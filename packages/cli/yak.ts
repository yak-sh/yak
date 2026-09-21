// The `yak` command. It knows five words of its own — `help`, `login`,
// `logout`, `serve`, `apply` — and everything else arrives as TOOLS: the ones
// of the graph this line opens (local.ts) or the ones a door lists
// (platform.ts), with the apps' commands (commands.ts) beside them. Either
// table costs something to gather, so run.ts asks for it only on a line that
// reaches past the five.
//
//   yak app_list
//   yak app_files --app recipes --path index.html --content @index.html
//   yak recipes add_recipe title='Lemon cake' serves=4
//   cat bundles.ndjson | yak apply
//
//   yak --config yak.json task list   # opens that graph, runs it, exits
//   yak land                          # the same, on the checkout you stand in
//   yak serve --config yak.json       # the HTTP doors onto the same graph
//
// THERE IS NO SERVER. A config names a GRAPH — a SQLite file and the plugins
// that speak over it — and a `yak` line opens it, composes them, runs the tool
// in this process and exits. WAL takes as many writers as there are lines, so
// nothing waits on a process somebody had to start. `--host` is for a graph
// this box cannot open as a file, and then the line talks to that door over
// `/mcp`; `yak serve` is the process that answers one.
//
// The door's table is why there is no list of tools in this package: it reads
// `tools/list` at run time, so the CLI cannot drift from the connector an
// agent is talking to, and a tool a release adds is a subcommand the day it
// ships without anybody publishing this package again.
//
// Exit codes are the contract a script reads: 0 said, 1 the tool or the door
// refused, 2 the command line was wrong.

import { Usage } from './args.ts'
import { bundlesIn, chunks } from './apply.ts'
import { appStray, appTools } from './commands.ts'
import { cli, type Command, type Ctx, helpTool, type Opts } from './run.ts'
import { configPath } from './config.ts'
import { listed } from './platform.ts'
import { forgetToken, saveToken } from './store.ts'

/** The platform this command talks to where it opens no graph of its own. */
export let HOST = 'yaks.app'

let HEAD = 'yak — the tools of the graph this line runs against'

let TAIL =
  `  --config <path> the config naming the graph to OPEN — its db and its
                  plugins, composed in this process (default $YAK_CONFIG)
  --host <host>   a graph to talk to over /mcp instead, for one this box
                  cannot open as a file (default $YAKS_HOST, else ${HOST})
  --json          print the structured result instead of the words
  --timing        a line on stderr per answer, with its Server-Timing
                  (or YAKS_TIMING=1)
  --help          this, or one command's own

A value that is @path is that file, and - is stdin. $YAKS_TOKEN is the
bearer when it is set; otherwise the one \`yak login\` wrote.`

// `apply` is graph_apply with a door for a stream: a batch is atomic, and a
// file of bundles is a load rather than one batch, so it goes over in chunks.
// It runs the SAME `graph_apply` every other line runs — the one the graph
// this line opened implements, or the one the door it named lists — so a load
// goes wherever the rest of the session went.
let applied = async (
  args: Record<string, unknown>,
  c: Ctx,
): Promise<number> => {
  let tool = (await c.all()).find((t) => t.name == 'graph_apply')
  if (!tool) {
    throw new Usage(`${c.config ?? c.host} has no graph_apply to apply through`)
  }
  // A dry run is the tool's `check`: every phase runs and the transaction is
  // rolled back, so the answer is what would have landed.
  let dry = args['dry-run'] === true
  let asked = (change: unknown) =>
    tool.run({ change, ...(dry ? { check: true } : {}) }, c)
  if (args.change) return await asked(args.change)
  // The BODY, already: `@path` is that file and `-` is stdin for every value
  // on every line (args.ts `inflate`), so what arrives here is the bundles
  // themselves. A line that said nothing at all means stdin.
  let body = typeof args.file == 'string' ? args.file : await c.reads.stdin()
  let code = 0
  for (let change of chunks(bundlesIn(body))) {
    code = await asked(change) || code
    if (code) break
  }
  return code
}

// The graph this line opened, where it opened one. Imported only on a line
// that named a config, because importing it drags in a database driver and
// every plugin the config names — `yak login` on a box with no graph at all
// must not pay for that, and neither must a line aimed at a door.
let local: typeof import('./local.ts') | undefined

// The table this line's tools come from: the graph a config names, opened
// here, or the door the line named.
let table = async (c: Ctx): Promise<Command[]> =>
  c.config ? (local ??= await import('./local.ts')).commands(c) : listed(c)

// `serve` is the HTTP doors and nothing else: one config, the plugins it
// names, and what @yaks/api and @yaks/mcp mount over the graph they compose.
let served = async (args: Record<string, unknown>, c: Ctx): Promise<number> => {
  let { read, serve } = await import('./serve.ts')
  let path = configPath(
    typeof args.config == 'string' ? args.config : c.config,
  )
  let config = path ? read(path) : {}
  if (typeof args.db == 'string') config.db = args.db
  if (args.port != null) config.port = Number(args.port)
  let { host, server } = await serve(
    config,
    (addr, host) =>
      c.note(
        `yak serve — http://${addr.hostname}:${addr.port} · ${config.db}` +
          ` · ${host.tools.length} tools`,
      ),
  )
  await server.finished
  await host.close(0)
  return 0
}

/** What a plain `yak` is, besides its tools. */
export let YAK: Opts = {
  name: 'yak',
  about: HEAD,
  notes: TAIL,
  host: HOST,
  more: table,
  stray: appStray,
}

/** The command's own five words, which shadow a tool any table names. */
export let own: Command[] = [
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
    name: 'serve',
    description: 'the doors onto the graph a config composes',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        config: {
          type: 'string',
          description: 'the config file (default $YAK_CONFIG)',
        },
        db: { type: 'string', description: 'the graph, over the config' },
        port: { type: 'number', description: 'what to listen on' },
      },
    },
    options: { positional: ['config'] },
    run: served,
  },
  {
    name: 'apply',
    description:
      'bundles as NDJSON, in batches of 50; --dry-run says what would land ' +
      'and writes none of it',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        file: { type: 'string', description: '@file, or - for stdin' },
        change: { type: 'array', description: 'one batch, inline' },
        'dry-run': {
          type: 'boolean',
          description: 'answer what would land, and write none of it',
        },
      },
    },
    options: { positional: ['file'] },
    destructive: true,
    run: applied,
  },
]

/** What a plain install carries, in precedence order. The apps' commands come
 * after this command's own and before the graph's tools, because one of those
 * tools is `command` itself: the raw one takes the app's arguments as a JSON
 * object, and the one here takes them the way a person types them. */
export let TOOLS: Command[] = [...own, ...appTools]

/** One line, from argv to an exit code — the refusal printed on the way. A
 * box with commands of its own passes them, and they shadow everything here.
 * Whatever graph the line opened is let go when it is done, and the code the
 * line answers is what its `process` row records as its ending. */
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

if (import.meta.main) Deno.exit(await main(Deno.args))
