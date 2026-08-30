// Persona projection invalidation at the daemon effect seam. A disposable
// database and callback prove role facets reconcile only when the same entity
// still wears persona, without materializing into a venture checkout.
import { assertEquals } from '@std/assert'

Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { freshDb } = await import('./testdb.ts')
let { dispatch, trace } = await import('./effects.ts')
let { wirePersonaSync } = await import('./doing.ts')
let { uuid } = await import('./types.ts')

Deno.test('role add and removal invalidate only persona projections', async () => {
  let db = freshDb()
  let persona = uuid(), ordinary = uuid()
  apply(db, [
    { eid: persona, name: 'doc', comp: { title: 'Persona role' } },
    { eid: persona, name: 'persona', comp: {} },
    { eid: ordinary, name: 'doc', comp: { title: 'Ordinary role' } },
  ])
  let syncs = 0
  wirePersonaSync(db, () => syncs++)
  let write = async (changes: Parameters<typeof apply>[1]) => {
    let t = trace()
    await dispatch(apply(db, changes, t), t)
  }

  await write([{
    eid: ordinary,
    name: 'role',
    comp: { state: 'stopped' },
  }])
  await write([{ eid: ordinary, name: 'role', comp: null }])
  assertEquals(syncs, 0, 'an unrelated role does not reconcile personas')

  await write([{
    eid: persona,
    name: 'role',
    comp: { state: 'stopped' },
  }])
  assertEquals(syncs, 1, 'role creation changes the persona human header')
  await write([{ eid: persona, name: 'role', comp: null }])
  assertEquals(syncs, 2, 'role removal restores the persona human header')
})
