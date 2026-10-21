// Versions: a store with history never changes a component row in place
// without keeping the values it replaced (D-130964). The live table stays the
// table a store without history has, plus one column, `$from`, the transaction
// that wrote its row. Each version a write replaces goes, once and never edited
// again, to the table beside it, `<comp>$versions`, closed at the transaction
// that replaced it: `[$from, $to)`. Current reads, their plans and every
// trigger on a live table (text and vector indexes, archetypes, numbering) are
// untouched; only a read as of a transaction or on a branch pays for history.
//
// A transaction id is an integer local to the store, in commit order. The
// store does not mint it: the history plugin hands the store a statement that
// takes one (`History.clock`, @yaks/journal's row of `journal_tx`), and the
// first versioned write of a unit runs it, so a unit that writes only exempt
// components takes none.
//
// A component its vocabulary declares `journal: false` keeps no versions, and
// its live table no `$from`. `tombstone` keeps them always: presence and death
// are what an as-of read is about first.
//
// A branch lives entirely beside: its rows are `<comp>$versions` rows of that
// branch, open at `$to = 0`, for every component table, exempt ones included,
// since a branch's writes must never reach main. The first write to an
// entity's component on a branch copies main's version as of the fork, then
// changes the copy. A removal on a branch closes its row, which hides main's.
//
// Reading the past is a connection of its own (./mode.ts): its temporary views
// stand in front of each table, so every statement this package builds reads
// the mode's rows without knowing it.

import {
  and,
  col,
  type Column,
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
import { tableDdl } from './ddl.ts'

export type { History } from '@yaks/sql'

export type { Mode } from '@yaks/sql'

/** The store-reserved columns. `$` names are the store's, as `$entity` is, so
 * no property can take them. */
export let FROM = '$from', TO = '$to', BRANCH = '$branch'

/** What the table beside a component's is named after it. */
export let BESIDE = '$versions'

/** The table of every version of `comp` but main's open one. */
export let beside = (comp: string): string => `${comp}${BESIDE}`

/** The table of branches. */
export let BRANCHES = '$branch'

/** Whether a component's live rows carry `$from` and its replaced rows are
 * kept: every component table but those declared `journal: false`. */
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

/** The column a live table with versions gains. */
export let FROM_COLUMN: Column = { name: FROM, type: 'integer' }

/** The tables beside each component table, with their keys: unconstrained
 * copies of its columns, since a version holds what was true then, and the
 * three store-reserved ones. Keyed `(entity, $branch, $to)`; `$to` is indexed
 * over closed rows for the retention floor and reads of the past. */
export let besideDdl = (vocab: Vocab): Stmt[] =>
  [...covered(vocab)].flatMap((comp): Stmt[] => {
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
          type: affinity(vocab, comp, c),
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
    return [made, key, closed]
  })

/** Everything a store with history needs beside its own schema: `$from` on
 * each live table that keeps versions (stated as the table with it, which the
 * host's schema pass grows a standing table to, @yaks/sqlite `add`), the
 * tables beside every component table, and the branch table. */
export let historySchema = (vocab: Vocab): Stmt[] => [
  ...tables(vocab).filter((c) => c != TOMBSTONE && keeps(vocab, c))
    .map((c) => tableDdl(vocab, c, c, [FROM_COLUMN])),
  {
    t: 'create table',
    name: TOMBSTONE,
    ifNot: true,
    cols: [
      {
        name: 'entity',
        type: 'integer',
        pk: true,
        ref: { table: 'entity', cols: ['id'] },
      },
      { name: 'deleted_at', type: 'text', notNull: true },
      FROM_COLUMN,
    ],
  },
  ...besideDdl(vocab),
  BRANCH_DDL,
]

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

// The live table a write names, where it is one this driver versions.
let target = (w: W): string =>
  w.t == 'insert' ? w.into : w.t == 'update' ? w.table : w.from

/**
 * The statements one write becomes on a driver with history: itself where its
 * table keeps no versions, else the copy that closes what it replaces, then
 * the write stamped with its transaction. On a branch, the write goes to the
 * branch's rows instead (`branched`). The last statement is the write itself,
 * whose count a caller reads.
 */
export let kept = (driver: Driver, w: W): W[] => {
  let k = keeping.get(driver)
  if (!k) return [w]
  let comp = target(w)
  let { vocab } = k
  if (!covered(vocab).has(comp)) return [w]
  if (k.mode && 'at' in k.mode) {
    throw new Error(`a read as of transaction ${k.mode.at} cannot write`)
  }
  if (k.mode && 'branch' in k.mode) {
    return branched(vocab, comp, w, k.mode.branch, clockOf(driver, k))
  }
  if (!keeps(vocab, comp)) return [w]
  let tx = clockOf(driver, k)
  if (w.t == 'insert') return [stamped(w, tx)]
  let where = w.where ?? lit(true)
  let close = closing(vocab, comp, where, tx)
  return w.t == 'update'
    ? [close, { ...w, set: { ...w.set, [FROM]: val(tx) } }]
    : [close, w]
}

let clockOf = (driver: Driver, k: Keeping): number => {
  let unit = k.units.at(-1)
  if (!unit) {
    throw new Error('a versioned write outside a unit of the store')
  }
  return unit.id ??= taken(driver, k)
}

// An insert writing its transaction as `$from`, in its rows or its query, and
// in the update an upsert falls back to.
let stamped = (w: Extract<W, { t: 'insert' }>, tx: number): W => ({
  ...w,
  cols: [...w.cols ?? [], FROM],
  ...w.rows ? { rows: w.rows.map((r) => [...r, val(tx)]) } : {},
  ...w.q ? { q: withCol(w.q, val(tx)) } : {},
  ...w.upsert
    ? {
      upsert: w.upsert.map((u) =>
        u.set ? { ...u, set: { ...u.set, [FROM]: col(FROM, 'excluded') } } : u
      ),
    }
    : {},
})

let withCol = (q: Query, e: Expr): Query => {
  if (q.t != 'select') throw new Error('a versioned insert from a compound')
  return { ...q, cols: [...q.cols ?? [], e] }
}

// The live rows `where` names, copied beside as closed at `tx`: every one this
// same transaction did not write, since nobody else ever saw that one.
let closing = (
  vocab: Vocab,
  comp: string,
  where: Expr,
  tx: number,
): W => {
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
        col(FROM),
        val(tx),
      ],
      from: table(comp),
      where: and(where, op('is not', col(FROM), val(tx))),
    }),
  }
}

// ---- writes on a branch ----

// The branch's open row of the entity a write's condition names.
let open = (branch: number) =>
  and(eq(col(BRANCH), val(branch)), eq(col(TO), lit(0)))

/**
 * A write on branch `b`, as writes to the branch's rows beside. Every read in
 * it (an absent insert's `not exists`, the copy below) names the live table,
 * which on a branch's connection is the branch's view of it (./mode.ts), so
 * it sees the branch.
 *
 * Before an update or a removal, the entity's component as the branch sees it
 * is copied into a row of the branch's own, if the branch has none yet; an
 * update then closes the branch's row this transaction did not write, and
 * changes the open one; a removal closes it, so it goes on hiding main's.
 */
let branched = (
  vocab: Vocab,
  comp: string,
  w: W,
  b: number,
  tx: number,
): W[] => {
  let cols = stored(vocab, comp)
  let to = beside(comp)
  if (w.t == 'insert') {
    let i = stamped(w, tx) as Extract<W, { t: 'insert' }>
    return [{
      ...i,
      into: to,
      cols: [...i.cols!, BRANCH, TO],
      ...i.rows ? { rows: i.rows.map((r) => [...r, val(b), lit(0)]) } : {},
      ...i.q ? { q: withCol(withCol(i.q, val(b)), lit(0)) } : {},
      ...i.upsert
        ? {
          upsert: i.upsert.map((u) => ({
            ...u,
            on: [col('entity'), col(BRANCH), col(TO)],
          })),
        }
        : {},
    }]
  }
  let where = w.where ?? lit(true)
  // The entity's component as the branch sees it, made the branch's own.
  let seed: W = {
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
      where: and(
        where,
        not(exists(select({
          cols: [lit(1)],
          from: table(to, '__mine'),
          where: and(
            eq(col('entity', '__mine'), col('entity', comp)),
            eq(col(BRANCH, '__mine'), val(b)),
          ),
        }))),
      ),
    }),
  }
  let mine = and(where, open(b))
  if (w.t == 'update') {
    let close: W = {
      t: 'insert',
      into: to,
      cols: ['entity', ...cols, BRANCH, FROM, TO],
      q: select({
        cols: [
          col('entity'),
          ...cols.map((c) => col(c)),
          val(b),
          col(FROM),
          val(tx),
        ],
        from: table(to),
        where: and(mine, op('is not', col(FROM), val(tx))),
      }),
    }
    return [seed, close, {
      t: 'update',
      table: to,
      set: { ...w.set, [FROM]: val(tx) },
      where: mine,
      ...w.returning ? { returning: w.returning } : {},
    }]
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
  return [seed, { t: 'delete', from: to, where: and(mine, twin) }, {
    t: 'update',
    table: to,
    set: { [TO]: val(tx) },
    where: mine,
    ...w.returning ? { returning: w.returning } : {},
  }]
}

// ---- what a mode reads ----

/** The temporary one-row table a mode's connection reads its mode from:
 * `at`, the transaction main is read as of (a branch's fork), and `branch`,
 * the branch whose rows lie over it, or null. Turning it is a write, so the
 * views stand and their statements stay prepared (./mode.ts `moded`). */
export let DIAL = '$mode'

// A table in the file itself, past any temporary view of the same name.
let main = (name: string, as?: string): Source => ({
  t: 'table',
  name,
  schema: 'main',
  as,
})

let dial = (c: 'at' | 'branch'): Expr =>
  sub(select({ cols: [col(c)], from: table(DIAL) }))

let visible = (): Expr => or(isNull(col(FROM)), op('<=', col(FROM), dial('at')))

// Main as it stood at the dial's transaction: the live rows written by then,
// and the closed ones open at it. A component that keeps no versions reads as
// it stands now.
let asOf = (vocab: Vocab, comp: string): Query => {
  let cols = [col('entity'), ...stored(vocab, comp).map((c) => col(c))]
  let live = main(comp)
  if (!keeps(vocab, comp)) return select({ cols, from: live })
  return unionAll(
    select({ cols, from: live, where: visible() }),
    select({
      cols,
      from: main(beside(comp)),
      where: and(
        eq(col(BRANCH), lit(0)),
        visible(),
        op('>', col(TO), dial('at')),
      ),
    }),
  )
}

/** What a mode reads `comp` as: the dial's branch's open rows over main as of
 * the dial's transaction, for every entity the branch has not written; with
 * no branch, main as of that transaction. */
export let seen = (vocab: Vocab, comp: string): Query => {
  let names = ['entity', ...stored(vocab, comp)]
  return unionAll(
    select({
      cols: names.map((c) => col(c)),
      from: main(beside(comp)),
      where: and(eq(col(BRANCH), dial('branch')), eq(col(TO), lit(0))),
    }),
    select({
      cols: names.map((c) => col(c, '__main')),
      from: { t: 'from', q: asOf(vocab, comp), as: '__main' },
      where: or(
        isNull(dial('branch')),
        not(exists(select({
          cols: [lit(1)],
          from: main(beside(comp), '__mine'),
          where: and(
            eq(col('entity', '__mine'), col('entity', '__main')),
            eq(col(BRANCH, '__mine'), dial('branch')),
          ),
        }))),
      ),
    }),
  )
}
