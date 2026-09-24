// What an agent may call here, exported as `@yaks/harness/tools` (and imported
// by @yaks/cli's `compose`) — the functions behind the `tool: true`
// declarations in the documents ./vocab.ts loads, keyed by tool name.
// `declared.ts` imports the same list for the harness's own command line, so
// one declaration serves both the command line and MCP.
//
// A package's components come with its tools. The harness loads @yaks/task's
// and @yaks/session's vocabularies, so it has to implement their tools too:
// `loadTools` refuses a declaration nobody implements, and the way to implement
// one is to call the package's own function rather than write a second. Their
// checks come with them: a harness answers for the leases it holds and the
// boards it saved, because it is what created them.

import type { Runs } from '@yaks/graph/tools'
import type { Vocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { runs as projects } from '@yaks/project/tools'
import { runs as sessions } from '@yaks/session/tools'
import { runs as tasks } from '@yaks/task/tools'

/** The functions behind the tools this harness's vocabulary declares. Each
 * returns the entities themselves — a tool that finds transcripts returns
 * transcripts. */
export let runs = (host: { vocab: Vocab }): Runs => ({
  ...tasks(),
  ...sessions(host),
  ...projects(host),
  session_list: (_, graph) => graph.read(parse('.session')),
})
