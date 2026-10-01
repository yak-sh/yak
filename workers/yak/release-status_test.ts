import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import * as apps from './apps.ts'
import { stamp } from './directory.ts'
import { platform, seeded, visit } from './serving-probe.ts'

let bytes = (s: string) => new TextEncoder().encode(s)
let doc = (type = 'string') => ({
  $defs: { note: { type: 'object', properties: { text: { type } } } },
})

test('release door reads immutable JSON/YAML vocab, caches pairs, and follows the fresh app version', async () => {
  using scenario = platform()
  let { env, files } = scenario
  let { app } = await seeded(env)
  files.held.set('sha/old', bytes(JSON.stringify(doc())))
  files.held.set(
    'sha/new',
    bytes(
      '$defs:\n  note:\n    type: object\n    properties:\n      text:\n        type: number\n',
    ),
  )
  let releases = [
    { version: 1, files: { 'vocab.json': 'old', 'index.html': 'one' } },
    { version: 2, files: { 'vocab.yml': 'new', 'index.html': 'two' } },
    { version: 3, files: { 'vocab.yml': 'new', 'index.html': 'three' } },
    {
      version: 4,
      files: { 'vocab.json': 'old', 'index.html': 'one' },
      reload: 'required',
    },
  ]
  await stamp(env, {
    entities: releases.map((v) => ({
      entity: { eid: crypto.randomUUID() },
      deploy: { app: app.eid, ...v, files: JSON.stringify(v.files) },
    })),
  })
  let current = (version: number) =>
    stamp(env, {
      entities: [{ entity: { eid: app.eid }, app: { version } }],
    })
  let get = async (version: number) => {
    let res = await apps.fetch(
      visit(`/cookbook/api/release?version=${version}`),
      env,
    )
    assertEquals(res.status, 200)
    assertEquals(res.headers.get('cache-control'), 'no-store')
    return res.json()
  }
  await current(2)
  assertEquals(await get(1), { version: 2, reload: 'required' })
  // The pair is already computed: immutable blobs need not be read again.
  files.held.delete('sha/old')
  files.held.delete('sha/new')
  assertEquals(await get(1), { version: 2, reload: 'required' })
  assertEquals(await get(2), { version: 2 })
  files.held.set(
    'sha/new',
    bytes(
      '$defs:\n  note:\n    type: object\n    properties:\n      text:\n        type: number\n',
    ),
  )
  await current(3)
  assertEquals(await get(2), { version: 3, reload: 'optional' })
  await current(4)
  // Rollback bytes identical to v1: neither a mark nor a changed number warns.
  assertEquals(await get(1), { version: 4 })
  files.held.set('sha/old', bytes(JSON.stringify(doc())))
  assertEquals(await get(2), { version: 4, reload: 'required' })
})

test('release door gates readers and validates the page version', async () => {
  using scenario = platform()
  let { env } = scenario
  let { app } = await seeded(env)
  let get = (tail = '', method = 'GET') =>
    apps.fetch(visit(`/cookbook/api/release${tail}`, { method }), env)
  assertEquals((await get()).status, 400)
  assertEquals((await get('?version=1.5')).status, 400)
  assertEquals((await get('?version=-1')).status, 400)
  assertEquals((await get('?version=1', 'POST')).status, 405)
  assertEquals((await get('?version=0')).status, 404)
  await stamp(env, {
    entities: [{ entity: { eid: app.eid }, app: { access: 'private' } }],
  })
  assertEquals((await get('?version=1')).status, 401)
})
