# @yaks/cli

`@yaks/cli` provides `yak`, a command-line client for a
[@yaks/graph](../graph/README.md), and the functions that assemble a graph from
a JSON config file. A graph stores entities. Each entity has a stable ID and
components, which are named objects containing properties. A bundle is one
entity's components represented as a JSON object; it can describe the entity's
current state or a change to it. A batch is a list of changes applied in one
transaction.

```sh
deno run -A --minimum-dependency-age=0 jsr:@yaks/cli/install

yak init Ada                    # Start this machine's own graph, as Ada.
yak --config yak.json task list # Open a local graph, run a tool, and exit.
yak land                        # Run a tool against the selected graph.
yak serve --config yak.json     # Run that graph's serve tool: HTTP.
yak app_list                    # Call a tool on the selected MCP server.
```

A tool is an operation declared by a graph, with a name, an input schema, and an
implementation. `yak` turns each tool in the selected graph into a subcommand.
Its arguments and help come from the tool's input schema, so a new tool does not
require a new CLI release.

`yak` provides five commands itself: `help`, `init`, `login`, `logout`, and
`apply`. Its other commands come from either a graph opened in the current
process or an MCP server queried at run time. `yak serve` is one of those tools
rather than a command of this package: [@yaks/api](../api/README.md) declares
and implements it, so a config listing that package is a config whose graph can
be served.

The package has two main responsibilities:

- [`host.ts`](./host.ts) opens the graph a config names for the roles a process
  serves, importing only those roles' facets of the configured plugins. It
  serves no HTTP of its own: the request handler is built by the listed plugin
  that hosts routes, which is @yaks/api.
- [`platform.ts`](./platform.ts) lists and calls tools on a remote MCP server.
  [`local.ts`](./local.ts) exposes the same command interface for a graph opened
  by the current process.

## Roles

A plugin says what it contributes, one facet per subpath, and never where it
runs. A process serves roles, and imports only the facets of the roles it
serves:

| Role            | Facets                          | What the process does                          |
| --------------- | ------------------------------- | ---------------------------------------------- |
| `graph`         | `./vocab`, `./rules`, `./tools` | opens the file, admits writes, runs tool calls |
| `web`           | `./routes`                      | answers HTTP with the routes @yaks/api hosts   |
| `effects`       | `./effects`                     | claims and runs what commits owe, in a pool    |
| a plugin's name | that plugin's `./service`       | keeps that plugin's timer or poll running      |

The `yak` command serves commands and rendering itself. Listing its commands
reads only the plugins' `./vocab`, where the tools are declared, so the usage
page opens nothing. Running one opens the graph for that command's roles: the
graph and the roles the tool declares (`serve` declares `web`). The duty roles,
the effect pool and each plugin's service, run beside it in a thread of the same
process where no live process serves them (see Duties). The rendering role
imports `./views`, and `./tui` under `--tui`.

## Where a command runs

A host is a process that opens and runs a graph. A config file describes a local
graph: its SQLite database, plugins, and host settings. A command that selects a
config opens that graph in its own process, runs the requested tool, and exits.
It does not require `yak serve`. SQLite uses WAL mode for file-backed graphs,
allowing separate CLI and server processes to share the database.

`--host` has a different meaning on the command line: it selects a remote
hostname or origin whose MCP endpoint is `/mcp`. A bare hostname uses HTTPS.
`--host` and `--config` cannot be used together because they select different
graphs.

The CLI chooses its target in this order:

| Input             | Target                                               |
| ----------------- | ---------------------------------------------------- |
| `--config <path>` | The local graph described by that config             |
| `--host <host>`   | The remote MCP server at `<host>/mcp`                |
| `$YAKS_HOST`      | The remote MCP server named by the variable          |
| `$YAK_CONFIG`     | The local graph described by the variable            |
| `~/.yak/yak.json` | The local graph described by this file, if it exists |
| None of the above | `https://yaks.app/mcp`                               |

A config named on the line is the one place that line means. A config found
through `$YAK_CONFIG` or at `~/.yak/yak.json` is only first in the order: a
command its graph does not have is asked of the host next, so `yak app_list`
reaches yaks.app from a machine that keeps a graph of its own.

Local and remote tool invocations both create a call entity and run it through
`@yaks/tools`. Tool calls made by people and agents therefore use the same
validation, rules, effects, attribution, and stored record. Their answers are
shown the same way too: through the views of the packages that declared the
components, where this machine has them. A remote server's vocabulary, and the
package behind each component, come from its `graph_schema`, asked once and
cached beside its tool list; a reply that carries no entities prints as its
text. CLI-only commands such as `help`, `init`, `login`, `logout`, and `apply`
use their own command implementations.

## The config

`yak init <your name>` starts a machine's own graph: it writes `~/.yak/yak.json`
(or the path `--config` names) with the plugins a graph, its tasks, sessions,
`/mcp` and the web canvas need, and makes you the graph's `person`. It never
replaces a config that is already there.

A config is plain JSON, so a plugin is one more line. Pass another with
`--config`, or set `$YAK_CONFIG`. This one adds @yaks/mail, with its options:

```json
{
  "db": "graph.db",
  "plugins": [
    "@yaks/kernel",
    "@yaks/id",
    "@yaks/secrets",
    "@yaks/doc",
    "@yaks/effects",
    "@yaks/tools",
    "@yaks/task",
    "@yaks/api",
    {
      "use": "@yaks/mail",
      "with": {
        "domain": "books.example",
        "sender": {
          "via": "cloudflare",
          "account": "a1b2",
          "token": { "secret": "CF_EMAIL_TOKEN" }
        }
      }
    }
  ],
  "numbers": true,
  "port": 8787
}
```

Relative database paths and plugin specifiers are resolved relative to the
config file.

| Field      | Meaning                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `db`       | SQLite path or `:memory:`. Required unless `$DB_PATH` is set.                                     |
| `plugins`  | Package specifiers, optionally paired with plugin-specific options.                               |
| `port`     | Port the `serve` tool listens on; defaults to `@yaks/api`'s `PORT`.                               |
| `hostname` | Network interface used by `serve`; defaults to `@yaks/api`'s `HOSTNAME`, `127.0.0.1`.             |
| `numbers`  | Enables short entity numbers. `{ "except": [...] }` excludes entities carrying named components.  |
| `adopt`    | Preserves incoming entity numbers instead of minting new ones. Intended for store imports.        |
| `name`     | MCP server name; defaults to `yak`.                                                               |
| `person`   | Who works at this machine, as any id the graph resolves; a command typed at a terminal is theirs. |
| `lease`    | Duty lease and effect-run claim duration in milliseconds; defaults to `30000` and `60000`.        |
| `duties`   | Whether this process runs its duties; defaults to `true`.                                         |

There is no default database path. `compose` throws unless `db` or `$DB_PATH` is
present.

### What a config passes to one plugin

A plugin entry is either a package specifier or an object with `use` and `with`
fields. Each exported plugin factory receives `(host, options)`. The host
contains the config, vocabulary, database connection, secrets vault, blob store,
store, graph, request handler, tool runner, duties, process entity, request
authentication function, and shutdown signal. An entry without `with` receives
an empty object. Option keys belong to the plugin.

The vault is where [@yaks/secrets](../secrets) keeps what is written through the
graph: one private file per secret in a `secrets` directory beside the database
(`~/.yak/secrets` for `~/.yak/yak.db`), or memory for a graph in memory.
`fileVault` and `vaultOf` ([vault.ts](./vault.ts)) are exported for code that
opens a graph without `compose`.

At any depth in `with`, an object containing only `{ "secret": "NAME" }` reads
that secret when the property is accessed: the value in the vault, the 1Password
value it is bound to, or else the environment variable `NAME`. This keeps
secrets out of the JSON file and lets a long-running plugin observe a value
supplied after startup. A secret nobody supplied produces `undefined`; the
plugin decides how to handle it.

Plugin factories may omit functionality when configuration is unavailable. Any
diagnostic behavior, including a `check` tool, belongs to the plugin; the CLI
does not impose a startup policy for missing plugin options.

## A plugin is a package, and each part of it is a subpath export

A facet is a sub-module export: one optional plugin subpath that supplies a
specific part of the running graph. `compose(config, roles)` imports, from each
configured package, the facets of the roles the process serves and no others. An
unexported facet is skipped; an exported facet that fails to import causes
composition to fail. A package that exports none of a process's facets
contributes nothing to that process.

```json
{
  "name": "@yaks/mail",
  "exports": {
    ".": "./mod.ts",
    "./vocab": "./vocab.ts",
    "./rules": "./rules.ts",
    "./effects": "./effects.ts",
    "./routes": "./routes.ts"
  }
}
```

| Subpath     | Role       | Expected exports                                                                        |
| ----------- | ---------- | --------------------------------------------------------------------------------------- |
| `./vocab`   | `graph`    | `docs?`, `keywords?`, and `derived?` declarations                                       |
| `./rules`   | `graph`    | `rules?: (host, options) => Plugin[]`, query `extend?`, and at most one `authenticate?` |
| `./tools`   | `graph`    | `runs?: (host, options) => Runs`, keyed by declared tool name                           |
| `./effects` | `effects`  | `effects?: (host, options) => Handlers`, keyed by declared effect name                  |
| `./routes`  | `web`      | `routes?: (host, options) => Route[]`, `filter?`, and at most one `handler?`            |
| `./service` | its plugin | `service?: (host, options, signal)` for a duty                                          |
| `.`         |            | Public types and library functions; not loaded by `compose`                             |

The web UI separately imports `./vocab` and `./views`, and `yak` imports
`./views` to show a tool's answer. Those modules must work in a browser and must
not import SQL, storage drivers, or server-only APIs. `deno task check:browser`
verifies this constraint. `compose` does not load `./views`: drawing is the
rendering role, which needs no graph open.

`@yaks/mail`, as `compose` reads it:

```ts
import { docs } from '@yaks/mail/vocab'
import { rules } from '@yaks/mail/rules'
import { runs } from '@yaks/mail/tools'

// Its options are its entry in yak.json.
let options = { domain: 'books.example' }
docs // [mailDoc]
rules({}, options) // [mailbox({ domain: 'books.example' })]
Object.keys(runs({}, options)) // the tools it runs, by name
```

### A tool that acts on the machine

Some tools change the machine running them instead of only changing the graph.
For example, `land` updates a checkout, `hooks install` writes a settings file,
and `serve` binds a TCP port. The call such a tool is handed carries
`process{pid, command, cwd}` (@yaks/process), the program that executes the
call, and `cwd` is its working directory. A locally opened graph uses the
directory where the user ran `yak`; a remote call uses the server process's
directory.

A tool that declines a call throws `CallError`. The runner records the error,
and `yak` returns exit code `1`.

Factories can retain `host.storage`, `host.graph`, `host.handler`,
`host.runner`, and `host.duties`, but must not access them before
initialization. In particular, `rules.extend` runs before the store exists. A
route is an `@yaks/api` `Route` with `method`, `path`, and a
`(Request) => Response` handler. Paths are exact unless they end in `*`; `*`
also matches any method.

A process serving `web` answers requests only where a listed plugin exports
`handler` from `./routes`. @yaks/api is that plugin: it is handed the host once
`host.routes` holds every listed plugin's routes, and returns them in front of
`/apply`, `/query` and `/ws`, which answer whatever no route claimed. A config
that does not list it composes a host with no `handler`, no `serve` tool, and no
call to any plugin's `routes` factory — the routes are ignored rather than built
for a listener that does not exist. `/mcp` is the same arrangement one level
down: @yaks/mcp contributes it as a route, so a config that wants an agent's
door lists that package too.

Routes that write should use `host.who(request)` and `signed` from `@yaks/api`
to attribute their changes. `authenticate` belongs to `./rules`, because every
door asks it, a command line naming its session as much as an HTTP request, and
at most one plugin may export it. Without an authenticated caller, writes are
attributed to the host process.

## Who a process writes as, and what starting up IS

Every command, server, or TUI that opens a graph, and every thread of one that
does, creates its own process entity:

```text
process{pid, command, cwd} ...and exit{code} when it closes
```

Writes without an explicit actor are attributed to that process. Authenticated
requests are attributed to the authenticated identity. On shutdown, `close()`
records the exit and releases the process's leases in one transaction.

Creating the process entity also provides the startup event: a plugin can
declare an effect `created: ["process"]`, and whichever process works the pool
runs it; there is no separate `./boot` facet. Start-up work that must run in the
process that started holds a lease instead.

## What `compose` does

[`compose(config, roles)`](./host.ts) performs these steps:

1. Imports, from each configured plugin, the facets of the roles given. Every
   process serves `graph`.
2. Combines vocabulary documents and keywords, rejecting duplicate component
   declarations.
3. Opens SQLite, runs migrations, and builds storage with derived columns, query
   extensions, optional entity numbers, and full-text indexes for fields
   declared with `search: true`.
4. Builds the graph from plugin rules and the effect registry. Every process
   writes down the runs its commits owe, whatever roles it serves.
5. Joins tool declarations to their `runs` implementations; a declared tool
   without an implementation is an error. Serving `effects`, it handles each
   declared effect with the one plugin `./effects` that gives it code, usually
   the declaring plugin's own (a declared effect the config gives no code is
   settled as done, and two plugins handling one is an error), and the tool
   runner's two effects for calls another process wrote.
6. Serving `web`, asks the plugin that hosts routes, if the config listed one,
   for the one handler this host answers with.
7. Creates the current process entity after registrations are ready.

It returns a `Served` object: the `Host` fields — which include `roles`,
`tools`, `routes`, `handler`, `runner`, and `duties` — plus `fx` and `close`.
Nothing here binds a port. The `serve` tool does that, reading the handler off
the host it was composed into, reconciling interrupted calls, and taking over
the duties for as long as it listens. `words(config)` reads the plugins'
`./vocab` alone: the vocabulary and the tools it declares, with nothing opened.

## Duties: the work nobody is asking for

Working the effect pool and each plugin's `./service` export are duties: the
pool is the `effects` role's, and a service is the role named by its plugin. Any
number of processes work the pool at once, each claiming a run before it runs
it. Each service runs under a lease named for its owning package, so only one
process over a graph runs it at a time, and a process takes only the leases of
the roles it serves.

```ts ignore
await host.duties() // Run until the host shuts down.
await host.duties(AbortSignal.abort()) // Run one pass, then release leases.
```

A `yak` command that opens a graph runs its duties in a thread of its own
([`thread.ts`](./thread.ts), [`worker.ts`](./worker.ts)), so the thread that
runs the command and draws its answer never waits on them. The thread composes
the same config for the duty roles as a host of its own, under a name the
process gives it: it writes its own process row, in the process's pid, and its
leases and claims name that row. A thread ended where it stands, or one that
fails, writes no ending and its pid lives on, so the process writes its ending
for it (`Host.end`): its calls interrupted, its leases released, its `exit`
stamped, and nobody waits out what it held. Once the command's host is open, the
process asks which duty roles no live process is serving
([`local.ts`](./local.ts) `unserved`). A one-shot command starts the thread only
when one of them is idle, for one pass of each on the way in, and closes it with
one last pass over the pool, for what the command itself wrote; where a process
that stays up is serving them, the command leaves its runs written down for it.
The `serve` tool asks for the long-running form, which starts the thread
whatever the leases say, since a holder that dies later is one it has to take
over from. The thread takes the leases and the pool settles who does what. A
live process renews its lease; another process can take over after the lease
expires or is released.

`yak --no-duties` (config `duties: false`) turns them off for one process: it
takes no lease, works no effects, and runs neither the services nor the start-up
passes `@yaks/session` and `@yaks/spawn` hold a lease for; what it commits is
left written down for a process that does. A one-shot command then only runs its
tool, and `yak --no-duties serve` answers requests while another process, or
none, does the duties.

`close()` first aborts `host.stopping`, closes the duty thread, lets the effects
it started finish and leaves the pool, ends every call its runner is still
running as `error{code: 'interrupted'}`, then releases leases, records the
process exit, and closes SQLite. `stop()` is the first step alone: the graph
stays open so what is running can finish and be written. Plugin timers and loops
should listen to `host.stopping` or the signal passed to `service`.

A signal winds a command down ([`signal.ts`](./signal.ts)). The first SIGTERM,
SIGINT or SIGHUP stops every graph the command opened, so `yak serve` stops
taking requests, answers the ones in flight and returns, and the command closes
the way it always does. A second signal, or 30 seconds passing first, ends the
duty thread where it stands, closes with the signal's code (143, 130, 129) and
exits: a duty that never heeded its signal is not waited on.

## The command line

`cli(commands, opts)` parses and runs one command and returns an exit code:

| Code | Meaning                                        |
| ---- | ---------------------------------------------- |
| `0`  | Success                                        |
| `1`  | A tool or server refused or failed the request |
| `2`  | Invalid command-line usage                     |

A program with commands of its own runs
`Deno.exitCode = await cli([helpTool(opts), ...commands], opts)`.

Commands earlier in the array take precedence. A graph's tools become commands
unless their `surfaces` leaves out `cli`. Tools with a noun and verb can be
written in either order, such as `yak task list` or `yak list task`. The usage
page groups verbs under their noun. `yak graph`, `yak graph --help`, and
`yak help graph` print the commands in the `graph` group.

| Global flag       | Meaning                                                                  |
| ----------------- | ------------------------------------------------------------------------ |
| `--config <path>` | Open the graph described by a local config.                              |
| `--host <host>`   | Call a remote MCP server.                                                |
| `--json`          | Print structured results as JSON.                                        |
| `--tui`           | Hold the answer in the terminal until Ctrl-C, drawn by plugins' `./tui`. |
| `--timing`        | Print response timing to stderr. `$YAKS_TIMING=1` enables it globally.   |
| `--no-duties`     | Take no lease and run no duties (config `duties: false`).                |
| `--help`, `-h`    | Print general or command-specific help.                                  |

An argument value written as `@path` is read from that file; `-` reads from
stdin. `yak apply` accepts a JSON array or newline-delimited JSON. For streamed
input, it groups bundles into batches of 50; `--dry-run` validates and reports
the result while rolling back the transaction.

Remote authentication uses `$YAKS_TOKEN` when set. Otherwise,
`yak login <token>` stores a token for the selected host. yaks.app mints one
with its `grant` tool: ask an assistant connected to yaks.app for a CLI token,
and paste the `yak login …` line it answers. `yak logout` ends the token: it
hands the token back to the host's `grant` tool to revoke, then removes it here,
and says so when the host could not revoke it. Tokens and cached tool lists are
stored separately under `$YAKS_HOME`, or the platform config directory followed
by `/yaks`:

| File         | Contents                                                                |
| ------------ | ----------------------------------------------------------------------- |
| `token.json` | Per-host bearer tokens; mode `0600` on non-Windows systems              |
| `tools.json` | Per-host tool schemas, protocol version, roster version, and vocabulary |

The tool cache avoids an MCP round trip for ordinary calls. A server response
that reports a changed roster invalidates or updates the cache.

The package exports six entry points:

- `@yaks/cli` exports command parsing, schema conversion, display and completion
  helpers, MCP transport, token and roster storage, config reading, remote tool
  listing, app-command adapters, and the `main`, `YAK`, `TOOLS`, and `HOST`
  values used by the installed command.
- `@yaks/cli/yak` exports the executable `main`, built-in commands, and
  defaults. Run it directly or pass additional commands to `main(argv, extra)`.
- `@yaks/cli/config` reads a config file: where its graph is, the plugins it
  names, and the release a plugin named without a version comes from. It imports
  no plugin, for a command that only needs to know where the graph is.
- `@yaks/cli/host` exports config and host types, the facet loader, `compose`,
  and supporting host functions for programs that assemble a graph.
- `@yaks/cli/install` is the installer: run it and `yak` is on PATH at the
  installer's own release, under a config that lets Deno resolve that release
  the day it publishes.
- `@yaks/cli/release` exports that config (`released`), for anything else that
  resolves a release from JSR, as @yaks/web's bundler does.

Application commands use `yak command <name> --app <app> key=value`, or the
short form `yak <app> <name> key=value`. Values are parsed as JSON when
possible. A graph tool with the same command name takes precedence.
