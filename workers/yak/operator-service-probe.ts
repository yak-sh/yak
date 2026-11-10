import { assert, assertEquals } from '@std/assert'
import type { Env } from './env.ts'

// Reporting a break hands work to the Operator; its execution belongs to
// operator_test.ts. These routes retain only that service boundary.
export let operators: Env['BUILDER'] = {
  idFromName: (name) => name,
  get: () => ({
    fetch: (req: Request) => {
      let path = new URL(req.url).pathname
      if (req.method == 'POST' && path == '/wipe') {
        assertEquals(req.headers.get('x-yak-kernel'), '1')
        return Promise.resolve(Response.json({ ok: true }))
      }
      if (path.startsWith('/operator/')) {
        assert(req.headers.get('x-yak-person'))
        assert(req.headers.get('x-space-eid'))
      }
      if (req.method == 'POST' && path == '/operator/receive') {
        return Promise.resolve(Response.json({}))
      }
      // An Operator that has set nothing speaks as the platform's.
      if (req.method == 'POST' && path == '/operator/settings') {
        return Promise.resolve(Response.json({}))
      }
      if (req.method == 'POST' && path == '/operator/requests') {
        return Promise.resolve(Response.json([]))
      }
      throw new Error(
        `Unhandled Operator service fixture: ${req.method} ${path}`,
      )
    },
  }),
}
