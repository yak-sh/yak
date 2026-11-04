import { platform as runtime } from './testing.ts'
import { hosting } from './directory-rows-probe.ts'
import type { Env } from './env.ts'
export { hosting, rows } from './directory-rows-probe.ts'

/** RAM directory with the runtime app Store namespace. */
export let platform = (
  secret: string,
  vars: Partial<Env> = {},
  composition: Parameters<typeof hosting>[1] = {},
) => hosting(runtime(secret, vars), composition)
