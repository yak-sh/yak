// The app_errors command reads an app's exception rows, including fields a
// stored report left empty.
import { test } from '@yaks/testing'
import { assertObjectMatch, assertStringIncludes } from '@std/assert'
import { appStore } from './directory.ts'
import { KERNEL, metaOf } from './meta.ts'
import { ADA, platform, seeded } from './serving-probe.ts'
import { call } from './tools.ts'

test('app_errors lists a break whose stored stack is null', async () => {
  using p = platform()
  let { env } = p
  let { dir, space, app } = await seeded(env)
  let store = metaOf(appStore(env.STORE, space, app))
  await store.apply([{
    entity: { eid: '$break' },
    exception: {
      at: '2026-09-28T00:00:00Z',
      request: 'page /cookbook/',
      message: 'failed before a stack was available',
      stack: null,
    },
  }], KERNEL)
  let [row] = await store.query('.exception')
  assertObjectMatch(row, { exception: { stack: null } })
  let listed = await call(
    { env, dir, person: ADA },
    'app_errors',
    { space: 'ada', app: 'cookbook' },
  )
  assertStringIncludes(listed.text, 'page /cookbook/ — failed before a stack')
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
