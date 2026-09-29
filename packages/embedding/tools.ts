// What an agent can ask about here: the `tools` export
// (`@yaks/embedding/tools`) — the implementation behind the `vector_check`
// declaration in ./vocab.json. One tool, and it is a check: a tool whose verb
// is `check`, which is all a "doctor" is (@yaks/tools ./check.ts). "The server"
// below means whichever process opened the graph and loaded this package.
//
// The failure it exists for is invisible from outside: the quantized index
// (./native.ts) has exactly one builder — the process running the sweep — and
// when that process is gone, writes still succeed and searches still answer
// correctly, because every vector written since the last build is scored
// exactly. What goes wrong is time: the vectors the index has not seen pile
// up, and every search reads more of them. Nothing raises an error.
//
// The evidence is the index's state: it is behind (never built, or built from
// another model, or too many vectors changed since), and the newest vector is
// older than the sweep's own interval, so nothing has been building it.
//
// A server that created no vector table has no index to be behind on, and
// reports that rather than passing: asking the question is what tells the two
// apart. So does one whose database never had sqlite-vector installed, or
// whose table holds two models' vectors while the sweep re-embeds: every search
// there reads every vector, and this is where that is said.
//
// The other invisible failure is a server that is waiting: missing config never
// prevents startup (./options.ts), so a graph with no key starts perfectly well
// and quietly embeds nothing. This is where that is reported, and it is
// reported every time the tool is called rather than once into a log nobody
// kept.

import type { Runs } from '@yaks/graph/tools'
import { checked, type Finding } from '@yaks/tools'
import { as, col, type Driver, fn, select, table } from '@yaks/sql'
import { TABLE } from './ddl.ts'
import { behind, REBUILD, state } from './native.ts'
import { embedderOf, type Options } from './options.ts'

export type { Options }

let STALE = 30

// When the newest vector was written, or null where there are none.
let newest = (db: Driver): string | null =>
  (db.query(select({
    cols: [as(fn('max', col('at')), 'at')],
    from: table(TABLE),
  }))[0]?.at as string | null) ?? null

/** The implementation behind the tool ./vocab.json declares, over this
 * server's own database connection — which is why this export is a factory. */
export let runs = (
  host: { sql: Driver },
  options: Options = {},
): Runs => ({
  vector_check: (call) => {
    let about = 'the vector index is being built by the sweep that owns it'
    let minutes = options.stale ?? STALE
    let warn = (text: string) =>
      checked(call.entity.eid, about, [{ level: 'warn', text }])
    // What this server is waiting for, if anything: a sweep that cannot embed
    // is not behind on a build, it has not started at all.
    let { waiting } = embedderOf(options)
    if (waiting) {
      return warn(
        `nothing is being embedded — ${waiting}. The sweep starts on its ` +
          `own once the config is there; nothing has to be restarted`,
      )
    }
    let said
    try {
      said = state(host.sql)
    } catch {
      // No vector table: this server never composed `@yaks/embedding/rules`,
      // so there is no index and no sweep. Not a failure, and not a pass
      // either.
      return warn(
        'this host keeps no vector table, so there is no index to build — ' +
          '@yaks/embedding/rules is what raises one',
      )
    }
    let last = newest(host.sql)
    if (!last) return checked(call.entity.eid, about, [])
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
          'the index waits for one model, and every search reads every ' +
          'vector until then',
      )
    }
    let at = Date.parse(last)
    let stalled = behind(said) && !isNaN(at) &&
      Date.now() - at > minutes * 60_000
    let found: Finding[] = stalled
      ? [{
        level: 'fail',
        text: `the index has been owed a build since ${last} (` +
          (said.build.n
            ? `${said.dirty} vectors changed since build ${said.build.n}, ` +
              `${REBUILD} call for another`
            : 'never built') +
          `) — over ${minutes}m with nothing building it. Searches are ` +
          `still exact, but each one scores every changed vector. No ` +
          `process is running the sweep`,
      }]
      : []
    return checked(call.entity.eid, about, found)
  },
})
