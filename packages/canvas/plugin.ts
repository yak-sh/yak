// The package as a graph plugin: the components, and nothing else.
//
// There is no hook here, and that is the point. The one rule this package has
// — a card is deleted with the thing it shows — is declared, as
// `death: cascade` on `card.target`, so the graph itself enforces it in the
// same transaction as the delete that caused it. A hook that went looking for
// orphaned cards afterwards would be a second, slower, less correct copy of a
// rule the vocabulary already states.

import type { Plugin } from '@yaks/graph'
import { canvasDoc } from './comp.ts'

/**
 * The canvas plugin: the spatial-UI components, contributed to a graph.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { canvas, canvasDoc } from '@yaks/canvas'
 *
 * let vocab = loadVocab([canvasDoc])
 * let g = graph({ storage: ram(vocab), vocab, plugins: [canvas()] })
 * ```
 *
 * Rendering is a client's job; this only declares what the pieces are. The
 * geometry a renderer needs — {@link visible}, {@link place},
 * {@link frame} — are plain functions beside it, framework-free on purpose,
 * so a web canvas and a terminal share one answer.
 */
export let canvas = (): Plugin => ({
  name: '@yaks/canvas',
  vocab: [canvasDoc],
})
