// The package as a graph plugin: one component, and no hooks at all.
//
// There is nothing to enforce. A title is a title, a body is a body, and every
// rule anybody would want around them — who may write one, whether the text is
// content-addressed, whether it is indexed for search — belongs to a package
// that owns that question (@yaks/member, @yaks/blob, @yaks/fts), composed
// beside this one. So the plugin is the vocabulary and a name, which is what a
// base content domain should be.

import type { Plugin } from '@yaks/graph'
import { docDoc } from './comp.ts'

/**
 * The document plugin: the `doc{title, body}` component, and nothing else.
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { loadVocab } from '@yaks/vocab'
 * import { docDoc, docs } from '@yaks/doc'
 *
 * let vocab = loadVocab([docDoc, mine])
 * let g = graph({ storage, vocab, plugins: [docs()] })
 * ```
 *
 * Compose it once per graph. A vocabulary refuses a component declared twice,
 * so a package that needs `doc` — {@link https://jsr.io/@yaks/mail | @yaks/mail}
 * is one — depends on this one and leaves composing it to you, rather than
 * shipping a second copy of the word.
 */
export let docs = (): Plugin => ({ name: '@yaks/doc', vocab: [docDoc] })
