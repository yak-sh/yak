// The `yak` command. It knows four words of its own — `help`, `login`,
// `logout`, `apply` — and everything else arrives as more TOOLS: the apps'
// commands (commands.ts) sit beside them in the list, and the server's own
// tools (platform.ts) are the table that costs a round trip, so run.ts asks
// for them only on a line that reaches them.
//
//   yak app_list
//   yak app_files --app recipes --path index.html --content @index.html
//   yak recipes add_recipe title='Lemon cake' serves=4
//   cat bundles.ndjson | yak apply
//
// The platform table is why there is no list of tools in this package: it
// reads `tools/list` at run time, so the CLI cannot drift from the connector
// an agent is talking to, and a tool a release adds is a subcommand the day it
// ships without anybody publishing this package again.
//
// Exit codes are the contract a script reads: 0 said, 1 the tool or the door
// refused, 2 the command line was wrong.

import { Usage } from './args.ts'
import { bundlesIn, chunks } from './apply.ts'
import { appStray, appTools } from './commands.ts'
import { cli, type Ctx, helpTool, type Opts, type Word } from './run.ts'
import { listed, printed, rosterOf } from './platform.ts'
import type { Result } from './roster.ts'
import { forgetToken, saveToken } from './store.ts'

/** The platform this command talks to unless told otherwise. */
export let HOST = 'yaks.app'

let HEAD = 'yak — the tools this server lists, and the words this box adds'

let TAIL = `  --host <host>   which server (default $YAKS_HOST, else ${HOST})
  --json          print the structured result instead of the words
  --timing        a line on stderr per answer, with its Server-Timing
                  (or YAKS_TIMING=1)
  --help          this, or a word's own

A value that is @path is that file, and - is stdin. $YAKS_TOKEN is the
bearer when it is set; otherwise the one \`yak login\` wrote.`

// `apply` is graph_apply with a door for a stream: a batch is atomic, and a
// file of bundles is a load rather than one batch, so it goes over in chunks.
let applied = async (
  args: Record<string, unknown>,
  c: Ctx,
): Promise<number> => {
  let roster = await rosterOf(c.host, c.ask)
  let tool = roster.tools.find((t) => t.name == 'graph_apply')
  if (!tool) throw new Usage(`${c.host} lists no graph_apply to apply through`)
  if (args.change) {
    let said = await c.ask('tools/call', {
      name: tool.name,
      arguments: { change: args.change },
    }) as Result
    return printed(c, roster, tool.name, said)
  }
  let source = typeof args.file == 'string' ? args.file : '-'
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

/** What a plain `yak` is, besides its tools. */
export let YAK: Opts = {
  name: 'yak',
  about: HEAD,
  notes: TAIL,
  host: HOST,
  more: listed,
  stray: appStray,
}

/** The command's own four words, which shadow a tool any table names. */
export let own: Word[] = [
  helpTool(YAK),
  {
    name: 'login',
    description: 'remember a bearer for this host',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['token'],
      properties: { token: { type: 'string' } },
    },
    options: { positional: ['token'] },
    run: (args, c) => {
      c.out(
        `bearer for ${c.host} kept in ${saveToken(c.host, String(args.token))}`,
      )
      return 0
    },
  },
  {
    name: 'logout',
    description: 'forget it',
    inputSchema: { type: 'object', additionalProperties: false },
    run: (_args, c) => {
      forgetToken(c.host)
      c.out(`forgot the bearer for ${c.host}`)
      return 0
    },
  },
  {
    name: 'apply',
    description: 'bundles as NDJSON, in batches of 50',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        file: { type: 'string', description: '@file, or - for stdin' },
        change: { type: 'array', description: 'one batch, inline' },
      },
    },
    options: { positional: ['file'] },
    destructive: true,
    run: applied,
  },
]

/** What a plain install carries, in precedence order. The apps' commands come
 * after this command's own words and before the server's tools, because one of
 * those tools is `command` itself: the raw one takes the app's arguments as a
 * JSON object, and the word here takes them the way a person types them. */
export let TOOLS: Word[] = [...own, ...appTools]

/** One line, from argv to an exit code — the refusal printed on the way. A
 * box with words of its own passes them, and they shadow everything here. */
export let main = (
  argv: string[],
  extra: readonly Word[] = [],
): Promise<number> => cli([...extra, ...TOOLS], { ...YAK, argv })

if (import.meta.main) Deno.exit(await main(Deno.args))
