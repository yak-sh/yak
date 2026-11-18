// Reading the past, and writing to a branch (D-130964), through a driver of
// the mode's own. Each statement it runs is given, in front of each component
// table it names, a common table expression of that name: the rows its mode
// reads of that component (./history.ts `seen`). A name a statement's `with`
// gives is the name everywhere in that statement, its subqueries, joins and
// the fragments compiled as text included, so every statement this package
// builds, the compiler's and every other, reads the mode without knowing it.
//
// Nothing stands in the database for it: no view, no table, no temporary
// object, which a Durable Object refuses. So a mode reads over any connection,
// the one its main store writes through included, and a statement holds the
// mode it was written for whatever else runs beside it. A table named with
// its schema (`main.doc`) is the table itself.
//
// Binding the driver to another mode answers the same store, and its memory
// (./memo.ts) lets go of everything it held, as it does when the schema moves.
//
// A mode reads its table sets from history's archetype index, populated by
// the same writes that keep its component versions (./history-shapes.ts).
// Index hints name live indexes a common table expression does not have.
//
// A driver as of a transaction refuses every write. A branch's writes go to
// the branch's rows beside the live tables (./history.ts `branched`); the
// live tables are never a mode's to write.

import {
  type Cte,
  type Derived,
  type Driver,
  lit,
  render,
  select,
  star,
  type Stmt,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { pastShapes } from './history-shapes.ts'
import { docDdl, indexed } from './ddl.ts'
import { covered, type History, keep, type Mode, seen } from './history.ts'
import { turned } from './memo.ts'
import { type Opts, storage, type Store } from './mod.ts'

// What a mode reads each relation it stands in front of as, by name, in the
// order a statement's `with` gives them: each component's table, then
// `doc_value`, which reads `doc`. A view's body sees no `with` of the
// statement naming it, so the view is given as its own. The archetypes are
// the store's own, and a mode reads none of them: their table's columns, and
// no row.
let relations = (vocab: Vocab, derived: Derived, mode: Mode): Cte[] => [
  ...[...covered(vocab)].map((comp): Cte => ({
    name: comp,
    materialized: false,
    q: comp == 'archetype'
      ? select({
        cols: [star()],
        from: { t: 'table', name: comp, schema: 'main' },
        where: lit(false),
      })
      : seen(vocab, comp, mode),
  })),
  ...docDdl(vocab, derived).flatMap((s): Cte[] =>
    s.t == 'create view' ? [{ name: s.name, materialized: false, q: s.q }] : []
  ),
]

// The names a statement's text holds, quoted or bare. More than the tables it
// reads (a column, a word in a literal) costs only a relation it never reads.
let NAME = /"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*)/g
let named = (sql: string): Set<string> =>
  new Set(
    [...sql.matchAll(NAME)].map((m) => m[1]?.replaceAll('""', '"') ?? m[2]),
  )

type Dressable = Extract<
  Stmt,
  { t: 'select' | 'compound' | 'insert' | 'update' | 'delete' }
>
let dressable = (s: Stmt): s is Dressable =>
  s.t == 'select' || s.t == 'compound' || s.t == 'insert' ||
  s.t == 'update' || s.t == 'delete'
let written = (s: Stmt): string | undefined =>
  s.t == 'insert'
    ? s.into
    : s.t == 'update'
    ? s.table
    : s.t == 'delete'
    ? s.from
    : undefined

/**
 * `s` with the relations it names from `all` in front of the tables of those
 * names, and those they read (`doc_value` reads `doc`). A statement that names
 * none is itself. A statement that writes a live table a mode stands in front
 * of is a bug in its writer: a mode's writes are the branch's rows.
 */
let dressed = (s: Stmt, all: Cte[]): Stmt => {
  let into = written(s)
  if (into && all.some((r) => r.name == into)) {
    throw new Error(`a mode cannot write the live table ${into}`)
  }
  if (!dressable(s) && s.t != 'raw') return s
  let names = named(render(s).sql)
  if (names.has('doc_value')) names.add('doc')
  let own = new Set((dressable(s) ? s.with ?? [] : []).map((c) => c.name))
  let ctes = all.filter((r) => names.has(r.name) && !own.has(r.name))
  if (!ctes.length) return s
  if (!dressable(s)) {
    return select({ with: ctes, cols: [star()], from: { t: 'from', q: s } })
  }
  return { ...s, with: [...ctes, ...s.with ?? []] }
}

// A mode's driver: the mode it is bound to now, what it reads each relation
// as, its vocabulary, the options its store reads its mode from, and the
// store.
type Dialed = {
  vocab: Vocab
  all: Cte[]
  opts: Opts & { mode: Mode }
  store: Store
}

// The driver a mode reads through, over `driver`: every statement it runs is
// dressed for the mode `on` holds. Its memory is its own (no `connection`),
// since what it reads is not what main's driver reads.
let through = (driver: Driver, on: () => Dialed): Driver => {
  let { connection: _, ...rest } = driver
  let query = driver.query.bind(driver)
  let run = driver.run?.bind(driver)
  return {
    ...rest,
    query: (s) => query(dressed(s, on().all)),
    ...run ? { run: (s: Stmt) => run(dressed(s, on().all)) } : {},
    ...driver.tx ? { tx: driver.tx.bind(driver) } : {},
  }
}

// Each driver's mode driver, bound once.
let modes = new WeakMap<Driver, { driver: Driver; on: Dialed }>()

/** Explicit history erasure changes even a fixed past view. */
export let erased = (driver: Driver): void => {
  turned(driver)
  let past = modes.get(driver)
  if (past) turned(past.driver)
}

/**
 * The store over `driver` reading `mode`: main as of a transaction, or a
 * branch, over a database a store with history keeps. `driver` may be the one
 * its main store writes through. The first binding makes its store; binding
 * the same driver again answers the same store, now reading the new mode. The
 * database's schema is its main store's to keep, never a mode's.
 */
export let moded = (
  driver: Driver,
  vocab: Vocab,
  base: Opts & { history: History },
  mode: Mode,
): Store => {
  let derived = base.derived ?? {}
  let all = relations(vocab, derived, mode)
  let made = modes.get(driver)
  if (made) {
    let { on } = made
    if (on.vocab != vocab) {
      throw new Error('a mode driver is bound to one vocabulary')
    }
    on.all = all
    on.opts.mode = mode
    keep(made.driver, vocab, base.history, mode)
    turned(made.driver)
    return on.store
  }
  let on = { vocab, all } as Dialed
  let mine = through(driver, () => on)
  modes.set(driver, { driver: mine, on })
  on.opts = {
    ...base,
    mode,
    // The schema is its main store's: a mode's store installs nothing, even
    // over a driver with no file, which would install on its first use.
    schemaReady: () => true,
    archetypes: () => undefined,
    missingIndexes: indexed(vocab).map((i) => i.name),
    held: (ids: number[], names: readonly string[]) =>
      pastShapes(mine, vocab, ids, names, on.opts.mode),
  }
  on.store = storage(mine, vocab, on.opts)
  return on.store
}
