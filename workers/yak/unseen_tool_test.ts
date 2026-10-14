// The app_errors command reads an app's exception rows, including fields a
// stored report left empty.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { appStore } from './directory.ts'
import { KERNEL, metaOf } from './meta.ts'
import { ADA, platform, seeded } from './serving-probe.ts'
import { call, TOOLS } from './tools.ts'
import { brokenIn, foresee, noted, serve } from './unseen.ts'
import type { Who } from './session.ts'
import { running } from './agent.ts'
import { tallying } from './lib/hops.ts'

test('app_errors lists a break whose stored stack is null', async () => {
  using p = platform()
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

test('app_errors says a break once, and its id archives every time', async () => {
  using p = platform()
  let { env } = p
  let { dir, space, app } = await seeded(env)
  let errors = (args = {}) =>
    call({ env, dir, person: ADA }, 'app_errors', {
      space: 'ada',
      app: 'cookbook',
      ...args,
    }).then((r) => r.text)
  for (let i = 0; i < 3; i++) {
    await noted({ request: 'page /cookbook/', message: 'boom', version: 1 }, {
      env,
      space,
      app,
    })
  }
  let [said, ...more] = (await errors()).split('\n')
  assertEquals(more, [])
  assertStringIncludes(said, 'boom (3 times since')
  assertEquals(await errors({ fixed: said.split(' ')[1] }), 'archived 1')
  assertEquals(await errors(), 'no open errors')
})

test('app_errors shows a session error from its content', async () => {
  using p = platform()
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

test('brokenIn says each break plainly and leaves it news', async () => {
  using p = platform()
  let { env } = p
  let { space, app } = await seeded(env)
  let ada: Who = { person: ADA, role: 'owner' }
  let at = { env, space, app }
  for (let i = 0; i < 3; i++) {
    await noted({ request: 'page /cookbook/', message: 'boom', version: 1 }, at)
  }
  await noted(
    { request: 'page /cookbook/new', message: 'bang', version: 1 },
    at,
  )
  let said = (await brokenIn(env, space, ada, [app])).get(app.eid)!
  assertEquals(
    said.map(({ said, where, times }) => ({ said, where, times })),
    [
      { said: 'bang', where: 'page /cookbook/new', times: 1 },
      { said: 'boom', where: 'page /cookbook/', times: 3 },
    ],
  )
  // Seen on the dashboard, not yet told: the assistant still hears of both.
  assertEquals((await serve(env, space, ada)).length, 4)
})

// The connector begins reading what a write's answer will tell as soon as the
// write knows its space (mcp.ts `ahead`), and the answer is handed that
// reading: the space's breaks are asked for once (T-124082).
test("a write's answer reads its space's breaks once", async () => {
  using p = platform()
  let { env } = p
  let { dir, space, app } = await seeded(env)
  await noted({ request: 'page /cookbook/', message: 'boom', version: 1 }, {
    env,
    space,
    app,
  })
  let tracker = env.TRACKER!
  let asked = 0
  env.TRACKER = {
    fetch: (r: Request) => {
      if (new URL(r.url).pathname == '/query') asked++
      return tracker.fetch(r)
    },
  }
  let ctx = {
    env,
    dir,
    person: ADA,
    ahead: (at: typeof space, who: Who) => foresee(env, at, who),
  }
  let set = TOOLS.find((t) => t.name == 'app_set')!
  let [said] = await tallying(
    new Map(),
    () => running(ctx, set)({ space: 'ada', app: 'cookbook', title: 'Cook' }),
  )
  assertStringIncludes(JSON.stringify(said), 'boom')
  assertEquals(asked, 1)
})
