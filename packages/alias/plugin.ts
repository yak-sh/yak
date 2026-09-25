// The package as a graph plugin: the `alias` component, the shorthand that
// writes one, and the lookup that accepts one wherever an eid is accepted.
//
// It contributes no `key` component and no deduplication of its own —
// @yaks/key has both, and this plugin is registered beside it
// (`plugins: [keys(vocab), aliases()]`). What is left is exactly what is
// particular to a name: how you write one, and that a name resolves to an id.

import type { Plugin } from '@yaks/graph'
import { aliasDoc } from './comp.ts'
import { split } from './sugar.ts'
import { addressed } from './refs.ts'

/**
 * The alias plugin:
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { keyDoc, keyKeywords, keys } from '@yaks/key'
 * import { aliasDoc, aliases } from '@yaks/alias'
 *
 * let vocab = loadVocab([keyDoc, aliasDoc], [keyKeywords])
 * let g = graph({ storage: ram(vocab), vocab, plugins: [keys(vocab), aliases()] })
 * ```
 *
 * It contributes {@link aliasDoc}, turns `alias{name}` on an entity into the
 * key entity it stands for, and accepts a name wherever an eid is accepted,
 * through `graph.address(ids)` — which a write's `normalize` phase asks about
 * every id the write names, before this plugin's shorthand runs, so one bundle
 * may be addressed by a name and claim another name at the same time.
 */
export let aliases = (): Plugin => ({
  name: '@yaks/alias',
  vocab: [aliasDoc],
  address: addressed,
  hooks: { normalize: split() },
})
