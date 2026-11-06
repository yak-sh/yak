import * as system from '@yaks/process/system'
import * as disk from '@yaks/file/io'
// What the `yak` command (./yak.ts) runs. It has built-in subcommands — `help`, `work`, `restart`, `init`,
// `auth`, `apply` — and other subcommands are graph tools (local.ts),
// an MCP server's tools (platform.ts), plugin terminal controls, or an app's
// own commands (commands.ts). Either
// list costs something to gather, so run.ts asks for it only when the
// built-in subcommands did not match.
//
// `serve` is one of those tools, not one of these four: @yaks/api declares it
// and implements it, and a config that names that package as a plugin is a
// config whose graph can be served.
//
//   yak app_list
//   yak app_files --app recipes --path index.html --content @index.html
//   yak recipes add_recipe --title 'Lemon cake' --serves 4
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
import { closeAccounts, personal } from './accounts.ts'
import { configPath, names, ownConfig, read } from './config.ts'
import { naming, personOf, refreshed, starter } from './init.ts'
import { command as launchCommand } from '@yaks/process/command'
import * as held from './held.ts'
import { restorable } from './restore.ts'
import { pinned } from './release.ts'
import { unitFailureCommand } from './unit_failure.ts'

/** The platform this command talks to when it opens no graph of its own. */
export let HOST = 'yaks.app'

let HEAD = 'yak — the tools of the graph this command runs against'

let TAIL =
  `  --config <path> the config file naming the graph to open: its db and
                  its plugins, imported in this process (default $YAK_CONFIG)
  --host <host>   an MCP server to call over /mcp instead, for a graph this
                  machine cannot open as a file (default $YAKS_HOST, else
                  ${HOST})
  --as <account>  select an owner's yaks.app connection by its whole address
                  or the part before @; list them with
                  \`yak connection list <owner>\` (owner id or name), and use
                  a yaks.app entry’s account.
                  Default is your own email, else the oldest connection.
                  A tool's own as argument is written as=<value>.
  --json          print the structured result instead of the text
  --tui           hold the answer in the terminal, scrollable, until Ctrl-C
  --timing        one line on stderr per response, with its Server-Timing
                  (or YAKS_TIMING=1)
  --no-duties     run no inline effects or services; serve still monitors
                  and restores independent workers for uncovered duty roles
  --help         this page, or one subcommand's own
  --version       the @yaks/cli release this is

An argument value written @path is read from that file, and - is read from
stdin. $YAKS_TOKEN is the bearer token when set; otherwise the selected
yaks.app connection supplies it. Sign in with \`yak auth yaks.app\`.`

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
  let asked = (bundles: unknown) =>
    tool.run({ bundles, ...(dry ? { check: true } : {}) }, c)
  if (args.bundles) return await asked(args.bundles)
  // This is already the body: `@path` is read from that file and `-` from
  // stdin for every argument value of every subcommand (args.ts `inflate`), so
  // what arrives here is the bundles themselves. Given no argument at all,
  // read stdin.
  let body = typeof args.file == 'string' ? args.file : await c.reads.stdin()
  let code = 0
  for (let bundles of chunks(bundlesIn(body))) {
    code = await asked(bundles) || code
    if (code) break
  }
  return code
}

// The code that lists a graph's subcommands (./subcommands.ts) and the code
// that opens one (./local.ts) are each imported by the first command that
// needs them, and by no other: the workspace runs with `lazy-dynamic-imports`
// (deno.json), because without it Deno walks every module a literal
// `import('./local.ts')` reaches as the program starts, whichever branch the
// run then takes.
let local = () => import('./local.ts')

// Where this command's tools come from: the graph a config names, opened here,
// or the MCP server the command named.
let table = async (
  c: Ctx,
  o?: { fresh?: boolean },
): Promise<Command[]> => {
  let commands = c.config
    ? await (await import('./subcommands.ts')).commands(c)
    : await listed(c, o)
  return commands.map((command) =>
    command.name == 'graph_apply'
      ? restorable(command, async (args, c) => (await local()).restore(args, c))
      : command
  )
}

/** What `yak` itself is, besides the tools it lists. */
export let YAK: Opts = {
  name: 'yak',
  about: HEAD,
  version: pinned['@yaks/cli'],
  notes: TAIL,
  globalFlags: [
    'as',
    'json',
    'host',
    'config',
    'timing',
    'tui',
    'no-duties',
    'help',
    'version',
  ],
  host: HOST,
  nowhere: 'no graph on this machine yet: `yak init` starts one, ' +
    'and `yak auth yaks.app` signs in to your yaks.app apps',
  more: table,
  stray: appStray,
}

// `init` is the one command that runs before there is a graph: it writes the
// config a machine's own graph starts from (./init.ts) and makes the person
// who works there, so what they type is signed as them from the first command.
// It asks for nothing: the person is named from git's `user.name`, or else the
// login user, and confirming that name is the graph's first task, filed to
// them, which any agent that connects finds and asks them about. It never
// replaces a config unless forced: one already there is somebody's graph. A
// forced one is rewritten at this release with its graph and person kept, the
// old file saved beside it.
let init = async (
  args: Record<string, unknown>,
  c: Ctx,
): Promise<number> => {
  let path = c.config ?? system.env.get('YAK_CONFIG') ?? ownConfig()
  if (!path) {
    throw new Usage('no $HOME to keep a config in — name one with --config')
  }
  let dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.'
  let graph = (db: string) => db.startsWith('/') ? db : `${dir}/${db}`
  let old: Record<string, unknown> | undefined
  try {
    old = JSON.parse(disk.readTextFileSync(path))
  } catch (error) {
    if (!(error instanceof disk.errors.NotFound)) throw error
  }
  if (old && !args.force) {
    c.note(
      `${path} already exists, and yak init never replaces a config. ` +
        'yak init --force rewrites it for this release, keeping your graph.',
    )
    return 1
  }
  // A forced init never loses the config it replaces.
  let saved = old && `${path}.${new Date().toISOString().replaceAll(':', '-')}`
  if (saved) disk.copyFileSync(path, saved)
  if (old?.person) {
    let { config, replaced } = refreshed(old)
    disk.writeTextFileSync(path, JSON.stringify(config, null, 2) + '\n')
    c.out(
      `Rewrote ${path} for yak ${pinned['@yaks/cli']}. ` +
        `Your graph (${graph(config.db!)}) and your person are kept.`,
    )
    for (let line of replaced) c.out(`Replaced ${line}`)
    c.out(`The old config is at ${saved}.`)
    return 0
  }
  let person = crypto.randomUUID()
  let name = await whose()
  disk.mkdirSync(dir, { recursive: true })
  try {
    disk.writeTextFileSync(
      path,
      JSON.stringify(starter(person), null, 2) + '\n',
      { createNew: !old },
    )
  } catch (error) {
    if (!(error instanceof disk.errors.AlreadyExists)) throw error
    c.note(`${path} already exists, and yak init never replaces a config.`)
    return 1
  }
  try {
    let { opened } = await local()
    let host = await opened(path, ['graph'], false)
    await host.graph.apply([
      personOf(person, name),
      naming(person, name),
    ])
  } catch (error) {
    // A config naming a person its graph never made is worse than none: the
    // next `yak init` could not replace it.
    disk.removeSync(path)
    throw error
  }
  c.out(`Wrote ${path}. Your graph is ${graph(starter(person).db!)}.`)
  c.out(
    name
      ? `You are ${name}. If that is wrong, run: yak name "Your Name"`
      : 'No name was found for you. Run: yak name "Your Name"',
  )
  if (saved) c.out(`The old config is at ${saved}.`)
  c.out('Next: yak task list, then yak serve')
  return 0
}

// The name the person at this machine already goes by: git's `user.name`,
// else the login user, else none.
let whose = async (): Promise<string | undefined> => {
  try {
    let { code, stdout } = await launchCommand('git', {
      args: ['config', '--get', 'user.name'],
      stdout: 'piped',
      stderr: 'null',
    }).output()
    let name = new TextDecoder().decode(stdout).trim()
    if (code == 0 && name) return name
  } catch {
    // no git on this machine
  }
  return system.env.get('USER') || system.env.get('USERNAME') || undefined
}

// `name` renames the person who works in this machine's graph: their
// `doc.title`, which is how what they type is signed.
let rename = async (args: Record<string, unknown>, c: Ctx): Promise<number> => {
  let path = configPath(c.config)
  if (!path) {
    throw new Usage('no graph on this machine yet: `yak init` starts one')
  }
  let name = String(args.name ?? '').trim()
  if (!name) throw new Usage('yak name <your name>')
  let eid = read(path).person
  if (!eid) throw new Usage(`${path} names no person`)
  let { opened } = await local()
  let host = await opened(path, ['graph'], false)
  await host.graph.apply([{ entity: { eid }, doc: { title: name } }])
  c.out(`you are ${name}`)
  return 0
}

/** The command's built-in subcommands, which shadow a tool of the same name
 * from either list. */
export let own: Command[] = [
  unitFailureCommand,
  helpTool(YAK),
  {
    name: 'version',
    description: 'the @yaks/cli release this is',
    inputSchema: { type: 'object', additionalProperties: false },
    readOnly: true,
    run: (_, c) => (c.out(YAK.version!), 0),
  },
  {
    name: 'work',
    description: 'Run the effects pool and plugin services without the web',
    offered: (c) => names(c.config, 'processes'),
    inputSchema: {
      type: 'object',
      properties: {
        ready: { type: 'string', description: 'Readiness file' },
        process: {
          type: 'string',
          description: 'Configured process unit name',
        },
        tethered: {
          type: 'boolean',
          description: 'Exit when stdin closes: the requesting process ended',
        },
        roles: {
          type: 'string',
          description: 'Only these comma-separated duties',
        },
      },
    },
    run: async (args, c) => {
      let path = c.config ?? ownConfig()
      if (!path) throw new Usage('yak work needs --config')
      let ready = typeof args.ready == 'string' ? args.ready : undefined
      let roles = typeof args.roles == 'string'
        ? args.roles.split(',')
        : undefined
      await (await local()).work(
        path,
        ready,
        roles,
        args.tethered === true,
        typeof args.process == 'string' ? args.process : undefined,
      )
      return 0
    },
  },
  {
    name: 'restart',
    description:
      "Queue a ready-first handover of the box's workers and webs in the background",
    offered: (c) => names(c.config, 'processes'),
    inputSchema: {
      type: 'object',
      properties: {
        handover: {
          type: 'boolean',
          description: 'Run the supervised handover',
        },
      },
    },
    run: async (args, c) => {
      let runtimeDir = system.env.get('XDG_RUNTIME_DIR')
      if (!runtimeDir) throw new Usage('yak restart needs $XDG_RUNTIME_DIR')
      let { restart, queueRestart } = await import('./restart.ts')
      let path = configPath(c.config)
      if (!args.handover) {
        let { launching } = await import('./release.ts')
        let { runtimeSource } = await import('./runtime.ts')
        // The units run the checkout's command, never this command's private
        // copy of it (./runtime.ts), which goes once nothing runs from it.
        let source = (path: string) =>
          runtimeSource(new URL(path, import.meta.url).href)
        let launch = [
          system.execPath(),
          'run',
          '-A',
          '--config',
          await launching(
            () => disk.makeTempDir({ dir: runtimeDir, prefix: 'yak-restart-' }),
            source('./release.ts'),
          ),
          source('./yak.ts'),
        ]
        c.out(
          await queueRestart(
            launch,
            path
              ? new URL(path, `file://${system.cwd()}/`).pathname
              : undefined,
          ),
        )
        return 0
      }
      c.out(
        await restart({
          runtimeDir,
          processes: path ? read(path).processes : undefined,
        }),
      )
      return 0
    },
  },
  {
    name: 'init',
    description:
      "start this machine's own graph: write its config and make you its person",
    offered: (c) => !c.config,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        force: {
          type: 'boolean',
          description:
            'rewrite an existing config for this release, keeping its graph and person',
        },
      },
    },
    run: init,
  },
  {
    name: 'name',
    description:
      "rename yourself, the person who works in this machine's graph",
    offered: (c) => !!configPath(c.config),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          description: 'your name, as the graph knows you',
        },
      },
    },
    positional: ['name'],
    run: rename,
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
        bundles: {
          type: 'array',
          description: 'one batch of bundles, inline',
        },
        'dry-run': {
          type: 'boolean',
          description: 'report what would be written, and write none of it',
        },
      },
    },
    positional: ['file'],
    destructive: true,
    run: applied,
  },
]

/** What a plain install carries, in precedence order. The apps' commands come
 * after this command's built-ins and before the graph's tools, because one of
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
    let { configPath } = await import('./config.ts')
    if (
      argv.includes('auth') && !configPath() &&
      !argv.some((a) => a == '--config' || a.startsWith('--config='))
    ) {
      let path = await personal()
      argv = ['--config', path, ...argv]
    }
    return code = await cli([...extra, ...TOOLS], {
      ...YAK,
      argv,
    })
  } finally {
    await held.close(code)
    await closeAccounts()
  }
}
