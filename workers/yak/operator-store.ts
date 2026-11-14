// The space's private work stays beside its builder, outside app restores.
// Its store is composed from its config (config.ts `operatorConfig`) through
// @yaks/host's assembly, as the Store object composes each kind it serves.
import { statements } from '@yaks/sqlite'
import type { Bundle, Graph, Storage } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { held } from '@yaks/id/graph'
import { type Ids, readable } from '@yaks/tools/readable'
import type { Extension } from '@yaks/sql'
import { driver, type DurableStorage } from '@yaks/durable-object/sql'
import { bounded } from '@yaks/durable-object/ceiling'
import { storage } from '@yaks/durable-object/store'
import { type Config, used } from '@yaks/host/config'
import type { Assembly } from '@yaks/host/assembly'
import { lent, planned } from '@yaks/durable-object/compose'
import { wordsOf } from '@yaks/host/words'
import { trialDoc } from '@yaks/trial/vocab'
import { deliverChild } from '@yaks/session'
import { type Effects, effects, expireDaily, type Handler } from '@yaks/effects'
import { type Blobs, blobSchema, memoryBlobs, sqliteBlobs } from '@yaks/blob'
import { prefixes } from '@yaks/id'
import { phoneTexts } from './phone-move.ts'
import { channeled } from './channel-move.ts'
import { operatorDoc } from './operator-vocab.ts'
import { OWNERS } from './operator-owner.ts'
import { due, soonest, tick } from '@yaks/wake'
import type { Watching } from './operator-schedules.ts'
import { WAKES, wakesMoved } from './wake-move.ts'
import { caught } from './defects.ts'
import { RETRY, SLICE } from '@yaks/durable-object/alarm'
import { adopt, indexed, schema as ftsSchema, search } from '@yaks/fts'
import { installed, type Meta, meta, printOf, sole } from '@yaks/sqlite'
import { schema as logSchema } from '@yaks/api/log'
import { operatorConfig } from './config.ts'
import { load, vocabFacets } from './operator-load.ts'
import { vocabsOf } from './vocabs.ts'

// Its words alone, held to what its config names: read without loading any
// of its graph facets, and shared by every store the isolate opens.
let words = wordsOf(vocabsOf(operatorConfig, vocabFacets), undefined, {
  implicit: false,
})
export let operatorVocab = words.vocab

/** How the store numbers what it keeps: each entity in the series of the
 * letter its kind declares (@yaks/id `prefixes`), from 1, so a space's first
 * task is T-1 and its first goal V-1. A kind that declares none is its eid. */
export let NUMBERS = prefixes(operatorVocab)

/** Where the file says every entity it kept before it numbered them has
 * its number (number-move.ts). */
export let NUMBERED = 'operator:numbered'

/** Where the file keeps the print of the schema it was last fitted to. */
export let FITTED = 'operator:fitted'

// What the store reads a stored value through (each package's `derived`: a
// blob's text, a session's status), and what the Operator finds what was said
// in its own work by: an entry's text, a doc's title and body, a memory
// (@yaks/fts). Pure in the vocabulary, so made once an isolate, and with them
// the schema's print (`operatorStore`).
let derived = words.derived
let text = indexed(operatorVocab)
// The search indexes and their triggers, kept over component tables: each is
// made with the last table it rests on, by the write that first names that
// component (@yaks/sqlite `over`), as an app's store makes its own. A store
// fitted before any entry was written holds no `entry` table to index then.
let searching = ftsSchema(text, derived)
// The write log the object's Builder keeps a person's line in while it is
// stopped (build.ts `#hold`), fitted with the store, so the alarm that takes
// the lines up (`#take`) finds the log standing and runs no DDL to look.
let beside = () => [...blobSchema(), ...logSchema()]
let print: string | undefined

/** The revision of how the file is fitted, part of its print: a file fitted
 * when its search indexes were made only by the fitting holds no index over a
 * table a later write made, so this code fits it again and makes them. */
let FITTING = 2

// What it serves: its graph, whose effects the Operator's own code handles
// (operator-channels.ts `handleChannels`), so no package's are loaded.
let ROLES = ['graph'] as const
let plan = (config: Config) => async (): Promise<Assembly> =>
  (await planned(config, load, ROLES)())(words)

/** The Operator's store as its object composes it, made once an isolate. */
export let operatorPlan = plan(operatorConfig)

/** The same composition over rows in memory, where a body stays the text it
 * was written as: nothing there reads an address back as its text. */
export let memoryPlan = plan({
  plugins: operatorConfig.plugins!.map((plug) =>
    used(plug) == '@yaks/blob' ? { use: used(plug), facets: ['vocab'] } : plug
  ),
})

/**
 * The Operator's store over its object's storage. Its schema is the code's,
 * so it is fitted once a schema: a wake whose print (the storage's own, which
 * carries its fitting's revision, and the blob and search statements beside
 * it, @yaks/sqlite `follow`) the file recorded runs no DDL and writes
 * nothing, under a new Worker version too: fitted once a Worker version, the
 * first wake on each deploy ran the schema's DDL and wrote its receipt before
 * its answer, though the Operator's words rarely change. The print is
 * rendered once an isolate, about 12 ms.
 */
export let operatorStore = async (
  durable: DurableStorage,
  options: Parameters<typeof effects>[1] = {},
): Promise<OperatorStore> => {
  let plan = await operatorPlan()
  let sql = driver(durable)
  let stood = false
  let store!: ReturnType<typeof storage>
  let marks = meta(sql)
  let graphed = operatorGraph(plan, {
    blobs: sqliteBlobs(statements(sql)),
    storage: (extend) =>
      store = storage(durable, operatorVocab, {
        deferred: true,
        derived,
        number: NUMBERS,
        extend,
        over: () => searching,
        report: (error) => caught(error, { request: 'operator store' }),
        schemaReady: () => stood,
      }),
    extend: [search(text, sql)],
    fit: () => {
      print ??= printOf(`operator:${FITTING}:${store.print()}`, [
        ...beside(),
        ...searching,
      ])
      let born = installed(sql) == null
      stood = !born && marks.get(FITTED) == print
      if (stood) return
      for (let stmt of beside()) sql.query(stmt)
      let left = store.install()
      adopt(sql, text, derived, { heal: false })
      if (!left.length) marks.set(FITTED, print)
      // A new file holds nothing written before the rule that keeps owners,
      // nor any wake in the Operator's old words.
      if (born) marks.set(OWNERS, 'done')
      if (born) marks.set(WAKES, 'done')
      // Nor anything kept before it numbered what it keeps.
      if (born) marks.set(NUMBERED, 'done')
    },
    // How a run ended is written while the object is stopped too, so a run
    // that finished never runs again (@yaks/durable-object `bounded`).
    effects: {
      free: (write) => bounded(durable).free(write),
      ...options,
    },
  })
  return {
    ...graphed,
    marks,
    upkeep: store.upkeep,
    lettered: () => !sole(sql),
    waiting: () => bounded(durable).under(0.5),
  }
}

/** The Operator's work graph, and where its file keeps what was done to it
 * once (channel-move.ts `channeled`), which a store in memory has nowhere
 * to keep. */
export type OperatorStore = ReturnType<typeof operatorGraph> & {
  marks?: Meta
  upkeep?: () => number | null
  /** Whether its spine holds a number in each series, not one across them
   * all (@yaks/sqlite `sole`), which a stated pair needs. */
  lettered?: () => boolean
  /** Background passes share half the object's windows with schema upkeep. */
  waiting?: () => number
}

/** What a composition of the Operator's store is bound to: its storage, given
 * the clause compilers its plugins and `extend` add; where its bodies are
 * kept; how the file is brought to its schema; and its effects' options. */
export type Bound = {
  storage: (extend: Extension[]) => Storage
  blobs?: Blobs
  extend?: Extension[]
  fit?: () => void
  effects?: Parameters<typeof effects>[1]
}

/** The Operator's work graph, independent of its durable storage boundary:
 * `plan` bound to the storage `bound` lends. */
export let operatorGraph = (plan: Assembly, bound: Bound) => {
  // The store is no process host: nothing it composes runs a duty, holds a
  // secret or ends a process.
  let { host } = plan.bind({
    host: lent('operator', bound.blobs ?? memoryBlobs()),
    storage: (_host, extend) => bound.storage(extend),
    extend: () => bound.extend ?? [],
    schema: () => bound.fit?.(),
    // Several runs at once: a person's next words, an email and a tool call
    // are taken while a session waits on its model. Each incarnation owes its
    // start-up runs as it first works the pool, so it takes up what the one
    // before it left held (@yaks/session `session_recover`).
    effects: (host, disabled) =>
      effects(host.vocab, {
        singleOwner: true,
        startup: 'join',
        defer: true,
        max: 8,
        disabled,
        ...bound.effects,
      }),
  })
  let known = naming(host.vocab, host.graph)
  return {
    g: host.graph,
    fx: host.fx,
    vocab: host.vocab,
    known,
    readable: drawing(host.vocab, known),
  }
}

/**
 * What the store calls each entity of the small series it holds in memory
 * (@yaks/id/graph `held`), by eid: its id (`T-2`). A read of the series that
 * failed is reported, and calls nothing, so prose draws its handles.
 */
let naming = (vocab: Vocab, g: Graph) => {
  let small = held(vocab, g)
  return (): Promise<Ids> =>
    small().catch((error) => {
      caught(error, { request: 'operator ids' })
      return () => undefined
    })
}

/**
 * A tool's answer from the store as its reader reads it (@yaks/tools
 * `readable`): each eid its prose holds drawn as the entity's id, from the
 * answer itself or what the store calls it (`known`), else as its short
 * handle.
 */
let drawing =
  (vocab: Vocab, known: () => Promise<Ids>) =>
  async (answer: Bundle[]): Promise<Bundle[]> =>
    readable(vocab, await known())(answer)

/**
 * The Operator's own effects (operator-vocab.ts), and a trial round's run,
 * owed by every write from
 * the moment its store is made, before the Operator whose code runs them
 * (operator-channels.ts `handleChannels`) is: a commit owes runs only for
 * effects with code, so a request a new incarnation received before it had
 * made its Operator owed none, and was never taken up (T-150347). Each
 * stands in until the Operator's own replaces it; a run that starts before
 * then makes the Operator (`made`) and runs on its handler.
 */
export let owing = (fx: Effects, made: () => Promise<unknown>) => {
  // A trial round's run is the Operator's too (operator-trials.ts), and so
  // is what a wake set for a person asks (operator-schedules.ts).
  let own = [
    ...[operatorDoc, trialDoc].flatMap((doc) =>
      Object.entries(doc.$defs ?? {})
        .filter(([, def]) => (def as { effect?: boolean }).effect)
        .map(([id]) => id)
    ),
    'wake_run',
  ]
  fx.handle(Object.fromEntries(own.map((id) => {
    let stand: Handler = async (...args) => {
      await made()
      let run = fx.slots().find((s) => s.id == id)?.run
      if (!run || run == stand) throw new Error(`nothing runs ${id}`)
      return run(...args)
    }
    return [id, stand]
  })))
}

/**
 * Work the store's pool until nothing is due or `until` passes, as the
 * object's alarm does: first each wake-up due fires (@yaks/wake `tick`), a
 * subscription only when its query's rows changed (read through `watching`);
 * then each session step is a run, and its commit owes the next; the steps
 * going at `until` finish. Answers when the next pending run it handles or the next
 * wake-up is due (ms since the epoch), now when the slice ended with one due,
 * or null when neither is.
 */
export let drain = async (
  { g, fx, marks, upkeep }: Pick<
    OperatorStore,
    'g' | 'fx' | 'marks' | 'upkeep'
  >,
  // An alarm is one invocation, whose CPU the runtime caps (wrangler.toml
  // `[limits]`, five minutes): a store whose sessions keep owing steps
  // (forks forking) is worked a slice an alarm.
  until = Date.now() + SLICE,
  // How a subscription's query is read as its person (operator.ts
  // `watching`); over this store where none is given.
  watching?: Watching,
): Promise<number | null> => {
  let upkeepWait = upkeep?.()
  let upkeepAt = upkeepWait == null
    ? null
    : Date.now() + Math.max(1000, upkeepWait)
  await phoneTexts(g)
  await channeled(g, marks)
  // A firing is the store's own write, as every other write the Operator
  // keeps of itself is. None fires until the store's wakes are in their
  // package's words (wake-move.ts), so none fires in words nothing runs.
  let moved = wakesMoved(marks)
  let { refused } = moved
    ? await tick(
      {
        read: (q, o) => g.read(q, o),
        apply: (b, o) => g.apply(b, { ...o, trusted: true }),
      },
      Date.now(),
      { watching },
    )
    : { refused: [] }
  for (let { wake, error } of refused) {
    caught(error, { request: 'operator wake', wake: wake.entity.eid })
  }
  let run = await working({ g, fx }, until)
  let chats = await g.read('.spawned.notice=true&!completed&.fields=entity.eid')
  for (let chat of chats) {
    let next = await deliverChild(g, chat.entity.eid)
    if (next != null) run = run == null ? next : Math.min(run, next)
  }
  await expiring(g, until)
  // One that came due while the pool worked fires on the next alarm; one a
  // tick refused waits RETRY, rather than ringing the alarm at once again.
  let now = Date.now()
  let wake = (await due(g, now)).length
    ? now + (refused.length || !moved ? RETRY : 1000)
    : await soonest(g, now)
  let next = run == null ? wake : wake == null ? run : Math.min(run, wake)
  return upkeepAt == null
    ? next
    : next == null
    ? upkeepAt
    : Math.min(upkeepAt, next)
}

/** This process, as the retention pass's lease names its holder: minted at
 * the first pass, since a Worker may not make random values at load. */
let holder: string | undefined

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
      owner: holder ??= crypto.randomUUID(),
      signal: AbortSignal.timeout(left),
    })
  } catch (e) {
    caught(e, { request: 'operator expire' })
  }
}

let working = async (
  { g, fx }: Pick<OperatorStore, 'g' | 'fx'>,
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
