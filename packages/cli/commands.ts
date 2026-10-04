// Remote tools and apps' commands use the same grammar as local commands.
// The outer command keeps only its selector flags; the receiving schema is
// fetched before the remaining words are parsed by argsFor.
import { valueIn } from '@yaks/tools/value'
import type { Bundle } from '@yaks/graph'
import { argsFor, type Grammar, type Reads, Usage } from './args.ts'
import type { Command, Ctx } from './run.ts'
import { printed } from './platform.ts'
import { Refused, type Rpc } from './rpc.ts'
import { type Result, saidBy } from './roster.ts'
import { type Listed, type Schema, spelling } from './tool.ts'

type AppCommand = {
  name: string
  at: string
  input: Schema
  positional?: Grammar['positional']
}

/** Fetch a tool's schema, parse its words with the CLI grammar, and call it.
 * Connector tools take precedence over the commands of reachable apps. The
 * caller supplies the RPC door, so login and admin account selection share
 * this whole path. */
export let toolCall = async (
  ask: Rpc,
  name: string,
  words: string[],
  o: { app?: string; reads?: Reads } = {},
): Promise<Result> => {
  let listed = await ask('tools/list') as { tools: Listed[] }
  let tool = listed.tools.find((t) => t.name == name)
  if (tool) {
    let args = await argsFor(
      { name, ...spelling(tool) },
      [...words, ...o.app ? ['--app', o.app] : []],
      o.reads,
    )
    return await ask('tools/call', { name, arguments: args }) as Result
  }
  let answer = await ask('tools/call', {
    name: 'commands',
    arguments: o.app ? { app: o.app } : {},
  }) as Result
  if (answer.isError) throw new Refused(saidBy(answer).text)
  let result = (answer.structuredContent as { result?: Bundle[] } | undefined)
    ?.result
  let commands = result && valueIn(result)?.commands as AppCommand[] | undefined
  if (!Array.isArray(commands)) {
    throw new Refused('commands returned no command schemas')
  }
  let found = commands.filter((t) => t.name == name)
  if (!found.length) throw new Usage(`No tool or app command named ${name}`)
  if (found.length > 1) {
    throw new Usage(
      `${name} is in ${
        found.map((t) => t.at).join(', ')
      } — choose one with --app`,
    )
  }
  let command = found[0]
  let args = await argsFor(
    { name, inputSchema: command.input, positional: command.positional },
    words,
    o.reads,
  )
  return await ask('tools/call', {
    name: 'command',
    arguments: { name, app: command.at, args },
  }) as Result
}

let called = async (
  c: Ctx,
  given: Record<string, unknown>,
  app?: string,
): Promise<number> => {
  let answer = await toolCall(
    c.ask,
    String(given.name),
    (given.args ?? []) as string[],
    {
      app: app ?? given.app as string | undefined,
      reads: c.reads,
    },
  )
  return printed(c, null, 'command', answer)
}

let ABOUT = `Run a connector tool or one of an app's own commands. ` +
  `--as selects an owner's yaks.app connection by its whole address or the part before @; ` +
  `\`yak connection list <owner>\` lists connections (owner id or name); use a yaks.app entry’s account. ` +
  `Without it, use your own email, else the oldest connection. ` +
  `Connector tools come first; \`yak commands\` lists app commands and their schemas. ` +
  `Use positionals and --flags; --app chooses an app when two share a command. ` +
  `Values follow the schema's types; @path reads a file and - reads stdin.`

let schema = (app: boolean): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', description: 'the tool or app command to run' },
    ...(app ? { app: { type: 'string', description: 'which app' } } : {}),
    args: {
      type: 'array',
      items: { type: 'string' },
      description: 'the command’s arguments',
    },
  },
})

/** Remote tools and apps' commands, as subcommands of this program. */
export let appTools: Command[] = [{
  name: 'command',
  title: 'run a remote tool or app command',
  description: ABOUT,
  inputSchema: schema(true),
  positional: ['name'],
  forward: 'args',
  run: (args, c) => called(c, args),
}]

/** `yak <app> <command>`: only reached when no subcommand matched the first
 * word, so a tool of the same name always wins. */
export let appStray = (app: string, args: string[]): Command | undefined => {
  let name = args[0]
  if (!name || name.startsWith('-')) return undefined
  return {
    name: app,
    title: `a command of the ${app} app`,
    description: ABOUT,
    inputSchema: schema(false),
    positional: ['name'],
    forward: 'args',
    run: (given, c) => called(c, given, app),
  }
}
