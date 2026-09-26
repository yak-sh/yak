// The package as a graph plugin: the `edge` component, the id a link derives
// from its own endpoints and relation, and the check that keeps incomplete
// links out.
//
// It is given the loaded vocabulary because the relations belong to the
// application, not to this package: which components name a relation is
// something only a loaded vocabulary knows. So a graph is built in two steps —
// load the documents, then pass that same vocabulary to the plugin.

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
 * import { ram } from '@yaks/ram'
 * import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
 *
 * let cites = { component: true, type: 'object', edge: true }
 * let blog = { $defs: { cites } }
 * let vocab = loadVocab([edgeDoc, blog], [edgeKeywords])
 * let g = graph({ storage: ram(vocab), vocab, plugins: [edges(vocab)] })
 * ```
 *
 * It contributes {@link edgeDoc}, derives a link's id from its endpoints and
 * relation (so a link written under a `$alias` lands on the same entity every
 * time), and rejects in the `mint` phase any edge missing an endpoint or a
 * relation.
 */
export let edges = (vocab: Vocab): Plugin => ({
  name: '@yaks/edge',
  vocab: [edgeDoc],
  derive: { [EDGE]: derive(names(vocab)) },
  hooks: { mint: stated(vocab) },
})
