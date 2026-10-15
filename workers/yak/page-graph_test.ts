// A page's graph doors: a query reaches its own store once, and the
// vocabulary door passes a Store refusal through to its caller.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { App, Space } from './directory.ts'
import type { Env } from './env.ts'
import { USES } from './door.ts'
import { queried, vocabulary } from './page-graph.ts'
import type { Who } from './session.ts'

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

// A store namespace whose every request is answered by `answer`.
let stub = (answer: (req: Request) => Response) =>
  ({
    STORE: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: (req: Request) => Promise.resolve(answer(req)) }),
    },
  }) as unknown as Env

let titles = (rows: unknown) =>
  (rows as { doc: { title: string } }[]).map((r) => r.doc.title)

test('page vocabulary preserves a Store refusal', async () => {
  let failed = { error: 'Refused', message: 'schema held' }
  let env = stub((req) =>
    new URL(req.url).pathname == '/uses'
      ? Response.json({})
      : Response.json(failed, { status: 503 })
  )
  let response = await vocabulary(env, space, app, who)
  assertEquals(response.status, 503)
  assertEquals(await response.json(), failed)
})

test('a page query of its own words reaches its store once', async () => {
  let asked: string[] = []
  let env = stub((req) => {
    asked.push(new URL(req.url).pathname)
    return Response.json([{ entity: { eid: 'n' }, doc: { title: 'Hi' } }], {
      headers: { [USES]: '{}' },
    })
  })
  assertEquals(titles(await queried(env, space, app, who, '.doc')), ['Hi'])
  assertEquals(asked, ['/query'])
})

// A store still on the code before it says which words it uses only at
// `/uses`, and is asked the way it was then.
test('a page query answers from a store that does not say its uses', async () => {
  let asked: string[] = []
  let env = stub((req) => {
    let url = new URL(req.url)
    asked.push(url.pathname)
    return url.pathname == '/uses'
      ? Response.json({})
      : Response.json([{ entity: { eid: 'n' }, doc: { title: 'Hi' } }])
  })
  assertEquals(titles(await queried(env, space, app, who, '.doc')), ['Hi'])
  assertEquals(asked, ['/query', '/uses', '/query'])
})
