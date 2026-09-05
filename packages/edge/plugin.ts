// The package as a graph plugin: the `edge` component, the id an edge derives
// from its own sentence, and the refusal that keeps half-sentences out.
//
// It takes the loaded vocabulary because the relations are the APPLICATION's,
// not this package's: which components tag an edge is something only a loaded
// vocabulary knows. So a graph is built in two steps — load the documents,
// then hand the same vocabulary to the plugin.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { EDGE, names } from './relations.ts'
import { derive } from './eid.ts'
import { stated } from './guard.ts'
import { edgeDoc } from './comp.ts'

/**
 * The edge plugin:
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
 *
 * let vocab = loadVocab([edgeDoc, blog], [edgeKeywords])
 * // let g = graph({ storage, vocab, plugins: [edges(vocab)] })
 * ```
 *
 * It contributes {@link edgeDoc}, derives an edge's id from the sentence it
 * states (so a `$alias`ed link lands on the same entity every time it is
 * stated), and refuses at `mint` any edge missing an end or a relation.
 */
export let edges = (vocab: Vocab): Plugin => ({
  name: '@yaks/edge',
  vocab: [edgeDoc],
  derive: { [EDGE]: derive(names(vocab)) },
  hooks: { mint: stated(vocab) },
})
