// The package as a graph plugin: the `key` component, the id a key derives from
// its own kind and value, the refusal that keeps incomplete keys out, and the
// resolution that makes claiming a value twice land on one entity.
//
// It takes the loaded vocabulary as an argument because the kinds are the
// application's, not this package's: which components tag a key is something
// only a loaded vocabulary knows. So a graph is built in two steps — load the
// documents, then pass the same vocabulary to the plugin.

import type { Hook, Plugin } from '@yaks/graph'
import { then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { KEY, names } from './kinds.ts'
import { derive } from './eid.ts'
import { stated } from './guard.ts'
import { retired, settled } from './resolve.ts'
import { keyDoc } from './comp.ts'

// The mint phase: refuse incomplete keys first, so the resolution below only
// ever reads complete ones.
let minting = (vocab: Vocab): Hook => {
  let whole = stated(vocab)
  let once = settled(vocab)
  return (bundles, tx) => then(whole(bundles, tx), (b) => once(b, tx))
}

/**
 * The key plugin:
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { keyDoc, keyKeywords, keys } from '@yaks/key'
 *
 * let vocab = loadVocab([keyDoc, library], [keyKeywords])
 * // let g = graph({ storage, vocab, plugins: [keys(vocab)] })
 * ```
 *
 * It contributes {@link keyDoc}, derives a key's id from the kind and value it
 * holds (so a value written under a `$alias` lands on the same entity every
 * time it is claimed), refuses at `mint` any key missing its kind, its value or
 * its `of`, and resolves a write claiming a value somebody already holds onto
 * that holder.
 */
export let keys = (vocab: Vocab): Plugin => ({
  name: '@yaks/key',
  vocab: [keyDoc],
  derive: { [KEY]: derive(names(vocab)) },
  hooks: { mint: minting(vocab), cascade: retired(vocab) },
})
