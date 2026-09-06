// The package as a graph plugin: the `alias` tag, the sugar that writes one,
// and the ladder that reads one back where an eid goes.
//
// It brings no carrier and no dedupe of its own — @yaks/key has both, and this
// plugin is composed BESIDE it (`plugins: [keys(vocab), aliases(vocab)]`). What
// is left is exactly what is particular to a name: how you say one, and that a
// name is worth an id.
//
// It takes the loaded vocabulary because the hook rewrites REFERENCES, and
// which columns are references is something only a loaded vocabulary knows.

import type { Hook, Plugin } from '@yaks/graph'
import { then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { aliasDoc } from './comp.ts'
import { split } from './sugar.ts'
import { addressed, pointed } from './refs.ts'

// The normalize phase, both halves: names read as ids first, then the sugar
// lifted into rows. That order, because a bundle may be addressed BY a name and
// claim another one in the same breath.
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
 * key entity it means, and accepts a name wherever an eid goes — in a batch
 * through the hook, and at a door through `graph.address(ids)`.
 */
export let aliases = (vocab: Vocab): Plugin => ({
  name: '@yaks/alias',
  vocab: [aliasDoc],
  address: addressed,
  hooks: { normalize: spelled(vocab) },
})
