// The package as a graph plugin: the kernel's words, plus the hook that keeps
// who finished a piece of work on its `completed` mark.

import { hook, type Plugin } from '@yaks/graph'
import { completing } from './completion.ts'
import { kernelDoc } from './vocab.ts'

/**
 * The kernel plugin: every component ./vocab.json declares, and a
 * `precondition` hook that records who completed something.
 */
/// let { loadVocab, pick } = await import('@yaks/vocab')
/// let { graph } = await import('@yaks/graph')
/// let { ram } = await import('@yaks/ram')
/// let { kernelDoc } = await import('@yaks/kernel')
/// let vocab = loadVocab(pick(kernelDoc, ['completed']))
/// let g = graph({ storage: ram(vocab), vocab, plugins: [kernel()] })
/// await g.apply([{ entity: { eid: 'w1' }, completed: {} }])
/// let [work] = await g.get(['w1'])
/// work ~> { completed: { by: null } }
export let kernel = (): Plugin => ({
  name: '@yaks/kernel',
  vocab: [kernelDoc],
  hooks: { precondition: hook(['completed'], completing) },
})
