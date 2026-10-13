// The app_errors command reads an app's exception rows, including fields a
// stored report left empty.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { appStore } from './directory.ts'
import { KERNEL, metaOf } from './meta.ts'
import { ADA, platform, seeded } from './serving-probe.ts'
import { call } from './tools.ts'
import { noted } from './unseen.ts'

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
