import type { Driver, Stmt } from '@yaks/sql'
import { context, scope } from '@yaks/trace'
import { busy } from './error.ts'
import { AsyncLocalStorage } from 'node:async_hooks'

type Owner = { connection: object; active: boolean }
let owner = new AsyncLocalStorage<Owner[]>()
let waiting = new WeakMap<object, Promise<void>>()

/** Whether this async context owns the connection's active transaction. */
export let owned = (driver: Driver): boolean =>
  !!owner.getStore()?.some((o) =>
    o.connection === (driver.connection ?? driver) && o.active
  )

/** Independent asynchronous transactions on one connection take turns.
 * Only calls within the owning body's async context may open savepoints;
 * otherwise an unrelated write could commit inside a transaction that later
 * rolls back. The uncontended synchronous path stays synchronous. */
export let exclusive = <R>(
  driver: Driver,
  body: () => R,
): R | Promise<Awaited<R>> => {
  let connection = driver.connection ?? driver
  let held = owner.getStore() ?? []
  if (owned(driver)) return body()
  let scope: Owner = { connection, active: true }
  let run = () => owner.run([...held, scope], body)
  let before = waiting.get(connection)
  let out: R | Promise<Awaited<R>>
  try {
    out = before ? before.then(run) as Promise<Awaited<R>> : run()
  } catch (error) {
    scope.active = false
    throw error
  }
  if (!(out instanceof Promise)) {
    scope.active = false
    return out
  }
  let done = out.finally(() => {
    scope.active = false
    if (waiting.get(connection) === tail) waiting.delete(connection)
  })
  let tail = done.then(() => {}, () => {})
  waiting.set(connection, tail)
  return done
}

// SQLite has one transaction per connection, so nesting is done with
// SAVEPOINTs: a store used inside a transaction the caller already opened (an
// application's own, or another store's) still gets its own all-or-nothing
// unit. Each is named for its depth: an inner savepoint never shares an outer
// one's name, so it can never release it, and a connection says only a handful
// of names, which its driver keeps prepared. A name per unit would be two
// statements prepared for every unit and never run again, and in memory, where
// every unit is a savepoint, they would push the statements a store does repeat
// out of the driver's bounded cache.

// How many units are open on each driver. A driver that owns a file needs to
// know whether it is the outermost one, because that is the one that takes the
// write lock (see `Driver.file`); everything inside it is a savepoint, since
// one connection has one transaction however deeply the calls nest.
let depth = new WeakMap<Driver, number>()

// One all-or-nothing unit of work. A driver that owns its own transactions
// (see `Driver.tx`) is asked for one; otherwise it is `begin immediate` where
// this driver owns a file and nobody is inside a unit yet, and a SAVEPOINT in
// plain SQL everywhere else. An async body is settled before the unit closes,
// so a batch that went async is still rolled back by a rejection.
//
// A unit that only reads says so (`read`), and the outermost one then begins
// deferred: in WAL a reader sees one consistent snapshot without the write
// lock, so a lookup neither waits on a writer nor makes one wait. It must not
// write — a deferred transaction that has read cannot take the lock once
// another connection has committed.
//
// A read opens a transaction only where it isolates the read from someone: a
// file other connections commit to. A read has nothing to roll back, so on a
// connection nobody else writes (memory, a Durable Object's own storage) a
// savepoint or a `transactionSync` around it is statements and a call that
// buy nothing, paid on every lookup a write asks before its own transaction.
//
// An outermost write waits out another connection's lock inside SQLite's busy
// handler, which sleeps the calling thread. A caller that can wait without
// holding its thread says `wait: false`: a held lock then refuses at once,
// marked retryable, and the caller waits as it likes (@yaks/graph `enter`).
export let unit = <R>(
  driver: Driver,
  body: () => R,
  mode: 'write' | 'read' = 'write',
  { wait = true }: { wait?: boolean } = {},
): R => {
  let tracing = context()
  let held = depth.get(driver) ?? 0
  // A read inside a unit already has its snapshot, and one on a connection no
  // other commits to needs none. Writes still need their rollback boundary.
  if (mode == 'read' && (held || !driver.file)) return body()
  if (driver.tx) {
    depth.set(driver, held + 1)
    let close = () => depth.set(driver, (depth.get(driver) ?? 1) - 1)
    try {
      let out = driver.tx(body)
      if (out instanceof Promise) return out.finally(close) as R
      close()
      return out
    } catch (error) {
      close()
      throw error
    }
  }
  let outer = !!driver.file && held == 0
  let name = `yaks_tx_${held}`
  let begin = () =>
    driver.query(
      outer
        ? { t: 'begin', mode: mode == 'read' ? 'deferred' : 'immediate' }
        : { t: 'savepoint', name },
    )
  try {
    outer && mode == 'write' && !wait ? unwaiting(driver, begin) : begin()
  } catch (e) {
    // No callback ran and no write landed. Callers may retry this refusal,
    // unlike a failure after the body could have performed external work.
    if (outer && mode == 'write' && busy(e)) {
      throw Object.assign(e, { retryable: true })
    }
    throw e
  }
  depth.set(driver, held + 1)
  let close = (...stmts: Stmt[]) => {
    depth.set(driver, (depth.get(driver) ?? 1) - 1)
    if (tracing) {
      scope(tracing, () => {
        for (let s of stmts) driver.query(s)
      })
    } else for (let s of stmts) driver.query(s)
  }
  let undo = (e: unknown): never => {
    if (outer) close({ t: 'rollback' })
    else close({ t: 'rollback', to: name }, { t: 'release', name })
    throw e
  }
  let done = <T>(out: T): T => {
    close(outer ? { t: 'commit' } : { t: 'release', name })
    return out
  }
  try {
    let out = body()
    return (out instanceof Promise ? out.then(done, undo) : done(out)) as R
  } catch (e) {
    return undo(e)
  }
}

/** `body` with this connection's busy wait at nothing: a lock another
 * connection holds refuses it at once, for work that can be left to later
 * rather than waited for. */
export let unwaiting = <R>(driver: Driver, body: () => R): R => {
  let [row] = driver.query({ t: 'pragma', name: 'busy_timeout' })
  let was = Number(Object.values(row ?? {})[0] ?? 0)
  driver.query({ t: 'pragma', name: 'busy_timeout', value: 0 })
  try {
    return body()
  } finally {
    driver.query({ t: 'pragma', name: 'busy_timeout', value: was })
  }
}
