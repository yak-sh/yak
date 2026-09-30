// The package as a graph plugin: the kernel's words, plus the hook that keeps
// who finished a piece of work on its `completed` mark.

import type { Plugin } from '@yaks/graph'
import { completing } from './completion.ts'
import { kernelDoc } from './vocab.ts'

/**
 * The kernel plugin: every component ./vocab.json declares, and a
 * `precondition` hook that records who completed something.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { kernel, kernelDoc, kernelKeywords } from '@yaks/kernel'
 *
 * let vocab = loadVocab([kernelDoc], [kernelKeywords])
 * let g = graph({ storage: ram(vocab), vocab, plugins: [kernel()] })
 * await g.apply([{ entity: { eid: 'w1' }, completed: {} }])
 * ```
 */
export let kernel = (): Plugin => ({
  name: '@yaks/kernel',
  vocab: [kernelDoc],
  hooks: { precondition: (bundles, tx) => completing(bundles, tx) },
})
