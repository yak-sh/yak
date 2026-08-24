// Write-path baselines: SINGLE-op apply() and keyed read paths against a
// resident 2k-task graph. Every bench measures one operation so it clears the
// sub-1ms bar the gate holds (a batch bench measures N ops at once — split into
// the single-op cost instead). `deno task bench`.
Deno.env.set('DB_PATH', ':memory:')
let { apply, componentCounts, db, eager, journalOf, resolveId } = await import(
  './db.ts'
)
let { freshDb } = await import('./testdb.ts')

let uid = () => crypto.randomUUID()
let task = (eid: string, i: number) => [
  { eid, name: 'doc', comp: { title: `Task ${i}`, body: 'b'.repeat(200) } },
  { eid, name: 'task', comp: { status: 'open', priority: i % 3 } },
]

// A resident graph of 2k tasks for the read benches.
let eids = Array.from({ length: 2000 }, uid)
eids.forEach((eid, i) => apply(db, task(eid, i)))

Deno.bench('apply: mint one task (2 comps)', () => {
  apply(db, task(uid(), 0))
})

Deno.bench('apply: patch one column', () => {
  apply(db, [{ eid: eids[7], name: 'task', comp: { priority: 2 } }])
})

// The read path that replaced the whole-graph snapshot (M-21143): one entity's
// components by eid — the O(1) keyed read /query and every client bootstrap now
// lean on instead of serializing the whole graph.
Deno.bench('eager: one entity by eid (keyed read)', () => {
  eager(db, eids[500])
})

Deno.bench('resolveId: num -> eid', () => {
  resolveId(db, '500')
})

// One entity's history: a journal_touch seek (T-13915), flat as the log grows.
// Before the index this was a full json_each scan of every journal row — the
// cost that made `task history` 3s on the live graph. A regression back to the
// scan grows this with the ~2k resident journal rows.
Deno.bench("journalOf: seek one entity's history", () => {
  journalOf(db, eids[500])
})

// The test-suite primitive: a regression here slows every db-backed test.
Deno.bench('freshDb: clone migrated image', () => {
  freshDb()
})

// The admin census over all ~89 component tables (T-18336): one statement of
// scalar counts. A regression back to one prepared count(*) per table restores
// 89 round-trips (and 89 compiles cold), the cost this collapsed.
Deno.bench('componentCounts: census over all tables', () => {
  componentCounts(db)
})
