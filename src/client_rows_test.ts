// A client singleton's eid derives from what it is of, so a cold cache that
// cannot see the previous camera mints the same row again.
import { assertEquals } from '@std/assert'
import { cameraEid } from './edge.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply, eager } = await import('./db.ts')
let { bareDb } = await import('./testdb.ts')
let uid = () => crypto.randomUUID()
bareDb()

Deno.test('a second cold-cache camera mint patches; the next pan succeeds', () => {
  let db = bareDb(), client = uid(), canvas = uid()
  let eid = cameraEid(client, canvas)
  try {
    apply(db, [{ eid: canvas, name: 'canvas', comp: {} }])
    // Neither life looks up the previous camera. Both mint client + camera.
    for (let x of [10, 20]) {
      apply(db, [
        { eid: client, name: 'client', comp: { user_agent: 'test' } },
        {
          eid,
          name: 'camera',
          comp: { client, canvas, x, y: 0, zoom: 1, w: 800, h: 600 },
        },
      ])
    }
    assertEquals(db.prepare('select count(*) as n from camera').get(), { n: 1 })
    assertEquals(eager(db, eid).camera?.x, 20)
    apply(db, [{ eid, name: 'camera', comp: { x: 30 } }])
    assertEquals(eager(db, eid).camera?.x, 30)
  } finally {
    db.close()
  }
})
