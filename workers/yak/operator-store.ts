// The space's private work stays beside its builder, outside app restores.
import { type Graph, graph, type Plugin, type Storage } from '@yaks/graph'
import { driver, type DurableStorage, storage } from '@yaks/durable-object'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { provenanceDoc } from '@yaks/provenance/vocab'
import { docDoc } from '@yaks/doc/vocab'
import { taskDoc } from '@yaks/task/vocab'
import { personaDoc } from '@yaks/persona'
import { projectDoc } from '@yaks/project/vocab'
import { sessionDoc, sessions } from '@yaks/session'
import { modelDoc } from '@yaks/model'
import { providerDocs } from './providers.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDerived } from '@yaks/session/status'
import { contextDoc } from '@yaks/context'
import { effectDoc, effects, expireDaily } from '@yaks/effects'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import {
  artifactDoc,
  blobKeywords,
  blobRead,
  blobSchema,
  sqliteBlobs,
} from '@yaks/blob'
import { plugins as blobs } from '@yaks/blob/graph'
import { ids } from '@yaks/id/graph'
import { phoneDoc } from '@yaks/phone'
import { phoneTexts } from './phone-move.ts'
import { channeled } from './channel-move.ts'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { operatorDoc } from './operator-vocab.ts'
import { draftDoc, drafts } from '@yaks/draft'
import { memoryDoc } from '@yaks/memory/vocab'
import { topicDoc } from '@yaks/topic'
import { wakeDoc } from '@yaks/wake/vocab'
import { due, soonest, tick, wakes } from '@yaks/wake'
import { caught } from './defects.ts'
import { adopt, indexed, search } from '@yaks/fts'

export let operatorVocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  docDoc,
  taskDoc,
  projectDoc,
  personaDoc,
  sessionDoc,
  modelDoc,
  ...providerDocs,
  toolsDoc,
  contextDoc,
  effectDoc,
  edgeDoc,
  artifactDoc,
  mailDoc,
  operatorDoc,
  {
    $defs: Object.fromEntries(
      Object.entries(phoneDoc.$defs!).filter(([name]) =>
        ['text', 'sender'].includes(name)
      ),
    ),
  },
  // A person's Updates from the Operator (operator-updates.ts): what it
  // tells them, and what each has read.
  {
    $defs: Object.fromEntries(
      Object.entries(notifyDoc.$defs!).filter(([name]) =>
        ['notification', 'subscription'].includes(name)
      ),
    ),
  },
  draftDoc,
  memoryDoc,
  topicDoc,
  // The wake-ups the Operator sets for the people it works for
  // (operator-wakes.ts).
  wakeDoc,
], [kernelKeywords, edgeKeywords, blobKeywords])

export let operatorStore = (
  durable: DurableStorage,
  options: Parameters<typeof effects>[1] = {},
) => {
  let vocab = operatorVocab
  let sql = driver(durable)
  let kept = sqliteBlobs(sql)
  let derived = { ...blobRead(vocab), ...sessionDerived(vocab) }
  // The Operator finds what was said in its own work by its words: an
  // entry's text, a doc's title and body, a memory (@yaks/fts).
  let text = indexed(vocab)
  let store = storage(durable, vocab, { derived, extend: [search(text, sql)] })
  for (let stmt of blobSchema()) sql.query(stmt)
  store.install()
  adopt(sql, text, derived, { heal: false })
  return operatorGraph(store, blobs({ vocab, blobs: kept }), options)
}

/** The Operator's work graph, independent of its durable storage boundary. */
export let operatorGraph = (
  storage: Storage,
  plugins: Plugin[],
  options: Parameters<typeof effects>[1] = {},
) => {
  let vocab = operatorVocab
  // Several runs at once: a person's next words, an email and a tool call
  // are taken while a session waits on its model. Each incarnation owes its
  // start-up runs as it first works the pool, so it takes up what the one
  // before it left held (@yaks/session `session_recover`).
  let fx = effects(vocab, {
    singleOwner: true,
    startup: 'join',
    defer: true,
    max: 8,
    ...options,
  })
  // Its tools take back the `#id` its context names everything by.
  let g = graph({
    storage,
    vocab,
    plugins: [sessions(), drafts(), ids(vocab), wakes(), ...plugins, fx],
  })
  return { g, fx, vocab }
}

/** An object's alarm, as its storage keeps it. */
export type Alarms = {
  setAlarm(at: number): Promise<void>
  getAlarm(): Promise<number | null>
  deleteAlarm(): Promise<void>
}

/** How long an object's wake may go unheard before it wakes again. */
export let BACKSTOP = 15_000

/**
 * The object's alarm: `work` (a `drain`) under an alarm armed BACKSTOP from
 * now, so a wake the object dies under (a deploy's reset under a step in
 * flight) wakes its replacement, which takes the step up again; then armed
 * for the next run due, or cleared when none is and nothing armed it since.
 *
 * The alarm answers once its work is under way, and one that rings while the
 * work goes arms the backstop again and starts no second: an alarm still
 * open when its object is reset holds back every alarm after it until
 * Cloudflare gives up on it, fourteen minutes for Jeff's (T-145428), the
 * backstop that would take the step up included. Work that fails is
 * reported, and the backstop it leaves armed tries it again.
 */
export let waking = (storage: Alarms, report: (e: unknown) => void) => {
  let armed = 0, going: Promise<void> | undefined
  return async (work: () => Promise<number | null>) => {
    armed = Date.now() + BACKSTOP
    await storage.setAlarm(armed)
    going ??= (async () => {
      try {
        let next = await work()
        if (next) await storage.setAlarm(next)
        else if (await storage.getAlarm() == armed) await storage.deleteAlarm()
      } catch (e) {
        report(e)
      } finally {
        going = undefined
      }
    })()
  }
}

/** How long a wake-up a tick refused waits before it is tried again. */
export let RETRY = 60_000

/**
 * How long one wake starts runs for. An alarm is one invocation, whose CPU
 * the runtime caps (wrangler.toml `[limits]`, five minutes): a store whose
 * sessions keep owing steps (forks forking) would otherwise work them all in
 * one alarm until it is killed.
 * What a slice leaves waits for the next alarm, armed at once.
 */
export let SLICE = 10_000

/**
 * Work the store's pool until nothing is due or `until` passes, as the
 * object's alarm does: first each wake-up due fires (@yaks/wake `tick`), then
 * each session step is a run, and its commit owes the next; the steps going
 * at `until` finish. Answers when the next pending run it handles or the next
 * wake-up is due (ms since the epoch), now when the slice ended with one due,
 * or null when neither is.
 */
export let drain = async (
  { g, fx }: Pick<ReturnType<typeof operatorStore>, 'g' | 'fx'>,
  until = Date.now() + SLICE,
): Promise<number | null> => {
  await phoneTexts(g)
  await channeled(g)
  // A firing is the store's own write, as every other write the Operator
  // keeps of itself is.
  let { refused } = await tick({
    read: (q, o) => g.read(q, o),
    apply: (b, o) => g.apply(b, { ...o, trusted: true }),
  }, Date.now())
  for (let { wake, error } of refused) {
    caught(error, { request: 'operator wake', wake: wake.entity.eid })
  }
  let run = await working({ g, fx }, until)
  await expiring(g, until)
  // One that came due while the pool worked fires on the next alarm; one a
  // tick refused waits RETRY, rather than ringing the alarm at once again.
  let now = Date.now()
  let wake = (await due(g, now)).length
    ? now + (refused.length ? RETRY : 1000)
    : await soonest(g, now)
  return run == null ? wake : wake == null ? run : Math.min(run, wake)
}

/** This process, as the retention pass's lease names its holder. */
let holder = crypto.randomUUID()

/**
 * The store's daily retention pass (@yaks/effects `expireDaily`) in what the
 * slice leaves: what the vocabulary declares expired goes (a session's
 * context parts and tool results after thirty days), and the graves every
 * finished run leaves are pruned thirty days after it. A pass the slice cuts
 * off goes on at the next wake, which holds it as the same process.
 */
let expiring = async (g: Graph, until: number) => {
  let left = until - Date.now()
  if (left <= 0) return
  try {
    await expireDaily(g, {
      owner: holder,
      signal: AbortSignal.timeout(left),
    })
  } catch (e) {
    caught(e, { request: 'operator expire' })
  }
}

let working = async (
  { g, fx }: Pick<ReturnType<typeof operatorStore>, 'g' | 'fx'>,
  until: number,
): Promise<number | null> => {
  // A pending run no handler here takes arms nothing: words declared before
  // their handler was (sessions' were, until the Operator ran on them).
  let handled = fx.slots().filter((s) => s.effect && s.run).map((s) => s.id)
  if (!handled.length) return null
  let seen = ''
  for (;;) {
    await fx.work(g, undefined, { until })
    await fx.idle()
    let [next] = await g.read(
      `.effect.state=pending .effect.handler=${
        handled.join(',')
      } .order=effect.next .limit=1`,
    )
    if (!next) return null
    let at = Date.parse(String((next.effect as { next?: string }).next)) ||
      Date.now()
    if (at <= Date.now() && Date.now() >= until) return Date.now()
    // A due run this pass left as it found it is nobody's to take here.
    let now = JSON.stringify(next)
    if (at > Date.now() || now == seen) return Math.max(at, Date.now() + 1000)
    seen = now
  }
}
