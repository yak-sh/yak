// The package as a graph plugin: the `key` component, the id a key derives from
// its own pair, the refusal that keeps half-sentences out, and the dedupe that
// makes stating a value twice land on one entity.
//
// It takes the loaded vocabulary because the kinds are the APPLICATION's, not
// this package's: which components tag a key is something only a loaded
// vocabulary knows. So a graph is built in two steps — load the documents, then
// hand the same vocabulary to the plugin.

import type { Hook, Plugin } from '@yaks/graph'
import { then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { KEY, names } from './kinds.ts'
import { derive } from './eid.ts'
import { stated } from './guard.ts'
import { retired, settled } from './resolve.ts'
import { keyDoc } from './comp.ts'

// The mint phase: refuse half a sentence first, so the dedupe below only ever
// reads whole ones.
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
 * states (so a `$alias`ed value lands on the same entity every time it is
 * stated), refuses at `mint` any key missing its kind, its value or its `of`,
 * and resolves a batch that claims a value somebody already holds onto that
 * holder.
 */
export let keys = (vocab: Vocab): Plugin => ({
  name: '@yaks/key',
  vocab: [keyDoc],
  derive: { [KEY]: derive(names(vocab)) },
  hooks: { mint: minting(vocab), cascade: retired(vocab) },
})
