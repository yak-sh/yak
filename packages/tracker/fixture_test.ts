// Tracker tests use graph admission and queries, with no filesystem or Worker.
// External references use UUIDs or commit hashes: absent word names are refused
// even in trusted writes, while global eids need no local catalog record.
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
import { effects as registry } from '@yaks/effects'
import { effects, type Options } from './effects.ts'

let vocab = loadVocab([
  kernelDoc,
  toolsDoc,
  apiDoc,
  docDoc,
  mailDoc,
  trackerDoc,
  wakeDoc,
], [kernelKeywords])

export let fixture = (
  options?: Options,
  clock = () => '2026-10-02T00:00:10Z',
) => {
  let g: ReturnType<typeof graph>
  let fx = options
    ? registry(vocab, { write: (b) => g.apply(b, { trusted: true }) })
    : undefined
  g = graph({
    vocab,
    storage: ram(vocab, { computed }),
    actor: { by: crypto.randomUUID(), via: crypto.randomUUID() },
    clock,
    plugins: fx ? [fx] : [],
  })
  if (fx) fx.handle(effects({ graph: g }, options))
  return g
}
