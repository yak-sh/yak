// The apps' own commands, on this command line. An app declares commands
// rather than tools (workers/yak `tools.ts`, T-34541) — the tool list is the
// same for everybody and must never change per user, so two fixed tools carry
// all of them: `commands` lists what an app has and `command` runs one. That
// works well for an agent and badly for a person typing, so this module adds
// the two forms a person reaches for:
//
//   yak command add_recipe --app recipes title='Lemon cake' serves=4
//   yak recipes add_recipe title='Lemon cake' serves=4
//
// The second is the fallback (run.ts `stray`): a first word no subcommand
// matched, with another word after it, is an app name and one of its commands.
// It cannot be a subcommand in the list, because which apps a person can reach
// is not known until something asks — and asking on every command line is the
// round trip this client exists to avoid.
//
// The arguments belong to the app, not to this program, so they are
// `key=value` words rather than `--name value` options. That is also what
// keeps `--app`, `--json` and `--host` unambiguous beside them: anything
// before an `=` belongs to somebody else's vocabulary.

import type { Command, Ctx } from './run.ts'
import { printed } from './platform.ts'
import type { Result } from './roster.ts'

// One `command` call: the app is named only where two apps have a command of
// the same name, so an empty app name is left out of the request entirely.
let called = async (
  c: Ctx,
  app: string,
  name: string,
  args: Record<string, unknown>,
): Promise<number> => {
  let said = await c.ask('tools/call', {
    name: 'command',
    arguments: { name, ...(app ? { app } : {}), args },
  }) as Result
  return printed(c, null, 'command', said)
}

let ABOUT =
  `Run one of an app's own commands, as the person calling it. \`yak commands\` ` +
  `lists them with the arguments each one takes; --app says which app when ` +
  `two of them have a command of the same name. A value is parsed as JSON ` +
  `where it parses as JSON, so serves=4 is a number and tags='["cake"]' is a ` +
  `list; @path is read from that file and - from stdin.`

// The arguments belong to the app, not to this program, so they arrive as the
// `rest` of the command line — `key=value` words rather than `--name value`
// options. That is also what keeps `--app`, `--json` and `--host` unambiguous
// beside them: anything before an `=` belongs to somebody else's
// vocabulary.
let schema = (app: boolean): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', description: 'the command to run' },
    ...(app ? { app: { type: 'string', description: 'which app' } } : {}),
    args: { type: 'object', description: 'the command’s own arguments' },
  },
})

let verb: Command = {
  name: 'command',
  title: 'run one of an app’s own commands',
  description: ABOUT,
  inputSchema: schema(true),
  options: { positional: ['name'], rest: 'args' },
  run: (args, c) =>
    called(
      c,
      typeof args.app == 'string' ? args.app : '',
      String(args.name),
      (args.args ?? {}) as Record<string, unknown>,
    ),
}

/** The apps' commands, as subcommands of this program. */
export let appTools: Command[] = [verb]

/** `yak <app> <command>`: only reached when no subcommand matched the first
 * word, so a tool of the same name always wins, and a typo produces the same
 * error message it produces today. */
export let appStray = (
  app: string,
  args: string[],
): Command | undefined => {
  let name = args[0]
  if (!name || name.startsWith('-')) return undefined
  return {
    name: app,
    title: `a command of the ${app} app`,
    description: ABOUT,
    inputSchema: schema(false),
    options: { positional: ['name'], rest: 'args' },
    run: (given, c) =>
      called(
        c,
        app,
        String(given.name),
        (given.args ?? {}) as Record<string, unknown>,
      ),
  }
}
