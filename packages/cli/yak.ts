// The `yak` command. It knows four verbs of its own — `help`, `login`,
// `logout`, `apply` — and everything else arrives through a PLUGIN
// (plugin.ts): a table of verbs contributed at boot, rendered by one usage
// beside these. Two ride here — the server's own tools (platform.ts) and the
// apps' commands (commands.ts) — and a box that has more, like the account
// verbs an owner's checkout carries, adds them by calling `main` with a longer
// list.
//
//   yak app_list
//   yak app_files --app recipes --path index.html --content @index.html
//   yak recipes add_recipe title='Lemon cake' serves=4
//   cat bundles.ndjson | yak apply
//
// The platform plugin is why there is no list of tools in this package: it
// reads `tools/list` at run time, so the CLI cannot drift from the connector
// an agent is talking to, and a tool a release adds is a subcommand the day it
// ships without anybody publishing this package again.
//
// Exit codes are the contract a script reads: 0 said, 1 the tool or the door
// refused, 2 the command line was wrong.

import { argsFor, type Reads, saidIn, Usage } from './args.ts'
import { bundlesIn, chunks } from './apply.ts'
import { commands } from './commands.ts'
import {
  type Ctx,
  helpFor,
  parts,
  type Plugin,
  usage,
  type Verb,
  verbFor,
} from './plugin.ts'
import { platform, printed, rosterOf } from './platform.ts'
import { doorUrl, rpc, timed } from './rpc.ts'
import type { Result } from './roster.ts'
import { safe } from './show.ts'
import { forgetToken, saveToken, tokenFor } from './store.ts'

/** The platform this command talks to unless told otherwise. */
export let HOST = 'yaks.app'

let out = (line: string) => console.log(safe(line))
let note = (line: string) => console.error(safe(line))

let reads: Reads = {
  file: (path) => Deno.readTextFile(path),
  stdin: () => new Response(Deno.stdin.readable).text(),
}

/** The flags this program keeps for itself, lifted out of the line before a
 * verb ever sees it. */
export let globals = (
  argv: string[],
): {
  host: string
  json: boolean
  help: boolean
  timing: boolean
  rest: string[]
} => {
  let host = Deno.env.get('YAKS_HOST') ?? HOST
  let json = false
  let help = false
  // A whole shell asks for the timing line with YAKS_TIMING=1; one command
  // asks with the flag.
  let timing = Deno.env.get('YAKS_TIMING') == '1'
  let rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    if (a == '--json') json = true
    else if (a == '--help' || a == '-h') help = true
    else if (a == '--timing') timing = true
    else if (a == '--host') host = argv[++i] ?? host
    else if (a.startsWith('--host=')) host = a.slice(7)
    else rest.push(a)
  }
  return { host, json, help, timing, rest }
}

let HEAD = 'yak — the tools this server lists, and the verbs this box adds'

let TAIL = `  --host <host>   which server (default $YAKS_HOST, else ${HOST})
  --json          print the structured result instead of the words
  --timing        a line on stderr per answer, with its Server-Timing
                  (or YAKS_TIMING=1)
  --help          this, or a verb's own

A value that is @path is that file, and - is stdin. $YAKS_TOKEN is the
bearer when it is set; otherwise the one \`yak login\` wrote.`

let page = async (c: Ctx): Promise<string> =>
  [HEAD, '', usage(await parts(c.plugins, c)), '', TAIL].join('\n')

// `apply` is graph_apply with a door for a stream: a batch is atomic, and a
// file of bundles is a load rather than one batch, so it goes over in chunks.
let applied = async (c: Ctx): Promise<number> => {
  let roster = await rosterOf(c.host, c.ask)
  let tool = roster.tools.find((t) => t.name == 'graph_apply')
  if (!tool) throw new Usage(`${c.host} lists no graph_apply to apply through`)
  let { opts } = saidIn(c.args)
  if (opts.some(([n]) => n == 'change')) {
    let said = await c.ask('tools/call', {
      name: tool.name,
      arguments: await argsFor(tool, c.args, reads),
    }) as Result
    return printed(c, roster, tool.name, said)
  }
  let source = c.args.find((a) => !a.startsWith('--')) ?? '-'
  let body = source == '-' || source == '@-'
    ? await c.reads.stdin()
    : await c.reads.file(source.replace(/^@/, ''))
  let code = 0
  for (let change of chunks(bundlesIn(body))) {
    let said = await c.ask('tools/call', {
      name: tool.name,
      arguments: { change },
    }) as Result
    code = printed(c, roster, tool.name, said) || code
    if (code) break
  }
  return code
}

/** The command's own four words, which shadow a verb any plugin names. */
export let built: Plugin = {
  name: 'yak',
  about: 'the command itself',
  verbs: (): Verb[] => [
    {
      name: 'help',
      args: '[verb]',
      about: 'every verb, one line each — or one verb’s own page',
      run: async (c) => {
        if (!c.args[0]) {
          c.out(await page(c))
          return 0
        }
        let v = await verbFor(c.plugins, c, c.args[0])
        if (!v) throw new Usage(`nothing here is called ${c.args[0]}`)
        c.out(await helpFor(v, c))
        return 0
      },
    },
    {
      name: 'login',
      args: '<token>',
      about: 'remember a bearer for this host',
      run: (c) => {
        if (!c.args[0]) throw new Usage('yak login <token>')
        c.out(`bearer for ${c.host} kept in ${saveToken(c.host, c.args[0])}`)
        return 0
      },
    },
    {
      name: 'logout',
      about: 'forget it',
      run: (c) => {
        forgetToken(c.host)
        c.out(`forgot the bearer for ${c.host}`)
        return 0
      },
    },
    {
      name: 'apply',
      args: '[@file]',
      about: 'bundles as NDJSON, in batches of 50',
      run: applied,
    },
  ],
}

/** What a plain install carries, in precedence order. The apps' commands come
 * before the tools because one of those tools is `command` itself: the raw one
 * takes the app's arguments as a JSON object, and the verb here takes them the
 * way a person types them. */
export let PLUGINS: Plugin[] = [built, commands, platform]

/** Run one command line. Answers the exit code. */
export let run = async (
  argv: string[],
  plugins: Plugin[] = PLUGINS,
): Promise<number> => {
  let { host, json, help, timing, rest } = globals(argv)
  let [word, ...args] = rest
  let c: Ctx = {
    host,
    word: word ?? '',
    args,
    json,
    help,
    ask: rpc({
      url: doorUrl(host),
      token: tokenFor(host),
      fetch: timing ? timed(note) : undefined,
    }),
    reads,
    out,
    note,
    plugins,
  }
  // The one thing that must work with no network and nobody signed in.
  if (!word) {
    out(await page(c))
    return 0
  }
  let verb = await verbFor(plugins, c, word)
  if (!verb) {
    throw new Usage(`${host} has nothing called ${word} — try \`yak help\``)
  }
  if (help) {
    out(await helpFor(verb, c))
    return 0
  }
  return await verb.run(c)
}

/** One line, from argv to an exit code — the refusal printed on the way. */
export let main = async (
  argv: string[],
  plugins: Plugin[] = PLUGINS,
): Promise<number> => {
  try {
    return await run(argv, plugins)
  } catch (e) {
    note(`yak: ${(e as Error).message}`)
    return e instanceof Usage ? 2 : 1
  }
}

if (import.meta.main) Deno.exit(await main(Deno.args))
