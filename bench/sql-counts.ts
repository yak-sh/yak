// Count native statement executions, including the cached driver's schema
// probes. Installed only in the separate counts process, never during timing.
import '../packages/sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'

export function sqlStatements() {
  let count = 0
  let prepare = Database.prototype.prepare
  Database.prototype.prepare = function (
    this: Database,
    ...args: Parameters<typeof prepare>
  ) {
    let statement = prepare.apply(this, args)
    for (let key of ['all', 'value', 'values', 'get', 'run'] as const) {
      let run = statement[key]
      Reflect.set(statement, key, (...params: unknown[]) => {
        count++
        return Reflect.apply(run, statement, params)
      })
    }
    return statement
  } as typeof prepare
  return {
    reset: () => {
      count = 0
    },
    count: () => count,
    close: () => {
      Database.prototype.prepare = prepare
    },
  }
}
