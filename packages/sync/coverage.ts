// Coverage records which components and columns a delivery actually carried.
// It is not a second copy of the data: a property missing from a bundle but
// outside the delivery's coverage has simply not been loaded, and must not be
// read as a null the server asserted.
import { type Bundle, comps } from '@yaks/graph'

/** `true` = the whole row, every server-owned component and column;
 * otherwise only the components and columns named. A component mapped to
 * `true` is covered whole, and `[]` covers only the fact that it is present. */
export type Coverage = true | Record<string, true | string[]>

/** Whether a delivery covers a component's presence or a particular column. */
export let covers = (scope: Coverage, name: string, prop?: string): boolean =>
  scope === true ||
  (prop === undefined
    ? Object.hasOwn(scope, name)
    : scope[name] === true || (scope[name] || []).includes(prop))

/** The coverage of a rider bundle that declared none: exactly what it
 * carried. */
export let delivered = (b: Bundle): Coverage =>
  Object.fromEntries(
    comps(b).map(([name, comp]) => [
      name,
      comp === null ? true : Object.keys(comp),
    ]),
  )
