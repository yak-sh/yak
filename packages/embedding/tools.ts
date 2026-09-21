// What an agent may ASK for here: the `tools` facet a host takes
// (`@yaks/embedding/tools`) — the run behind the `vector_check` declaration in
// ./vocab.json. One tool, and it is a CHECK: a tool whose verb is `check`,
// which is the whole of what a "doctor" is (@yaks/tools ./check.ts).
//
// The failure it exists for is invisible from outside: an approximate index
// has exactly one writer — the process whose sweep rebuilds it — and when that
// process is gone, or its connection never opened the index it thought it had,
// the writes still land, the searches still answer, and the neighbours are
// quietly frozen at the last good rebuild. Nothing errors. The graph looks
// well. Semantic search is just wrong now, and stays wrong.
//
// The tell is ./mark.ts: the triggers set the mark inside the same statement
// as a write, and only a landed rebuild clears it, so a mark that outlives the
// sweep's own interval means nobody is quantizing. `state()` was written for
// exactly this reading ("what a health check reads"); this is the check.
//
// A host that composed no vector table has no index to be behind on, and says
// so rather than passing: asking the question is what tells the two apart.
//
// The other invisible failure is a host that is WAITING: missing config never
// prevents boot (./options.ts), so a graph with no key comes up perfectly well
// and quietly embeds nothing. This is where that is said out loud, and it is
// said every time it is asked rather than once into a log nobody kept.

import type { Runs } from '@yaks/graph/tools'
import { checked, type Finding } from '@yaks/tools'
import type { Driver } from './driver.ts'
import { state } from './mark.ts'
import { embedderOf, type Options } from './options.ts'

export type { Options }

let STALE = 30

/** The run behind the tool ./vocab.json declares — over this host's own
 * connection, which is why the facet is a factory. */
export let runs = (
  host: { sql: Driver },
  options: Options = {},
): Runs => ({
  vector_check: (_bundles, ctx) => {
    let about = 'the vector index is being rebuilt by the sweep that owns it'
    let minutes = options.stale ?? STALE
    // What this host is waiting for, if anything: a sweep that cannot embed
    // is not behind on a rebuild, it has not started.
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
      // No vector table: this host composed `@yaks/embedding/rules` nowhere,
      // so there is no index and no sweep. Not a fault, and not a pass either.
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
