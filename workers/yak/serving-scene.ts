import type { Env } from './env.ts'
import { hosting } from './directory-probe.ts'
import { platform as runtime } from './serving-probe.ts'

// Reporting a break hands work to the Operator; its execution belongs to
// operator_test.ts. These routes retain only that service boundary.
let operators: Env['BUILDER'] = {
  idFromName: (name) => name,
  get: () => ({
    fetch: (req: Request) => {
      let path = new URL(req.url).pathname
      if (req.method == 'POST' && path == '/operator/receive') {
        return Promise.resolve(Response.json({}))
      }
      if (req.method == 'POST' && path == '/operator/requests') {
        return Promise.resolve(Response.json([]))
      }
      throw new Error(
        `Unhandled serving Operator fixture: ${req.method} ${path}`,
      )
    },
  }),
}

/** The platform in memory, with `vars` beside its own. */
export let platform = (vars: Partial<Env> = {}) =>
  hosting(runtime({ BUILDER: operators, ...vars }))
