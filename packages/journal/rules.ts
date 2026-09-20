// The log OF the wire: the `rules` facet a host takes (`@yaks/journal/rules`).
// It raises the three append-only tables through the host's own connection and
// returns the plugin that writes a row per component every batch touched.
//
// The binding itself is here rather than inside `rules`, because the `tools`
// facet READS the same tables the plugin writes: one host has one log, said
// once (`logFor`).

import type { Plugin } from '@yaks/graph'
import type { Driver } from '@yaks/sqlite'
import { ddl, journal, type Log, log } from './mod.ts'

/** The log bound to a host: the three tables, through its own connection. */
export let logFor = (host: { sql: Driver }): Log =>
  log({
    rows: (sql, params) =>
      host.sql.query(sql, params as Parameters<typeof host.sql.query>[1]),
  })

/** Who wrote what, within the transaction that wrote it. */
export let rules = (host: { sql: Driver }): Plugin[] => {
  host.sql.exec(ddl())
  return [journal(logFor(host))]
}
