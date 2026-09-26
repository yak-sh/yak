// The kinds of place a level is made of (levels.ts names one at each point):
// how each shapes the ground, what it covers the ground with, what grows
// there, and what stands at its middle. terrain.ts grows a level from them.
// Each land's kinds are rows in its file under features/; a new kind of place
// is a row there. Creatures find a kind by its name, or by the kind it is
// `like` (beasts.ts `haunts`).
import { COAST } from './features/coast.ts'
import { DEEP } from './features/deep.ts'
import { FIRE } from './features/fire.ts'
import { FROST } from './features/frost.ts'
import { HILLS } from './features/hills.ts'
import { type Feature, Top } from './features/kit.ts'
import { MARSH } from './features/marsh.ts'
import { SANDS } from './features/sands.ts'
import { VALE } from './features/vale.ts'

export { type Feature, Top }

/** Every kind of place, by its name. */
export let FEATURES: Record<string, Feature> = {
  ...VALE,
  ...COAST,
  ...MARSH,
  ...HILLS,
  ...DEEP,
  ...SANDS,
  ...FROST,
  ...FIRE,
}

/** Whether a place of kind `kind` is a `near`: it is one, or it is like one.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([isA('moor', 'moor'), isA('moor', 'woods')], [true, false])
 * ```
 */
export let isA = (kind: string, near: string): boolean =>
  kind == near || FEATURES[kind]?.like == near
