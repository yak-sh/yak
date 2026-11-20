// The Driver over the SQLite built into Deno (node:sqlite), for databases
// Deno itself keeps open in this process, such as its module caches. POSIX
// locks belong to the process, so a second SQLite closing the same file drops
// the locks Deno's copy holds, and the two can corrupt it. Deno links one
// SQLite, and node:sqlite is that one; a file Deno holds is opened only here.
import { DatabaseSync } from 'node:sqlite'
import * as io from '@yaks/file/io'
import type { Driver, Param, Row } from '@yaks/sql'
import { driver } from './driver.ts'

/** Open an existing database through Deno's own SQLite; a missing one is
 * refused, never created. */
export let builtin = (path: string): Driver & { close: () => void } => {
  let url = io.pathToFileURL(path)
  url.searchParams.set('mode', 'rw')
  let db = new DatabaseSync(url)
  let changes = 0
  let ran = (sql: string, params: Param[]): Row[] => {
    let statement = db.prepare(sql)
    let bound = params.map((p) => typeof p == 'boolean' ? Number(p) : p)
    if (statement.columns().length) {
      return statement.all(...bound).map((row) => ({ ...row }))
    }
    changes = Number(statement.run(...bound).changes)
    return []
  }
  return {
    ...driver(ran, { file: true, changes: () => changes }),
    close: () => db.close(),
  }
}
