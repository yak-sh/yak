import type { Driver } from './driver.ts'

// SQLite has one transaction per connection, so nesting is done with
// SAVEPOINTs: a store used inside a transaction the host already opened (an
// application's own, or another store's) still gets its own all-or-nothing
// unit. The counter names each one uniquely — it only ever goes up, so an
// outer savepoint can never be released by an inner one's name.
let seq = 0

// One all-or-nothing unit of work. A driver that owns its own transactions
// (see `Driver.tx`) is asked for one; otherwise it is a SAVEPOINT in plain
// SQL. An async body is settled before the savepoint closes, so a batch that
// went async is still rolled back by a rejection.
export let unit = <R>(driver: Driver, body: () => R): R => {
  if (driver.tx) return driver.tx(body)
  let name = `yaks_tx_${seq++}`
  driver.exec(`savepoint ${name}`)
  let undo = (e: unknown): never => {
    driver.exec(`rollback to ${name}`)
    driver.exec(`release ${name}`)
    throw e
  }
  let done = <T>(out: T): T => {
    driver.exec(`release ${name}`)
    return out
  }
  try {
    let out = body()
    return (out instanceof Promise ? out.then(done, undo) : done(out)) as R
  } catch (e) {
    return undo(e)
  }
}
