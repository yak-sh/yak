// A deployment's Store boundary accepts the app's empty declaration. Tests
// about vocabulary or saved rows use directory-probe's app Stores instead.
import { assertEquals } from '@std/assert'
import type { Env } from './env.ts'
import { operators } from './operator-service-probe.ts'
import { platform as runtime } from './directory-probe.ts'

export let platform = (secret: string, vars: Partial<Env> = {}) =>
  runtime(secret, {
    BUILDER: operators,
    STORE: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (req: Request) => {
          let path = new URL(req.url).pathname
          if (path == '/' && req.method == 'DELETE') {
            assertEquals(req.headers.get('x-yak-kernel'), '1')
            return Response.json({ ok: true })
          }
          if (path == '/query') {
            assertEquals(req.method, 'GET')
            return Response.json([])
          }
          if (path == '/released') {
            assertEquals(req.method, 'POST')
            assertEquals(req.headers.get('x-yak-kernel'), '1')
            return Response.json(await req.json())
          }
          if (['/vocab', '/uses', '/tools'].includes(path)) {
            if (req.method == 'GET') return Response.json({})
            assertEquals(req.method, 'POST')
            let value = await req.json()
            if (path == '/vocab') {
              assertEquals(Object.keys(value.$defs ?? {}), [])
              return Response.json({
                comps: [],
                dropped: [],
                added: [],
                kept: [],
              })
            }
            return Response.json({ [path.slice(1)]: Object.keys(value) })
          }
          throw new Error(`Unhandled deploy fixture: ${req.method} ${path}`)
        },
      }),
    },
    ...vars,
  })
