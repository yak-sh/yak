// The `yak` command. It has four subcommands of its own — `help`, `login`,
// `logout`, `apply` — and every other subcommand is a tool: one of the tools
// of the graph this command opens (local.ts), or one an MCP server lists
// (platform.ts), with the apps' own commands (commands.ts) beside them. Either
// list costs something to gather, so run.ts asks for it only when the four
// built-in subcommands did not match.
//
// `serve` is one of those tools, not one of these four: @yaks/api declares it
// and implements it, and a config that names that package as a plugin is a
// config whose graph can be served.
//
//   yak app_list
//   yak app_files --app recipes --path index.html --content @index.html
//   yak recipes add_recipe title='Lemon cake' serves=4
//   cat bundles.ndjson | yak apply
//
//   yak --config yak.json task list   # opens that graph, runs the tool, exits
//   yak land                          # the same, on the checkout you are in
//   yak serve --config yak.json       # the same, for a tool that stays up
//
// There is no server process to start. A config file names a graph — a SQLite
// file and the plugins that read and write it — and a `yak` command opens it,
// imports them, runs the tool in this process and exits. SQLite in WAL mode
// accepts as many writers as there are commands running, so nothing waits on a
// daemon somebody had to start. `--host` is for a graph this machine cannot
// open as a file, and then the command talks to that machine's MCP server at
// `/mcp`; `yak serve` is the process that answers one.
//
// Reading the server's tool list at run time is why this package contains no
// list of tools: the CLI cannot drift from the MCP server an agent is talking
// to, and a tool a release adds becomes a subcommand the day it ships without
// anybody publishing this package again.
//
// Exit codes are the contract a script reads: 0 succeeded, 1 the tool or the
// server refused, 2 the command line was wrong.

import { Usage } from './args.ts'
import { bundlesIn, chunks } from './apply.ts'
import { appStray, appTools } from './commands.ts'
import { cli, type Command, type Ctx, helpTool, type Opts } from './run.ts'
import { listed } from './platform.ts'
import { forgetToken, saveToken } from './store.ts'

/** The platform this command talks to when it opens no graph of its own. */
export let HOST = 'yaks.app'

let HEAD = 'yak — the tools of the graph this command runs against'

let TAIL =
  `  --config <path> the config file naming the graph to OPEN — its db and
                  its plugins, imported in this process (default $YAK_CONFIG)
  --host <host>   an MCP server to call over /mcp instead, for a graph this
                  machine cannot open as a file (default $YAKS_HOST, else
                  ${HOST})
  --json          print the structured result instead of the text
  --tui           hold the answer in the terminal, scrollable, until Ctrl-C
  --timing        one line on stderr per response, with its Server-Timing
                  (or YAKS_TIMING=1)
  --no-duties     take no lease and run no duty — the effect sweep, the
                  plugins' services — in the graph this opens
  --help         this page, or one subcommand's own

An argument value written @path is read from that file, and - is read from
stdin. $YAKS_TOKEN is the bearer token when set; otherwise the one
\`yak login\` saved.`

// `apply` is `graph_apply` fed from a stream. One batch is applied in one
// transaction, and a file of fifty thousand bundles is a bulk load rather than
// one transaction, so it is sent in chunks. It calls the same `graph_apply`
// every other subcommand would — the one implemented by the graph this command
// opened, or the one the MCP server it named lists — so a load goes wherever
// the rest of the session went.
let applied = async (
  args: Record<string, unknown>,
  c: Ctx,
): Promise<number> => {
  let tool = (await c.all()).find((t) => t.name == 'graph_apply')
  if (!tool) {
    throw new Usage(`${c.config ?? c.host} has no graph_apply to apply through`)
  }
  // A dry run is the tool's `check`: every phase runs and the transaction is
  // rolled back, so the result is what would have been written.
  let dry = args['dry-run'] === true
  let asked = (change: unknown) =>
    tool.run({ change, ...(dry ? { check: true } : {}) }, c)
  if (args.change) return await asked(args.change)
  // This is already the body: `@path` is read from that file and `-` from
  // stdin for every argument value of every subcommand (args.ts `inflate`), so
  // what arrives here is the bundles themselves. Given no argument at all,
  // read stdin.
  let body = typeof args.file == 'string' ? args.file : await c.reads.stdin()
  let code = 0
  for (let change of chunks(bundlesIn(body))) {
    code = await asked(change) || code
    if (code) break
  }
  return code
}

// The graph this command opened, when it opened one. Imported only when the
// command named a config, because importing it pulls in a database driver and
// every plugin the config names — `yak login` on a machine with no graph at
// all must not pay for that, and neither must a command aimed at an MCP
// server.
let local: typeof import('./local.ts') | undefined

// Where this command's tools come from: the graph a config names, opened here,
// or the MCP server the command named.
let table = async (c: Ctx): Promise<Command[]> =>
  c.config ? (local ??= await import('./local.ts')).commands(c) : listed(c)

/** What `yak` itself is, besides the tools it lists. */
export let YAK: Opts = {
  name: 'yak',
  about: HEAD,
  notes: TAIL,
  host: HOST,
  more: table,
  stray: appStray,
}

/** The command's own four subcommands, which shadow a tool of the same name
 * from either list. */
export let own: Command[] = [
  helpTool(YAK),
  {
    name: 'login',
    description: 'save a bearer token for this host',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['token'],
      properties: { token: { type: 'string' } },
    },
    options: { positional: ['token'] },
    run: (args, c) => {
      c.out(
        `bearer token for ${c.host} saved in ${
          saveToken(c.host, String(args.token))
        }`,
      )
      return 0
    },
  },
  {
    name: 'logout',
    description: 'forget the saved bearer token',
    inputSchema: { type: 'object', additionalProperties: false },
    run: (_args, c) => {
      forgetToken(c.host)
      c.out(`forgot the bearer token for ${c.host}`)
      return 0
    },
  },
  {
    name: 'apply',
    description:
      'apply bundles read as NDJSON, in transactions of 50; --dry-run ' +
      'reports what would be written and writes none of it',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        file: { type: 'string', description: '@file, or - for stdin' },
        change: {
          type: 'array',
          description: 'one batch of bundles, inline',
        },
        'dry-run': {
          type: 'boolean',
          description: 'report what would be written, and write none of it',
        },
      },
    },
    options: { positional: ['file'] },
    destructive: true,
    run: applied,
  },
]

/** What a plain install carries, in precedence order. The apps' commands come
 * after this command's own four and before the graph's tools, because one of
 * those tools is `command` itself: the graph's version takes the app's
 * arguments as a JSON object, and the one here takes them the way a person
 * types them. */
export let TOOLS: Command[] = [...own, ...appTools]

/** One command line, from argv to an exit code, printing any refusal on the
 * way. A program with subcommands of its own passes them in, and they shadow
 * everything here. Whatever graph the command opened is closed when it is
 * done, and the exit code it returns is what its `process` row records as its
 * ending. */
export let main = async (
  argv: string[],
  extra: readonly Command[] = [],
): Promise<number> => {
  let code = 1
  try {
    return code = await cli([...extra, ...TOOLS], { ...YAK, argv })
  } finally {
    await local?.close(code)
  }
}

// Not a top-level await: this module is also `@yaks/cli` itself (./mod.ts), so
// a plugin the command loads that imports the package would wait on this
// module finishing, while this module waits on the command.
if (import.meta.main) main(Deno.args).then(Deno.exit)
