/**
 * @yaks/web — the web door: a graph's canvas, cards, boards and editing in a
 * browser. A host whose config names this package answers `/`, `/admin` and
 * every entity's id (`/T-9`) with the app, served beside @yaks/api's doors,
 * which it reads and writes through @yaks/client.
 *
 * - `./routes` — the facet a host composes: the page, the bundled app, its
 *   stylesheet, icons and the vocabulary (routes.ts).
 * - `.` — the vocabulary the app speaks, learned from the host's documents
 *   (types.ts `learn`).
 *
 * @module
 */

export { learn, vocab } from './types.ts'
