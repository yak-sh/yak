// What an agent can ask about here: the `tools` export
// (`@yaks/embedding/tools`) — the implementation behind the `vector_check`
// declaration in ./vocab.json. One tool, and it is a check: a tool whose verb
// is `check`, which is all a "doctor" is (@yaks/tools ./check.ts). "The server"
// below means whichever process opened the graph and loaded this package.
//
// The failure it exists for is invisible from outside: an approximate index has
// exactly one writer — the process whose sweep rebuilds it — and when that
// process is gone, or its connection never opened the index it thought it had,
// writes still succeed, searches still return results, and the neighbours are
// silently frozen at the last good rebuild. Nothing raises an error. The graph
// looks healthy. Semantic search is simply wrong from then on.
//
// The evidence is in ./mark.ts: the triggers set the dirty flag inside the same
// statement as a write, and only a finished rebuild clears it, so a flag older
// than the sweep's own interval means nothing is rebuilding the index.
// `state()` was written for exactly this reading ("what a health check reads");
// this is that check.
//
// A server that created no vector table has no index to be behind on, and
// reports that rather than passing: asking the question is what tells the two
// apart.
//
// The other invisible failure is a server that is waiting: missing config never
// prevents startup (./options.ts), so a graph with no key starts perfectly well
// and quietly embeds nothing. This is where that is reported, and it is
// reported every time the tool is called rather than once into a log nobody
// kept.

import type { Runs } from '@yaks/graph/tools'
import { checked, type Finding } from '@yaks/tools'
import type { Driver } from './driver.ts'
import { state } from './mark.ts'
import { embedderOf, type Options } from './options.ts'

export type { Options }

let STALE = 30

/** The implementation behind the tool ./vocab.json declares, over this
 * server's own database connection — which is why this export is a factory. */
export let runs = (
  host: { sql: Driver },
  options: Options = {},
): Runs => ({
  vector_check: (_bundles, ctx) => {
    let about = 'the vector index is being rebuilt by the sweep that owns it'
    let minutes = options.stale ?? STALE
    // What this server is waiting for, if anything: a sweep that cannot embed
    // is not behind on a rebuild, it has not started at all.
    let { waiting } = embedderOf(options)
    if (waiting) {
      return checked(ctx.call, about, [{
        level: 'warn',
        text: `nothing is being embedded — ${waiting}. The sweep starts on ` +
          `its own once the config is there; nothing has to be restarted`,
      }])
    }
    let said
    try {
      said = state(host.sql)
    } catch {
      // No vector table: this server never composed `@yaks/embedding/rules`,
      // so there is no index and no sweep. Not a failure, and not a pass
      // either.
      return checked(ctx.call, about, [{
        level: 'warn',
        text: 'this host keeps no vector table, so there is no index to ' +
          'rebuild — @yaks/embedding/rules is what raises one',
      }])
    }
    let at = Date.parse(String(said.newest ?? ''))
    let stale = said.dirty && said.rows > 0 && !isNaN(at) &&
      Date.now() - at > minutes * 60_000
    let found: Finding[] = stale
      ? [{
        level: 'fail',
        text: `the index has been owed a rebuild since ${said.newest} ` +
          `(${said.rows} vectors) — over ${minutes}m with nothing ` +
          `quantizing, so every neighbourhood answers from the last good ` +
          `build. No process is running the sweep, or its connection never ` +
          `opened the index it writes`,
      }]
      : []
    return checked(ctx.call, about, found)
  },
})
