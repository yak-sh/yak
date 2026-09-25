// The connection a statement runs on, as every package that runs SQL sees it:
// a statement in, rows out. A statement is a node (./ast.ts), so a driver is
// the one place one is rendered and sent, and nothing that holds a driver can
// hand it text.
//
// Synchronous on purpose: SQLite is a synchronous engine, and a store's reads
// and writes stay free of promise plumbing. An engine that is async (D1) wraps
// it at its own boundary.
//
// TODO(T-39499): a string and its parameters are still taken while the
// packages that wrote SQL text move onto the AST; the string form and `exec`
// go once none does.

import {
  as,
  col,
  count,
  type Expr,
  type Param,
  select,
  type Stmt,
  table,
} from './ast.ts'

/** One row, a bag of column values keyed by name. */
export type Row = Record<string, unknown>

export type Driver = {
  /** run a statement and return every row */
  query: (s: Stmt | string, params?: Param[]) => Row[]
  /** run a write and return how many rows it changed, triggers aside;
   * optional for a driver that can only query */
  run?: (s: Stmt | string, params?: Param[]) => number
  /** run a script of statements for effect */
  exec: (s: Stmt | string) => void
  /**
   * Run `body` as one all-or-nothing unit, for an engine that owns its
   * transactions: commit when it returns, roll back when it throws. Most
   * drivers leave it out and the store opens a savepoint; a Durable Object
   * refuses `savepoint` as a statement and offers `transactionSync`, which is
   * what this is for. It nests, and it is synchronous.
   */
  tx?: <R>(body: () => R) => R
  /**
   * This driver owns a whole SQLite file other processes may have open. The
   * outermost unit then takes the write lock up front (`begin immediate`): a
   * deferred transaction that read first cannot upgrade once another
   * connection has committed, and SQLite reports that as a `SQLITE_BUSY` the
   * busy handler may not retry. Taking the lock first turns the refusal into
   * the bounded wait `busy_timeout` is for.
   */
  file?: boolean
  /**
   * How many terms one compound select may carry on this engine. Workerd, the
   * SQLite under a Durable Object, rejects a sixth (`ARMS`), where an
   * embedded SQLite takes the stock 500 (`STOCK`). A driver that leaves it out
   * gets workerd's, and runs more statements rather than one the engine
   * refuses.
   */
  arms?: number
}

/** A statement run for its effect, through `run` where the driver has one. */
export let effect = (
  driver: Driver,
  s: Stmt | string,
  params?: Param[],
): void => {
  if (driver.run) driver.run(s, params)
  else driver.query(s, params)
}

/** How many rows a table holds, or how many of them a condition keeps. */
export let tally = (driver: Driver, name: string, where?: Expr): number =>
  Number(
    driver.query(
      select({ cols: [as(count(), 'n')], from: table(name), where }),
    )[
      0
    ]?.n ?? 0,
  )

/** A table's rows, or the ones a condition keeps: every column, or the ones
 * named. */
export let scan = (
  driver: Driver,
  name: string,
  where?: Expr,
  cols?: string[],
): Row[] =>
  driver.query(select({
    cols: cols?.map((c) => col(c)),
    from: table(name),
    where,
  }))
