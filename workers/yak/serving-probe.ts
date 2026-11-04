import type { Env } from './env.ts'
import { platform as inMemory } from './testing.ts'
import { SECRET } from './serving-data-probe.ts'
export { ADA, ADA_OWNS, as, seeded, visit } from './serving-data-probe.ts'

/** The platform in memory, with `vars` beside its own. */
export let platform = (vars: Partial<Env> = {}) => inMemory(SECRET, vars)
