// A page's graph doors: a query reaches its own store once, and the
// vocabulary door passes a Store refusal through to its caller.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type App, appStore, directory, type Space } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'
import { queried, vocabulary } from './page-graph.ts'
import { vouched, type Who } from './session.ts'
import { platform } from './testing.ts'
import { call } from './tools.ts'

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
  let { env } = platform('page-graph-secret')
  let ADA = 'a0000000-0000-4000-8000-0000000000ad'
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) }, true)
  let ctx = { env, dir, person: ADA }
  await call(ctx, 'space_new', { slug: 'ada', title: 'Ada' })
  await call(ctx, 'app_new', { space: 'ada', slug: 'notes', title: 'Notes' })
  let [ada] = await dir.spaces(ADA)
  let [notes] = await dir.apps(ada)
  let store = appStore(env.STORE, ada, notes)
  await store('/vocab', { method: 'POST', body: '{}' }, KERNEL)
  let owner = { person: ADA, role: 'owner' } as Who
  await metaOf(store, vouched(owner)).apply([{
    entity: { eid: '$n' },
    doc: { title: 'Hi' },
  }])
  let asked: string[] = []
  let counted = {
    ...env,
    STORE: {
      idFromName: (name: string) => env.STORE.idFromName(name),
      get: (id: unknown) => ({
        fetch: (req: Request) => {
          asked.push(new URL(req.url).pathname)
          return env.STORE.get(id).fetch(req)
        },
      }),
    },
  } as Env
  assertEquals(titles(await queried(counted, ada, notes, owner, '.doc')), [
    'Hi',
  ])
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
