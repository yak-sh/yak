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
// Reading the past is a driver of its own (./mode.ts): each statement it runs
// names, in front of each table it reads, a common table expression of the
// same name holding the mode's rows, so every statement this package builds
// reads the mode without knowing it. Each is one select over one table, which
// SQLite folds into any read, a join's right side included; a compound one it
// would materialize whole wherever a read left-joins it.

import {
  among,
  and,
  as,
  col,
  type CreateIndex,
  type CreateTable,
  type Driver,
  eq,
  exists,
  type Expr,
  field,
  fn,
  from,
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
  table,
  unionAll,
  val,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { TOMBSTONE } from '@yaks/graph/bundle'
import { tables } from './layout.ts'
import { indexed } from './ddl.ts'
import { branched } from './history-branch.ts'
import {
  BESIDE,
  beside,
  BRANCH,
  FROM,
  shaped,
  shapeDdl,
  SHAPES,
  shapeSeeds,
  TO,
} from './history-shapes.ts'
export { BESIDE, beside, BRANCH, FROM, TO } from './history-shapes.ts'

export type { History } from '@yaks/sql'

export type { Mode } from '@yaks/sql'

/** The table of branches. */
export let BRANCHES = '$branch'

/** Branches held in trash, with every version still in place. */
export let BRANCH_TRASH = '$branch$trash'

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
 * retention floor, `$branch` over the branches' rows, and each of the live table's vocabulary indexes kept over
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
    // A branch's rows are few beside main's: what reads or drops one finds
    // them here rather than in every version main keeps.
    let few: CreateIndex = {
      t: 'create index',
      name: `${name}.branch`,
      on: name,
      cols: [col(BRANCH), col('entity')],
      ifNot: true,
      where: ne(col(BRANCH), lit(0)),
    }
    let mirrored = indexes.filter((i) => i.on == comp).map((
      i,
    ): CreateIndex => ({
      ...i,
      name: `${i.name}${BESIDE}`,
      on: name,
      unique: false,
    }))
    return [made, key, closed, few, ...mirrored]
  })
}

/** Everything a store with history needs beside its own schema: the tables of
 * versions, typed as `typed` says the live ones stand, and the branch table.
 * The live tables are not restated: history changes none of them. */
export let historySchema = (vocab: Vocab, typed?: Typed): Stmt[] => [
  ...besideDdl(vocab, typed),
  ...shapeDdl,
  BRANCH_DDL,
  {
    t: 'create table',
    name: BRANCH_TRASH,
    ifNot: true,
    cols: [
      { name: 'id', type: 'integer', pk: true },
      { name: 'at', type: 'text', notNull: true },
    ],
  },
]

/** The versions of what main holds as history begins: each live row of every
 * component that keeps versions, whose table of versions `made` says was just
 * made, as its open version from no transaction. */
export let seeds = (vocab: Vocab, made: (table: string) => boolean): Stmt[] => [
  ...[...covered(vocab)]
    .filter((comp) => keeps(vocab, comp) && made(beside(comp)))
    .map((comp): Stmt => {
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
    }),
  ...shapeSeeds([...covered(vocab)], made),
]

/** The key of what a store whose history began paced (`Opts.paced`) still
 * owes, in `server_meta`: the components whose live rows are not yet their
 * first versions, oldest first, and the last entity taken of the first. */
export let SEEDING = 'history:seeding'

/** What a paced beginning owes ({@link SEEDING}). */
export type Seeding = { comps: string[]; after: number }

/** The components of `seeds` whose first versions are owed a page at a
 * time: each that keeps versions, whose table of versions `made` says was
 * just made. */
export let unseeded = (
  vocab: Vocab,
  made: (table: string) => boolean,
): string[] =>
  [...covered(vocab)].filter((comp) => keeps(vocab, comp) && made(beside(comp)))

/** The memberships a store repairs at once where its table of them was
 * made beside tables of versions that stood: what {@link seeds} copies of
 * them, less the components a paced beginning seeds itself. */
export let reshapes = (
  vocab: Vocab,
  made: (table: string) => boolean,
): Stmt[] =>
  shapeSeeds(
    [...covered(vocab)].filter((comp) => !made(beside(comp))),
    made,
  )

/**
 * One page of a paced beginning's first versions: the live rows of `comp`
 * past entity `after`, up to `limit`, each as its open version from no
 * transaction, with its membership, where main has neither yet. History is
 * kept from the beginning on, so a row a write changed or removed before its
 * page was taken keeps only what that write made: its past begins there.
 * Answers how many rows it took, and the last entity, or null where it took
 * the last of them.
 */
export let seedPage = (
  driver: Driver,
  vocab: Vocab,
  comp: string,
  after: number,
  limit: number,
): { taken: number; last: number | null } => {
  let [last] = driver.query(select({
    cols: [
      as(fn('max', col('entity')), 'last'),
      as(fn('count', lit(1)), 'n'),
    ],
    from: from(
      select({
        cols: [col('entity')],
        from: table(comp),
        where: op('>', col('entity'), val(after)),
        order: [col('entity')],
        limit: lit(limit),
      }),
      'page',
    ),
  }))
  if (last?.last == null) return { taken: 0, last: null }
  let upto = Number(last.last), taken = Number(last.n)
  let page = and(
    op('>', col('entity', 'live'), val(after)),
    op('<=', col('entity', 'live'), val(upto)),
  )
  let none = (name: string, also: Expr[] = []) =>
    not(exists(select({
      cols: [lit(1)],
      from: table(name, 'held'),
      where: and(
        eq(col('entity', 'held'), col('entity', 'live')),
        eq(col(BRANCH, 'held'), lit(0)),
        ...also,
      ),
    })))
  let cols = stored(vocab, comp)
  driver.query({
    t: 'insert',
    into: beside(comp),
    cols: ['entity', ...cols, BRANCH, FROM, TO],
    q: select({
      cols: [
        col('entity', 'live'),
        ...cols.map((c) => col(c, 'live')),
        lit(0),
        lit(null),
        lit(0),
      ],
      from: table(comp, 'live'),
      where: and(page, none(beside(comp))),
    }),
  })
  driver.query({
    t: 'insert',
    into: SHAPES,
    cols: ['entity', 'component', BRANCH, FROM, TO],
    q: select({
      cols: [col('entity', 'live'), lit(comp), lit(0), lit(null), lit(0)],
      from: table(comp, 'live'),
      where: and(
        page,
        none(SHAPES, [eq(col('component', 'held'), lit(comp))]),
      ),
    }),
  })
  return { taken, last: taken == limit ? upto : null }
}

/** The branch table: a branch's parent (0 is main), the transaction it forked
 * at, and when. Making one writes a row and copies nothing. A dropped
 * branch's id is never given again, so an id names one branch for good. */
export let BRANCH_DDL: CreateTable = {
  t: 'create table',
  name: BRANCHES,
  ifNot: true,
  cols: [
    { name: 'id', type: 'integer', pk: true, autoincrement: true },
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
let keep1 = (driver: Driver, w: W): Kept => {
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

export let kept = (driver: Driver, w: W): Kept => {
  let result = keep1(driver, w)
  let k = keeping.get(driver)
  let comp = target(w)
  if (!k || !covered(k.vocab).has(comp) || !k.mode && !keeps(k.vocab, comp)) {
    return result
  }
  let tx = clockOf(driver, k)
  let branch = k.mode && 'branch' in k.mode ? k.mode.branch : 0
  return {
    ...result,
    after: (
      owners,
    ) => [
      ...result.after?.(owners) ?? [],
      ...shaped(comp, owners, branch, tx, w.t != 'delete'),
    ],
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

// ---- what a mode reads ----

/** Which way a mode reads: as of a transaction, or on a branch. */
export type Kind = 'at' | 'branch'

/** The way a mode reads. */
export let kind = (mode: Mode): Kind => 'at' in mode ? 'at' : 'branch'

// A table in the file itself, past any relation of the same name the
// statement reading it stands in front of it (./mode.ts).
let main = (name: string, as?: string): Source => ({
  t: 'table',
  name,
  schema: 'main',
  as,
})

// The transaction main is read as of, a branch's fork, and the branch, or 0
// for none: integers written into the text, so a mode binds no value of its
// own beside the statement's (a Durable Object binds at most 100).
let atOf = (mode: Mode): Expr => lit('at' in mode ? mode.at : mode.fork)
let branchOf = (mode: Mode): Expr => lit('branch' in mode ? mode.branch : 0)

// No row of the mode's branch for the entity a row of `of` belongs to.
let unshadowed = (comp: string, of: string, mode: Mode): Expr =>
  not(exists(select({
    cols: [lit(1)],
    from: main(beside(comp), '__mine'),
    where: and(
      eq(col('entity', '__mine'), col('entity', of)),
      eq(col(BRANCH, '__mine'), branchOf(mode)),
    ),
  })))

/**
 * What `mode` reads `comp` as. Where main keeps its versions, one select over
 * them: main's as of the mode's transaction and, on a branch, the branch's
 * open rows over main's for every entity the branch has not written. Where it
 * keeps none, as of a transaction, the live table as it stands; on a branch,
 * the branch's open rows and the live rows it has not written.
 */
export let seen = (vocab: Vocab, comp: string, mode: Mode): Query => {
  let names = ['entity', ...stored(vocab, comp)]
  let v = '__v'
  let picked = (of?: string) => names.map((c) => col(c, of))
  let at = atOf(mode), b = branchOf(mode)
  let past = kind(mode) == 'at'
  if (keeps(vocab, comp)) {
    let then = and(
      eq(col(BRANCH, v), lit(0)),
      or(isNull(col(FROM, v)), op('<=', col(FROM, v), at)),
      or(eq(col(TO, v), lit(0)), op('>', col(TO, v), at)),
    )
    return select({
      cols: picked(v),
      from: main(beside(comp), v),
      where: past ? then : or(
        and(eq(col(BRANCH, v), b), eq(col(TO, v), lit(0))),
        and(then, unshadowed(comp, v, mode)),
      ),
    })
  }
  if (past) return select({ cols: picked(), from: main(comp) })
  return unionAll(
    select({
      cols: picked(),
      from: main(beside(comp)),
      where: and(eq(col(BRANCH), b), eq(col(TO), lit(0))),
    }),
    select({
      cols: picked('__live'),
      from: main(comp, '__live'),
      where: unshadowed(comp, '__live', mode),
    }),
  )
}
