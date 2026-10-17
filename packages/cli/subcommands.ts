// The tools of the graph a config names that are offered on a command line,
// as the subcommands a person types: the list `cli` gathers when the command
// named a config (run.ts `more`). They are read off the plugins' words
// (./words.ts) and their terminal controls (`./cli`), so listing them opens
// nothing and loads none of the code that opens a graph: a usage page, a help
// page and a mistyped word cost a command no more than the declarations. The
// one a command line runs imports that code then (./local.ts).

import { type Config, read, subpath } from './config.ts'
import type { CliFacet } from './host.ts'
import { type Declarations, declarations } from './declarations.ts'
import { prepare } from './prepare.ts'
import type { Command, Ctx } from './run.ts'
import { traceCommand } from './trace_control.ts'

/** What a listing read before any graph was open: the config, its plugins'
 * words, and the terminal controls each plugin's `./cli` holds, beside the
 * plugin it came from. */
export type Listing = {
  config: Config
  said: Declarations
}

/** The subcommands of the graph `c.config` names: `yak trace`, its plugins'
 * terminal controls, then every tool it offers on a command line. */
export let commands = async (c: Ctx): Promise<Command[]> => {
  let config = read(c.config!)
  let said = await declarations(config, true)
  let listing: Listing = { config, said }
  let local = (
    command: Pick<Command, 'name' | 'roles'>,
    selected?: readonly [plugin: string, facet: 'cli' | 'tools'],
  ) => prepare(config, command, selected, !c.json)
  let tools = said.tools.map((declared) => ({
    ...declared,
    globals: said.controls.find(({ plugin }) =>
      plugin == said.owners[declared.name]
    )?.value?.globals?.[declared.name],
    // A tool arrives declaring its arguments as JSON Schema — the same
    // document `tools/list` sends — so a command typed against a local graph
    // and the same command typed against an MCP server are written
    // identically. Nothing is converted here: a transport that wants them in
    // another form restates them on its own side (@yaks/mcp `core`).
    run: async (args: Record<string, unknown>): Promise<number> => {
      let plugin = said.owners[declared.name]
      let control = said.controls.find((v) => v.plugin == plugin)?.value
      if (control?.tools?.includes(declared.name)) {
        let cli = await subpath<CliFacet>(plugin, 'cli')
        let code = await cli?.tools?.[declared.name]?.(args, c)
        if (code !== undefined) return code
      }
      return (await local(declared)).tool(c, declared, args, listing)
    },
  }))
  let controls: Command[] = said.controls.flatMap(({ plugin, value }) =>
    (value?.commands ?? []).map((declared, i) => ({
      ...declared,
      run: async (args: Record<string, unknown>, context: Ctx) => {
        let ready = await local(declared, [plugin, 'cli'])
        let control = (await subpath<CliFacet>(plugin, 'cli'))!.commands![i]
        return ready.control(
          context,
          declared,
          control.run,
          args,
          listing,
        )
      },
    }))
  )
  return [traceCommand(config), ...controls, ...tools]
}
