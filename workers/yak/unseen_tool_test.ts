// The app_errors command reads an app's exception rows, including fields a
// stored report left empty.
import { assertObjectMatch, assertStringIncludes } from '@std/assert'
import { appStore } from './directory.ts'
import { KERNEL, metaOf } from './meta.ts'
import { ADA, platform, seeded } from './serving-probe.ts'
import { call } from './tools.ts'

Deno.test('app_errors lists a break whose stored stack is null', async () => {
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
