// The app_errors command reads an app's exception rows, including fields a
// stored report left empty.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { type App, appStore, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'
import { ADA, seeded } from './serving-data-probe.ts'
import { platform } from './deploy-probe.ts'
import { stores } from './app-store-probe.ts'
import { call } from './tools.ts'
import {
  brokenIn,
  closing,
  folds,
  foresee,
  line,
  noted,
  serve,
  trackedIn,
} from './unseen.ts'
import type { Who } from './session.ts'
import { tallying } from './lib/hops.ts'
import type { Send } from './app-errors.ts'

test('app_errors lists a break whose stored stack is null', async () => {
  await using p = platform('unseen-secret')
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
  // Each report's id remains an archive argument.
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

// A person's app break is also the platform's, since yaks.app may have caused
// it; the page's own write its words refuse is the owner's alone.
test("an app's own mistake reaches its owner, never the platform", async () => {
  await using p = platform('unseen-secret')
  let { env } = p
  let { space, app } = await seeded(env)
  let sent: Record<string, unknown>[] = []
  let send = env.ERRORS!.send.bind(env.ERRORS)
  env.ERRORS = {
    send: (
      rows,
    ) => (sent.push(...rows as Record<string, unknown>[]), send(rows)),
  }
  let sources = async (mistake: boolean) => {
    sent.length = 0
    await noted(
      { request: 'POST /cookbook/api/apply', message: 'no', mistake },
      {
        env,
        space,
        app,
      },
    )
    return sent.flatMap((r) => {
      let tags = (r.error as { tags: { source?: string } } | undefined)?.tags
      return tags ? [tags.source ?? 'space'] : []
    })
  }
  assertEquals(await sources(false), ['space', 'app'])
  assertEquals(await sources(true), ['space'])
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
  let asked: { path: string; init: RequestInit }[] = []
  let send: Send = (path, init) => {
    asked.push({ path, init })
    return Promise.resolve(init.method == 'POST' ? {} : rows)
  }
  return { env: {} as Env, asked, send }
}

let space = { eid: 'space-1', slug: 'ada' } as Space
let cook = { eid: 'app-1', slug: 'cookbook', version: 1 } as App
let ada: Who = { person: ADA, role: 'owner' }

let foldedHits = [1, 2, 3].map((n) => ({
  kind: 'error',
  tracked: true,
  entity: { eid: `e${n}` },
  error: { message: 'boom', request: 'page /cookbook/', at: `2026-01-0${n}` },
}))

test('app_errors says a break once, and its id archives every time', () => {
  let lines = folds(foldedHits.map((hit) => ({ app: cook, hit }))).map(line)
  assertEquals(lines.length, 1)
  assertStringIncludes(lines[0], 'boom (3 times since 2026-01-01')
  let id = lines[0].split(' ')[1]
  assertEquals(closing(foldedHits, [id]).length, 3)
  assertEquals(closing(foldedHits, ['nothing']).length, 0)
})

test('app_errors shows a session error from its content', async () => {
  await using p = platform('unseen-secret')
  let { env } = p
  let { dir, space, app } = await seeded(env)
  stores(env)
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
  let { env, asked, send } = tracker()
  await tallying(new Map(), async () => {
    foresee(env, space, ada, send)
    await serve(env, space, ada, undefined, false, undefined, undefined, send)
  })
  assertEquals(asked.length, 1)
})

let arrived = tracker([row('fresh-break', cook, 'boom', 'page /cookbook/')])

test("a write's prefetched break remains in its one cached tracker read", async () => {
  let { env, asked, send } = arrived
  let open = await tallying(new Map(), async () => {
    foresee(env, space, ada, send)
    return await trackedIn(env, space, ada, false, send)
  })
  assertEquals(open.get(cook.eid)?.[0].error?.message, 'boom')
  assertEquals(asked.length, 1)
})

let announced = tracker()
let freshBreak = {
  kind: 'error',
  tracked: true,
  entity: { eid: 'fresh-break' },
  error: { message: 'boom', request: 'page /cookbook/', version: 1 },
}
let freshBreaks = new Map([[cook.eid, [freshBreak]]])

test("a write's reply carries its fresh break and marks it told", async () => {
  let { env, asked, send } = announced
  let offered = await serve(
    env,
    space,
    ada,
    undefined,
    false,
    () => Promise.resolve(freshBreaks),
    () => Promise.resolve([cook]),
    send,
  )
  assertEquals(offered.length, 1)
  assertStringIncludes(line(offered), 'page /cookbook/ — boom')
  assertEquals(asked.length, 1)
  assertEquals(asked[0].init.method, 'POST')
  assertEquals(JSON.parse(String(asked[0].init.body)), {
    app: cook.eid,
    eids: ['fresh-break'],
    mark: 'notified',
  })
})

let dashboard = tracker([
  ...[1, 2, 3].map((n) =>
    row(`e${n}`, cook, 'boom', 'page /cookbook/', `2026-01-0${n}`)
  ),
  row('e4', cook, 'bang', 'page /cookbook/new', '2026-01-04'),
])

test('brokenIn says each break plainly and leaves it news', async () => {
  let { env, asked, send } = dashboard
  let said = (await brokenIn(
    env,
    space,
    ada,
    [cook],
    (_env, _space, _who, ids) =>
      Promise.resolve(new Map(ids.map((id) => [id, {}]))),
    send,
  )).get(cook.eid)!
  assertEquals(
    said.map(({ said, where, times }) => ({ said, where, times })),
    [
      { said: 'bang', where: 'page /cookbook/new', times: 1 },
      { said: 'boom', where: 'page /cookbook/', times: 3 },
    ],
  )
  // Nothing was marked: the assistant still hears of both.
  assertEquals(asked.filter((r) => r.init.method == 'POST'), [])
})
