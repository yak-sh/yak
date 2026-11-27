// The connection a statement runs on, as every package that runs SQL sees it:
// a statement in, rows out. A statement is a node (./ast.ts), so a driver is
// the one place one is rendered and sent, and nothing that holds a driver can
// hand it text.
//
// Synchronous on purpose: SQLite is a synchronous engine, and a store's reads
// and writes stay free of promise plumbing. An engine that is async (D1) wraps
// it at its own boundary.

import type { Vocab } from '@yaks/vocab'
import {
  as,
  col,
  count,
  type Expr,
  type Raw,
  select,
  type Stmt,
  table,
} from './ast.ts'
import { render } from './render.ts'
import { asWritten, faultAsWritten } from './catalogue.ts'

/** One row, a bag of column values keyed by name. */
export type Row = Record<string, unknown>

/** Anything but a promise: what the body of a synchronous transaction
 * returns. One that returned a promise would have its transaction commit at
 * the first `await`, and run the rest outside it. */
export type Settled =
  | null
  | undefined
  | void
  | string
  | number
  | boolean
  | bigint
  | symbol
  | (object & { then?: never })

export type Driver = {
  /** Load a native SQL extension when this engine supports one. */
  extension?: (path: string) => void
  /** run a statement and return every row */
  query: (s: Stmt) => Row[]
  /** run a write and return how many rows it changed, triggers aside;
   * optional for a driver that can only query */
  run?: (s: Stmt) => number
  /**
   * Run `body` as one all-or-nothing unit, for an engine that owns its
   * transactions: commit when it returns, roll back when it throws. Most
   * drivers leave it out and the store opens a savepoint; a Durable Object
   * refuses `savepoint` as a statement and offers `transactionSync`, which is
   * what this is for. It nests, and it is synchronous: a body that went async
   * would commit at its first `await` (`Settled`).
   */
  tx?: <R extends Settled>(body: () => R) => R
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
   * Hear the file change: `changed` is called soon after another connection
   * commits to it, and may be called when nothing this caller wants did.
   * Answers a stop. Only a driver over a file other processes may write has
   * one; a connection that owns its database alone sees every change itself.
   */
  watch?: (changed: () => void) => () => void
  /**
   * Keep planner statistics during installation. A file engine permits a
   * bounded sample; Durable Object SQLite permits optimization but refuses
   * `analysis_limit`, so any analysis there reads full indexes. Omitted for
   * transient stores whose statistics would not outlive the connection.
   */
  statistics?: 'sampled' | {
    /** Stored bytes, read from the engine without a SQL row scan. */
    bytes: () => number
  }
  /**
   * How many terms one compound select may carry on this engine. Workerd, the
   * SQLite under a Durable Object, rejects a sixth (`ARMS`), where an
   * embedded SQLite takes the stock 500 (`STOCK`). A driver that leaves it out
   * gets workerd's, and runs more statements rather than one the engine
   * refuses.
   */
  arms?: number
  /**
   * This driver keeps each prepared statement by its text and binds every
   * collection as one JSON array (`renderStable`): a list in a compiled read
   * binds that way too, so the read's text is the same whatever the list
   * holds, and is prepared once. A driver that leaves it out takes lists
   * written into the text, which an engine billing each row read (D1) tests
   * a row against without reading any (@yaks/sql `spelled`). A Durable Object
   * keeps statements by their text too: a cold burst of distinct reads would
   * prepare one statement each, which costs it more than the rows.
   */
  stable?: boolean
  /**
   * How this engine writes a statement as text: within its limits on bound
   * values and named relations, collections bound as {@link stable} says, and
   * with the names `v` stores its words under (./render.ts). A driver that
   * leaves it out writes one within the strictest engine's limits.
   */
  render?: (s: Stmt, v?: Vocab) => Raw
  /**
   * The vocabulary this driver writes statements with ({@link storeAs}),
   * shared by every driver over the same database: a driver made over
   * another (`{ ...driver }`) holds the same one.
   */
  stored?: { v?: Vocab }
  /** The connection supplies component relations under their logical names. */
  views?: boolean
  /**
   * Make a schema from a template. Where another database of this process
   * already ran `make` for the same `key`, holding the same objects this one
   * holds and no rows, this one becomes a copy of what that one made, and
   * `make` does not run; otherwise it runs, and what it made is kept as the
   * template for the next. For an engine where copying a schema costs far less
   * than making one: an embedded database in memory, which a test suite opens
   * thousands of. A driver that leaves it out makes every schema itself.
   */
  template?: (key: string, make: () => void) => void
  /**
   * The connection this driver speaks through, where other drivers may speak
   * through it too: a Durable Object's storage, which each driver bound to it
   * shares. What is remembered of a connection ({@link revision}, and
   * @yaks/sqlite's memory) is kept once for all of them, so a write through
   * one is seen through every other. A driver that leaves it out is a
   * connection of its own.
   */
  connection?: object
}

/** A statement run for its effect. Query executes commands too; asking for
 * an affected count can require another engine operation, so reserve `run`
 * for callers that consume its count. */
/**
 * Have `driver` write every statement with the names `v` stores its words
 * under (`Vocab.stored`): what a store binds its driver with, so each statement
 * it and every package beside it runs names a component's table and columns
 * as storage keeps them, though written with their labels. Every driver over
 * the same database shares it ({@link Driver.stored}); bound again, it takes
 * the newer vocabulary. A driver with no such slot (a test's own) is changed
 * in place to write each statement before sending it.
 */
export let storeAs = (driver: Driver, v: Vocab): void => {
  if (driver.stored) return void (driver.stored.v = v)
  let at: { v?: Vocab } = { v }
  driver.stored = at
  let text = (s: Stmt): Stmt =>
    s.t == 'raw' ? s : render(s, undefined, undefined, at.v)
  let query = driver.query.bind(driver)
  driver.query = (s) => labeled(() => asWritten(s, query(text(s)), at.v), at.v)
  if (driver.run) {
    let run = driver.run.bind(driver)
    driver.run = (s) => labeled(() => run(text(s)), at.v)
  }
}

/** What `ran` answers, or its refusal under the names its statement wrote
 * (./catalogue.ts `faultAsWritten`): how every driver bound to a vocabulary
 * runs a statement. */
export let labeled = <T>(ran: () => T, v?: Vocab): T => {
  try {
    return ran()
  } catch (e) {
    throw faultAsWritten(e, v)
  }
}

export let effect = (driver: Driver, s: Stmt): void => {
  driver.query(s)
}

/** Run a file's own schema names through an already-bound driver. */
export let queryPhysical = (driver: Driver, stmt: Stmt): Row[] => {
  if (!driver.stored?.v) return driver.query(stmt)
  let written = driver.render?.(stmt) ?? render(stmt)
  return driver.query({ ...written, physical: true })
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
