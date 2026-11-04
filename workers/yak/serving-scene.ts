import type { Env } from './env.ts'
import { hosting } from './directory-probe.ts'
import { platform as runtime } from './serving-probe.ts'
import { operators } from './operator-service-probe.ts'

/** The platform in memory, with `vars` beside its own. */
export let platform = (vars: Partial<Env> = {}) =>
  hosting(runtime({ BUILDER: operators, ...vars }))
