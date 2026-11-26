// The service-bound app query Worker. Store deploys have independent version
// IDs, so this entry reports its own and leaves the objects' version alone.
import { observed } from '../defects-runtime.ts'
import type { Env } from '../env.ts'
import { fetch } from './worker.ts'

export default {
  fetch: (req: Request, env: Env) =>
    observed(env, 'query fetch', () => fetch(req, env), req),
}
