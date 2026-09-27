// Every kind of building (buildings/), in every land's dress. A building is a
// kind of prop named for its plan and its dress, `smithy.plaster` a smithy of
// Mossvale's plaster and timber; a village builds its plans in its own dress
// (features/kit.ts `dress`). To add a kind of building, write its plan in a
// file of its own under buildings/ and name it in PLANS.
import { DRESSES } from './buildings/dress.ts'
import { type Plan, raise, type Raised } from './buildings/kit.ts'
import { SMITHY } from './buildings/smithy.ts'
import type { Kind } from './props/kit.ts'

/** Every kind of building, by its name. */
export let PLANS: Record<string, Plan> = {
  smithy: SMITHY,
}

/** The kind of prop a plan is in a dress; any other kind as it is.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(dressed('smithy', 'stone'), 'smithy.stone')
 * assertEquals(dressed('smithy'), 'smithy.plaster')
 * assertEquals(dressed('well', 'stone'), 'well')
 * ```
 */
export let dressed = (kind: string, dress = 'plaster') =>
  PLANS[kind] ? `${kind}.${dress}` : kind

// How many looks (a roof's colour, the grain of a wall) each building has.
let LOOKS = 4

let made = new Map<string, Raised>()
let raised = (plan: Plan, dress: string, seed: number): Raised => {
  let id = `${plan.name}.${dress}:${seed % LOOKS}`
  let got = made.get(id)
  if (!got) made.set(id, got = raise(plan, DRESSES[dress], seed % LOOKS))
  return got
}

/** Every plan in every dress, as a kind of prop. */
export let BUILDINGS: Record<string, Kind> = Object.fromEntries(
  Object.entries(PLANS).flatMap(([name, plan]) =>
    Object.keys(DRESSES).map((dress): [string, Kind] => {
      let [w, d] = plan.size
      let raise = (seed: number) => raised(plan, dress, seed)
      return [`${name}.${dress}`, {
        make: raise,
        raise,
        shapes: LOOKS,
        span: [w, d],
        foot: Math.hypot(w, d) / 2,
      }]
    })
  ),
)
