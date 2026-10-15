// The app_errors command reads an app's exception rows, including fields a
// stored report left empty.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { type App, appStore, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'
import { ADA, platform, seeded } from './serving-probe.ts'
import { call } from './tools.ts'
import {
  brokenIn,
  closing,
  folds,
  foresee,
  line,
  noted,
  serve,
} from './unseen.ts'
import type { Who } from './session.ts'
import { tallying } from './lib/hops.ts'

test('app_errors lists a break whose stored stack is null', async () => {
  await using p = platform()
  let { env } = p
  let { dir, space, app } = await seeded(env)
  await noted({
    request: 'page /cookbook/',
    message: 'failed before a stack was available',
    version: 1,
  }, { env, space, app })
  let listed = await call(
    { env, dir, person: ADA },
    'app_errors',
    { space: 'ada', app: 'cookbook' },
  )
  assertStringIncludes(listed.text, 'page /cookbook/ — failed before a stack')
  await noted({
    request: 'page /cookbook/new',
    message: 'new tracked break',
    version: 1,
  }, { env, space, app })
  let current = await call({ env, dir, person: ADA }, 'app_errors', {
    space: 'ada',
    app: 'cookbook',
  })
  assertStringIncludes(current.text, 'new tracked break')
  // The legacy id and the new tracker id both remain archive arguments.
  let ids = current.text.split('\n').map((line) => line.split(' ')[1])
  let archived = await call({ env, dir, person: ADA }, 'app_errors', {
    space: 'ada',
    app: 'cookbook',
    fixed: ids,
  })
  assertEquals(archived.text, 'archived 2')
  assertEquals(
    (await call({ env, dir, person: ADA }, 'app_errors', {
      space: 'ada',
      app: 'cookbook',
    })).text,
    'no open errors',
  )
})

// A tracker occurrence as the space's tracker answers a query for it.
let row = (
  eid: string,
  app: App,
  message: string,
  request: string,
  at = '',
) => ({
  entity: { eid },
  error: { at, message, tags: { request }, version: 1 },
  during: { app: app.eid },
})

// The space's tracker, answering every query with `rows`, and keeping what it
// was asked.
let tracker = (rows: unknown[] = []) => {
  let asked: Request[] = []
  let env = {
    TRACKER_SECRET: 'secret',
    TRACKER: {
      fetch: (r: Request) => {
        asked.push(r)
        return Promise.resolve(Response.json(r.method == 'POST' ? {} : rows))
      },
    },
  } as unknown as Env
  return { env, asked }
}

let space = { eid: 'space-1', slug: 'ada' } as Space
let cook = { eid: 'app-1', slug: 'cookbook' } as App
let ada: Who = { person: ADA, role: 'owner' }

test('app_errors says a break once, and its id archives every time', () => {
  let hits = [1, 2, 3].map((n) => ({
    kind: 'error',
    tracked: true,
    entity: { eid: `e${n}` },
    error: { message: 'boom', request: 'page /cookbook/', at: `2026-01-0${n}` },
  }))
  let lines = folds(hits.map((hit) => ({ app: cook, hit }))).map(line)
  assertEquals(lines.length, 1)
  assertStringIncludes(lines[0], 'boom (3 times since 2026-01-01')
  let id = lines[0].split(' ')[1]
  assertEquals(closing(hits, [id]).length, 3)
  assertEquals(closing(hits, ['nothing']).length, 0)
})

test('app_errors shows a session error from its content', async () => {
  await using p = platform()
  let { env } = p
  let { dir, space, app } = await seeded(env)
  let store = metaOf(appStore(env.STORE, space, app))
  await store.apply([
    { entity: { eid: 'session-1' }, session: { id: 'one' } },
    {
      entity: { eid: '$error' },
      entry: { session: 'session-1', seq: 1 },
      error: { code: 'http_400' },
      content: { body: 'OpenRouter speech request failed (400)' },
    },
  ], KERNEL)
  let listed = await call(
    { env, dir, person: ADA },
    'app_errors',
    { space: 'ada', app: 'cookbook' },
  )
  assertStringIncludes(
    listed.text,
    'http_400 — OpenRouter speech request failed (400)',
  )
})

// The connector begins reading what a write's answer will tell as soon as the
// write knows its space (mcp.ts `ahead`), and the answer is handed that
// reading: the space's breaks are asked for once (T-124082).
test("a write's answer reads its space's breaks once", async () => {
  let { env, asked } = tracker()
  await tallying(new Map(), async () => {
    foresee(env, space, ada)
    await serve(env, space, ada)
  })
  assertEquals(asked.length, 1)
})

test('brokenIn says each break plainly and leaves it news', async () => {
  let { env, asked } = tracker([
    ...[1, 2, 3].map((n) =>
      row(`e${n}`, cook, 'boom', 'page /cookbook/', `2026-01-0${n}`)
    ),
    row('e4', cook, 'bang', 'page /cookbook/new', '2026-01-04'),
  ])
  let said = (await brokenIn(env, space, ada, [cook])).get(cook.eid)!
  assertEquals(
    said.map(({ said, where, times }) => ({ said, where, times })),
    [
      { said: 'bang', where: 'page /cookbook/new', times: 1 },
      { said: 'boom', where: 'page /cookbook/', times: 3 },
    ],
  )
  // Nothing was marked: the assistant still hears of both.
  assertEquals(asked.filter((r) => r.method == 'POST'), [])
})
