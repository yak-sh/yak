// Coverage is knowledge, not a second copy of the payload. A missing property
// outside this scope is unloaded, not an authoritative null.
import { type Bundle, comps } from '@yaks/graph'

/** true = whole wire row; otherwise named components/columns only.
 * A component mapped to true is whole, [] covers only its presence. */
export type Coverage = true | Record<string, true | string[]>

/** Whether a delivery covers a component's presence or a particular column. */
export let covers = (scope: Coverage, name: string, prop?: string): boolean =>
  scope === true ||
  (prop === undefined
    ? Object.hasOwn(scope, name)
    : scope[name] === true || (scope[name] || []).includes(prop))

/** Peer riders without a declared scope cover only what they delivered. */
export let delivered = (b: Bundle): Coverage =>
  Object.fromEntries(
    comps(b).map(([name, comp]) => [
      name,
      comp === null ? true : Object.keys(comp),
    ]),
  )
