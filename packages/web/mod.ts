/**
 * @yaks/web — a graph in a browser. A host whose config names this package
 * answers `/` and every entity's id (`/T-9`) with a read-only app, built from
 * the listed plugins' `./views` and served beside @yaks/api's doors.
 *
 * - `./routes` — the facet a host composes: the page, the bundled app, its
 *   stylesheet and the vocabulary (routes.ts).
 * - `./views` — the views any entity has (`Tile`, `Page`, `Facts`, `Comment`),
 *   portable, so a terminal can print them too (views.ts).
 * - `./client` — the browser entry the bundled app starts from (client.ts).
 *
 * @module
 */

export { type Related, type Shown, views } from './views.ts'
