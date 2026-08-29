// Backfilling the EXISTING JSON journal history into the normalized tables
// (T-18879). These pure-seam tests drive db.ts `backfillJournal` over a journal
// built from raw legacy rows (the JSON-only shape that predates dual-write) and
// hold the migration faithful: a backfilled batch's normalized rows reconstruct
// its JSON batch exactly, journal_tx.id equals the JSON row's rowid so total and
// within-batch order are preserved, a historical component removal tombstones
// the fields present per the BACKFILLED record, the first run clears the interim
// non-identity dual-write rows, and a re-run resumes without double-writing.
// Raw SQL reads the log tables the way journal_normalized_test.ts does.
Deno.env.set('DB_PATH', ':memory:')
let { apply, backfillJournal, renamed } = await import('./db.ts')
let { bareDb } = await import('./testdb.ts')
let { assertEquals } = await import('@std/assert')
let { DatabaseSync } = await import('./sqlite.ts')
import { type Change } from './types.ts'

// Build the migrated snapshot once — setup, not the per-test 1ms work.
bareDb()

let uid = () => crypto.randomUUID()
type DB = InstanceType<typeof DatabaseSync>

// Insert one LEGACY JSON journal row — the JSON-only shape that predates
// dual-write, with no normalized counterpart — and return its rowid.
let legacy = (
  d: DB,
  batch: Change[],
  prov: { ts?: string; actor?: string; via?: string; trace?: string } = {},
): number =>
  Number(
    d.prepare(
      'insert into journal (ts, actor, via, batch, trace) values (?, ?, ?, ?, ?)',
    ).run(
      prov.ts ?? '2026-01-01T00:00:00.000Z',
      prov.actor ?? null,
      prov.via ?? null,
      JSON.stringify(batch),
      prov.trace ?? null,
    ).lastInsertRowid,
  )

// Reconstruct a transaction's batch from the normalized rows: each
// journal_change in applied order, its comp rebuilt from the present after-image
// rows (a remove is comp:null). Equals the batch's canonical form if the two
// logs agree.
let reconstruct = (d: DB, tx: number): Change[] => {
  let changes = d.prepare(
    `select id, eid, component, operation from journal_change
     where tx = ? order by ordinal`,
  ).all(tx) as {
    id: number
    eid: string
    component: string
    operation: string
  }[]
  return changes.map(({ id, eid, component, operation }) => {
    if (operation == 'remove') return { eid, name: component, comp: null }
    let fields = d.prepare(
      `select field, value from journal_field
       where change = ? and present = 1 order by ordinal`,
    ).all(id) as { field: string; value: string }[]
    return {
      eid,
      name: component,
      comp: Object.fromEntries(
        fields.map((f) => [f.field, JSON.parse(f.value)]),
      ),
    }
  })
}

let n = (d: DB, sql: string): number =>
  (d.prepare(sql).get() as { n: number }).n

Deno.test('backfill: normalized rows reconstruct each JSON batch, in order', () => {
  let d = bareDb()
  let t = uid()
  let b1: Change[] = [
    { eid: t, name: 'doc', comp: { title: 'a', body: '' } },
    { eid: t, name: 'task', comp: { priority: 'P2' } },
  ]
  let b2: Change[] = [{ eid: t, name: 'task', comp: { status: 'wip' } }]
  let r1 = legacy(d, b1)
  let r2 = legacy(d, b2)
  assertEquals(backfillJournal(d).wrote, 2)
  // Each batch round-trips through the shared derivation. renamed() is the
  // live writer's canonical form (identity today: the rename map is empty).
  assertEquals(reconstruct(d, r1), b1.map((c) => renamed(c)))
  assertEquals(reconstruct(d, r2), b2.map((c) => renamed(c)))
})

Deno.test('backfill: journal_tx.id equals the JSON rowid (identity + total order)', () => {
  let d = bareDb()
  let r1 = legacy(d, [{
    eid: uid(),
    name: 'doc',
    comp: { title: 'a', body: '' },
  }])
  let r2 = legacy(d, [{
    eid: uid(),
    name: 'doc',
    comp: { title: 'b', body: '' },
  }])
  backfillJournal(d)
  let ids = (d.prepare('select id from journal_tx order by id').all() as {
    id: number
  }[]).map((x) => x.id)
  // One tx per legacy row, keyed by that row's rowid — so the normalized order
  // is the journal order and a reader joins journal.rowid = journal_tx.id.
  assertEquals(ids, [r1, r2])
})

Deno.test('backfill: within-batch ordinals are dense and match the JSON batch', () => {
  let d = bareDb()
  let t = uid()
  let b: Change[] = [
    { eid: t, name: 'doc', comp: { title: 'a', body: '' } },
    { eid: t, name: 'task', comp: { priority: 'P2' } },
    { eid: t, name: 'design', comp: {} },
  ]
  let r = legacy(d, b)
  backfillJournal(d)
  let rows = d.prepare(
    'select ordinal, component from journal_change where tx = ? order by ordinal',
  ).all(r) as { ordinal: number; component: string }[]
  assertEquals(rows.map((x) => x.ordinal), b.map((_, i) => i))
  assertEquals(rows.map((x) => x.component), b.map((c) => c.name))
})

Deno.test('backfill: a historical removal tombstones the then-present fields', () => {
  let d = bareDb()
  let t = uid()
  legacy(d, [
    { eid: t, name: 'doc', comp: { title: 'a', body: '' } },
    { eid: t, name: 'task', comp: { priority: 'P2' } },
  ])
  let rem = legacy(d, [{ eid: t, name: 'task', comp: null }])
  backfillJournal(d)
  let change = d.prepare(
    `select id, operation from journal_change where tx = ? and component = 'task'`,
  ).get(rem) as { id: number; operation: string }
  assertEquals(change.operation, 'remove')
  let fields = d.prepare(
    'select field, present, value from journal_field where change = ? order by field',
  ).all(change.id) as { field: string; present: number; value: string | null }[]
  // The fields present per the BACKFILLED record are tombstoned — established by
  // the backfill's own predecessor frontier, not by any live-only state.
  assertEquals(fields.every((f) => f.present == 0 && f.value == null), true)
  assertEquals(
    new Set(fields.map((f) => f.field)),
    new Set(['priority']),
  )
})

Deno.test('backfill: a present null stays distinct from a tombstone', () => {
  let d = bareDb()
  let t = uid()
  legacy(d, [{
    eid: t,
    name: 'task',
    comp: { priority: 'P2' },
  }])
  let r = legacy(d, [{ eid: t, name: 'task', comp: { assignee: null } }])
  backfillJournal(d)
  let change = (d.prepare(
    `select id from journal_change where tx = ? and component = 'task'`,
  ).get(r) as { id: number }).id
  let field = d.prepare(
    'select present, value from journal_field where change = ? and field = ?',
  ).get(change, 'assignee') as { present: number; value: string }
  assertEquals(field.present, 1)
  assertEquals(field.value, 'null')
})

Deno.test('backfill: restart resumes and never double-writes', () => {
  let d = bareDb()
  legacy(d, [{ eid: uid(), name: 'doc', comp: { title: 'a', body: '' } }])
  assertEquals(backfillJournal(d).wrote, 1)
  // A legacy row appended after the first pass is picked up on the next.
  legacy(d, [{ eid: uid(), name: 'doc', comp: { title: 'b', body: '' } }])
  assertEquals(backfillJournal(d).wrote, 1)
  // And a further re-run is a pure no-op.
  assertEquals(backfillJournal(d).wrote, 0)
  // One tx per JSON row, exactly — no double-insert.
  assertEquals(
    n(d, 'select count(*) as n from journal_tx'),
    n(d, 'select count(*) as n from journal'),
  )
})

Deno.test('backfill: first run clears interim non-identity dual-write rows', () => {
  let d = bareDb()
  let t = uid()
  let r = legacy(d, [{ eid: t, name: 'doc', comp: { title: 'x', body: '' } }])
  // Simulate the pre-identity dual-write shape: a journal_tx whose id does NOT
  // equal its journal rowid (the old auto-increment), plus a stray change.
  d.prepare(
    'insert into journal_tx (id, ts, actor, via, trace) values (99, ?, ?, ?, ?)',
  ).run('2026-01-01T00:00:00.000Z', null, null, null)
  d.prepare(
    `insert into journal_change (tx, ordinal, eid, component, operation)
     values (99, 0, ?, 'doc', 'upsert')`,
  ).run(t)
  backfillJournal(d)
  // The interim id=99 row is gone; the log is rebuilt keyed by rowid.
  let ids = (d.prepare('select id from journal_tx order by id').all() as {
    id: number
  }[]).map((x) => x.id)
  assertEquals(ids, [r])
})

Deno.test('backfill: reset+rebuild reproduces the live dual-write exactly', () => {
  let d = bareDb()
  let t = uid()
  // apply() dual-writes the normalized rows; capture the JSON batch it logged.
  apply(d, [
    { eid: t, name: 'doc', comp: { title: 'a', body: '' } },
    { eid: t, name: 'task', comp: { priority: 'P2' } },
  ])
  let row = d.prepare(
    'select rowid as id, batch from journal order by rowid desc limit 1',
  )
    .get() as { id: number; batch: string }
  let before = reconstruct(d, row.id)
  // Backfill (mark absent) wipes the dual-written rows and rebuilds from JSON.
  backfillJournal(d)
  let after = reconstruct(d, row.id)
  // Same derivation → identical rows, and both equal the authoritative batch.
  assertEquals(after, before)
  assertEquals(
    after,
    (JSON.parse(row.batch) as Change[]).map((c) => renamed(c)),
  )
})

Deno.test('backfill: an unparseable (corrupt) batch is skipped, not fatal', () => {
  let d = bareDb()
  let t = uid()
  // A corrupt legacy batch — a raw control character makes it invalid JSON, the
  // shape the live db carries on one historically-torn row. Written as raw bytes
  // straight into the column, bypassing JSON.stringify.
  let corrupt = d.prepare(
    'insert into journal (ts, actor, via, batch, trace) values (?, ?, ?, ?, ?)',
  ).run(
    '2026-01-01T00:00:00.000Z',
    null,
    null,
    '[{"body":"a' + String.fromCharCode(1) + 'b"}]',
    null,
  )
  let bad = Number(corrupt.lastInsertRowid)
  let good = legacy(d, [{
    eid: t,
    name: 'doc',
    comp: { title: 'ok', body: '' },
  }])
  // The migration survives the corrupt row: it is skipped, the good row lands.
  let { wrote, skipped } = backfillJournal(d)
  assertEquals(wrote, 1)
  assertEquals(skipped, 1)
  // The corrupt rowid has no journal_tx — an honest gap, not a partial row.
  assertEquals(
    n(d, `select count(*) as n from journal_tx where id = ${bad}`),
    0,
  )
  assertEquals(
    n(d, `select count(*) as n from journal_tx where id = ${good}`),
    1,
  )
})
