// `@yaks/journal/rules` — what a server composed from a config file imports to
// switch the journal on. It creates the three append-only tables over the
// server's own database connection and returns the plugin that writes a row per
// component every transaction touched.
//
// `logFor` is here rather than inside `rules` because `@yaks/journal/tools`
// READS the same tables this plugin writes, and both build their reader the
// same way: one server, one log, bound in one place.

import type { Plugin } from '@yaks/graph'
import type { Driver } from '@yaks/sqlite'
import { ddl, journal, type Log, log } from './mod.ts'

/** The log bound to a server: the three tables, read and written over that
 * server's own connection. */
export let logFor = (host: { sql: Driver }): Log =>
  log({
    rows: (sql, params) =>
      host.sql.query(sql, params as Parameters<typeof host.sql.query>[1]),
  })

/** Record who wrote what, inside the transaction that wrote it. */
export let rules = (host: { sql: Driver }): Plugin[] => {
  host.sql.exec(ddl())
  return [journal(logFor(host))]
}
