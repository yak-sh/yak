// Check embedding availability and the native scan used for vector search.
import type { Graph } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { checked } from '@yaks/tools/check'
import {
  as,
  col,
  fn,
  select,
  type Statements,
  statements,
  table,
} from '@yaks/sql'
import { TABLE } from './ddl.ts'
import { state } from './native.ts'
import { embedderOf, type Options } from './options.ts'

export type { Options }

// When the newest vector was written, or null where there are none.
let newest = (db: Statements): string | null =>
  (db.query(select({
    cols: [as(fn('max', col('at')), 'at')],
    from: table(TABLE),
  }))[0]?.at as string | null) ?? null

/** The implementation behind the tool ./vocab.json declares, over this
 * server's own database connection — which is why this export is a factory. */
export let runs = (
  host: { storage: { statements?: Statements }; graph: Pick<Graph, 'get'> },
  options: Options = {},
): Runs => {
  let db = statements(host.storage)
  return {
    vector_check: async (call) => {
      let about = 'vector search reads the current canonical vectors'
      let warn = (text: string) =>
        checked(call.entity.eid, about, [{ level: 'warn', text }])
      // What this server is waiting for, if anything: a sweep that cannot embed
      // is not behind on a build, it has not started at all.
      let { waiting } = await embedderOf(options, host.graph)
      if (waiting) {
        return warn(
          `nothing is being embedded — ${waiting}. The sweep starts on its ` +
            `own once the config is there; nothing has to be restarted`,
        )
      }
      let said
      try {
        said = state(db)
      } catch {
        // No vector table: this server never composed `@yaks/embedding/graph`,
        // so there is no index and no sweep. Not a failure, and not a pass
        // either.
        return warn(
          'this host keeps no vector table, so there are no vectors to search — ' +
            '@yaks/embedding/graph is what raises one',
        )
      }
      let last = newest(db)
      if (!last) return checked(call.entity.eid, about, [])
      // Where no index serves, a database only this process has open holds its
      // vectors in memory (./held.ts): no search reads them.
      let held = db.ownership == 'exclusive' &&
        (!said.installed || !said.model)
      if (held) return checked(call.entity.eid, about, [])
      if (!said.installed) {
        return warn(
          'sqlite-vector is not installed on this database, so every search ' +
            'reads every stored vector — back the file up, then installNative() ' +
            'once',
        )
      }
      if (!said.model) {
        return warn(
          "two models' vectors share the table while the sweep re-embeds; " +
            'native scans wait for one model, and JavaScript scores each ' +
            'matching vector until then',
        )
      }
      return checked(call.entity.eid, about, [])
    },
  }
}
