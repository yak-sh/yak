// What an agent may CALL here: the `tools` facet a host takes (@yaks/cli
// `compose`, `@yaks/harness/tools`) — the runs behind the `tool: true`
// declarations in ./vocab.json, keyed by tool name. `declared.ts` takes the
// same list for the harness's own command line, so one declaration reaches
// both doors.

import type { Runs } from '@yaks/graph/tools'
import { parse } from '@yaks/query'

/** The runs behind the tools vocab.json declares. The answer is the entities
 * themselves — a tool that finds transcripts answers transcripts. */
export let runs: Runs = {
  session_list: (_bundles, ctx) => ctx.read(parse('.session')),
}
