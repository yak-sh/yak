// The routes facet, exported as `@yaks/mcp/routes`: `/mcp` as one route on a
// host's own listener.
//
// This server is a path, not a process. A host whose config names this package
// answers JSON-RPC at `/mcp`, through whatever is serving its routes
// (@yaks/api) — so a config that names neither serves no HTTP and still runs
// every one of these tools in its own process, which is what an ordinary `yak`
// command does.
//
// The generic tier is shaped twice on purpose. A host holds it as the
// vocabulary declares it (@yaks/graph `tier`), which is the JSON Schema a
// command line parses; this transport restates the same tools in the form it
// accepts (`core: true`), which is what gives `graph_apply` the bundle schema
// this graph's own vocabulary describes. The host's copies are dropped from
// the list rather than registered a second time under the same names.

import type { Graph, NamedTool } from '@yaks/graph'
import { generic } from '@yaks/graph/tools'
import type { Authenticate, Route } from '@yaks/api'
import { mcp } from './mount.ts'
import type { Search } from './tools.ts'

/** The path an agent speaks to. */
export let PATH = '/mcp'

/** What this facet reads off the host it is composing into: the graph its
 * tools read and write, who that host says is calling, the tools it assembled,
 * and the ranked search its vocabulary may or may not have earned. */
export type Hosting = {
  config: { name?: string }
  graph: Graph
  who: Authenticate
  tools: NamedTool[]
  search?: Search
}

/** `/mcp`: one JSON-RPC request in, one reply out. */
export let routes = (host: Hosting): Route[] => {
  let tier = new Set(generic)
  let handle = mcp({
    graph: host.graph,
    authenticate: host.who,
    tools: host.tools.filter((t) => !tier.has(t.name)),
    search: host.search,
    name: host.config.name ?? 'yak',
  })
  return [{ method: '*', path: PATH, handle }]
}
