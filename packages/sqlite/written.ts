// Which entity each write to a file named, in commit order, for the other
// connections to it (./memo.ts). A connection keeps the entities it read in
// memory, and another connection's commit says only that something moved, so
// memory let every entity go: on the box, where other processes commit twice
// a second, a native step read its whole window again each time (T-130884).
//
// Triggers on the spine, the graves and each component's table append the
// entity a row they insert, update or delete is of to `entity_written`, in
// the transaction that wrote the row, whoever wrote it, raw SQL included.
// Writers commit one at a time, so the rows past the newest a connection has
// read are what was written since, and nothing else. The log keeps about its
// newest {@link KEEP}; a connection that fell further behind, or a file whose
// tables lack their triggers, can't say what moved, and memory lets go of
// everything as before. A store in memory has one connection, which sees its
// own statements, and keeps no log.
import {
  as,
  catalogue,
  col,
  type CreateTrigger,
  type Driver,
  eq,
  fn,
  ge,
  le,
  left,
  lit,
  op,
  render,
  select,
  type Stmt,
  table,
  val,
  when,
} from '@yaks/sql/core'

/** The log's table. */
export const WRITTEN = 'entity_written'

/** How many of the newest rows the log keeps, give or take a prune. */
export const KEEP = 1 << 16
// Rows are pruned once per this many, all at once.
const PRUNE = 1 << 10

let events = ['insert', 'update', 'delete'] as const

// The trigger telling the log of each row `event` writes in `table`: the
// spine's row is the entity, any other table's names it by `entity`. A spine
// whose eid moved names none, since what memory holds under the old one
// can't be found from the new.
let told = (table: string, event: typeof events[number]): CreateTrigger => {
  let row = event == 'delete' ? 'old' : 'new'
  let entity = table != 'entity'
    ? col('entity', row)
    : event == 'update'
    ? when([[eq(col('eid', 'old'), col('eid', 'new')), col('id', 'new')]])
    : col('id', row)
  return {
    t: 'create trigger',
    name: `written_${table}_${event}`,
    ifNot: true,
    timing: 'after',
    event,
    on: table,
    body: [{ t: 'insert', into: WRITTEN, cols: ['entity'], rows: [[entity]] }],
  }
}

/** The log, and the triggers on the spine, the graves and each of `tables`
 * that write it. */
export let writtenDdl = (tables: string[]): Stmt[] => [
  {
    t: 'create table',
    name: WRITTEN,
    ifNot: true,
    cols: [
      { name: 'seq', type: 'integer', pk: true },
      // No key to the spine: a pruned entity's last writes outlive its row.
      { name: 'entity', type: 'integer' },
    ],
  },
  {
    t: 'create trigger',
    name: 'written_kept',
    ifNot: true,
    timing: 'after',
    event: 'insert',
    on: WRITTEN,
    when: eq(op('%', col('seq', 'new'), lit(PRUNE)), lit(0)),
    body: [{
      t: 'delete',
      from: WRITTEN,
      where: le(col('seq'), op('-', col('seq', 'new'), lit(KEEP))),
    }],
  },
  ...['entity', 'tombstone', ...tables].flatMap((name) =>
    events.map((event) => told(name, event))
  ),
]

// Per driver, while its schema stands: what each object was made by, and
// whether each table has its triggers.
let checked = new WeakMap<Driver, {
  at: readonly unknown[]
  named: Map<string, string | null>
  tables: Map<string, boolean>
}>()

/** Whether the log follows every write to the spine, the graves and each of
 * `tables` the file holds: each has its triggers as this package makes them.
 * Asked of the file once while its schema stands. */
export let follows = (driver: Driver, tables: Iterable<string>): boolean => {
  let objects = catalogue(driver)
  let held = checked.get(driver)
  if (held?.at !== objects) {
    held = {
      at: objects,
      named: new Map(objects.map((o) => [o.name, o.sql])),
      tables: new Map(),
    }
    checked.set(driver, held)
  }
  let { named } = held
  if (!named.has(WRITTEN)) return false
  for (let name of ['entity', 'tombstone', ...tables]) {
    let known = held.tables.get(name)
    if (known === undefined) {
      known = !named.has(name) || events.every((event) => {
        let [trigger, made] = making(name, event)
        return body(named.get(trigger) ?? '') == made
      })
      held.tables.set(name, known)
    }
    if (!known) return false
  }
  return true
}

// SQLite keeps a trigger's statement without its `if not exists`.
let body = (sql: string) => sql.replace(/^create trigger /i, '')

// Each trigger's name and statement, rendered once.
let made = new Map<string, [string, string]>()
let making = (table: string, event: typeof events[number]) => {
  let key = `${table} ${event}`
  let held = made.get(key)
  if (!held) {
    let s = told(table, event)
    made.set(key, held = [s.name, body(render({ ...s, ifNot: false }).sql)])
  }
  return held
}

/** The newest seq the log holds, 0 for none. */
export let newest = (driver: Driver): number =>
  Number(
    driver.query(select({
      cols: [as(fn('coalesce', fn('max', col('seq')), lit(0)), 'seq')],
      from: table(WRITTEN),
    }))[0].seq,
  )

/** The eids of the entities written after the seq `at`, and the newest seq
 * read; `undefined` where the log can't say: the rows after `at` were pruned
 * (or `at` is past what it holds), or one names no entity standing (one since
 * pruned, or an eid moved). */
export let since = (
  driver: Driver,
  at: number,
): { at: number; eids: Set<string> } | undefined => {
  let rows = driver.query(select({
    cols: [col('seq', 'w'), col('eid', 'e')],
    from: table(WRITTEN, 'w'),
    joins: [left(table('entity', 'e'), eq(col('id', 'e'), col('entity', 'w')))],
    where: ge(col('seq', 'w'), val(at)),
    order: [col('seq', 'w')],
  }))
  // The row at `at` is the newest read before, unless the log held none.
  let after = at ? rows.slice(1) : rows
  if (at ? Number(rows[0]?.seq) != at : Number(rows[0]?.seq ?? 1) != 1) {
    return undefined
  }
  let eids = new Set<string>()
  for (let r of after) {
    if (r.eid == null) return undefined
    eids.add(String(r.eid))
  }
  return { at: Number(rows.at(-1)?.seq ?? at), eids }
}
