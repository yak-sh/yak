// What an agent may CALL here: the `tools` facet a host takes (@yaks/cli
// `compose`, `@yaks/harness/tools`) — the runs behind the `tool: true`
// declarations in the documents ./vocab.ts loads, keyed by tool name.
// `declared.ts` takes the same list for the harness's own command line, so one
// declaration reaches both doors.
//
// A package's words come with its verbs. The harness speaks @yaks/task's and
// @yaks/session's vocabularies, so it answers for their tools too — which is
// the facet contract said the other way round: `loadTools` refuses a
// declaration nobody implements, and the way to implement one is to take the
// package's own run rather than write a second. Their CHECKS come with them: a
// harness answers for the locks it holds and the boards it saved, because it
// is the thing that made them.

import type { Runs } from '@yaks/graph/tools'
import type { Vocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { runs as projects } from '@yaks/project/tools'
import { runs as sessions } from '@yaks/session/tools'
import { runs as tasks } from '@yaks/task/tools'

/** The runs behind the tools this harness's vocabulary declares. The answer is
 * the entities themselves — a tool that finds transcripts answers
 * transcripts. */
export let runs = (host: { vocab: Vocab }): Runs => ({
  ...tasks(),
  ...sessions(host),
  ...projects(host),
  session_list: (_bundles, ctx) => ctx.read(parse('.session')),
})
