// A graph tool, asked of the `yak serve` already running over the graph a
// command's config names. That server holds the whole read path loaded and
// warm, and answers in milliseconds what a command opening the graph itself
// spends half a second importing (./local.ts). Its `/mcp` is the door every
// agent's MCP tools already use, so a command and an MCP call run the same
// tool through the same runner. The answer is drawn here, with this config's
// own vocabulary and views, exactly as a command that opened the graph draws
// it (./terminal.ts `shown`): the server's own account of its words is never
// needed, so no cached copy of it can be stale.
//
// Nothing has to be running: a command no server answers opens the graph
// itself, as it always could. The server is found at the address its config
// says it listens on (@yaks/api/address), and every request names the graph
// file it means. Only a server serving that file says it back, so an answer
// from one listening there for another graph (a copy's config naming the same
// port), or from one too old to say, is not taken for this graph's.
//
// A command runs here only where the server can run it exactly as this
// process would:
//
// - its tool declares no role beyond the graph (`serve` listens; a tool
//   naming a plugin's role runs in that role's process);
// - it is not held in this terminal (`--tui`);
// - it reads, or it speaks for a session: the server signs a session's writes
//   as that session (`x-via`, local.ts `signer`), and a line typed at a
//   keyboard with none, which this process signs as the config's person,
//   writes from here.
//
// Only a call the server never began is run again here: no server, one
// serving another graph, or one whose code predates the tool (an unknown
// tool). Once a call is under way, what the server says is the answer, and a
// connection lost during it is an error, never a second run.

import type { Bundle } from '@yaks/graph'
import { DB, served } from '@yaks/api/address'
import { type Config, pluginViews, used } from './config.ts'
import { type Declared, words } from './words.ts'
import { doorUrl, Refused, type Rpc, rpc } from './rpc.ts'
import type { Ctx } from './run.ts'
import { type Result, saidBy } from './roster.ts'

// JSON-RPC's invalid params, which an MCP server answers an unknown tool with
// before running anything.
let UNKNOWN = -32602

/** Whether the server for `config` may run `declared` for this line. */
export let warmable = (
  c: Pick<Ctx, 'tui' | 'via'>,
  config: Pick<Config, 'db'>,
  declared: Pick<Declared, 'roles' | 'readOnly'>,
): boolean =>
  !!config.db && config.db != ':memory:' && !c.tui &&
  !declared.roles?.some((role) => role != 'graph') &&
  (!!declared.readOnly || !!c.via)

/** `declared`, run by the server serving `config`'s graph and printed:
 * the exit code, or undefined where no such server began it. */
export let warm = async (
  c: Ctx,
  config: Config,
  declared: Declared,
  args: Record<string, unknown>,
  fetch?: (request: Request) => Response | Promise<Response>,
): Promise<number | undefined> => {
  if (!warmable(c, config, declared)) return
  let host = served(config)
  let go = fetch ?? ((request: Request) => globalThis.fetch(request))
  // The response to the request last sent, once one came: whether it said
  // this graph's file back is whether this graph's server answered.
  let last: Response | undefined
  let ours = () => last?.headers.get(DB) == config.db
  let ask = rpc({
    url: doorUrl(host),
    via: c.via,
    headers: { [DB]: config.db! },
    fetch: async (request) => {
      last = undefined
      return last = await go(request)
    },
  })
  // A ping runs nothing, so whatever becomes of it, nothing has run yet.
  try {
    await ask('ping')
  } catch {
    return
  }
  if (!ours()) return
  let said: Result
  try {
    said = await ask('tools/call', {
      name: declared.name,
      arguments: args,
    }) as Result
  } catch (error) {
    if (last && !ours()) return
    if (error instanceof Refused && error.code == UNKNOWN) return
    throw error
  }
  return await printed(c, config, declared, said, ask)
}

// The bundles a reply answers with, which every tool whose answer is entities
// sends under `structuredContent.result` (@yaks/mcp `answerSchema`).
let bundles = (said: Result): Bundle[] | undefined => {
  let result = (said.structuredContent as { result?: unknown } | undefined)
    ?.result
  return Array.isArray(result) ? result : undefined
}

// A reply printed as the command would have printed the answer had it run the
// tool itself (./local.ts `tool`): `--json` as the data, entities through the
// views, a refusal's exit code 1. A reply with no entities is its text.
let printed = async (
  c: Ctx,
  config: Config,
  declared: Declared,
  said: Result,
  ask: Rpc,
): Promise<number> => {
  let code = said.isError ? 1 : 0
  let answer = bundles(said)
  if (c.json && said.structuredContent !== undefined) {
    c.out(JSON.stringify(said.structuredContent, null, 2))
    return code
  }
  if (!answer) {
    let { text } = saidBy(said)
    if (text) (code ? c.note : c.out)(text)
    return code
  }
  let plugins = (config.plugins ?? []).map(used)
  let [{ vocab }, { registry }, { shown }] = await Promise.all([
    words(config),
    import('./answer.ts'),
    import('./terminal.ts'),
  ])
  let asked = (name: string, args: Record<string, unknown>) =>
    ask('tools/call', { name, arguments: args })
      .then((r) => bundles(r as Result) ?? [], () => [])
  await shown(
    c,
    plugins,
    await registry(plugins, pluginViews),
    vocab,
    answer,
    {
      lookup: (ids) => asked('graph_show', { ids }),
      query: (q) => asked('graph_query', { q }),
    },
    declared,
  )
  return code
}
