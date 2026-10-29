// The routes facet, exported as `@yaks/mcp/routes`: `/mcp` as one route on a
// host's own listener.
//
// This server is a path, not a process. A host whose config names this package
// answers JSON-RPC at `/mcp`, through whatever is serving its routes
// (@yaks/api) — so a config that names neither serves no HTTP and still runs
// every one of these tools in its own process, which is what an ordinary `yak`
// command does.
//
// A composed host lends its runner and registry. A caller that lends only a
// tool list gets the transport's generic tier beside those plugin tools.

import type { Graph, NamedTool } from '@yaks/graph'
import type { Reply, Runner } from '@yaks/tools'
import { generic } from '@yaks/graph/tools'
import { graphDoc } from '@yaks/graph/vocab'
import { SESSION } from '@yaks/session'
import type { Authenticate, Route } from '@yaks/api'
import { mcp } from './mount.ts'
import { attachSkills } from './skills.ts'
import type { Search } from './tools.ts'

/** The path an agent speaks to. */
export let PATH = '/mcp'

/** What this facet reads off the host it is composing into: the graph its
 * tools read and write, who that host says is calling, the tools it assembled,
 * the ranked search its vocabulary may or may not have earned, and what a
 * direct call is owed beside its answer. */
export type Hosting = {
  config: { name?: string }
  graph: Graph
  who: Authenticate
  tools: NamedTool[]
  runner?: Runner
  search?: Search
  reply?: Reply
}

/** `/mcp`: one JSON-RPC request in, one reply out. */
export let routes = (host: Hosting): Route[] => {
  let tier = new Set(generic)
  let handle = mcp({
    graph: host.graph,
    runner: host.runner,
    sessions: host.graph.vocab.comp(SESSION) ? host.graph : undefined,
    authenticate: host.who,
    tools: host.tools.filter((t) => !tier.has(t.name)),
    search: host.search,
    reply: host.reply,
    name: host.config.name ?? 'yak',
    skills: (built, exchange) =>
      attachSkills(built, { graph: host.graph, cwd: Deno.cwd() }, exchange),
    instructions: [graphDoc, ...host.graph.vocab.docs].map((doc) =>
      doc.instructions?.trim()
    )
      .filter((line): line is string => !!line).join('\n\n'),
  })
  return [{ method: '*', path: PATH, handle }]
}
