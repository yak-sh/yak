// Fleet parity for @yaks/match (T-33576, goal V-33493): does the in-memory
// evaluator answer the REAL fleet graph the way the database does? One graph is
// seeded through the app's own apply(), gathered into whole bundles through
// @yaks/sqlite, and then every query is asked twice — once of SQLite through
// @yaks/sql, once of @yaks/match over the gathered bundles. Same set, same
// answer, or the test says so.
//
// The sibling spike (yaks_sqlite_spike_test.ts) pins the storage adapter against
// the app's own reader; this pins the second evaluator against the adapter, so
// the client tier (a graph in the page answering saved filters with no server)
// stands on measured agreement rather than a claim.
//
// The boundary this pins, executable at the bottom:
//   - The covered query subset agrees exactly, windows included.
//   - `.status` is a COMPUTED fleet column: @yaks/sql reads it through the
//     derived hook, @yaks/match has no such hook and declines. Every fleet board
//     filtering on status needs that gap closed before it can run in a page.
//   - A bare word agrees on doc titles. It cannot agree on doc BODIES here,
//     because the app stores a body as a blob id the gathered bundle carries
//     verbatim (the gap the spike filed), and because @yaks/match searches every
//     text column while the SQLite dialect searches the doc index alone.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { storage } from '@yaks/sqlite'
import type { Bundle, Driver } from '@yaks/sqlite'
import { Unsupported } from '@yaks/sql'
import { matcher } from '@yaks/match'

import { fleetVocab } from '../vocab/fleet_vocab.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('../db.ts')
let { bareDb } = await import('../testdb.ts')
let { uuid } = await import('../types.ts')
let { derived: fleetDerived } = await import('../sql_derived.ts')

let NOW = Date.parse('2026-08-20T15:00:00.000Z')
let V = fleetVocab()

// ---- one real graph, seeded through the app's own apply() ------------------

let db = bareDb()
let P = uuid(), S = uuid(), T1 = uuid(), T2 = uuid(), T3 = uuid()
let C1 = uuid()

apply(db, [
  { eid: S, name: 'session', comp: { id: 'match-parity' } },
  { eid: P, name: 'doc', comp: { title: 'Match Parity Project' } },
  { eid: P, name: 'project', comp: {} },
  { eid: T1, name: 'doc', comp: { title: 'alpha widget' } },
  { eid: T1, name: 'task', comp: { priority: 1, domain: 'Eng', project: P } },
  { eid: T2, name: 'doc', comp: { title: 'beta widget' } },
  { eid: T2, name: 'task', comp: { priority: 2, domain: 'Ops', project: P } },
  { eid: T2, name: 'claim', comp: { session: S } },
  { eid: T3, name: 'doc', comp: { title: 'gamma' } },
  { eid: T3, name: 'task', comp: { priority: 0, domain: 'Eng' } },
  { eid: C1, name: 'doc', comp: { title: 'a note about alpha' } },
  { eid: C1, name: 'comment', comp: { target: T1 } },
])

// ---- the two evaluators over that one graph --------------------------------

let driver: Driver = {
  query: (sql, params) => db.prepare(sql).all(...params),
  exec: (sql) => db.exec(sql),
}
let store = storage(driver, V, { derived: fleetDerived, now: NOW })

// Every live entity, gathered whole — the bundle set the in-memory evaluator is
// handed, exactly as a client that had synced the graph would hold it. Two
// reads because the fleet mints some entities (a content-addressed blob) with no
// spine number, and the query grammar has no spelling for "everything".
let bundles: Bundle[] = [...store.read('.num!'), ...store.read('.num=')]

let sql = (q: string): string[] =>
  store.rows(q).map((r) => r.eid as string).filter((e) => e != null).sort()
let ram = (q: string): string[] =>
  matcher(q, V, { now: NOW })(bundles).map((b) => b.entity.eid).sort()

let agree = (q: string) => assertEquals(ram(q), sql(q), `disagreed on: ${q}`)

let CORPUS = [
  // scalars: numbers, ranges, comparisons, enums, lists, contains
  '.priority=1',
  '.priority=0..2',
  '.priority>=2',
  '.priority<1',
  '.domain=Eng',
  '.domain=Eng,Ops',
  '.domain~=n',
  '.domain=',
  '.domain!=Eng',
  // facets and reference columns
  '.task!',
  '.claim!',
  '.task.project!',
  '.task.project=',
  `.project=${P}`,
  // a reference-deref path
  '.task.project.doc.title~=parity',
  '.task.project.doc.title~=nothing',
  // the kind scope
  '.kind=task',
  '.kind=project',
  '.kind=comment',
  // reverse hops over comment.target
  '.comments!',
  '.comments=',
  '.comments>=1',
  '.comments>=5',
  '.comments.doc.title~=alpha',
  // backlinks
  `.refs=${P}`,
  `.refs=${T1}`,
  // boolean composition
  '.priority=1&.domain=Eng',
  '.kind=task&.priority>=1',
]

Deno.test('fleet: the seed materialized', () => {
  assert(bundles.length >= 6, 'expected the seeded entities as bundles')
  assert(sql('.kind=task').length == 3, 'expected the seeded tasks')
})

Deno.test('fleet: @yaks/match agrees with @yaks/sql over the real graph', () => {
  for (let q of CORPUS) agree(q)
  // and the agreement is not vacuous
  assertEquals(ram('.kind=task'), [T1, T2, T3].sort())
  assertEquals(ram('.comments!'), [T1])
})

Deno.test('fleet: a window pages identically', () => {
  for (let q of ['.kind=task&.limit=2', '.kind=task&.order=priority']) {
    assertEquals(
      matcher(q, V, { now: NOW })(bundles).map((b) => b.entity.eid),
      store.rows(q).map((r) => r.eid),
      q,
    )
  }
})

Deno.test('fleet: a bare word agrees on titles', () => {
  for (let q of ['widget', 'gamma', 'nothinghere']) agree(q)
})

Deno.test('gap: the computed status column declines in memory', () => {
  // The fleet's `.status` is rolled up from cancelled/completed/claim rows;
  // @yaks/sql reads it through the derived hook it is handed, and @yaks/match
  // has no in-memory equivalent yet, so it refuses rather than answer
  // almost-right. Every status board is blocked on this.
  assertEquals(sql('.status=open'), [T1, T3].sort())
  let e = assertThrows(
    () => matcher('.status=open', V, { now: NOW }),
    Unsupported,
  ) as Unsupported
  assertEquals(e.by, '@yaks/match')
})
