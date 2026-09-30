/**
 * @yaks/inspect: the inspector. A graph's data model, its values and how they
 * flow, as a schema browser, the same in a browser and a terminal: the index
 * of packages and components, and beside it the pages gone to, stacked, the
 * top one drawn and a strip for each under it. Everything a client may write
 * is written in place, and any heading takes a note, picked up as work.
 *
 * The views know no store. Each is selected through @yaks/render, declares
 * the queries it needs as data, and draws what the host answers; an edit goes
 * out as bundles. The inspector's own state (the stack of pages, what is
 * armed, how each table runs) lives in the page's own graph (./front.json,
 * and @yaks/ux's `Stack`). A value is changed where it stands through
 * @yaks/ux's `Edit`, whose host the page hands down over its own
 * (`editing`).
 *
 * - `views`: every view, as a registry: the `/views` facet (./views.ts);
 *   `composed(more)`, with the views other packages contribute ahead of them.
 * - `inspector(registry, host)`: the `Door` a host draws them through, and
 *   their `io` (./door.ts).
 * - What a package's own page for its kind is built with besides the parts
 *   any page has (`io.show(e, 'Inspect.Head')`): `Part`, a titled part with
 *   its notes; `usePageNotes`, the notes by heading; `mention`, an entity by
 *   its name, linked; `reads`, a value as a person reads it; `useNamed`, the
 *   entities a part names, asked for.
 * - `frame(inspector, chrome)`: the index and the stack around them
 *   (./Frame.ts).
 * - `note`: the change that leaves a note under a heading (./notes.ts).
 * - `Host`, `View`, `Answer`, `Ask`: the contract (./host.ts).
 * - `stackOf`, `stackPath`, `queryPath`, `pagePath`, `at`: the inspector's
 *   addresses, each a stack of panes (./where.ts).
 *
 * `./routes` serves its own page at `/inspect` (./main.ts, over ./live.ts),
 * `./cli` holds it in a terminal as `yak inspect` (./tui.ts), and `./front`
 * is its page's own components.
 *
 * @module
 */

export { type DoorProps, type Inspector, inspector } from './door.ts'
export { type Chrome, frame } from './Frame.ts'
export { note, Part, type PartProps, useNamed } from './notes.ts'
export { type PageCtx, usePageNotes } from './Entity.ts'
export type { HeadCtx } from './Head.ts'
export type { FactsCtx } from './Facts.ts'
export type { LinksCtx } from './Links.ts'
export { mention, reads } from './value.ts'
export type {
  Answer,
  Ask,
  Asks,
  Bundle,
  Front,
  Host,
  Io,
  Props,
  View,
} from './host.ts'
export { edited, editing, follow, INSPECT, STACK } from './state.ts'
export { all, composed, views } from './views.ts'
export {
  type At,
  at,
  HOME,
  pagePath,
  queryPath,
  stackOf,
  stackPath,
} from './where.ts'
