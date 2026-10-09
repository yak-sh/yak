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
// {@link watch} makes the database's triggers match the fields. A trigger that
// was missing or said something else cannot have noted what happened to its
// table, so the entities in that table are queued — a new field's component,
// one a field left — and nothing else: a component whose trigger stood saw
// every write. A new database, or a vector table dropped and made again,
// moves the triggers on the vectors and the tombstones, and queues everything.

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
  or,
  render,
  select,
  table,
  val,
} from '@yaks/sql'
import type { Statements } from '@yaks/sql'
import type { Bundle } from '@yaks/graph'
import { type Field, wearers } from './fields.ts'
import { OWED, TABLE } from './ddl.ts'

// Queue the entities `q` selects, or bump the count of those already queued.
let queue = (rows: Pick<Insert, 'rows' | 'q'>): Insert => ({
  t: 'insert',
  into: OWED,
  cols: ['owner', 'n'],
  ...rows,
  upsert: [{ on: [col('owner')], set: { n: op('+', col('n'), lit(1)) } }],
})

let one = (e: Expr): Insert => queue({ rows: [[e, lit(1)]] })

// Whether `table` has a row for this entity: a component table keys it by
// `entity`, a vector table (./ddl.ts) by `owner`.
let wears = (name: string, e: Expr): Expr =>
  exists(select({
    cols: [lit(1)],
    from: table(name),
    where: eq(col(name == TABLE || name == OWED ? 'owner' : 'entity', name), e),
  }))

let NEW = col('entity', 'new')
let OLD = col('entity', 'old')
let GONE = col('owner', 'old')

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
        trigger('vector_delete', 'delete', TABLE, GONE, not(wears(OWED, GONE))),
      ]
      : [],
  ]
}

let watching = new WeakMap<Field[], Set<string>>()

/**
 * Whether writing these bundles can have queued an entity: whether one names
 * a component a trigger watches ({@link triggers}), or deletes or restores
 * its entity. A host that drains the queue after a write asks the queue only
 * then.
 *
 * ```ts
 * import { queues } from '@yaks/embedding'
 *
 * let fields = [{ comp: 'doc', prop: 'body' }]
 * queues(fields, [{ entity: { eid: 'a' }, doc: { body: 'hi' } }]) // true
 * queues(fields, [{ entity: { eid: 'a' }, $delete: true }]) // true
 * queues(fields, [{ entity: { eid: 'a' }, place: { x: 1 } }]) // false
 * ```
 */
export let queues = (fields: Field[], bundles: Bundle[]): boolean => {
  let tables = watching.get(fields)
  if (!tables) {
    watching.set(fields, tables = new Set(triggers(fields).map((t) => t.on)))
  }
  return bundles.some((b) =>
    (tables.has('tombstone') && b.$delete === true) ||
    Object.keys(b).some((name) => tables.has(name))
  )
}

// A trigger's definition from its name onward. SQLite keeps the statement it
// was given, so this is what two definitions compare by.
let body = (sql: string, name: string): string =>
  sql.slice(sql.indexOf(`"${name}"`)).trim()

let watched = new WeakMap<Statements, { version: number; fields: string }>()

/** A queue trigger as the database holds it: its name, the table it is on,
 * and the statement it was made by. */
export type Standing = { name: string; on: string; sql: string }

/** What making the database's triggers the wanted ones takes. */
export type Moves = {
  /** the held triggers to drop: gone from the fields, or said otherwise */
  drop: string[]
  /** the wanted triggers to make */
  make: CreateTrigger[]
  /** whose wearers are owed a look: the tables a moved trigger is on, or
   * everyone (`true`) when one on the vectors or the tombstones moved */
  owed: Set<string> | true
}

// The triggers that are about every vector, not one component's rows.
let EVERY = new Set([TABLE, 'tombstone'])

/**
 * What {@link watch} does about the triggers a database holds, given the
 * ones the fields want. A trigger that stands as wanted owes nothing: it saw
 * every write to its table. One made, dropped or changed missed or misread
 * its table's writes, so the entities in that table are owed a look, and no
 * others.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { render } from '@yaks/sql'
 * let book = { comp: 'book', prop: 'title' }
 * let want = triggers([book])
 * let held = want.map((t) => ({ name: t.name, on: t.on, sql: render(t).sql }))
 * equal(moves(held, want).owed, new Set())
 * let more = triggers([book, { comp: 'review', prop: 'prose' }])
 * equal(moves(held, more).owed, new Set(['review']))
 * equal(moves([], want).owed, true)
 * ```
 */
export let moves = (have: Standing[], want: CreateTrigger[]): Moves => {
  let wanted = new Map(want.map((t) => [t.name, t]))
  let drop: string[] = []
  let owed: Set<string> | true = new Set()
  let touched = (on: string) => {
    if (owed === true) return
    if (EVERY.has(on)) owed = true
    else owed.add(on)
  }
  for (let r of have) {
    let now = wanted.get(r.name)
    if (now && body(r.sql, r.name) == body(render(now).sql, r.name)) {
      wanted.delete(r.name)
      continue
    }
    drop.push(r.name)
    touched(r.on)
  }
  for (let t of wanted.values()) touched(t.on)
  return { drop, make: [...wanted.values()], owed }
}

/**
 * Make the database's queue triggers the ones {@link triggers} says, and
 * queue the entities whose writes a missing or changed trigger may have
 * missed ({@link moves}). Returns whether it changed anything. A second call
 * with the same fields and schema reads and writes nothing.
 */
export let watch = (db: Statements, fields: Field[]): boolean => {
  let version = db.revision('schema')
  let definitions = triggers(fields)
  let key = JSON.stringify(definitions)
  let kept = watched.get(db)
  if (kept?.version == version && kept.fields == key) return false
  let have = db.query(
    select({
      cols: [col('name'), as(col('tbl_name'), 'on'), col('sql')],
      from: table('sqlite_master'),
      where: and(
        eq(col('type'), val('trigger')),
        op('glob', col('name'), val(`${OWED}_*`)),
      ),
    }),
  ).map((r) => ({ name: String(r.name), on: String(r.on), sql: String(r.sql) }))
  let { drop, make, owed } = moves(have, definitions)
  for (let name of drop) {
    db.query({ t: 'drop', kind: 'trigger', name, ifExists: true })
  }
  for (let t of make) db.query(t)
  if (owed === true) owe(db, fields)
  else if (owed.size) owe(db, fields, owed)
  watched.set(db, { version: db.revision('schema'), fields: key })
  return drop.length + make.length > 0
}

/** Queue every entity that wears an embedded field or has a vector — or,
 * given `tables`, only those with a row in one of them. */
export let owe = (
  db: Statements,
  fields: Field[],
  tables?: Set<string>,
): void => {
  let held = (e: Expr) =>
    or(
      ...[...tables ?? []].map((name) =>
        exists(select({
          cols: [lit(1)],
          from: table(name),
          where: eq(col('entity', name), e),
        }))
      ),
    )
  let vectors = select({
    cols: [col('owner')],
    from: table(TABLE),
    where: tables ? held(col('owner', TABLE)) : undefined,
  })
  let worn = tables
    ? fields.filter((f) => tables.has(f.comp) || !!f.on && tables.has(f.on))
    : fields
  for (let q of [...wearers(worn, db.arms), vectors]) {
    db.query(
      queue({
        q: select({ cols: [col('owner'), lit(1)], from: from(q, 'w') }),
      }),
    )
  }
}

/** One queued entity, and the count it was read at. */
export type Due = { owner: number; n: number }

/** The newest `limit` queued entities, newest first: what was just said is
 * what someone is about to look for. */
export let due = (db: Statements, limit: number): Due[] =>
  db.query(
    select({
      cols: [col('owner'), col('n')],
      from: table(OWED),
      order: [desc(col('owner'))],
      limit: val(limit),
    }),
  ).map((r) => ({ owner: Number(r.owner), n: Number(r.n) }))

/** Settle a queued entity, unless a write queued it again since it was read. */
export let paid = (db: Statements, d: Due): void =>
  void db.query({
    t: 'delete',
    from: OWED,
    where: and(eq(col('owner'), val(d.owner)), eq(col('n'), val(d.n))),
  })

/** How many entities are queued. */
export let left = (db: Statements): number =>
  Number(db.query(select({ cols: [as(count(), 'n')], from: table(OWED) }))[0].n)
