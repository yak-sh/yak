import type { Driver } from './driver.ts'

// SQLite has one transaction per connection, so nesting is done with
// SAVEPOINTs: a store used inside a transaction the caller already opened (an
// application's own, or another store's) still gets its own all-or-nothing
// unit. The counter names each one uniquely — it only ever goes up, so an
// outer savepoint can never be released by an inner one's name.
let seq = 0

// How many units are open on each driver. A driver that owns a FILE needs to
// know whether it is the outermost one, because that is the one that takes the
// write lock (see `Driver.file`); everything inside it is a savepoint, since
// one connection has one transaction however deeply the calls nest.
let depth = new WeakMap<Driver, number>()

// One all-or-nothing unit of work. A driver that owns its own transactions
// (see `Driver.tx`) is asked for one; otherwise it is `begin immediate` where
// this driver owns a file and nobody is inside a unit yet, and a SAVEPOINT in
// plain SQL everywhere else. An async body is settled before the unit closes,
// so a batch that went async is still rolled back by a rejection.
export let unit = <R>(driver: Driver, body: () => R): R => {
  if (driver.tx) return driver.tx(body)
  let held = depth.get(driver) ?? 0
  let outer = !!driver.file && held == 0
  let name = `yaks_tx_${seq++}`
  driver.exec(outer ? 'begin immediate' : `savepoint ${name}`)
  depth.set(driver, held + 1)
  let close = (sql: string) => {
    depth.set(driver, (depth.get(driver) ?? 1) - 1)
    driver.exec(sql)
  }
  let undo = (e: unknown): never => {
    close(outer ? 'rollback' : `rollback to ${name}; release ${name}`)
    throw e
  }
  let done = <T>(out: T): T => {
    close(outer ? 'commit' : `release ${name}`)
    return out
  }
  try {
    let out = body()
    return (out instanceof Promise ? out.then(done, undo) : done(out)) as R
  } catch (e) {
    return undo(e)
  }
}
