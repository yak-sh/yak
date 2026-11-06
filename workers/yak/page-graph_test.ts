// A page's graph doors: a query reaches its own store once, and the
// vocabulary door passes a Store refusal through to its caller.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { App, Space } from './directory.ts'
import type { Env } from './env.ts'
import { USES } from './door.ts'
import { queried, vocabularyAnswer } from './page-graph.ts'
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

let failed = { error: 'Refused', message: 'schema held' }
let refusedVocabulary = Response.json(failed, { status: 503 })
test('page vocabulary preserves a Store refusal', async () => {
  let { failed: response } = await vocabularyAnswer(refusedVocabulary, {
    request: 'GET /api/vocab.json',
    space: space.slug,
    app: app.slug,
  })
  if (!response) throw new Error('the refusal became vocabulary')
  assertEquals(response.status, 503)
  assertEquals(await response.json(), failed)
})

let ownAsked: string[] = []
let ownAnswer = Response.json(
  [{ entity: { eid: 'n' }, doc: { title: 'Hi' } }],
  {
    headers: { [USES]: '{}' },
  },
)
let ownEnv = stub((req) => {
  ownAsked.push(new URL(req.url).pathname)
  return ownAnswer
})
test('a page query of its own words reaches its store once', async () => {
  assertEquals(titles(await queried(ownEnv, space, app, who, '.doc')), ['Hi'])
  assertEquals(ownAsked, ['/query'])
})

// A store still on the code before it says which words it uses only at
// `/uses`, and is asked the way it was then.
let legacyAsked: string[] = []
let legacyAnswers = [
  Response.json([{ entity: { eid: 'n' }, doc: { title: 'Hi' } }]),
  Response.json({}),
  Response.json([{ entity: { eid: 'n' }, doc: { title: 'Hi' } }]),
]
let legacyEnv = stub((req) => {
  legacyAsked.push(new URL(req.url).pathname)
  return legacyAnswers.shift()!
})
test('a page query answers from a store that does not say its uses', async () => {
  assertEquals(titles(await queried(legacyEnv, space, app, who, '.doc')), [
    'Hi',
  ])
  assertEquals(legacyAsked, ['/query', '/uses', '/query'])
})
