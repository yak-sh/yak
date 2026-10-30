import { equal, ok, test } from '@yaks/testing'
import { PLATFORM_STORE, STATIC_QUERY, storeOf } from './door.ts'
import { KERNEL } from './meta.ts'
import { platform, seeded } from './serving-probe.ts'

let p = platform()
let { dir, app } = await seeded(p.env)
let door = storeOf(p.env.STORE, PLATFORM_STORE)
let path = `/query?q=${encodeURIComponent(`.entity.eid=${app.eid}`)}`
let read = () => door(path, {}, { [STATIC_QUERY]: '1' })
let first = await read()
await first.body?.cancel()
let warm = await read()
let before = (await warm.json())[0].doc.title
let reused = Number(warm.headers.get('x-yak-stmts'))
await dir.stamp({
  entities: [{ entity: { eid: app.eid }, doc: { title: 'Changed' } }],
}, KERNEL)
let changed = await read()
let after = (await changed.json())[0].doc.title

test('a typed directory query reuses rows until an authoritative mutation', () => {
  equal(before, 'Cookbook')
  equal(after, 'Changed')
  ok(Number(changed.headers.get('x-yak-stmts')) > reused)
})
