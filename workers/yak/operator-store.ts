// The space's private work stays beside its builder, outside app restores.
import { graph } from '@yaks/graph'
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

export let operatorVocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  docDoc,
  taskDoc,
  projectDoc,
  personaDoc,
  sessionDoc,
  modelDoc,
  toolsDoc,
  contextDoc,
  effectDoc,
  edgeDoc,
  artifactDoc,
], [kernelKeywords, edgeKeywords, blobKeywords])

export let operatorStore = (durable: DurableStorage) => {
  let vocab = operatorVocab
  let sql = driver(durable)
  let kept = sqliteBlobs(sql)
  let store = storage(durable, vocab, {
    derived: { ...blobRead(vocab), ...sessionDerived(vocab) },
  })
  for (let stmt of blobSchema()) sql.query(stmt)
  store.install()
  let fx = effects(vocab)
  let g = graph({
    storage: store,
    vocab,
    plugins: [sessions(), ...blobs({ vocab, blobs: kept })],
  })
  return { g, fx, vocab }
}
