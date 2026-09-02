// The journal (D-18860/D-18861), written in apply()'s transaction. These
// pure-seam tests hold the record faithful: the rows reconstruct the batch
// apply() logged exactly, preserve total and within-batch order, tombstone a
// removed component's then-present fields, and mirror an entity-deletion
// cascade. Raw SQL reads the log tables the way db_test.ts does.
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

// What apply() journals: its returned batch minus the server-stamped provenance
// echoes (created/updated repeat the ts + actor the journal_tx row keeps).
let logged = (out: Change[]): Change[] =>
  out.filter((c) => c.name != 'created' && c.name != 'updated')

// Reconstruct the newest transaction's batch from the journal rows: each
// journal_change in applied order, its comp rebuilt from the present after-image
// rows (a remove is comp:null). If this equals what apply() logged, the record
// is faithful.
let normalizedBatch = (d: DB): Change[] => {
  let tx = (d.prepare('select max(id) as id from journal_tx').get() as {
    id: number
  }).id
  let changes = d.prepare(
    `select jc.id as id, e.eid as eid, jc.component as component,
            jc.operation as operation
     from journal_change jc join entity e on e.id = jc.entity
     where jc.tx = ? order by jc.ordinal`,
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

Deno.test('journal: rows reconstruct the applied batch exactly, in order', () => {
  let d = fresh()
  let t = uid()
  let out = apply(d, [
    { eid: t, name: 'doc', comp: { title: 'a', body: '' } },
    { eid: t, name: 'task', comp: { priority: 'P2' } },
  ])
  // The record is byte-for-byte the applied batch — same changes, same order
  // (doc before task before the synthesized entity birth).
  assertEquals(normalizedBatch(d), logged(out))
})

Deno.test('journal: one journal_tx per apply carries the provenance', () => {
  let d = fresh()
  apply(d, [{ eid: uid(), name: 'doc', comp: { title: 'a', body: '' } }])
  apply(d, [{ eid: uid(), name: 'doc', comp: { title: 'b', body: '' } }])
  let txs = d.prepare('select id, ts, actor from journal_tx order by id')
    .all() as { id: number; ts: string; actor: string | null }[]
  assertEquals(txs.length, 2)
  // ts is an ISO stamp — the provenance envelope delta re-derives from.
  assertEquals(txs.every((x) => x.ts.endsWith('Z')), true)
})

Deno.test('journal: within-batch ordinals reproduce applied order', () => {
  let d = fresh()
  let t = uid()
  let batch = logged(apply(d, [
    { eid: t, name: 'doc', comp: { title: 'a', body: '' } },
    { eid: t, name: 'task', comp: { priority: 'P2' } },
  ]))
  let tx = (d.prepare('select max(id) as id from journal_tx').get() as {
    id: number
  }).id
  let rows = d.prepare(
    'select ordinal, component from journal_change where tx = ? order by ordinal',
  ).all(tx) as { ordinal: number; component: string }[]
  // (tx, ordinal) is a dense 0..n-1 sequence matching the batch positions.
  assertEquals(rows.map((r) => r.ordinal), batch.map((_, i) => i))
  assertEquals(rows.map((r) => r.component), batch.map((c) => c.name))
})

Deno.test('journal: a present null field is distinct from a tombstone', () => {
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

Deno.test('journal: an empty component is an upsert with no field rows', () => {
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

Deno.test('journal: removing a component tombstones its then-present fields', () => {
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

Deno.test('journal: create-then-remove in one batch tombstones the fields', () => {
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

Deno.test('journal: entity deletion cascades to a remove per casualty', () => {
  let d = fresh()
  let p = uid()
  let c = uid()
  apply(d, [
    { eid: p, name: 'doc', comp: { title: 'p', body: '' } },
    { eid: c, name: 'comment', comp: { target: p } },
    { eid: c, name: 'doc', comp: { title: '', body: 'about p' } },
  ])
  // Deleting p cascades to the comment aimed at it: both become entity removes.
  let out = apply(d, [{ eid: p, name: 'entity', comp: null }])
  let tx = (d.prepare('select max(id) as id from journal_tx').get() as {
    id: number
  }).id
  let removed = d.prepare(
    `select e.eid as eid from journal_change jc join entity e on e.id = jc.entity
     where jc.tx = ? and jc.component = 'entity' and jc.operation = 'remove'`,
  ).all(tx) as { eid: string }[]
  let eids = new Set(removed.map((r) => r.eid))
  assertEquals(eids.has(p), true)
  assertEquals(eids.has(c), true)
  // And the batch reconstructs what apply() logged, casualties included.
  assertEquals(normalizedBatch(d), logged(out))
})
