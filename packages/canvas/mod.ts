/**
 * @yaks/canvas — the spatial-UI component domain for a
 * {@link https://jsr.io/@yaks/graph | @yaks/graph}: the interface is data.
 *
 * Picture a wall of sticky notes. The wall is a `canvas`; each note is a
 * `card` showing something, and its `pin` says where on the wall it sits.
 * Whoever is looking has a `camera` — a centre, a scale, and the size of
 * their window — and a `cursor` naming what they have open. There is a second
 * way to arrange the same things (`layout` and `pane`, a split of the screen
 * rather than a plane), a `fold` for the sections someone has collapsed, and
 * a `shelf` for what they are holding off the wall.
 *
 * All of it is entities wearing components, which is the whole idea: a layout
 * is stored, queried, shared and undone exactly like the content it frames,
 * and a card is something another window — or a script, or an agent — can
 * read and move. A private view-model can do none of that.
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
 * ## One rule, declared
 * A card dies with the thing it shows — `death: cascade` on `card.target`, so
 * the graph's reaper enforces it in the same transaction as the delete that
 * caused it. There is no hook and no orphan sweep.
 *
 * ## Where each piece lives
 * Every component declares a {@link https://jsr.io/@yaks/sync | @yaks/sync}
 * `persist` tier. All of them are `wire`. The shared ones obviously so — a
 * wall nobody else can see is not a wall. The per-window ones (`camera`,
 * `cursor`, `fold`, `shelf`, `client`) are the interesting call: they
 * describe ONE window, so `local` looks right, and it is wrong. Something
 * other than that window has to read them — a second tab restoring the
 * viewport it left, a directory of who is looking at what, a tool that moves
 * somebody's open card by writing their `cursor`.
 *
 * ## The geometry is plain functions
 * {@link visible} is what a renderer asks every frame, {@link place} is where
 * the next card goes, and {@link frame} is the camera that fits everything.
 * They take plain objects and touch no platform API, so a browser canvas and
 * a terminal share one answer rather than drifting apart.
 *
 * @module
 */

export * from './comp.ts'
export * from './geom.ts'
export * from './view.ts'
export * from './place.ts'
export * from './plugin.ts'
