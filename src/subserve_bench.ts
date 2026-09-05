// The subscription server — the code between a write landing and every open tab
// seeing it, and the largest hot path the ratchet did not watch. Two shapes:
//
//   control()  — what a view pays when it MOUNTS: the sub's first frame, its
//                whole current membership in one batch. A board load sends a
//                dozen of these and they are served SERIALLY on one socket, so
//                one slow sub delays every sub behind it.
//   maintain() — what EVERY commit pays, on every socket, for every sub it
//                holds: re-test the touched eids against each open filter and
//                send only the deltas. Its cost is subs × touched, and a query
//                re-answered per batch instead of re-tested is the regression
//                that turns one comment into a whole-graph read.
//
// subserve is db-parameterized and takes its `send` as a callback, so both run
// here with no socket, no server and no browser (projection_test.ts drives it
// the same way).
Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { db } = await import('./live_db.ts')
let { subserve } = await import('./subserve.ts')
let { subqueue } = await import('./subqueue.ts')
let { cursorOf } = await import('./db.ts')
import { link } from './edge.ts'
import type { Change } from './types.ts'

let uid = () => crypto.randomUUID()
let PROJ = uid()
let SESS = uid()
apply(db, [
  { eid: PROJ, name: 'doc', comp: { title: 'Sub bench project', body: '' } },
  { eid: PROJ, name: 'project', comp: {} },
  { eid: SESS, name: 'session', comp: { id: 'sub-bench' } },
])
let eids = Array.from({ length: 600 }, uid)
eids.forEach((eid, i) =>
  apply(db, [
    { eid, name: 'doc', comp: { title: `Task ${i}`, body: 'b'.repeat(120) } },
    { eid, name: 'task', comp: { priority: i % 3, project: PROJ } },
    ...(i % 4 == 0 ? [{ eid, name: 'completed', comp: {} }] : []),
  ])
)

// A HUB: one entity every task points at. The route sub below is what a card on
// it opens, and before the rider was bounded that sub shipped a sentence and a
// projected peer row for every one of them (T-33752: 1,947 edges, 902 KB and
// 942ms to open P-19 on the live graph).
let HUB = uid()
apply(db, [
  { eid: HUB, name: 'doc', comp: { title: 'Sub bench hub', body: '' } },
])
eids.forEach((eid) => apply(db, link(HUB, 'contains', eid)))

let sink = () => {}

// A view mounting: the sub's first frame. This is the per-mount cost a board,
// a card and the nav each pay, one after another, on one socket.
Deno.bench('subserve: a board sub answers its first frame', () => {
  let sv = subserve(db, sink)
  sv.frame({ sub: 'board', q: `.project=${PROJ}&.limit=400` }, sink)
})

// A tally sub answers a VALUE and must never enumerate its members — not even
// once. The regression this guards is the aggregate falling back to hydrating
// the selection (T-33706: 747ms for 146 bytes of answer on the live graph).
Deno.bench('subserve: a status tally sub answers without members', () => {
  let sv = subserve(db, sink)
  sv.frame({ sub: 'tally', q: `.project=${PROJ}&.tally=task.status` }, sink)
})

// A small sub's FIRST FRAME while a large one is in flight (T-33753). The two
// go out in one burst, board first; the queue answers the bounded tally before
// the 600-row board, so this measures the tally's own cost and not the board's.
// Served in arrival order it costs the board's time plus its own — 17ms here,
// and on the live graph a 142-byte answer waiting ~900ms on the subs ahead of
// it. b.start/b.end keep the board, still served afterwards, out of the
// measurement.
Deno.bench(
  'subserve: a small sub first-frames while a large one is in flight',
  async (b) => {
    let small = Promise.withResolvers<void>()
    let both = Promise.withResolvers<void>()
    let n = 0
    let sv = subserve(db, (f) => {
      if ((f as { sub?: string }).sub == 'tally') small.resolve()
      if (++n == 2) both.resolve()
    })
    let q = subqueue(db, (f) => sv.frame(f))
    b.start()
    q.push({ sub: 'board', q: `.project=${PROJ}&.limit=400` })
    q.push({ sub: 'tally', q: `.project=${PROJ}&.tally=task.status` })
    await small.promise
    b.end()
    await both.promise
  },
)

// A route sub on a HUB pays its BOUND, never its neighbourhood. This is the
// clamp, not just the timing: the frame is inspected and the bench THROWS if
// more than `.edges.limit=` sentences — or a peer row for anything but their far
// endpoints — comes back, so an unbounded rider fails here rather than showing
// up as a slow number somebody reads past.
let ROUTE = `.edges.peers=task.status,doc.title&.edges.limit=100`
let clamp = (frame: unknown) => {
  let f = frame as { edges?: unknown[]; peers?: { eid: string }[] }
  let edges = f.edges ?? []
  let peers = new Set((f.peers ?? []).map((c) => c.eid))
  if (edges.length > 100) throw new Error(`rider shipped ${edges.length} edges`)
  if (peers.size > 100) throw new Error(`rider shipped ${peers.size} peers`)
  if (!edges.length) throw new Error('rider shipped nothing — bench is inert')
}
Deno.bench('subserve: a route sub on a hub answers its bounded rider', () => {
  let sv = subserve(db, clamp)
  sv.frame({ sub: `route:${HUB}`, q: `id=${HUB}&${ROUTE}` })
})

// One committed batch folded across a socket holding a realistic set of subs —
// a board window, its tally, a favorites set and a route. Only the touched eid
// may be re-read; a sub that re-answers its whole query per batch shows here as
// a multiple.
let held = subserve(db, sink)
for (
  let [sub, q] of [
    ['board', `.project=${PROJ}&.limit=400`],
    ['tally', `.project=${PROJ}&.tally=task.status`],
    ['favs', '.favorite!'],
    ['projects', '.project!'],
    ['route', `id=${eids[0]}&.edges.peers=task.status,doc.title`],
  ]
) held.frame({ sub, q }, sink)

let touched: Change[] = [
  { eid: eids[7], name: 'task', comp: { priority: 2 } },
]
Deno.bench('subserve: fold one commit across five open subs', () => {
  held.maintain(touched, cursorOf(db))
})

// The clock tick: a moving time window ages members out with nobody writing.
// Every socket runs this on a timer, so it must cost its own members, not the
// graph.
let moving = subserve(db, sink)
moving.frame({ sub: 'recent', q: '.created.at>=-7d&.limit=200' }, sink)
Deno.bench('subserve: age a moving-window sub on a tick', () => {
  moving.aged()
})
