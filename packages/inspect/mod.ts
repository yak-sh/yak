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
 * - `views`: every view, as a registry: the `/views` facet (./views.ts).
 * - `inspector(registry, host)`: the `Door` a host draws them through, and
 *   their `io` (./door.ts).
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
export { note } from './notes.ts'
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
export { editing, follow, INSPECT, STACK } from './state.ts'
export { all, views } from './views.ts'
export {
  type At,
  at,
  HOME,
  pagePath,
  queryPath,
  stackOf,
  stackPath,
} from './where.ts'
