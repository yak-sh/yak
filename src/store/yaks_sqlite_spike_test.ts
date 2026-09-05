// Integration spike (T-33494, goal V-33493): does @yaks/sqlite answer the REAL
// fleet graph? This wires the whole stack end to end — the fleet vocabulary
// loaded through @yaks/vocab (the shared fleet glue), a @yaks/sqlite `storage()`
// pointed at the APP's own migrated SQLite layout (db.ts's schema, via a thin
// Driver over the app connection), and a graph seeded through the app's own real
// `apply()` — then holds @yaks/sqlite's membership answers against what the app's
// own reader (query.ts → sql.ts → relation.run) returns for the same query. Two
// independent readers, one real graph, the same question: if they disagree the
// spike says so.
//
// This is NOT the same as sql_parity_test. That test proves @yaks/sql's compiled
// SQL equals src/sql.ts's over a hand-built fixture, calling compile() directly.
// This proves the whole @yaks/sqlite ADAPTER — storage()/rows()/read() — answers
// the app's real db, seeded the real way. It is the honest evidence that the
// read path works on real data, and it pins the exact coverage boundary — now
// one gap wide: doc.body is gathered off the wrong layout (documented below).
//
// Findings, in one place (see the bottom tests for the executable form):
//   - Membership over the covered query subset is EXACT against the real graph.
//   - `.near=<eid>&.order=similar` compiles and ranks, through @yaks/embedding
//     registered as a @yaks/sql extension, against the app's OWN `embedding`
//     table — the layouts are column-for-column the same (T-33538).
//   - The reverse-hop grammar (`.comments!`, `.comments>=5`, `.comments.<path>`)
//     compiles and agrees with the app (T-33540).
//   - The traversal grammar (`.edges!`, `.reaches[requires,<=N]=<eid>`) compiles
//     through @yaks/edge's @yaks/sql extension and agrees with the app (T-33539).
//   - `read()` gathers doc.body straight off the `doc` table, but the app stores
//     body as a blob_text FK behind the `doc_value` view, so a gathered bundle's
//     doc.body is the blob's integer id, not the text (filed).

import { assert, assertEquals } from '@std/assert'
import { storage } from '@yaks/sqlite'
import { fields, hashEmbedder, semantic, sweep } from '@yaks/embedding'
import type { Driver } from '@yaks/sqlite'
import { traverse } from '@yaks/edge'

import { fleetVocab } from '../vocab/fleet_vocab.ts'
import { link } from '../edge.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('../db.ts')
let { bareDb } = await import('../testdb.ts')
let { uuid } = await import('../types.ts')
let { parseQuery } = await import('../query.ts')
let { where, windowed, countSql } = await import('../sql.ts')
let { run } = await import('../relation.ts')
let { derived: fleetDerived } = await import('../sql_derived.ts')

let NOW = Date.parse('2026-08-20T15:00:00.000Z')
let V = fleetVocab()

// ---- one real graph, seeded through the app's own apply() ------------------

let db = bareDb()

// Real eids (uuids), the way a client mints them.
let P = uuid(), S = uuid(), T1 = uuid(), T2 = uuid(), T3 = uuid(), T4 = uuid()
let C1 = uuid()

// A change is the app's wire shape (eid/name/comp). Referenced entities lead so
// a ref resolves within the batch. Statuses: T1 open, T2 wip (claimed), T3 done
// (completed), T4 cancelled — the derived-status ordering the boards read.
apply(db, [
  { eid: S, name: 'session', comp: { id: 'spike-sess' } },
  { eid: P, name: 'doc', comp: { title: 'Storage Spike Project' } },
  { eid: P, name: 'project', comp: {} },
  {
    eid: T1,
    name: 'doc',
    comp: { title: 'alpha widget', body: 'the first one' },
  },
  { eid: T1, name: 'task', comp: { priority: 1, domain: 'Eng', project: P } },
  { eid: T2, name: 'doc', comp: { title: 'beta widget', body: 'the second' } },
  { eid: T2, name: 'task', comp: { priority: 2, domain: 'Ops', project: P } },
  { eid: T2, name: 'claim', comp: { session: S } },
  { eid: T3, name: 'doc', comp: { title: 'gamma', body: 'under_score' } },
  { eid: T3, name: 'task', comp: { priority: 0, domain: 'Eng' } },
  {
    eid: T3,
    name: 'completed',
    comp: { at: '2026-08-02T00:00:00.000Z', by: null },
  },
  { eid: T4, name: 'doc', comp: { title: 'delta' } },
  { eid: T4, name: 'task', comp: { priority: 3, domain: 'Ops' } },
  {
    eid: T4,
    name: 'cancelled',
    comp: { at: '2026-08-03T00:00:00.000Z', by: null, reason: 'superseded' },
  },
  { eid: C1, name: 'doc', comp: { title: 'a note about alpha' } },
  { eid: C1, name: 'comment', comp: { target: T1 } },
  // a requires chain, so the traversal grammar has something to walk:
  // T3 → T2 → T1, and T4 off to the side.
  ...link(T2, 'requires', T1),
  ...link(T3, 'requires', T2),
  ...link(T4, 'contains', T1),
])

// ---- the two readers over that one graph -----------------------------------

// @yaks/sqlite, pointed at the app's live connection through the minimal Driver.
// No install(): the app's own migration already built the schema @yaks/sql reads.
let driver: Driver = {
  query: (sql, params) => db.prepare(sql).all(...params),
  exec: (sql) => db.exec(sql),
}
// @yaks/edge registers the traversal clauses (`.edges`, `.reaches`) the way
// @yaks/fts registers search: an extension over the same compiler.
let opts = { derived: fleetDerived, now: NOW, extend: [traverse(V)] }
let store = storage(driver, V, opts)

// The adapter's membership answer for a query, as a sorted eid set.
let mine = (q: string): string[] =>
  store.rows(q).map((r) => r.eid as string).filter((e) => e != null).sort()

// The app's own membership answer, as a sorted eid set — null when the app's
// compiler declined (not a compiled-parity case).
let ref = (q: string): string[] | null => {
  let rel = where(parseQuery(q), NOW)
  return rel ? run<{ eid: string }>(db, rel).map((r) => r.eid).sort() : null
}

// Both readers agree, and the app did not decline (a decline would mean the app
// itself falls to its JS matcher — outside the compiled subset this spike pins).
let agree = (q: string) => {
  let r = ref(q)
  assert(r != null, `app declined (not a compiled case): ${q}`)
  assertEquals(mine(q), r, `disagreed on: ${q}`)
}

// ---- the real-query corpus, run through the whole adapter ------------------

let CORPUS = [
  // derived status across the cancelled→completed→claim→open ordering
  '.status=open',
  '.status=wip',
  '.status=done',
  '.status=cancelled',
  '.status=open,wip',
  '.status!=done',
  // scalars: numbers, ranges, comparisons, lists, contains
  '.priority=1',
  '.priority=1..3',
  '.priority>=2',
  '.priority<1',
  '.domain=Eng',
  '.domain=Eng,Ops',
  '.domain~=n',
  // presence / absence over a facet and an explicit reference column
  '.task!',
  '.task.project!',
  '.task.project=',
  `.project=${P}`,
  // reference-deref path (task.project → doc.title)
  '.task.project.doc.title~=spike',
  '.task.project.doc.title~=nothing',
  // full-text over doc
  'widget',
  'gamma',
  // .kind scope (present-and-earlier-absent)
  '.kind=task',
  '.kind=project',
  '.kind=comment',
  // boolean composition
  '.priority=1&.domain=Eng',
  '.status=open&.priority>=1',
]

Deno.test('spike: the seed materialized (both readers see the tasks)', () => {
  // Sanity that the real apply() built the graph this spike reads — else every
  // parity line below would be a vacuous empty==empty.
  assert(ref('.kind=task')!.length >= 3, 'expected the seeded tasks')
  assert(ref('.status=open')!.length >= 1, 'expected an open task')
})

Deno.test('spike: @yaks/sqlite membership equals the app over the real graph', () => {
  for (let q of CORPUS) agree(q)
})

Deno.test('spike: the newest-first window pages identically', () => {
  let ordered = store.rows('.status=open&.limit=3').map((r) => r.eid)
  let refList = run<{ eid: string }>(
    db,
    windowed(where(parseQuery('.status=open'), NOW)!, { limit: 3 }),
  ).map((r) => r.eid)
  assertEquals(ordered, refList)
})

Deno.test('spike: an aggregate count matches through rows()', () => {
  let mineN = Number(store.rows('.status=open&.count!')[0].n)
  let refN =
    run<{ n: number }>(db, countSql(parseQuery('.status=open&.count!'))!)[0].n
  assertEquals(mineN, Number(refN))
})

// ---- the exact coverage boundary, made executable --------------------------

Deno.test('spike: the traversal grammar agrees with the app', () => {
  // Was the last of the declining directives (T-33539). @yaks/edge compiles both
  // clauses against the same fleet vocabulary — `.reaches` as a recursive CTE
  // over the edge table, `.edges` as the rider that narrows nothing — so they
  // are held against the app's own compiler rather than declining.
  for (
    let q of [
      '.reaches[requires,<=1]=' + T1,
      '.reaches[requires,<=2]=' + T1,
      '.reaches[requires,<=9]=' + T1,
      '.reaches[contains,<=9]=' + T1,
      '.reaches[requires,<=9]=' + T1 + '&.status=done',
      '.edges!',
      '.edges[requires]!',
      '.edges!&.status=open',
    ]
  ) agree(q)
  // and the agreement is not vacuous: the seeded chain is T3 → T2 → T1
  assertEquals(mine('.reaches[requires,<=1]=' + T1), [T2])
  assertEquals(mine('.reaches[requires,<=2]=' + T1).sort(), [T2, T3].sort())
})

Deno.test('spike: the reverse-hop grammar agrees with the app', () => {
  // `.comments` is the reverse of comment.target — the association @yaks/vocab
  // derives from the reference columns and @yaks/sql compiles as a correlated
  // EXISTS/count, the same shape src/sql.ts's revSql builds. Presence, absence,
  // cardinality and a child filter, each held against the app's own reader.
  for (
    let q of [
      '.comments!',
      '.comments=',
      '.comments>=1',
      '.comments>=5',
      '.comments.doc.title~=alpha',
      '.comments.doc.title~=nothing',
      '.comments!&.status=open',
    ]
  ) agree(q)
  // and the agreement is not vacuous: the seeded comment puts T1 in the set
  assertEquals(mine('.comments!'), [T1])
  assertEquals(mine('.comments.doc.title~=alpha'), [T1])
})

Deno.test('spike: .near ranks the real graph through the adapter', async () => {
  // The gap this closes (T-33538): `.near=<eid>&.order=similar` used to throw
  // Unsupported here. @yaks/embedding answers it as a @yaks/sql extension, and
  // it writes to the app's OWN `embedding` table — db.ts already migrated one
  // whose columns are exactly the package's, so this test installs no schema.
  //
  // The app's own reader is not the reference for this one: it answers `.near`
  // with a JS ranker over a native vector extension (server_runtime.ts's
  // setRanker → embed.ts), not with compiled SQL, and neither the extension nor
  // the embedding model is reachable from a test. What is held here instead is
  // that the compiled statement selects and orders EXACTLY the neighbourhood the
  // ranking produced, over the real graph, with a deterministic embedder.
  let text = fields(V, (c) => c.prop == 'title')
  let embedder = hashEmbedder()
  await sweep(driver, text, embedder)

  let near = semantic(driver, embedder, { limit: 3 })
  let got = store.rows(`.near=${T1}&.order=similar`, { extend: [near] })
    .map((r) => r.eid as string)

  assert(got.length > 0, 'the neighbourhood is not empty')
  assert(!got.includes(T1), 'an entity is not its own neighbour')
  assertEquals(got, near.neighbours().map((n) => n.entity))
  // 'alpha widget' and 'beta widget' share a word; 'gamma' does not.
  assertEquals(got[0], T2)
  // and the rest of the line still filters
  assertEquals(
    store.rows(`.near=${T1}&.domain=Eng`, {
      extend: [semantic(driver, embedder)],
    })
      .map((r) => r.eid),
    [T3],
  )
  // the similarity rides back as a query-only comp, on no table at all
  let ranked = near.rank(store.read(`.near=${T1}&.order=similar`, {
    extend: [near],
  }))
  assertEquals(ranked[0].entity.eid, T2)
  assert((ranked[0].rank as { score: number }).score > 0)
})

Deno.test('gap: read() gathers doc.body off the wrong layout', () => {
  // The app stores doc.body as an integer FK into blob_text, surfaced as text
  // only through the `doc_value` view; @yaks/sqlite's bundleOf reads `doc.body`
  // straight off the `doc` table, so it gathers the blob's integer id, not the
  // text. Membership (which routes doc through doc_value) is unaffected; only the
  // whole-entity gather diverges. Documented as a landed gap, not worked around.
  let [t1] = store.read(`.project=${P}&.priority=1`)
  assertEquals(t1.entity.eid, T1)
  let body = (t1.doc as Record<string, unknown>).body
  assertEquals(typeof body, 'number') // the blob entity id, not 'the first one'
  assert(body !== 'the first one', 'doc.body is the blob id, not the text')
})
