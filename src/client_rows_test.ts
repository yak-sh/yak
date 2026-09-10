// Cold caches cannot decide a singleton's existence; open() heals old UUIDs.
import { assertEquals, assertNotEquals } from '@std/assert'
import { cameraEid, cursorEid } from './edge.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply, eager, epochOf } = await import('./db.ts')
let { open } = await import('./store/sqlite.ts')
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

Deno.test('open derives client row eids once, retaining references and journal', () => {
  let root = Deno.makeTempDirSync({ prefix: 'tasks-client-rows-' })
  let path = `${root}/graph.db`
  let db = open(path)
  let client = uid(),
    canvas = uid(),
    camera = uid(),
    cursor = uid(),
    card = uid()
  let cam = cameraEid(client, canvas), cur = cursorEid(client)
  let counts = () =>
    ['entity', 'camera', 'cursor', 'card', 'pin'].map((table) =>
      db.prepare(`select count(*) as n from ${table}`).get()
    )
  let journal = () =>
    db.prepare('select * from journal_field order by change, ordinal').all()
  try {
    apply(db, [
      { eid: client, name: 'client', comp: { user_agent: 'test' } },
      { eid: canvas, name: 'canvas', comp: {} },
      { eid: camera, name: 'camera', comp: { client, canvas, x: 42, zoom: 2 } },
      {
        eid: cursor,
        name: 'cursor',
        comp: { client, target: camera, view: 'Full' },
      },
      { eid: card, name: 'card', comp: { target: cursor, view: 'Full' } },
      {
        eid: card,
        name: 'pin',
        comp: { canvas: camera, x: 1, y: 2, w: 3, h: 4 },
      },
    ])
    let before = counts(), history = journal(), epoch = epochOf(db)
    let ids = db.prepare(
      'select id, eid from entity where eid in (?, ?) order by id',
    ).all(
      camera,
      cursor,
    )
    db.close()
    db = open(path)
    assertEquals(counts(), before)
    assertEquals(journal(), history)
    assertEquals(
      db.prepare('select id, eid from entity where eid in (?, ?) order by id')
        .all(
          cam,
          cur,
        ),
      ids.map((r) => ({ ...r, eid: r.eid == camera ? cam : cur })),
    )
    assertEquals(eager(db, camera), {})
    assertEquals(eager(db, cursor), {})
    assertEquals(eager(db, cam).camera?.x, 42)
    assertEquals(eager(db, cam).camera?.zoom, 2)
    assertEquals(eager(db, cur).cursor?.target, cam)
    assertEquals(eager(db, card).card?.target, cur)
    assertEquals(eager(db, card).pin?.canvas, cam)
    assertEquals(db.prepare('pragma foreign_key_check').all(), [])
    assertNotEquals(epochOf(db), epoch)
    let migratedEpoch = epochOf(db)
    db.close()
    db = open(path)
    assertEquals(counts(), before)
    assertEquals(journal(), history)
    assertEquals(epochOf(db), migratedEpoch)
    assertEquals(eager(db, cur).cursor?.target, cam)
  } finally {
    db.close()
    Deno.removeSync(root, { recursive: true })
  }
})
