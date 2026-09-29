/**
 * @yaks/inspect: the inspector. A graph's data model, its values and how they
 * flow, drawn as pages and listings of @yaks/ui parts for a browser and a
 * terminal alike, with feedback left on any part where it was seen.
 *
 * The views know no store. Each is selected through @yaks/render, declares
 * the queries it needs as data, and draws what the host answers; an edit goes
 * out as bundles. The inspector's own state (a folded section, a lens, the
 * trail, the map's listings) lives in the page's own graph (./vocab.json).
 *
 * - `views`: every view, as a registry: the `/views` facet (./views.ts).
 * - `inspector(registry, host)`: the `Door` a host draws them through, and
 *   their `io` (./door.ts).
 * - `opened`, `ran`, `MAP`: the map set up in a page's graph, a line run in
 *   its bar, and its entity (./Map.ts).
 * - `feedback`: the change that leaves feedback on a part (./Feedback.ts).
 * - `Host`, `View`, `Answer`, `Ask`: the contract (./host.ts).
 *
 * @module
 */

export { type DoorProps, type Inspector, inspector } from './door.ts'
export { feedback } from './Feedback.ts'
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
export { LISTINGS, MAP, opened, QUERY, ran } from './Map.ts'
export { all, views } from './views.ts'
