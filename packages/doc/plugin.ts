// Document reads carry the body token used by the graph precondition.

import type { Plugin } from '@yaks/graph'
import { witnessed } from './freshness.ts'
import { docDoc } from './comp.ts'

/**
 * The document plugin: `doc{title, body}` and its read token.
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { loadVocab } from '@yaks/vocab'
 * import { ram } from '@yaks/ram'
 * import { docDoc, docs } from '@yaks/doc'
 *
 * let vocab = loadVocab([docDoc])
 * let g = graph({ storage: ram(vocab), vocab, plugins: [docs()] })
 * ```
 *
 * Compose it once per graph. A vocabulary rejects a component declared twice,
 * so a package that needs `doc` — {@link https://jsr.io/@yaks/mail | @yaks/mail}
 * is one — depends on this one and leaves composing it to you, rather than
 * shipping a second copy of the component.
 */
export let docs = (): Plugin => ({
  name: '@yaks/doc',
  vocab: [docDoc],
  answer: (_ctx, bundles) => bundles.map(witnessed),
})
