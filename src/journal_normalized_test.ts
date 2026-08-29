// The normalized journal (D-18860/D-18861), dual-written beside the JSON
// `journal` in apply()'s transaction (T-18878). These pure-seam tests hold the
// parallel record faithful: the normalized rows reconstruct the authoritative
// JSON batch exactly (dual-write consistency), preserve total and within-batch
// order, tombstone a removed component's then-present fields, and mirror an
// entity-deletion cascade. Raw SQL reads the log tables the way db_test.ts does.
Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { bareDb } = await import('./testdb.ts')
let { assertEquals } = await import('@std/assert')
let { DatabaseSync } = await import('./sqlite.ts')
import { type Change } from './types.ts'

// Build the migrated snapshot once — setup, not the per-test 1ms work.
bareDb()

let fresh = () => bareDb()
let uid = () => crypto.randomUUID()
type DB = InstanceType<typeof DatabaseSync>

// The JSON journal's authoritative batch for the newest transaction.
let jsonBatch = (d: DB): Change[] =>
  JSON.parse(
    (d.prepare('select batch from journal order by rowid desc limit 1')
      .get() as { batch: string }).batch,
  )

// Reconstruct the newest transaction's batch from the normalized rows: each
// journal_change in applied order, its comp rebuilt from the present after-image
// rows (a remove is comp:null). If this equals jsonBatch, the two logs agree.
let normalizedBatch = (d: DB): Change[] => {
  let tx = (d.prepare('select max(id) as id from journal_tx').get() as {
    id: number
  }).id
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

// The field rows of the newest transaction's change at a given ordinal.
let fieldsAt = (d: DB, ordinal: number) => {
  let tx = (d.prepare('select max(id) as id from journal_tx').get() as {
    id: number
  }).id
  let change = (d.prepare(
    'select id from journal_change where tx = ? and ordinal = ?',
  ).get(tx, ordinal) as { id: number }).id
  return d.prepare(
    'select field, present, value from journal_field where change = ? order by ordinal',
  ).all(change) as { field: string; present: number; value: string | null }[]
}

Deno.test('normalized: rows reconstruct the JSON batch exactly, in order', () => {
  let d = fresh()
  let t = uid()
  apply(d, [
    { eid: t, name: 'doc', comp: { title: 'a', body: '' } },
    { eid: t, name: 'task', comp: { priority: 'P2' } },
  ])
  // The parallel record is byte-for-byte the authoritative batch — same
  // changes, same order (doc before task before the synthesized entity birth).
  assertEquals(normalizedBatch(d), jsonBatch(d))
})

Deno.test('normalized: one journal_tx per apply carries the provenance', () => {
  let d = fresh()
  apply(d, [{ eid: uid(), name: 'doc', comp: { title: 'a', body: '' } }])
  apply(d, [{ eid: uid(), name: 'doc', comp: { title: 'b', body: '' } }])
  let txs = d.prepare('select id, ts, actor from journal_tx order by id')
    .all() as { id: number; ts: string; actor: string | null }[]
  assertEquals(txs.length, 2)
  // ts is a real ISO stamp, mirroring the JSON journal's provenance envelope.
  assertEquals(txs.every((x) => x.ts.endsWith('Z')), true)
})

Deno.test('normalized: within-batch ordinals reproduce applied order', () => {
  let d = fresh()
  let t = uid()
  apply(d, [
    { eid: t, name: 'doc', comp: { title: 'a', body: '' } },
    { eid: t, name: 'task', comp: { priority: 'P2' } },
  ])
  let batch = jsonBatch(d)
  let tx = (d.prepare('select max(id) as id from journal_tx').get() as {
    id: number
  }).id
  let rows = d.prepare(
    'select ordinal, component from journal_change where tx = ? order by ordinal',
  ).all(tx) as { ordinal: number; component: string }[]
  // (tx, ordinal) is a dense 0..n-1 sequence matching the JSON batch positions.
  assertEquals(rows.map((r) => r.ordinal), batch.map((_, i) => i))
  assertEquals(rows.map((r) => r.component), batch.map((c) => c.name))
})

Deno.test('normalized: a present null field is distinct from a tombstone', () => {
  let d = fresh()
  let t = uid()
  apply(d, [{ eid: t, name: 'doc', comp: { title: 'a', body: '' } }])
  apply(d, [{ eid: t, name: 'task', comp: { priority: 'P2' } }])
  // Clear a nullable column: the after-image is a PRESENT null, not a tombstone.
  apply(d, [{ eid: t, name: 'task', comp: { assignee: null } }])
  let field = fieldsAt(d, 0).find((f) => f.field == 'assignee')!
  assertEquals(field.present, 1)
  assertEquals(field.value, 'null')
})

Deno.test('normalized: an empty component is an upsert with no field rows', () => {
  let d = fresh()
  let t = uid()
  // `design` is a zero-column marker component — its presence carries no fields.
  apply(d, [
    { eid: t, name: 'doc', comp: { title: 'd', body: '' } },
    { eid: t, name: 'design', comp: {} },
  ])
  let tx = (d.prepare('select max(id) as id from journal_tx').get() as {
    id: number
  }).id
  let design = d.prepare(
    `select id, operation from journal_change where tx = ? and component = 'design'`,
  ).get(tx) as { id: number; operation: string }
  // The empty presence survives as its journal_change alone.
  assertEquals(design.operation, 'upsert')
  assertEquals(
    (d.prepare('select count(*) as n from journal_field where change = ?')
      .get(design.id) as { n: number }).n,
    0,
  )
})

Deno.test('normalized: removing a component tombstones its then-present fields', () => {
  let d = fresh()
  let t = uid()
  apply(d, [
    { eid: t, name: 'doc', comp: { title: 'a', body: '' } },
    { eid: t, name: 'task', comp: { priority: 'P2' } },
  ])
  // Remove the whole task component.
  apply(d, [{ eid: t, name: 'task', comp: null }])
  let tx = (d.prepare('select max(id) as id from journal_tx').get() as {
    id: number
  }).id
  let change = d.prepare(
    `select id, operation from journal_change where tx = ? and component = 'task'`,
  ).get(tx) as { id: number; operation: string }
  assertEquals(change.operation, 'remove')
  let fields = d.prepare(
    'select field, present, value from journal_field where change = ? order by field',
  ).all(change.id) as { field: string; present: number; value: string | null }[]
  // Every field the task still held gets a present=0 tombstone with a null value.
  assertEquals(fields.every((f) => f.present == 0 && f.value == null), true)
  let names = new Set(fields.map((f) => f.field))
  assertEquals(names.has('priority'), true)
})

Deno.test('normalized: create-then-remove in one batch tombstones the fields', () => {
  let d = fresh()
  let t = uid()
  // The removal's predecessor lookup must see the upsert from earlier in THIS
  // same batch (uncommitted, same connection) — else it tombstones nothing.
  apply(d, [
    { eid: t, name: 'doc', comp: { title: 'a', body: '' } },
    { eid: t, name: 'task', comp: { priority: 'P2' } },
    { eid: t, name: 'task', comp: null },
  ])
  let tx = (d.prepare('select max(id) as id from journal_tx').get() as {
    id: number
  }).id
  let change = d.prepare(
    `select id from journal_change where tx = ? and component = 'task'
     and operation = 'remove'`,
  ).get(tx) as { id: number }
  let n = (d.prepare(
    'select count(*) as n from journal_field where change = ? and present = 0',
  ).get(change.id) as { n: number }).n
  assertEquals(n >= 1, true)
})

Deno.test('normalized: entity deletion cascades to a remove per casualty', () => {
  let d = fresh()
  let p = uid()
  let c = uid()
  apply(d, [
    { eid: p, name: 'doc', comp: { title: 'p', body: '' } },
    { eid: c, name: 'comment', comp: { target: p } },
    { eid: c, name: 'doc', comp: { title: '', body: 'about p' } },
  ])
  // Deleting p cascades to the comment aimed at it: both become entity removes.
  apply(d, [{ eid: p, name: 'entity', comp: null }])
  let tx = (d.prepare('select max(id) as id from journal_tx').get() as {
    id: number
  }).id
  let removed = d.prepare(
    `select eid from journal_change
     where tx = ? and component = 'entity' and operation = 'remove'`,
  ).all(tx) as { eid: string }[]
  let eids = new Set(removed.map((r) => r.eid))
  assertEquals(eids.has(p), true)
  assertEquals(eids.has(c), true)
  // And the normalized batch still reconstructs the authoritative JSON one.
  assertEquals(normalizedBatch(d), jsonBatch(d))
})
