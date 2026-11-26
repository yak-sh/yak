import { assert, assertEquals } from '@std/assert'
import { SEATED } from './build-door.ts'
import type { Env } from './env.ts'

/** The spaces whose Operators an app told of a commit (`/heard`), and
 * what each answers: 204 while it watches, 410 once it does not. */
export let heard = { spaces: [] as string[], status: 204 }

// Reporting a break hands work to the Operator; its execution belongs to
// operator_test.ts. These routes retain only that service boundary.
export let operators: Env['BUILDER'] = {
  idFromName: (name) => name,
  get: (space) => ({
    fetch: (req: Request) => {
      let path = new URL(req.url).pathname
      if (req.method == 'POST' && path == '/heard') {
        assertEquals(req.headers.get('x-yak-kernel'), '1')
        heard.spaces.push(String(space))
        return Promise.resolve(new Response(null, { status: heard.status }))
      }
      // A seat moved in the space (build.ts `SEATED`): no page here holds
      // one, and the Builder answers 204 whatever it re-reads.
      if (req.method == 'POST' && path == SEATED) {
        assertEquals(req.headers.get('x-yak-kernel'), '1')
        return Promise.resolve(new Response(null, { status: 204 }))
      }
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
