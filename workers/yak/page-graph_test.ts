// A page's vocabulary door passes a Store refusal through to its caller.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type App, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { vocabulary } from './page-graph.ts'
import type { Who } from './session.ts'

test('page vocabulary preserves a Store refusal', async () => {
  let failed = { error: 'Refused', message: 'schema held' }
  let env = {
    STORE: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (req: Request) =>
          Promise.resolve(
            new URL(req.url).pathname == '/uses'
              ? Response.json({})
              : Response.json(failed, { status: 503 }),
          ),
      }),
    },
  } as unknown as Env
  let space = { slug: 'page-words' } as Space
  let app = {
    eid: 'page',
    slug: 'page',
    access: 'public',
    home: false,
    store: null,
    version: 1,
  } as App
  let who = { person: null, role: null } as Who

  let response = await vocabulary(env, space, app, who)
  assertEquals(response.status, 503)
  assertEquals(await response.json(), failed)
})
