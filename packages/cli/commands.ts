// The apps' own verbs, on this command line. An app declares COMMANDS rather
// than tools (workers/yak `tools.ts`, T-34541) — the tool list is the same for
// everybody and must never move, so two fixed tools carry the lot: `commands`
// says what there is and `command` runs one. That is a fine shape for an agent
// and a poor one to type, so this plugin gives them the two spellings a person
// reaches for:
//
//   yak command add_recipe --app recipes title='Lemon cake' serves=4
//   yak recipes add_recipe title='Lemon cake' serves=4
//
// The second is the STRAY: a first word no table named, with a word after it,
// is an app and its command. It cannot be a verb in the table, because the
// apps a person can reach are not known until something asks — and asking on
// every line is the round trip this client exists to avoid.
//
// The arguments are the APP's, not this program's, so they are `key=value`
// words rather than `--name value` options. That is also what keeps `--app`,
// `--json` and `--host` unambiguous beside them: everything before the `=` is
// somebody else's vocabulary.

import type { Ctx, Word } from './run.ts'
import { printed } from './platform.ts'
import type { Result } from './roster.ts'

// One `command` call: the app is named only where two apps spell the same
// command, so an empty one is left off the wire entirely.
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
  `lists them with the arguments each one takes; --app names which app when ` +
  `two of them spell one command. A value is JSON where it parses as JSON, ` +
  `so serves=4 is a number and tags='["cake"]' is a list; @path is that ` +
  `file's text and - is stdin.`

// The arguments are the APP's, not this program's, so they arrive as the
// `rest` of the line — `key=value` words rather than `--name value` options.
// That is also what keeps `--app`, `--json` and `--host` unambiguous beside
// them: everything before the `=` is somebody else's vocabulary.
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

let verb: Word = {
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

/** The apps' commands, as tools of this command. */
export let appTools: Word[] = [verb]

/** `yak <app> <command>`: only ever reached when no table named the word, so a
 * tool of the same name always wins and a typo says what it says today. */
export let appStray = (
  app: string,
  args: string[],
): Word | undefined => {
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
