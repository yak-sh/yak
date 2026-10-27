import type { Driver, Stmt } from '@yaks/sql'
import { context, scope } from '@yaks/trace'
import { busy } from './error.ts'

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
export let unit = <R>(
  driver: Driver,
  body: () => R,
  mode: 'write' | 'read' = 'write',
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
  try {
    driver.query(
      outer
        ? { t: 'begin', mode: mode == 'read' ? 'deferred' : 'immediate' }
        : { t: 'savepoint', name },
    )
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
