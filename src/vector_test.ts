// The native vector seam: a raw-vector write dirties the persisted ANN data,
// refresh rebuilds it, and SQLite answers KNN from that rebuilt structure.
Deno.env.set('DB_PATH', ':memory:')
let { db } = await import('./live_db.ts')
let { DIM, refreshVector } = await import('./vector.ts')
let { assertEquals } = await import('@std/assert')
let { slow } = await import('./testing.ts')

slow('vector index: embedding writes dirty, rebuild, and answer KNN', () => {
  let eid = crypto.randomUUID()
  let vec = new Float32Array(DIM)
  vec[0] = 1
  db.prepare('insert into entity (eid, num) values (?, ?)').run(
    eid,
    Math.floor(Math.random() * 1e9),
  )
  db.prepare(
    `insert into embedding (eid, model, hash, vec)
     values (?, 'test', 'test', vector_as_f32(?, ?))`,
  ).run(eid, new Uint8Array(vec.buffer), DIM)
  assertEquals(
    db.prepare('select dirty from embedding_index where id = 1').get(),
    { dirty: 1 },
  )

  assertEquals(refreshVector(db) > 0, true)
  let hit = db.prepare(
    `select e.eid
     from vector_quantize_scan('embedding', 'vec', ?, 1) v
     join embedding e on e.rowid = v.rowid`,
  ).get(new Uint8Array(vec.buffer))
  assertEquals(hit, { eid })
  assertEquals(
    db.prepare('select dirty from embedding_index where id = 1').get(),
    { dirty: 0 },
  )
})
