// The space's private work stays beside its builder, outside app restores.
import { graph, type Plugin, type Storage } from '@yaks/graph'
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
import { effectDoc, effects } from '@yaks/effects'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import {
  artifactDoc,
  blobKeywords,
  blobRead,
  blobSchema,
  sqliteBlobs,
} from '@yaks/blob'
import { plugins as blobs } from '@yaks/blob/graph'
import { phoneDoc } from '@yaks/phone'
import { phoneTexts } from './phone-move.ts'
import { channeled } from './channel-move.ts'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { operatorDoc } from './operator-vocab.ts'
import { draftDoc, drafts } from '@yaks/draft'
import { memoryDoc } from '@yaks/memory/vocab'
import { topicDoc } from '@yaks/topic'
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
  // are taken while a session waits on its model.
  let fx = effects(vocab, {
    singleOwner: true,
    defer: true,
    max: 8,
    ...options,
  })
  let g = graph({
    storage,
    vocab,
    plugins: [sessions(), drafts(), ...plugins, fx],
  })
  return { g, fx, vocab }
}

/**
 * Work the store's pool until nothing is due, as the object's alarm does:
 * each session step is a run, and its commit owes the next. Answers when the
 * next pending run it handles is due (ms since the epoch), or null when none
 * is.
 */
export let drain = async (
  { g, fx }: Pick<ReturnType<typeof operatorStore>, 'g' | 'fx'>,
): Promise<number | null> => {
  await phoneTexts(g)
  await channeled(g)
  // A pending run no handler here takes arms nothing: words declared before
  // their handler was (sessions' were, until the Operator ran on them).
  let handled = fx.slots().filter((s) => s.effect && s.run).map((s) => s.id)
  let seen = ''
  for (;;) {
    await fx.work(g)
    await fx.idle()
    let [next] = await g.read(
      `.effect.state=pending .effect.handler=${
        handled.join(',')
      } .order=effect.next .limit=1`,
    )
    if (!next) return null
    let at = Date.parse(String((next.effect as { next?: string }).next)) ||
      Date.now()
    // A due run this pass left as it found it is nobody's to take here.
    let now = JSON.stringify(next)
    if (at > Date.now() || now == seen) return Math.max(at, Date.now() + 1000)
    seen = now
  }
}
