// The kernel's words, completion authors, and explicitly attributed decisions.

import { hook, type Plugin } from '@yaks/graph/plugin'
import { completing } from './completion.ts'
import { deciding } from './decision.ts'
import { kernelDoc } from './vocab.ts'

/**
 * The kernel plugin: every component ./vocab.json declares, and a
 * `precondition` hook that records completion and decision attribution.
 */
/// let { loadVocab, pick } = await import('@yaks/vocab')
/// let { graph } = await import('@yaks/graph')
/// let { ram } = await import('@yaks/ram')
/// let { kernelDoc } = await import('@yaks/kernel')
/// let vocab = loadVocab(pick(kernelDoc, ['completed']))
/// let g = graph({ storage: ram(vocab), vocab, plugins: [kernel()] })
/// await g.apply([{ entity: { eid: 'w1' }, completed: {} }])
/// let [work] = await g.get(['w1'])
/// work ~> { completed: { by: undefined } }
export let kernel = (): Plugin => ({
  name: '@yaks/kernel',
  vocab: [kernelDoc],
  requests: ['$decider'],
  hooks: {
    precondition: hook(
      ['completed', '$decider'],
      (bundles, tx) => completing(deciding(bundles), tx),
    ),
  },
})
