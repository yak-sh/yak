// The package as a graph plugin: the `alias` component, the shorthand that
// writes one, and the lookup that accepts one wherever an eid is accepted.
//
// It contributes no `key` component and no deduplication of its own —
// @yaks/key has both, and this plugin is registered beside it
// (`plugins: [keys(vocab), aliases(vocab)]`). What is left is exactly what is
// particular to a name: how you write one, and that a name resolves to an id.
//
// It is given the loaded vocabulary because the hook rewrites references, and
// which properties are references is something only a loaded vocabulary knows.

import type { Hook, Plugin } from '@yaks/graph'
import { then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { aliasDoc } from './comp.ts'
import { split } from './sugar.ts'
import { addressed, pointed } from './refs.ts'

// The `normalize` phase, both halves: names resolved to ids first, then the
// shorthand turned into key entities. That order, because one bundle may be
// addressed by a name and claim another name at the same time.
let spelled = (vocab: Vocab): Hook => {
  let by = pointed(vocab)
  let sugar = split()
  return (bundles, tx) => then(by(bundles, tx), (b) => sugar(b, tx))
}

/**
 * The alias plugin:
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { keyDoc, keyKeywords, keys } from '@yaks/key'
 * import { aliasDoc, aliases } from '@yaks/alias'
 *
 * let vocab = loadVocab([keyDoc, aliasDoc, mine], [keyKeywords])
 * // let g = graph({ storage, vocab, plugins: [keys(vocab), aliases(vocab)] })
 * ```
 *
 * It contributes {@link aliasDoc}, turns `alias{name}` on an entity into the
 * key entity it stands for, and accepts a name wherever an eid is accepted — in
 * a write through the hook, and elsewhere through `graph.address(ids)`.
 */
export let aliases = (vocab: Vocab): Plugin => ({
  name: '@yaks/alias',
  vocab: [aliasDoc],
  address: addressed,
  hooks: { normalize: spelled(vocab) },
})
