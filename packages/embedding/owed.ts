// What is owed a look: the queue of entities whose text may have moved since
// their vector was made, filled by triggers and drained by the sweep.
//
// A corpus of transcripts is too big to reconcile whole on every pass — reading
// and hashing every text to find the few that changed costs minutes, where the
// changes themselves are a handful of rows. So the database says what moved.
// A trigger on each embedded component notes the entity a write touched, in
// the same statement as the write, whichever process made it: this server, a
// CLI, a restore. The sweep reads the queue newest first, looks at those
// entities only, and settles each one.
//
// A queued entity carries a count, bumped by every write that queues it
// again. The sweep settles an entity only while the count is the one it read,
// so a write that lands while a model is answering keeps its entity queued
// for the next pass instead of being settled by a pass that never saw it.
//
// The triggers are made from the fields, so they change when the fields do.
// {@link watch} makes the database's triggers match the fields, and when it
// changes anything — a new database, a new field, a vector table dropped and
// made again — it queues every entity there is, since a trigger that was not
// there cannot have noted what happened without it.

import {
  and,
  as,
  col,
  count,
  type CreateTrigger,
  desc,
  eq,
  exists,
  type Expr,
  from,
  type Insert,
  lit,
  not,
  op,
  type Query,
  render,
  select,
  type Stmt,
  table,
  union,
  val,
} from '@yaks/sql'
import type { Driver } from './driver.ts'
import { type Field, wearers } from './fields.ts'
import { OWED, TABLE } from './ddl.ts'

// Queue the entities `q` selects, or bump the count of those already queued.
let queue = (rows: Pick<Insert, 'rows' | 'q'>): Insert => ({
  t: 'insert',
  into: OWED,
  cols: ['entity', 'n'],
  ...rows,
  upsert: [{ on: [col('entity')], set: { n: op('+', col('n'), lit(1)) } }],
})

let one = (e: Expr): Insert => queue({ rows: [[e, lit(1)]] })

// Whether `table` has a row for this entity.
let wears = (name: string, e: Expr): Expr =>
  exists(select({
    cols: [lit(1)],
    from: table(name),
    where: eq(col('entity', name), e),
  }))

let NEW = col('entity', 'new')
let OLD = col('entity', 'old')

let trigger = (
  name: string,
  event: CreateTrigger['event'],
  on: string,
  e: Expr,
  when?: Expr,
  of?: string[],
): CreateTrigger => ({
  t: 'create trigger',
  name: `${OWED}_${name}`,
  timing: 'after',
  event,
  of,
  on,
  when,
  body: [one(e)],
})

/**
 * The triggers that keep the queue: for each component a field lives on, its
 * rows arriving, changing and leaving; for text an entity is found by through
 * another component (`on`), that component arriving and leaving too, and the
 * text counting only while it does; an entity with a vector being deleted or
 * restored; and a vector deleted by anything but the sweep, which is owed
 * back.
 */
export let triggers = (fields: Field[]): CreateTrigger[] => {
  let groups = new Map<string, Field[]>()
  for (let f of fields) {
    let key = f.on ? `${f.comp}_${f.on}` : f.comp
    groups.set(key, [...groups.get(key) ?? [], f])
  }
  return [
    ...[...groups].flatMap(([key, [f, ...rest]]) => {
      let props = [f, ...rest].map((g) => g.prop)
      let scoped = (e: Expr) => f.on ? wears(f.on, e) : undefined
      return [
        trigger(`${key}_insert`, 'insert', f.comp, NEW, scoped(NEW)),
        trigger(`${key}_update`, 'update', f.comp, NEW, scoped(NEW), props),
        trigger(`${key}_delete`, 'delete', f.comp, OLD, scoped(OLD)),
        ...f.on
          ? [
            trigger(`${key}_join`, 'insert', f.on, NEW, wears(f.comp, NEW)),
            trigger(`${key}_leave`, 'delete', f.on, OLD),
          ]
          : [],
      ]
    }),
    ...fields.length
      ? [
        trigger(
          'tombstone_insert',
          'insert',
          'tombstone',
          NEW,
          wears(TABLE, NEW),
        ),
        trigger('tombstone_delete', 'delete', 'tombstone', OLD),
        trigger('vector_delete', 'delete', TABLE, OLD, not(wears(OWED, OLD))),
      ]
      : [],
  ]
}

// A trigger's definition from its name onward. SQLite keeps the statement it
// was given, so this is what two definitions compare by.
let body = (sql: string, name: string): string =>
  sql.slice(sql.indexOf(`"${name}"`)).trim()

let rows = (db: Driver, q: Query) => {
  let s = render(q)
  return db.query(s.sql, s.params)
}

let run = (db: Driver, stmt: Stmt): void => {
  let s = render(stmt)
  db.query(s.sql, s.params)
}

/**
 * Make the database's queue triggers the ones {@link triggers} says, and
 * queue everything when that changed anything. Returns whether it did. A
 * second call with the same fields reads the schema and writes nothing.
 */
export let watch = (db: Driver, fields: Field[]): boolean => {
  let want = new Map(triggers(fields).map((t) => [t.name, render(t).sql]))
  let have = rows(
    db,
    select({
      cols: [col('name'), col('sql')],
      from: table('sqlite_master'),
      where: and(
        eq(col('type'), val('trigger')),
        op('glob', col('name'), val(`${OWED}_*`)),
      ),
    }),
  )
  let moved = false
  for (let r of have) {
    let name = String(r.name)
    let now = want.get(name)
    if (now && body(String(r.sql), name) == body(now, name)) {
      want.delete(name)
      continue
    }
    run(db, { t: 'drop', kind: 'trigger', name, ifExists: true })
    moved = true
  }
  for (let sql of want.values()) db.exec(sql)
  if (moved || want.size) owe(db, fields)
  return moved || want.size > 0
}

/** Queue every entity that wears an embedded field or has a vector. */
export let owe = (db: Driver, fields: Field[]): void => {
  let worn = wearers(fields)
  let vectors = select({ cols: [col('entity')], from: table(TABLE) })
  run(
    db,
    queue({
      q: select({
        cols: [col('entity'), lit(1)],
        from: from(worn ? union(worn, vectors) : vectors, 'w'),
      }),
    }),
  )
}

/** One queued entity, and the count it was read at. */
export type Due = { owner: number; n: number }

/** The newest `limit` queued entities, newest first: what was just said is
 * what someone is about to look for. */
export let due = (db: Driver, limit: number): Due[] =>
  rows(
    db,
    select({
      cols: [as(col('entity'), 'owner'), col('n')],
      from: table(OWED),
      order: [desc(col('entity'))],
      limit: val(limit),
    }),
  ).map((r) => ({ owner: Number(r.owner), n: Number(r.n) }))

/** Settle a queued entity, unless a write queued it again since it was read. */
export let paid = (db: Driver, d: Due): void =>
  run(db, {
    t: 'delete',
    from: OWED,
    where: and(eq(col('entity'), val(d.owner)), eq(col('n'), val(d.n))),
  })

/** How many entities are queued. */
export let left = (db: Driver): number =>
  Number(rows(db, select({ cols: [as(count(), 'n')], from: table(OWED) }))[0].n)
