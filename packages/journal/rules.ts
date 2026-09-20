// The log OF the wire: the `rules` facet a host takes (`@yaks/journal/rules`).
// It raises the three append-only tables through the host's own connection and
// returns the plugin that writes a row per component every batch touched.
//
// There are no words here — the journal declares no component and appears in
// no snapshot — which is why this package has a `rules` facet and no `vocab`
// one.

import type { Plugin } from '@yaks/graph'
import type { Driver } from '@yaks/sqlite'
import { ddl, journal, log } from './mod.ts'

/** Who wrote what, within the transaction that wrote it. */
export let rules = (host: { sql: Driver }): Plugin[] => {
  host.sql.exec(ddl())
  return [
    journal(
      log({
        rows: (sql, params) =>
          host.sql.query(sql, params as Parameters<typeof host.sql.query>[1]),
      }),
    ),
  ]
}
