// Tracker tests use graph admission and queries, with no filesystem or Worker.
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { toolsDoc } from '@yaks/tools/vocab'
import { apiDoc } from '@yaks/api/vocab'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail/vocab'
import { wakeDoc } from '@yaks/wake'
import { ram } from '@yaks/ram'
import { computed, trackerDoc } from './vocab.ts'

export let fixture = () => {
  let vocab = loadVocab([
    kernelDoc,
    toolsDoc,
    apiDoc,
    docDoc,
    mailDoc,
    trackerDoc,
    wakeDoc,
  ], [kernelKeywords])
  return graph({
    vocab,
    storage: ram(vocab, { computed }),
    actor: { by: crypto.randomUUID(), via: crypto.randomUUID() },
    clock: () => '2026-10-02T00:00:10Z',
  })
}
