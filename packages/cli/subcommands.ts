// The tools of the graph a config names that are offered on a command line,
// as the subcommands a person types: the list `cli` gathers when the command
// named a config (run.ts `more`). They are read off the plugins' words
// (./words.ts) and their terminal controls (`./cli`), so listing them opens
// nothing and loads none of the code that opens a graph: a usage page, a help
// page and a mistyped word cost a command no more than the declarations. The
// one a command line runs imports that code then (./local.ts).

import { offered } from '@yaks/graph'
import { type Config, read, used } from './config.ts'
import { facet, type Words, words } from './words.ts'
import type { Command, Ctx } from './run.ts'
import type { CliFacet } from './host.ts'
import { traceCommand } from './trace_control.ts'

/** What a listing read before any graph was open: the config, its plugins'
 * words, and the terminal controls each plugin's `./cli` holds, beside the
 * plugin it came from. */
export type Listing = {
  config: Config
  said: Words
  loaded: { plugin: string; value: CliFacet | null }[]
}

/** The subcommands of the graph `c.config` names: `yak trace`, its plugins'
 * terminal controls, then every tool it offers on a command line. */
export let commands = async (c: Ctx): Promise<Command[]> => {
  let config = read(c.config!)
  let said = await words(config)
  let plugins = (config.plugins ?? []).map(used)
  await facet.together?.(plugins.map((p) => [p, 'cli'] as const))
  let loaded = await Promise.all(
    plugins.map(async (plugin) => ({
      plugin,
      value: await facet(plugin, 'cli'),
    })),
  )
  let listing: Listing = { config, said, loaded }
  let local = () => import('./local.ts')
  let tools = said.tools().filter(offered('cli')).map((declared) => ({
    ...declared,
    // A tool arrives declaring its arguments as JSON Schema — the same
    // document `tools/list` sends — so a command typed against a local graph
    // and the same command typed against an MCP server are written
    // identically. Nothing is converted here: a transport that wants them in
    // another form restates them on its own side (@yaks/mcp `core`).
    run: async (args: Record<string, unknown>): Promise<number> =>
      (await local()).tool(c, declared, args, listing),
  }))
  let controls: Command[] = loaded.flatMap(({ value }) => value?.commands ?? [])
    .map(({ run, ...declared }) => ({
      ...declared,
      run: async (args, context) =>
        (await local()).control(context, declared, run, args, listing),
    }))
  return [traceCommand(config), ...controls, ...tools]
}
