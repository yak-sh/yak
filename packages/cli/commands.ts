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

import { pairsIn, saidIn, Usage } from './args.ts'
import type { Ctx, Plugin, Verb } from './plugin.ts'
import { printed } from './platform.ts'
import type { Result } from './roster.ts'

// One `command` call: the app is named only where two apps spell the same
// command, so an empty one is left off the wire entirely.
let called = async (
  c: Ctx,
  app: string,
  name: string,
  words: string[],
): Promise<number> => {
  let said = await c.ask('tools/call', {
    name: 'command',
    arguments: {
      name,
      ...(app ? { app } : {}),
      args: await pairsIn(words, c.reads),
    },
  }) as Result
  return printed(c, null, 'command', said)
}

let HELP = `yak command <name> [--app <app>] [key=value ...]
yak <app> <name> [key=value ...]

  One of an app's own commands, run as the person calling it. \`yak commands\`
  lists them with the arguments each one takes; --app names which app when two
  of them spell one command.

  A value is JSON where it parses as JSON, so serves=4 is a number and
  tags='["cake"]' is a list. @path is that file's text and - is stdin.`

let verb: Verb = {
  name: 'command',
  args: '<name> [key=value ...]',
  about: 'run one of an app’s own commands',
  help: () => HELP,
  run: (c) => {
    let { opts, words } = saidIn(c.args)
    let [name, ...rest] = words
    if (!name) throw new Usage('yak command <name> [key=value ...]')
    let app = opts.find(([n]) => n == 'app')?.[1]
    return called(c, app === true ? '' : app ?? '', name, rest)
  },
}

/** The apps' commands, as verbs of this command. */
export let commands: Plugin = {
  name: 'commands',
  about: 'the apps’ own commands',
  verbs: () => [verb],
  // `yak <app> <command>`: only ever reached when no table named the word, so
  // a tool of the same name always wins and a typo says what it says today.
  stray: (c) => {
    let [name, ...rest] = c.args
    if (!name || name.startsWith('-')) return undefined
    return {
      name: c.word,
      about: `a command of the ${c.word} app`,
      run: () => called(c, c.word, name, rest),
    }
  },
}
