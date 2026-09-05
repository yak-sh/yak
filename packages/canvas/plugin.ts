// The package as a graph plugin: the components, and nothing else.
//
// There is no hook here, and that is the point. The one rule this domain has
// — a card dies with the thing it shows — is DECLARED, as `death: cascade` on
// `card.target`, so the graph's own reaper enforces it in the same
// transaction as the delete that caused it. A hook that went looking for
// widowed cards afterwards would be a second, slower, wronger copy of a rule
// the vocabulary already states.

import type { Plugin } from '@yaks/graph'
import { canvasDoc } from './comp.ts'

/**
 * The canvas plugin: the spatial-UI components, contributed to a graph.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { canvas, canvasDoc } from '@yaks/canvas'
 *
 * let vocab = loadVocab([canvasDoc, mine])
 * let g = graph({ storage, vocab, plugins: [canvas()] })
 * ```
 *
 * Rendering is a client's job; this only says what the pieces ARE. The
 * geometry a renderer needs — {@link visible}, {@link place},
 * {@link frame} — are plain functions beside it, framework-free on purpose,
 * so a web canvas and a terminal share one answer.
 */
export let canvas = (): Plugin => ({
  name: '@yaks/canvas',
  vocab: [canvasDoc],
})
