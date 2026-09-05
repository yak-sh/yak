// The EDGES rider's BOUND (T-33752). A rider used to ship every edge incident
// to its members and a projected peer row for each, so opening one well-joined
// project sent 1,947 sentences and 1,935 peer rows — 902 KB and 942ms for a
// list no view can render. It windows now, exactly as a row set does: the
// newest `limit` sentences, and the frame states the total it is a prefix of.
//
// Driven against subserve over an in-memory graph — no socket, no server — so
// what is asserted is the frame contract itself.
import { assert, assertEquals } from '@std/assert'
import { edgeRider, parseQuery } from './query.ts'
import { link } from './edge.ts'
import type { Change, Dep } from './types.ts'
import { uuid } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { subserve } = await import('./subserve.ts')
let { bareDb } = await import('./testdb.ts')

type Frame = {
  sub?: string
  edges?: Dep[]
  peers?: Change[]
  unedges?: Dep[]
  edgeWindow?: { limit: number; total?: number }
}

let PEERS = '.edges.peers=task.status,doc.title'

// ONE hub for the whole file — freshDb is the expensive part, and every
// assertion here is about the FRAME, which a fresh subserve gives each test
// over the same graph. `kids` grows as the mutating tests link more.
let db = bareDb()
let root = uuid()
let kids: string[] = []
apply(db, [{ eid: root, name: 'doc', comp: { title: 'hub', body: '' } }])

// One more child, hung off the hub by `contains` — newest last.
let grow = (): Change[] => {
  let eid = uuid()
  kids.push(eid)
  return [
    { eid, name: 'doc', comp: { title: `kid ${kids.length}`, body: 'b' } },
    { eid, name: 'task', comp: { priority: 1 } },
    ...link(root, 'contains', eid),
  ]
}
for (let i = 0; i < 12; i++) apply(db, grow())

let open = (line: string) => {
  let frames: Frame[] = []
  let sv = subserve(db, (f) => frames.push(f as Frame))
  sv.frame({ sub: `route:${root}`, q: `id=${root}&${line}` })
  return { sv, frames }
}

Deno.test('.edges.limit is the rider bound, tightest ask wins', () => {
  let one = edgeRider(parseQuery(`${PEERS}&.edges.limit=25`))!
  assertEquals(one.limit, 25)
  assertEquals(one.peers.length, 2)
  let two = edgeRider(parseQuery('.edges.limit=25&.edges.limit=5'))!
  assertEquals(two.limit, 5)
  // A rider that names no bound leaves the server's floor to say how many.
  assertEquals(edgeRider(parseQuery('.edges!'))!.limit, undefined)
})

Deno.test('a rider inside its bound ships whole and states nothing', () => {
  let { frames } = open(`${PEERS}&.edges.limit=25`)
  assertEquals(frames[0].edges!.length, 12)
  assertEquals(frames[0].edgeWindow, undefined)
})

Deno.test('a rider over its bound ships a prefix and states the total', () => {
  let { frames } = open(`${PEERS}&.edges.limit=5`)
  assertEquals(frames[0].edges!.length, 5)
  assertEquals(frames[0].edgeWindow, { limit: 5, total: 12 })
  // A peer rides for each delivered edge and for NO other — the row cost is
  // the bound's, which is the whole point of bounding it.
  assertEquals(new Set(frames[0].peers!.map((c) => c.eid)).size, 5)
})

Deno.test('the prefix is the NEWEST sentences', () => {
  let { frames } = open(`${PEERS}&.edges.limit=3`)
  assertEquals(
    frames[0].edges!.map((d) => d.child).sort(),
    kids.slice(-3).sort(),
  )
})

Deno.test('a new sentence enters the bounded prefix and one leaves', () => {
  let { sv, frames } = open(`${PEERS}&.edges.limit=3`)
  let out = kids.at(-3)
  let batch = grow()
  apply(db, batch)
  sv.maintain(batch)
  let d = frames[1]
  assert(d, 'a bounded rider speaks when its prefix moves')
  assertEquals(d.edges!.map((e) => e.child), [kids.at(-1)])
  assertEquals(d.unedges!.map((e) => e.child), [out])
  assertEquals(d.edgeWindow, { limit: 3, total: 13 })
})

Deno.test('a rider that grows back inside its bound withdraws the window', () => {
  let { sv, frames } = open(`${PEERS}&.edges.limit=12`)
  assertEquals(frames[0].edgeWindow, { limit: 12, total: 13 })
  let batch: Change[] = [{ eid: kids[0], name: 'entity', comp: null }]
  apply(db, batch)
  sv.maintain(batch)
  assertEquals(frames.at(-1)!.edgeWindow, { limit: 12, total: 12 })
  db.close()
})
