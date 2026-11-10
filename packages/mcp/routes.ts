import * as io from '@yaks/file/io'
import * as system from '@yaks/process/system'
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

import type { Bundle, Graph, NamedTool } from '@yaks/graph'
import type { Reply, Runner } from '@yaks/tools'
import { generic } from '@yaks/graph/tools'
import { graphDoc } from '@yaks/graph/vocab'
import { SESSION } from '@yaks/session'
import type { Authenticate, Handler, Offers, Route, Told } from '@yaks/api'
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
  /** the tools a request is offered, where the link it came through narrows
   * them (@yaks/host `Host.offers`) */
  offers?: Offers
  /** what a request is told before this server's own instructions, where the
   * link it came through says so (@yaks/host `Host.told`) */
  told?: Told
  /** The process serving the host, whose own writes come through it. */
  me?: string
  tools: NamedTool[]
  runner?: Runner
  search?: Search
  reply?: Reply
  /** a tool's answer as this host's views draw it, sent to a request that
   * asks for it (@yaks/api/address `TEXT`) */
  text?: (
    answer: Bundle[],
    tool: { readOnly?: boolean; page?: boolean },
  ) => Promise<string>
}

// The handler, made by the first request to `/mcp`: a server listens before
// any agent has asked.
let mounted = async (host: Hosting): Promise<Handler> => {
  let [{ mcp }, { attachSkills }] = await Promise.all([
    import('./mount.ts'),
    import('./skills.ts'),
  ])
  let tier = new Set(generic)
  return mcp({
    graph: host.graph,
    runner: host.runner,
    sessions: host.graph.vocab.comp(SESSION) ? host.graph : undefined,
    authenticate: host.who,
    offers: (request) => host.offers?.(request),
    told: host.told,
    me: host.me,
    tools: host.tools.filter((t) => !tier.has(t.name)),
    search: host.search,
    reply: host.reply,
    text: host.text,
    readFile: (path) => io.readTextFile(path),
    name: host.config.name ?? 'yak',
    skills: (built, exchange) =>
      attachSkills(built, { graph: host.graph, cwd: system.cwd() }, exchange),
    instructions: [graphDoc, ...host.graph.vocab.docs].map((doc) =>
      doc.instructions?.trim()
    )
      .filter((line): line is string => !!line).join('\n\n'),
  })
}

/** `/mcp`: one JSON-RPC request in, one reply out. */
export let routes = (host: Hosting): Route[] => {
  let made: Promise<Handler> | undefined
  // A handler that failed to import is imported again by the next request.
  let handler = () =>
    made ??= mounted(host).catch((error) => {
      made = undefined
      throw error
    })
  return [{
    method: '*',
    path: PATH,
    handle: async (request) => (await handler())(request),
    says: "the graph's tools for agents, over MCP",
  }]
}
