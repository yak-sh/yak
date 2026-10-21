// Versions: a store with history keeps every version of every component row
// (D-130964). The live tables stay exactly the tables a store without history
// has. Beside each one, `<comp>$versions` holds its versions, each the span of
// transactions it was true for, `[$from, $to)`: the open one, `$to = 0`, is a
// copy of the live row, and a write closes it and opens the next. Current
// reads, their plans and every trigger on a live table (text and vector
// indexes, archetypes, numbering) are untouched; a write pays for its versions,
// and a read as of a transaction or on a branch reads them alone.
//
// A transaction id is an integer local to the store, in commit order. The
// store does not mint it: the history plugin hands the store a statement that
// takes one (`History.clock`, @yaks/journal's row of `journal_tx`), and the
// first versioned write of a unit runs it, so a unit that writes only exempt
// components takes none. A version kept from before the store kept history has
// no `$from`, and stands for every transaction before its `$to`.
//
// A component its vocabulary declares `journal: false` keeps no versions on
// main. `tombstone` keeps them always: presence and death are what an as-of
// read is about first.
//
// A branch lives entirely beside: its rows are `<comp>$versions` rows of that
// branch, for every component table, exempt ones included, since a branch's
// writes must never reach main. The first write to an entity's component on a
// branch copies what the branch sees of it, then changes the copy. A removal on
// a branch closes its row, which goes on hiding main's.
//
// Reading the past is a connection of its own (./mode.ts): its temporary views
// stand in front of each table, so every statement this package builds reads
// the mode's rows without knowing it. Each view is one select over one table,
// which SQLite folds into any read, a join's right side included; a compound
// one it would materialize whole wherever a read left-joins it.

import {
  among,
  and,
  col,
  type CreateIndex,
  type CreateTable,
  type Driver,
  eq,
  exists,
  type Expr,
  field,
  type History,
  isNull,
  lit,
  type Mode,
  ne,
  not,
  op,
  or,
  type Query,
  select,
  type Source,
  type Stmt,
  sub,
  table,
  unionAll,
  val,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { TOMBSTONE } from '@yaks/graph/bundle'
import { tables } from './layout.ts'
import { indexed } from './ddl.ts'

export type { History } from '@yaks/sql'

export type { Mode } from '@yaks/sql'

/** The store-reserved columns. `$` names are the store's, as `$entity` is, so
 * no property can take them. */
export let FROM = '$from', TO = '$to', BRANCH = '$branch'

/** What the table beside a component's is named after it. */
export let BESIDE = '$versions'

/** The table of every version of `comp`. */
export let beside = (comp: string): string => `${comp}${BESIDE}`

/** The table of branches. */
export let BRANCHES = '$branch'

/** Whether main keeps a component's versions: every component table but those
 * declared `journal: false`. */
export let keeps = (vocab: Vocab, comp: string): boolean =>
  comp == TOMBSTONE || vocab.comp(comp)?.journal !== false

// What a component stores, in the order its table carries it: the tombstone's
// is the spine's (./ddl.ts SPINE), every other one its vocabulary's.
export let stored = (vocab: Vocab, comp: string): string[] =>
  comp == TOMBSTONE
    ? ['deleted_at']
    : vocab.props(comp).map((p) => vocab.prop(comp, p)!)
      .filter((c) => !c.computed).map((c) => field(c.prop))

let affinity = (vocab: Vocab, comp: string, name: string): string | undefined =>
  comp == TOMBSTONE
    ? 'text'
    : vocab.props(comp).map((p) => vocab.prop(comp, p)!)
      .find((c) => field(c.prop) == name)?.affinity || undefined

// Every table a write may name that history covers: each component's, and the
// tombstones, which a vocabulary need not declare.
let held = new WeakMap<Vocab, Set<string>>()
export let covered = (vocab: Vocab): Set<string> => {
  let found = held.get(vocab)
  if (!found) {
    held.set(vocab, found = new Set([...tables(vocab), TOMBSTONE]))
    found.delete('entity')
  }
  return found
}

/** A column's declared type as its live table holds it, where it stands. */
export type Typed = (comp: string, column: string) => string | undefined

/**
 * The tables beside each component table: copies of its columns, typed as the
 * live table declares them (`typed`, else the vocabulary), so a version holds
 * a value exactly as its live row did, and the three store-reserved ones.
 * Keyed `(entity, $branch, $to)`, `$to` indexed over closed rows for the
 * retention floor, and each of the live table's vocabulary indexes kept over
 * its versions too, none of them unique, so a read of the past seeks as a read
 * of the present does.
 */
export let besideDdl = (
  vocab: Vocab,
  typed: Typed = () => undefined,
): Stmt[] => {
  let indexes = indexed(vocab)
  return [...covered(vocab)].flatMap((comp): Stmt[] => {
    let name = beside(comp)
    let made: CreateTable = {
      t: 'create table',
      name,
      ifNot: true,
      cols: [
        {
          name: 'entity',
          type: 'integer',
          notNull: true,
          ref: { table: 'entity', cols: ['id'] },
        },
        ...stored(vocab, comp).map((c) => ({
          name: c,
          type: typed(comp, c) ?? affinity(vocab, comp, c),
        })),
        { name: BRANCH, type: 'integer', notNull: true, default: lit(0) },
        { name: FROM, type: 'integer' },
        { name: TO, type: 'integer', notNull: true, default: lit(0) },
      ],
    }
    let key: CreateIndex = {
      t: 'create index',
      name: `${name}.key`,
      on: name,
      cols: [col('entity'), col(BRANCH), col(TO)],
      unique: true,
      ifNot: true,
    }
    let closed: CreateIndex = {
      t: 'create index',
      name: `${name}.to`,
      on: name,
      cols: [col(TO)],
      ifNot: true,
      where: ne(col(TO), lit(0)),
    }
    let mirrored = indexes.filter((i) => i.on == comp).map((
      i,
    ): CreateIndex => ({
      ...i,
      name: `${i.name}${BESIDE}`,
      on: name,
      unique: false,
    }))
    return [made, key, closed, ...mirrored]
  })
}

/** Everything a store with history needs beside its own schema: the tables of
 * versions, typed as `typed` says the live ones stand, and the branch table.
 * The live tables are not restated: history changes none of them. */
export let historySchema = (vocab: Vocab, typed?: Typed): Stmt[] => [
  ...besideDdl(vocab, typed),
  BRANCH_DDL,
]

/** The versions of what main holds as history begins: each live row of every
 * component that keeps versions, whose table of versions `made` says was just
 * made, as its open version from no transaction. */
export let seeds = (vocab: Vocab, made: (table: string) => boolean): Stmt[] =>
  [...covered(vocab)]
    .filter((comp) => keeps(vocab, comp) && made(beside(comp)))
    .map((comp) => {
      let cols = stored(vocab, comp)
      return {
        t: 'insert',
        into: beside(comp),
        cols: ['entity', ...cols, BRANCH, FROM, TO],
        q: select({
          cols: [
            col('entity'),
            ...cols.map((c) => col(c)),
            lit(0),
            lit(null),
            lit(0),
          ],
          from: table(comp),
        }),
      }
    })

/** The branch table: a branch's parent (0 is main), the transaction it forked
 * at, and when. Making one writes a row and copies nothing. */
export let BRANCH_DDL: CreateTable = {
  t: 'create table',
  name: BRANCHES,
  ifNot: true,
  cols: [
    { name: 'id', type: 'integer', pk: true },
    { name: 'parent', type: 'integer', notNull: true, default: lit(0) },
    { name: 'fork', type: 'integer', notNull: true },
    { name: 'at', type: 'text', notNull: true },
  ],
}

// ---- the unit's transaction ----

// A unit's transaction id, taken by its first versioned write. Units nest (a
// graph applied inside a caller's transaction), and each takes its own.
type Unit = { id?: number }
type Keeping = {
  vocab: Vocab
  history: History
  mode?: Mode
  units: Unit[]
}
let keeping = new WeakMap<Driver, Keeping>()

/** Bind a driver's writes to history: what `storage()` does for a store
 * opened with one. */
export let keep = (
  driver: Driver,
  vocab: Vocab,
  history: History,
  mode?: Mode,
): void => void keeping.set(driver, { vocab, history, mode, units: [] })

/** Run `body` as one unit of history on this driver: its versioned writes
 * name one transaction, taken when the first of them asks. */
export let within = <R>(
  driver: Driver,
  body: (clock: () => number) => R,
): R => {
  let k = keeping.get(driver)
  if (!k) return body(() => NaN)
  let unit: Unit = {}
  k.units.push(unit)
  let clock = () => unit.id ??= taken(driver, k)
  try {
    return body(clock)
  } finally {
    k.units.splice(k.units.lastIndexOf(unit), 1)
  }
}

let taken = (driver: Driver, k: Keeping): number => {
  if (k.mode && 'at' in k.mode) {
    throw new Error(`a read as of transaction ${k.mode.at} cannot write`)
  }
  let [row] = driver.query(k.history.clock)
  let id = Number(row?.id)
  if (!Number.isInteger(id)) {
    throw new Error('the history clock answered no transaction id')
  }
  return id
}

/** The id this driver's innermost unit's versions name, where it has taken
 * one: what the history plugin writes its transaction row as. */
export let ticked = (driver: Driver): number | undefined =>
  keeping.get(driver)?.units.at(-1)?.id

// ---- versioned writes ----

type W = Extract<Stmt, { t: 'insert' | 'update' | 'delete' }>
type Insert = Extract<W, { t: 'insert' }>

/** One write as the statements that run it on a driver with history: those
 * that keep its versions before it, itself, whose count a caller reads, and,
 * where it has any, those after it, made from the owners of the rows it wrote
 * (the write's own `returning`). */
export type Kept = {
  before: W[]
  write: W
  after?: (owners: number[]) => W[]
}

// The live table a write names.
let target = (w: W): string =>
  w.t == 'insert' ? w.into : w.t == 'update' ? w.table : w.from

/**
 * One write, kept: on main, the write itself, with the versions of the rows it
 * changes closed and opened beside it; on a branch, a write to the branch's
 * rows instead (`branched`). A write to a table history does not cover, or on
 * main to an exempt component, is itself alone.
 */
export let kept = (driver: Driver, w: W): Kept => {
  let k = keeping.get(driver)
  let alone = { before: [], write: w }
  if (!k) return alone
  let comp = target(w)
  let { vocab } = k
  if (!covered(vocab).has(comp)) return alone
  if (k.mode && 'at' in k.mode) {
    throw new Error(`a read as of transaction ${k.mode.at} cannot write`)
  }
  if (k.mode && 'branch' in k.mode) {
    return branched(vocab, comp, w, k.mode.branch, clockOf(driver, k))
  }
  if (!keeps(vocab, comp)) return alone
  let tx = clockOf(driver, k)
  let cols = stored(vocab, comp)
  if (w.t == 'insert') {
    return {
      before: [],
      write: w,
      after: (owners) => synced(comp, cols, owners.map((o) => val(o)), tx),
    }
  }
  let where = w.where ?? lit(true)
  if (w.t == 'delete') {
    return { before: closed(comp, owned(comp, where), tx), write: w }
  }
  if (w.from) throw new Error('a versioned update from another table')
  // Only the rows the update changes get a version.
  let set = Object.entries(w.set).filter(([c]) => cols.includes(c))
  let changes = and(where, or(...set.map(([c, e]) => op('is not', col(c), e))))
  return {
    before: [
      ...closed(comp, owned(comp, changes), tx),
      opened(comp, cols, changes, tx, Object.fromEntries(set)),
    ],
    write: w,
  }
}

let clockOf = (driver: Driver, k: Keeping): number => {
  let unit = k.units.at(-1)
  if (!unit) {
    throw new Error('a versioned write outside a unit of the store')
  }
  return unit.id ??= taken(driver, k)
}

// Main's open version.
let MAIN_OPEN = and(eq(col(BRANCH), lit(0)), eq(col(TO), lit(0)))

// The entities whose rows of `comp` match `where`.
let owned = (comp: string, where: Expr): Query =>
  select({ cols: [col('entity')], from: table(comp), where })

// An insert's query with more columns after its own.
let appended = (q: Query, es: Expr[]): Query => {
  if (q.t != 'select') throw new Error('a versioned insert from a compound')
  return { ...q, cols: [...q.cols ?? [], ...es] }
}

// The entities an insert names: its rows' owners, or its query's.
let entities = (w: Insert): Expr[] | Query => {
  let at = w.cols?.indexOf('entity') ?? -1
  if (at < 0) {
    throw new Error(`a versioned insert into ${w.into} names no owner`)
  }
  if (w.rows) return w.rows.map((r) => r[at])
  if (w.q?.t != 'select') throw new Error('a versioned insert from a compound')
  return { ...w.q, with: w.q.with ?? w.with, cols: [w.q.cols![at]] }
}

// Main's open versions of `owners`, ended at `tx`: one this same transaction
// opened goes, since nobody else ever saw it; any other is closed.
let closed = (comp: string, owners: Expr[] | Query, tx: number): W[] => {
  let to = beside(comp)
  let mine = and(MAIN_OPEN, among(col('entity'), owners))
  return [
    { t: 'delete', from: to, where: and(mine, eq(col(FROM), val(tx))) },
    { t: 'update', table: to, set: { [TO]: val(tx) }, where: mine },
  ]
}

// A version opened at `tx` for each live row `where` matches, holding what the
// row holds with `set` applied: an update's values, read before it runs.
let opened = (
  comp: string,
  cols: string[],
  where: Expr,
  tx: number,
  set: Record<string, Expr> = {},
): W => ({
  t: 'insert',
  into: beside(comp),
  cols: ['entity', ...cols, BRANCH, FROM, TO],
  q: select({
    cols: [
      col('entity'),
      ...cols.map((c) => set[c] ?? col(c)),
      lit(0),
      val(tx),
      lit(0),
    ],
    from: table(comp),
    where,
  }),
})

// After an insert, main's open versions of the `owners` it wrote made to match
// their live rows again: one that no longer does is ended, and a live row
// without one gets one. An upsert that changed nothing keeps none.
let synced = (
  comp: string,
  cols: string[],
  owners: Expr[],
  tx: number,
): W[] => {
  let to = beside(comp)
  let same = exists(select({
    cols: [lit(1)],
    from: table(comp, '__live'),
    where: and(
      eq(col('entity', '__live'), col('entity', to)),
      ...cols.map((c) => op('is', col(c, '__live'), col(c, to))),
    ),
  }))
  let stale = and(MAIN_OPEN, among(col('entity'), owners), not(same))
  let none = not(exists(select({
    cols: [lit(1)],
    from: table(to, '__open'),
    where: and(
      eq(col('entity', '__open'), col('entity', comp)),
      eq(col(BRANCH, '__open'), lit(0)),
      eq(col(TO, '__open'), lit(0)),
    ),
  })))
  return [
    { t: 'delete', from: to, where: and(stale, eq(col(FROM), val(tx))) },
    { t: 'update', table: to, set: { [TO]: val(tx) }, where: stale },
    opened(comp, cols, and(among(col('entity'), owners), none), tx),
  ]
}

// ---- writes on a branch ----

// The branch's open row of the entity a write's condition names.
let open = (branch: number) =>
  and(eq(col(BRANCH), val(branch)), eq(col(TO), lit(0)))

/**
 * A write on branch `b`, as a write to the branch's rows beside. Every read in
 * it names the live table, which on a branch's connection is the branch's view
 * of it (./mode.ts), so it sees the branch.
 *
 * Before any write, each entity's component as the branch sees it is copied
 * into an open row of the branch's own, where it has none: an insert then
 * lands on that row as it would on main's, an update changes it, and a removal
 * closes it, so it goes on hiding main's. A branch keeps no versions of its
 * own: its rows are what it holds now, and what it removed.
 */
let branched = (
  vocab: Vocab,
  comp: string,
  w: W,
  b: number,
  tx: number,
): Kept => {
  let cols = stored(vocab, comp)
  let to = beside(comp)
  let seed = (where: Expr): W => ({
    t: 'insert',
    or: 'ignore',
    into: to,
    cols: ['entity', ...cols, BRANCH, FROM, TO],
    q: select({
      cols: [
        col('entity'),
        ...cols.map((c) => col(c)),
        val(b),
        val(tx),
        lit(0),
      ],
      from: table(comp),
      where,
    }),
  })
  if (w.t == 'insert') {
    let e = entities(w)
    return {
      before: [seed(among(col('entity'), e))],
      write: {
        ...w,
        into: to,
        cols: [...w.cols!, BRANCH, FROM, TO],
        ...w.rows
          ? { rows: w.rows.map((r) => [...r, val(b), val(tx), lit(0)]) }
          : {},
        ...w.q ? { q: appended(w.q, [val(b), val(tx), lit(0)]) } : {},
        ...w.upsert
          ? {
            upsert: w.upsert.map((u) => ({
              ...u,
              on: [col('entity'), col(BRANCH), col(TO)],
            })),
          }
          : {},
      },
    }
  }
  let where = w.where ?? lit(true)
  let mine = and(where, open(b))
  if (w.t == 'update') {
    return {
      before: [seed(where)],
      write: {
        t: 'update',
        table: to,
        set: { ...w.set, [FROM]: val(tx) },
        where: mine,
        ...w.returning ? { returning: w.returning } : {},
      },
    }
  }
  // A row this transaction both opened and closed already has its closed
  // twin at `tx`; it goes. Any other open row is closed where it stands.
  let twin = exists(select({
    cols: [lit(1)],
    from: table(to, '__twin'),
    where: and(
      eq(col('entity', '__twin'), col('entity', to)),
      eq(col(BRANCH, '__twin'), val(b)),
      eq(col(TO, '__twin'), val(tx)),
    ),
  }))
  return {
    before: [seed(where), { t: 'delete', from: to, where: and(mine, twin) }],
    write: {
      t: 'update',
      table: to,
      set: { [TO]: val(tx) },
      where: mine,
      ...w.returning ? { returning: w.returning } : {},
    },
  }
}

// ---- what a mode reads ----

/** The temporary one-row table a mode's connection reads its mode from:
 * `at`, the transaction main is read as of (a branch's fork), and `branch`,
 * the branch whose rows lie over it, or null. Turning it is a write, so the
 * views stand and their statements stay prepared (./mode.ts `moded`). */
export let DIAL = '$mode'

/** Which views a mode's connection reads through: as of a transaction, or on
 * a branch. Turning the dial between them makes the views again. */
export type Kind = 'at' | 'branch'

/** The kind of views a mode reads through. */
export let kind = (mode: Mode): Kind => 'at' in mode ? 'at' : 'branch'

// A table in the file itself, past any temporary view of the same name.
let main = (name: string, as?: string): Source => ({
  t: 'table',
  name,
  schema: 'main',
  as,
})

let dial = (c: 'at' | 'branch'): Expr =>
  sub(select({ cols: [col(c)], from: table(DIAL) }))

// No row of the dial's branch for the entity a row of `of` belongs to.
let unshadowed = (comp: string, of: string): Expr =>
  not(exists(select({
    cols: [lit(1)],
    from: main(beside(comp), '__mine'),
    where: and(
      eq(col('entity', '__mine'), col('entity', of)),
      eq(col(BRANCH, '__mine'), dial('branch')),
    ),
  })))

/**
 * What a mode reads `comp` as. Where main keeps its versions, one select over
 * them: main's as of the dial's transaction and, on a branch, the branch's
 * open rows over main's for every entity the branch has not written. Where it
 * keeps none, as of a transaction, the live table as it stands; on a branch,
 * the branch's open rows and the live rows it has not written.
 */
export let seen = (vocab: Vocab, comp: string, k: Kind): Query => {
  let names = ['entity', ...stored(vocab, comp)]
  let v = '__v'
  let picked = (of?: string) => names.map((c) => col(c, of))
  if (keeps(vocab, comp)) {
    let then = and(
      eq(col(BRANCH, v), lit(0)),
      or(isNull(col(FROM, v)), op('<=', col(FROM, v), dial('at'))),
      or(eq(col(TO, v), lit(0)), op('>', col(TO, v), dial('at'))),
    )
    return select({
      cols: picked(v),
      from: main(beside(comp), v),
      where: k == 'at' ? then : or(
        and(eq(col(BRANCH, v), dial('branch')), eq(col(TO, v), lit(0))),
        and(then, unshadowed(comp, v)),
      ),
    })
  }
  if (k == 'at') return select({ cols: picked(), from: main(comp) })
  return unionAll(
    select({
      cols: picked(),
      from: main(beside(comp)),
      where: and(eq(col(BRANCH), dial('branch')), eq(col(TO), lit(0))),
    }),
    select({
      cols: picked('__live'),
      from: main(comp, '__live'),
      where: unshadowed(comp, '__live'),
    }),
  )
}
