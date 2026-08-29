// Windows as grammar (T-22617, D-22567 §4). `.limit=N` / `.after=<num>` bound
// an answer to a newest-first prefix, and a reply that carries one SAYS so —
// `{window: {limit, total}}`, the total from the same indexed count the
// aggregate grammar answers with. Two things are being held here that a
// hand-written expected set would not catch:
//
//   1. A window is EXACT. It is a prefix of the matches, never a prefix of a
//      candidate scan — so a time board whose matches sit low in the spine
//      answers whole (T-22370), where before the cap it showed 290 of 1248.
//   2. A window's EDGE is maintained. The rows that cross it are precisely the
//      ones no batch mentions: a birth pushes the oldest member out, a
//      departure pulls the next-newest in. Both are asserted over the real
//      subserve(), the same code a socket runs.
//
// subserve is db-parameterized, so this drives the serving half directly
// against an in-memory graph — no server boot, no socket, same frames.

import { assertEquals } from '@std/assert'
import { uuid } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { freshDb } = await import('./testdb.ts')
let { evalGraph, evalSub } = await import('./graph_query.ts')
let { subserve } = await import('./subserve.ts')
let { adopt, matchQuery, parseQuery, windowOf } = await import('./query.ts')

// Thirty tasks, minted oldest-first so num order IS creation order. The schema
// seeds a starter graph, so everything below is scoped by a domain of its own —
// agreement has to hold beside rows this file never wrote.
let db = freshDb()
let MINE = '.task.domain=win'
let ids: string[] = []
for (let i = 0; i < 30; i++) {
  let eid = uuid()
  ids.push(eid)
  apply(db, [
    { eid, name: 'doc', comp: { title: `task ${i}`, body: '' } },
    { eid, name: 'task', comp: { priority: 1, domain: 'win' } },
  ])
}
// The stamps are server-owned, so they are aged by hand here — stored bytes are
// what both readers read. The ODD rows are aged to 2020, and the spread is the
// point: matches sitting LOW in the spine are exactly what a candidate prefix
// drops, so the ones that stay today must be answered from anywhere in the num
// range (T-22370).
//
// It is `created.at` that moves, because `updated` is only stamped by a LATER
// write and these rows were merely made — the 1,656-entity class query.ts reads
// THROUGH (`updated.at` falls back to `created.at`: being made IS the last time
// a thing changed). A compile reading the `updated` column alone would answer
// nothing here at all. Two rows then carry a real `updated` stamp that
// DISAGREES with their creation, so the fallback is held in both directions.
let old = '2020-01-01T00:00:00.000Z'
let now = new Date().toISOString()
let idOf = (eid: string) =>
  db.prepare('select id from entity where eid = ?')
    .get(eid) as { id: number }
for (let i = 1; i < 30; i += 2) {
  db.prepare('update "created" set at = ? where entity = ?')
    .run(old, idOf(ids[i]).id)
}
// ids[1]: made in 2020, touched today — in a today window through `updated`.
db.prepare('insert into "updated" (entity, at) values (?, ?)')
  .run(idOf(ids[1]).id, now)
// ids[2]: made today, last touched in 2020 — OUT of it, for the same reason.
db.prepare('insert into "updated" (entity, at) values (?, ?)')
  .run(idOf(ids[2]).id, old)
// num rides the spine, so read the order back rather than assuming it.
let numOf = new Map(
  (db.prepare('select eid, num from entity').all() as {
    eid: string
    num: number
  }[]).map((r) => [r.eid, r.num]),
)
let newest = [...ids].sort((a, b) => numOf.get(b)! - numOf.get(a)!)
// Which rows a today-window holds, spelled out: the even half, minus the one
// created today but last touched in 2020, plus the one made in 2020 and touched
// today. Fifteen, drawn from the whole length of the spine.
let fresh = newest.filter((e) => {
  let i = ids.indexOf(e)
  return i == 1 ? true : i == 2 ? false : i % 2 == 0
})

// ---- the grammar ----

Deno.test('window: .limit and .after parse into one folded bound', () => {
  assertEquals(windowOf(parseQuery('.task!&.limit=5')), { limit: 5 })
  assertEquals(windowOf(parseQuery('.task!&.limit=5&.after=90')), {
    limit: 5,
    after: 90,
  })
  // a repeated bound folds — the last one wins, as a filter's would
  assertEquals(windowOf(parseQuery('.limit=5&.limit=9')), { limit: 9 })
  // a query naming no window says nothing, which is what leaves an unwindowed
  // answer whole
  assertEquals(windowOf(parseQuery('.task!')), {})
})

Deno.test('window: a bound that is not a whole number is refused', () => {
  for (
    let q of ['.limit=abc', '.limit=', '.limit!', '.after=-1', '.limit=1.5']
  ) {
    let threw = false
    try {
      parseQuery(q)
    } catch {
      threw = true
    }
    assertEquals(threw, true, `${q} should have been refused`)
  }
})

Deno.test('window: a bound selects nothing and writes nothing', () => {
  // A window is not a filter: every match still matches (matchQuery passes it
  // through), and a board DROP must never try to write `.limit` onto the task
  // it adopted (adopt reads scalar equalities, and a bound is not one).
  let preds = parseQuery(`${MINE}&.limit=5`)
  let row = { task: { domain: 'win' } }
  assertEquals(matchQuery(row, preds), true)
  assertEquals(adopt(preds, 'task'), { domain: 'win' })
})

// ---- the answer ----

Deno.test('window: the line bounds evalGraph to the newest page', () => {
  let all = evalGraph(db, MINE).hits
  assertEquals(all.length, 30)
  let page = evalGraph(db, `${MINE}&.limit=5`).hits
  assertEquals(page.length, 5)
  assertEquals(
    page.map((h) => h.eid).sort(),
    newest.slice(0, 5).sort(),
    'a window is the NEWEST five, not an arbitrary five',
  )
})

Deno.test('window: .after continues the window below a num cursor', () => {
  let first = evalGraph(db, `${MINE}&.limit=5`).hits
  let cursor = Math.min(...first.map((h) => h.num))
  let second = evalGraph(db, `${MINE}&.limit=5&.after=${cursor}`).hits
  assertEquals(second.length, 5)
  assertEquals(
    second.map((h) => h.eid).sort(),
    newest.slice(5, 10).sort(),
    'the second page is the next five, and overlaps the first in nothing',
  )
})

Deno.test('window: a sub states its bound and the total behind it', () => {
  let a = evalSub(db, MINE, false, 5)
  assertEquals(a.hits.length, 5)
  assertEquals(a.window, { limit: 5, total: 30 })
})

Deno.test('window: an answer that fits its bound states nothing', () => {
  // Frame semantics for an unwindowed sub are unchanged: no window field at
  // all, which is the only way a client can tell a whole set from a page.
  let a = evalSub(db, MINE, false, 1000)
  assertEquals(a.hits.length, 30)
  assertEquals(a.window, undefined)
})

Deno.test('window: an ASKED bound is stated even when the answer fits', () => {
  // The client asked for a window, so it is told what it holds — a total equal
  // to the page is how it learns there is no next page.
  let a = evalSub(db, `${MINE}&.limit=100`, false, 1000)
  assertEquals(a.hits.length, 30)
  assertEquals(a.window, { limit: 100, total: 30 })
})

// ---- T-22370: a time board answers its matches, not a spine prefix ----

Deno.test('window: a time board is a prefix of MATCHES, not of candidates', () => {
  // Fifteen of the thirty match, spread evenly across the num range. Under a
  // bound of 5 the page is the newest five MATCHES and the total is the exact
  // 15 — a spine-ordered candidate prefix could state neither.
  let a = evalSub(db, `${MINE}&.updated.at=today`, false, 5)
  assertEquals(a.window, { limit: 5, total: 15 })
  assertEquals(a.hits.map((h) => h.eid).sort(), fresh.slice(0, 5).sort())
  // and unbounded, every one of them — including the ones lowest in the spine,
  // which is the half a capped candidate window used to drop.
  let whole = evalSub(db, `${MINE}&.updated.at=today`, false, 1000)
  assertEquals(whole.hits.length, 15)
  assertEquals(whole.window, undefined)
})

// ---- the edge, maintained ----

// One subserve over this graph, collecting the frames a socket would receive.
let dial = (q: string, name = 'w') => {
  let seen: {
    sub: string
    changes?: { eid: string; name: string }[]
    drop?: string[]
    replace?: boolean
    window?: { limit: number; total?: number }
  }[] = []
  let s = subserve(db, (json) => seen.push(JSON.parse(json)))
  s.frame({ sub: name, q })
  return { s, seen, last: () => seen[seen.length - 1] }
}

Deno.test('window: a birth inside the bound pushes the oldest member out', () => {
  let { s, seen, last } = dial(`${MINE}&.limit=3`)
  assertEquals(last().window, { limit: 3, total: 30 })
  let held = new Set(last().changes!.map((c) => c.eid))
  assertEquals(held.size, 3)
  let oldest = [...held].sort((a, b) => numOf.get(a)! - numOf.get(b)!)[0]

  let born = uuid()
  let batch = [
    { eid: born, name: 'doc', comp: { title: 'newborn', body: '' } },
    {
      eid: born,
      name: 'task',
      comp: { priority: 1, domain: 'win' },
    },
  ]
  apply(db, batch)
  seen.length = 0
  s.maintain(batch as never)

  let f = last()
  // The newborn arrives AND the row it displaced leaves — the drop is the half
  // no per-eid delta could produce, since nothing in the batch names it.
  assertEquals(f.changes!.some((c) => c.eid == born), true, 'the birth ships')
  assertEquals(f.drop, [oldest], 'the edge pushed the oldest member out')
  assertEquals(f.window, { limit: 3, total: 31 }, 'and the total moved')
})

Deno.test('window: a departure pulls the next-newest member in', () => {
  // An EXACT window (a compilable filter) is the one whose edge subserve
  // maintains by re-answering — the derived .task.status is compiled through
  // its lifecycle CASE, while the window still has to be recomputed as a set,
  // the departure is driven through the same domain filter the window screens on.
  let { s, seen, last } = dial(`${MINE}&.limit=3`, 'w2')
  let held = new Set(last().changes!.map((c) => c.eid))
  let inside = [...held].sort((a, b) => numOf.get(b)! - numOf.get(a)!)[0]
  // The rows below the window — one of them should be pulled up.
  let beneath = newest.filter((e) => !held.has(e))

  // Move it out of the domain the window screens on — it leaves the query
  // exactly as a status flip once did, and nothing in the batch names its refill.
  let batch = [{ eid: inside, name: 'task', comp: { domain: 'out' } }]
  apply(db, batch)
  seen.length = 0
  s.maintain(batch as never)

  let f = last()
  assertEquals(f.drop, [inside], 'the row that left the query leaves the set')
  let added = f.changes!.map((c) => c.eid).filter((e) => e != inside)
  assertEquals(
    new Set(added).size,
    1,
    'exactly one row was pulled up to refill the window',
  )
  assertEquals(
    beneath.includes([...new Set(added)][0]),
    true,
    'and it is the next-newest match, which the batch never mentioned',
  )
})

Deno.test('window: an unrelated write leaves a windowed sub silent', () => {
  let { s, seen } = dial(`${MINE}&.limit=3`, 'w3')
  seen.length = 0
  let other = uuid()
  let batch = [{ eid: other, name: 'memory', comp: { scope: null } }]
  apply(db, batch)
  s.maintain(batch as never)
  // The dirty test is component overlap, the same one the aggregates use: a
  // write touching nothing the line reads costs a Set lookup and no frame.
  assertEquals(seen.filter((f) => f.sub == 'w3').length, 0)
})
