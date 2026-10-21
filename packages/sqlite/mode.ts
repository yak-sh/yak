// Reading the past, and writing to a branch, on a connection of its own
// (D-130964). A connection's temporary views stand in front of the tables of
// the same name, so each component table, the tombstones and the `doc_value`
// view are replaced, for this connection only, by the rows its mode reads
// (./history.ts `seen`). Every statement this package builds, the compiler's
// and every other, then reads that mode without knowing it.
//
// The views read their mode from a one-row temporary table, the dial
// (./history.ts `DIAL`). Binding the connection to another mode turns the
// dial: the views stand, the statements already prepared over them stay
// prepared, and the connection's memory (./memo.ts) lets go of everything, as
// it does when the schema moves. Turning it from a transaction to a branch, or
// back, makes the views again, since each kind reads its own way. A
// connection reads one mode at a time, so every store over it reads the one it
// was last bound to.
//
// What the views cannot carry is turned off: the archetype pointers say what
// an entity holds now, so the descriptors read as none and presence is read
// from the tables themselves; and an index hint names an index a view does
// not have, so the compiler gives none.
//
// A connection as of a transaction refuses every write. A branch's writes go
// to the branch's rows beside the live tables (./history.ts `branched`).

import {
  col,
  type Derived,
  type Driver,
  eq,
  lit,
  select,
  type Stmt,
  val,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { docDdl, indexed } from './ddl.ts'
import {
  BRANCHES,
  covered,
  DIAL,
  type History,
  keep,
  type Kind,
  kind,
  type Mode,
  seen,
  stored,
} from './history.ts'
import { type Opts, storage, type Store } from './mod.ts'

// The dial, set to read nothing until a mode turns it.
let DIAL_DDL: Stmt[] = [
  {
    t: 'create table',
    temp: true,
    name: DIAL,
    cols: [{ name: 'at', type: 'integer' }, {
      name: 'branch',
      type: 'integer',
    }],
  },
  {
    t: 'insert',
    into: DIAL,
    cols: ['at', 'branch'],
    rows: [[lit(0), lit(null)]],
  },
]

// The temporary views a mode's connection reads through, of one kind.
let views = (vocab: Vocab, derived: Derived, k: Kind): Stmt[] => [
  ...[...covered(vocab)].map((comp): Stmt => ({
    t: 'create view',
    temp: true,
    name: comp,
    q: comp == 'archetype'
      ? select({
        cols: [col('entity'), ...stored(vocab, comp).map((c) => col(c))],
        from: { t: 'table', name: comp, schema: 'main' },
        where: lit(false),
      })
      : seen(vocab, comp, k),
  })),
  ...docDdl(vocab, derived).flatMap((s) =>
    s.t == 'create view' ? [{ ...s, temp: true }] : []
  ),
]

// The views of one kind gone, to make the other's.
let unviewed = (vocab: Vocab): Stmt[] =>
  [...covered(vocab), 'doc_value'].map((name) => ({
    t: 'drop',
    kind: 'view',
    name,
    ifExists: true,
  }))

// A mode's connection: its vocabulary, the kind of views it holds, its one
// store, and the options that store reads its mode from.
type Dialed = {
  vocab: Vocab
  kind: Kind
  opts: Opts & { history: History; mode: Mode }
  store: Store
}
let dialed = new WeakMap<Driver, Dialed>()

/**
 * The store over `driver`, a connection of its own to a database a store with
 * history keeps, reading `mode`: main as of a transaction, or a branch. The
 * first binding makes its dial, its views and its store; binding it again
 * turns its dial and answers the same store. The database's schema is its own
 * writer's to keep, never this connection's.
 */
export let moded = (
  driver: Driver,
  vocab: Vocab,
  base: Opts & { history: History },
  mode: Mode,
): Store => {
  let on = dialed.get(driver)
  if (on && on.vocab != vocab) {
    throw new Error('a mode connection is bound to one vocabulary')
  }
  let k = kind(mode)
  let derived = base.derived ?? {}
  let made = !on
    ? [...DIAL_DDL, ...views(vocab, derived, k)]
    : on.kind != k
    ? [...unviewed(vocab), ...views(vocab, derived, k)]
    : []
  for (let s of made) driver.query(s)
  driver.query({
    t: 'update',
    table: DIAL,
    set: 'at' in mode
      ? { at: val(mode.at), branch: lit(null) }
      : { at: val(mode.fork), branch: val(mode.branch) },
  })
  if (on) {
    on.kind = k
    on.opts.mode = mode
    keep(driver, vocab, on.opts.history, mode)
    return on.store
  }
  let opts = {
    ...base,
    mode,
    archetypes: () => undefined,
    missingIndexes: indexed(vocab).map((i) => i.name),
  }
  let store = storage(driver, vocab, opts)
  dialed.set(driver, { vocab, kind: k, opts, store })
  return store
}

/** Make a branch of main at its newest transaction: one row, nothing copied.
 * Answers its id and the transaction it forked at. */
export let branch = (
  driver: Driver,
  history: History,
): { branch: number; fork: number } => {
  let fork = Number(driver.query(history.tip)[0]?.id ?? 0)
  let [row] = driver.query({
    t: 'insert',
    into: BRANCHES,
    cols: ['parent', 'fork', 'at'],
    rows: [[lit(0), val(fork), val(new Date().toISOString())]],
    returning: [col('id')],
  })
  return { branch: Number(row.id), fork }
}

/** The branch `id`, as a mode: where it forked. Undefined for none. */
export let branchOf = (driver: Driver, id: number): Mode | undefined => {
  let [row] = driver.query(select({
    cols: [col('fork')],
    from: { t: 'table', name: BRANCHES },
    where: eq(col('id'), val(id)),
  }))
  return row ? { branch: id, fork: Number(row.fork) } : undefined
}
