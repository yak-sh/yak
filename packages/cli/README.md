# @yaks/cli

`@yaks/cli` provides `yak`, a command-line client for a
[@yaks/graph](../graph/README.md), and the functions that assemble a graph from
a JSON config file. A graph stores entities. Each entity has a stable ID and
components, which are named objects containing properties. A bundle is one
entity's components represented as a JSON object; it can describe the entity's
current state or a change to it. A batch is a list of bundles applied in one
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

`yak` provides `help`, `init`, and `apply` itself. Its other commands come from
a configured plugin, a graph opened in the current process, or an MCP server
queried at run time. `yak serve` is a tool rather than a command of this
package: [@yaks/api](../api/README.md) declares and implements it, so a config
listing that package is a config whose graph can be served.

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
| `graph`         | `./vocab`, `./graph`, `./tools` | opens the file, admits writes, runs tool calls |
| `web`           | `./routes`                      | answers HTTP with the routes @yaks/api hosts   |
| `effects`       | `./effects`                     | claims and runs what commits owe, in a pool    |
| a plugin's name | that plugin's `./service`       | keeps that plugin's timer or poll running      |

The `yak` command serves commands and rendering itself. It reads the plugins'
`./vocab` for tools and optional `./cli` facets for terminal controls, so the
usage page opens no graph. A `./cli` command runs directly in the terminal
process and is not a stored tool call: input such as an OAuth return URL cannot
be replayed by another process. Running one opens the graph for that command's
roles: the graph and the roles it declares (`serve` declares `web`). The duty
roles, the effect pool and each plugin's service, run in independent processes
for `serve` where no live process serves them (see Duties). The rendering role
imports `./views`, and `./tui` under `--tui`.

## Where a command runs

A [host](../host/README.md) composes a graph and lends capabilities to its
plugins. The CLI is the box's concrete host. A config file describes a local
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
text. Terminal controls from a plugin's `./cli` facet, such as the harness's
`connection authorize`, run in that terminal process and use their own command
implementations, as do `help`, `init`, and `apply`.

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
    "./graph": "./graph.ts",
    "./effects": "./effects.ts",
    "./routes": "./routes.ts"
  }
}
```

| Subpath     | Role       | Expected exports                                                                                                               |
| ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `./vocab`   | `graph`    | `docs?`, `keywords?`, `derived?` and `backed?` declarations, and `description?` from deno.json                                 |
| `./graph`   | `graph`    | `install?`, `plugins?: (host, options) => Plugin[]`, `extend?`, `reply?`, `meaning?`, `feed?`, and at most one `authenticate?` |
| `./tools`   | `graph`    | `runs?: (host, options) => Runs`, keyed by declared tool name                                                                  |
| `./cli`     | `yak`      | `commands?: CliCommand[]`, direct terminal controls with a composed host                                                       |
| `./effects` | `effects`  | `effects?: (host, options) => Handlers`, keyed by declared effect name                                                         |
| `./routes`  | `web`      | `routes?: (host, options) => Route[]`, `filter?`, and at most one `handler?`                                                   |
| `./service` | its plugin | `service?: (host, options, signal)` for a duty                                                                                 |
| `.`         |            | Public types and library functions; not loaded by `compose`                                                                    |

The web UI separately imports `./vocab` and `./views`, and `yak` imports
`./views` to show a tool's answer. Those modules must work in a browser and must
not import SQL, storage drivers, or server-only APIs. `deno task check:browser`
verifies this constraint. `compose` does not load `./views`: drawing is the
rendering role, which needs no graph open.

`@yaks/mail`, as `compose` reads it:

```ts
import { docs } from '@yaks/mail/vocab'
import { plugins } from '@yaks/mail/graph'
import { runs } from '@yaks/mail/tools'

// Its options are its entry in yak.json.
let options = { domain: 'books.example' }
docs // [mailDoc]
plugins({}, options) // [mailbox({ domain: 'books.example' })]
Object.keys(runs({}, options)) // the tools it runs, by name
```

### Machine providers

The CLI lends providers through `Host.machines`. A config can choose providers
without making plugins know where commands run:

```json
{
  "machines": {
    "defaultProvider": "process",
    "providers": {
      "process": {
        "use": "@yaks/process",
        "with": { "dir": "/srv/yak/machines" }
      }
    }
  }
}
```

Absent that setting, the CLI lends the process provider, keeping sandbox
directories beside a file-backed graph (under the test's temporary directory for
a graph in memory). It is directory separation, not security or resource
isolation. A provider module other than `@yaks/process` exports
`provider(host, options)` and answers the
[MachineProvider](../machine/README.md#providers) contract. Provisioning happens
only when a session needs commands or files. Graph commits are prepared from
objects in the host's binary artifact store, not from an ambient checkout.

Machine vocabulary and its Git object references are host words, like invocation
records: a config need not separately list their vocabulary plugins. Existing
machines are explicit `machine{provider, address}` records. The CLI's legacy
home translation lives at its SQLite boundary; the harness sees only machine
homes.

### A tool that acts on the machine

Some tools change the machine running them instead of only changing the graph.
For example, `land` updates a checkout, `hooks install` writes a settings file,
and `serve` binds a TCP port. The call such a tool is handed carries
`process{pid, command, cwd}` (@yaks/process), the program that executes the
call, and `cwd` is its working directory. A locally opened graph uses the
directory where the user ran `yak`; a remote call uses the server process's
directory.

A tool that declines a call throws `CallError`. The runner records the refusal,
and `yak` returns exit code `1`.

Factories receive the [portable host interface](../host/README.md), with no SQL
driver or state directory. They can retain `host.storage`, `host.graph`,
`host.handler`, `host.runner`, and `host.duties`, but must not access them
before initialization. Storage capabilities are available to `extend` from
`./graph`; graph reads wait until composition has bound all extensions. A route
is an `@yaks/api` `Route` with `method`, `path`, and a `(Request) => Response`
handler. Paths are exact unless they end in `*`; `*` also matches any method.

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
to attribute their changes. `authenticate` belongs to `./graph`, because every
door asks it, a command line naming its session as much as an HTTP request, and
at most one plugin may export it. Without an authenticated caller, writes are
attributed to the host process.

## Who a process writes as, and what starting up IS

Every command, server, or TUI that opens a graph, and every thread of one that
does, creates its own process entity:

```text
process{pid, command, cwd, roles} ...and exit{code} when it closes
```

Writes without an explicit actor are attributed to that process. Authenticated
requests are attributed to the authenticated identity. On shutdown, `close()`
records the exit and releases the process's leases in one transaction.

Start-up work is an effect declared `start: true` (@yaks/effects): a process
that starts working the pool owes itself a run of it, and a command passing
through, which serves no `effects` role, owes none; there is no separate
`./boot` facet. Start-up work that must run in the process that started holds a
lease instead.

## What `compose` does

[`compose(config, roles)`](./host.ts) performs these steps:

1. Imports, from each configured plugin, the facets of the roles given. Every
   process serves `graph`.
2. Combines vocabulary documents and keywords, rejecting duplicate component
   declarations.
3. Opens the installed SQLite graph, checks migration control, and binds storage
   with derived columns, backings of computed components, query extensions,
   optional entity numbers, and the installed full-text indexes.
4. Builds the graph from plugins and the effect registry. Every process writes
   down the runs its commits owe, whatever roles it serves. An effect's `option`
   names the declaring plugin's boolean option, which must be `true` before any
   process owes that effect a run.
5. Joins tool declarations to their `runs` implementations; a declared tool
   without an implementation is an error. Serving `effects`, it handles each
   declared effect with the one plugin `./effects` that gives it code, usually
   the declaring plugin's own (a declared effect the config gives no code owes
   no run, and two plugins handling one is an error), and the tool runner's two
   effects for calls another process wrote.
6. Serving `web`, asks the plugin that hosts routes, if the config listed one,
   for the one handler this host answers with.
7. Creates the current process entity after registrations are ready, except for
   a read-only host (`readOnly: true`) or an installer (`process: false`).

A **graph installer** prepares the schema and indexes explicitly. `yak init`
uses it for a fresh graph. After changing the configured plugins or upgrading
code that changes storage, run it as the operator before opening the graph:

```sh
yak upgrade --config /path/to/yak.json
```

The installer creates migration control and blob storage, installs component
schema and archetypes, calls each graph facet's `install(host, options)`, and
adopts full-text indexes. Refitting tables, backfilling data, counting index
health and updating planner statistics belong to that operation, never to an
ordinary command or service opening its graph. Library hosts invoke it with
`compose(config, ['graph'], load, { install: true, process: false })`; in-memory
scratch hosts install automatically. No service is started by installation.
Coordinate an upgrade with the processes using that file: stop them before
schema changes and start them with the matching code afterwards. An ordinary
read never repairs a schema another process changed.

A local read-only command opens SQLite with `readOnly: true`, records no
process, tool, call, claim or result, and invokes no write reply. Failed reads
return fault bundles without persisting them or writing telemetry to the graph.
Its connection exposes no native-extension loader; semantic ranking uses the
exact fallback rather than loading an extension that writes metadata. SQLite
still coordinates concurrent WAL readers through its shared-memory index; this
is not a database or WAL row write.

It returns a `Served` object: the `Host` fields — which include `roles`,
`tools`, `routes`, `handler`, `runner`, and `duties` — plus `fx` and `close`.
Nothing here binds a port. The `serve` tool does that, reading the handler off
the host it was composed into, reconciling interrupted calls, and taking over
the duties for as long as it listens. `words(config)` reads the plugins'
`./vocab` alone: the vocabulary and the tools it declares, with nothing opened.

Selected file-backed facets are loaded together as one module graph, so the
runtime traverses their shared dependencies once rather than once per dynamic
import. This happens for vocabulary discovery, composition, command discovery,
and portable views. It imports only the selected subpaths; tools stay lazy.
Unmapped packages use the ordinary JSR loader. An absent optional facet remains
absent; an exported facet that fails still fails the load. No generated file or
persistent module cache is kept.

```ts
import { subpaths } from './config.ts'
import { equal } from '@yaks/testing'

let [words, absent] = await subpaths([
  ['@yaks/doc', 'vocab'],
  ['@yaks/doc', 'routes'],
])
equal(typeof words, 'object')
equal(absent, null)
```

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

`yak serve` serves web without a duty thread in its process. It checks live
process roles and starts an independent `yak work --roles <missing>` for any
missing duties, using the current executable and module with detached, null
stdio. Service leases remain singleton; duplicate effect workers are allowed. A
successfully started worker survives web shutdown. `yak work` composes the graph
and duty roles directly and stays up until interrupted. Its `--ready` file
announces that handlers and graph are assembled, not that an old service has
surrendered its lease. Other command hosts can still use a duty thread through
[@yaks/threads](../threads/README.md); [`duties.ts`](./duties.ts) only opens the
box graph for the roles it is handed. The same package works the pool and leased
services for independent `yak work` processes.

On the box, `yak-web@` units run `serve --no-duties --share --ready <file>`, and
independent `yak-work@` units run the pool and plugin services. The independent
tracker uses `yak-tracker@` workers over its own config and `yak-tracker-web@`
units for HTTP. **Use `yak restart`**, not raw systemctl restart: for each role
(the primary workers and web, and each active tracker role) it starts a
replacement from the unit template and waits for its readiness file, and once
every replacement is ready it queues the old units' stops without waiting for
them, then says which units it started, how long each took and which it is
stopping. A worker's replacement is ready once its pool and graph are assembled,
and the old worker drains its steps in flight. A web's replacement is ready once
it listens on the same port as the old one (`share`), so no request is refused;
the old web stops taking requests, closes its sockets and cuts what is still
open after its grace ([@yaks/api](../api/README.md)). Inactive or uninstalled
optional units stay untouched; discovery and enqueue failures are reported. A
session requesting its own restart can finish that request. A failed handover
before readiness cleans up only the replacement; once ready, a replacement
survives later enqueue errors.

`yak --no-duties` (config `duties: false`) turns them off for a host that stays
up: it takes no lease, works no effects, and runs neither the services nor the
start-up passes `@yaks/session` and `@yaks/spawn` hold a lease for; what it
commits is left written down for another host. `yak --no-duties serve` answers
requests while another process, or none, does the duties.

`stop()` winds a host down with the graph still open: it aborts `host.stopping`,
so the duties stop, a server takes no new request and a transcript starts no new
step, and it leaves the pool, claiming no new run. `close()` does the same,
closes the duty thread, waits for every effect the host started to finish, for
as long as each takes, and says in the log which ones it is waiting on
([`drain.ts`](./drain.ts)); then it ends every call its runner is still running
as `interrupted{code}`, releases leases, records the process exit, and closes
SQLite. What a run left owed is the next worker's. Plugin timers and loops
should listen to `host.stopping` or the signal passed to `service`.

An interrupt winds a command down (`@yaks/process/wind`, wired in
[`yak.ts`](./yak.ts)): a SIGTERM, SIGINT or SIGHUP, or Ctrl-C in a terminal app.
The first stops every graph the command opened, so `yak serve` stops taking
requests, answers the ones in flight and returns, and the command closes the way
it always does once its effects have finished. Nothing here puts a deadline on
that; only the work knows how long it needs. A second interrupt ends the duty
thread where it stands, closes with the interrupt's code (143, 130, 129) and
exits.

## Shared command grammar

Import `@yaks/cli/grammar` for command parsing and completion in a browser or
another host that does not need the CLI runtime. Both functions read the same
`Grammar` descriptors: command names, `inputSchema`, optional `positional`, and
`short` on input properties. A final positional suffixed `...` takes every
remaining bare word. A browser caller does not need a separate argument parser.

```ts
import { argsFor, complete, type Grammar } from '@yaks/cli/grammar'

let greet: Grammar = {
  name: 'greet',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', enum: ['Ada', 'Lin'] } },
    required: ['name'],
  },
}

await argsFor(greet, ['--name=Ada']) // { name: 'Ada' }
await argsFor(greet, ['--name', 'Ada']) // { name: 'Ada' }
await complete([greet], 'greet --name A') // ['Ada']
```

`argsFor(tool, argv, reads?)` returns a promise of the typed, validated argument
object, including schema defaults. It accepts `name=value`, `--name=value` and
`--name value`, declared short options, boolean flags, positional arguments, and
repeated list options; `--` ends option parsing. Invalid input throws `Usage`.
File and stdin expansion (`@path`, `-`, `@-`) happens only when the host
supplies `Reads{file, stdin}`; without it, those words stay literal.

`complete(tools, line, look?)` returns a promise of whole replacement words, not
suffixes. `line` may be a string or a words array. It offers commands, options
and schema values (enums, booleans and examples), recognizing both option-value
forms. Optional `Lookup{ids, hits}` callbacks supply entity IDs and full-text
matches without putting graph IO in the grammar.

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
`yak auth yaks.app` signs in through OAuth. The sign-in is a connection in the
configured graph. A machine with no graph creates a small personal graph in its
CLI state directory on its first `yak auth`.

`--as <account>` is optional on commands that reach yaks.app. Without it, the
connection whose account matches the configured person's own address wins,
otherwise the oldest connection. The default is computed, never stored.
`YAKS_TOKEN` still supplies a sandbox bearer without opening a graph.

| File                           | Contents                                                                |
| ------------------------------ | ----------------------------------------------------------------------- |
| `accounts.json`, `accounts.db` | The personal account graph on a machine with no configured graph        |
| `secrets/`                     | Private vault beside the account graph; no token in graph text          |
| `tools.json`                   | Per-host tool schemas, protocol version, roster version, and vocabulary |

The tool cache avoids an MCP round trip for ordinary calls. A server response
that reports a changed roster invalidates or updates the cache.

The package exports eight entry points:

- `@yaks/cli` exports command parsing, schema conversion, display and completion
  helpers, MCP transport, token and roster storage, config reading, remote tool
  listing and app-command adapters. It is what the command is built from, not
  the command: importing it starts nothing. Browser callers use the IO-free
  `@yaks/cli/grammar` entry point rather than the CLI runtime.
- `@yaks/cli/grammar` is the browser-safe command grammar and completion entry
  point, with no runtime IO: `argsFor`, `complete`, command lookup and token
  helpers, and the `Grammar`, `Reads`, `Lookup`, `Prop` and `Schema` types.
- `@yaks/cli/yak` is the command: the executable `main`, its built-in commands,
  and the `YAK`, `TOOLS` and `HOST` defaults it runs with. Run it directly or
  pass additional commands to `main(argv, extra)`.
- `@yaks/cli/config` reads a config file: where its graph is, the plugins it
  names, and the release a plugin named without a version comes from. It imports
  no plugin, for a command that only needs to know where the graph is.
- `@yaks/cli/host` exports the facet loader, `compose`, and re-exports portable
  host types from `@yaks/host`, and supporting host functions for programs that
  assemble a graph.
- `@yaks/cli/install` is the installer: run it and `yak` is on PATH at the
  installer's own release, under a config that lets Deno resolve that release
  the day it publishes.
- `@yaks/cli/release` exports that config (`released`), for anything else that
  resolves a release from JSR, as `@yaks/cli/page`'s bundler does.
- `@yaks/cli/page` is what a plugin's `./routes` serve a page with: `kept`
  answers an address with a body made once and kept for the process, bounded,
  healed on its next request after a failure, and ended as its host closes;
  `bundle(entry, signal)` makes a page's script and everything it imports into
  one browser module with `deno bundle`, from a file or from an entry written
  for the host (`Written`: its code, and where its imports resolve from).
  @yaks/web serves the application its plugin config chooses through a
  contributed `./web` facet, such as @yaks/browse.

Application commands use `yak command <name> [arguments] --app <app>`, or the
short form `yak <app> <name> [arguments]`, as the selected yaks.app connection.
The command's `vocab.json` declares `positional` beside `input`, with a final
`...` suffix for every remaining bare word, and `short` on the input property it
shortens. Without `positional`, it takes only named arguments (`name=value` or
`--name value`). Its input schema decides each value's type; `@path` reads a
file and `-` reads stdin. `--app` selects an app when several share a command
name. A graph tool with the same command name takes precedence.

The same optional `--as` selects an account for connector tools and app
commands; no separate admin forwarding command is needed.

```sh
yak where matt
yak app_list --as admin@bot.yak.sh
yak app_errors --space yourname --app vale
```

### Reporting outside the watched graph

`tracker: {spool: "tracker-spool"}` names the file spool relative to the config
file. Hosts report unexpected tool, effect, request and duty failures there and
to Sentry through `@yaks/tracker/sentry`, resolving the existing `SENTRY_DSN` or
`sentry` credential in the host vault at use time. Sentry failure is retained in
the spool without recursion. The Sentry event carries the handler and target,
not the letter or tool arguments. Reports go to the spool without opening a
tracker database. The separate @yaks/tracker role imports it using its own
config and database; the task graph keeps no tracker error rows. Console
telemetry remains enabled.

The daily `bin/backup` uses this same reporter for nonzero exits, including its
hard timeout. Its supervisor stays outside the bounded backup child, forwards
stdout and stderr to the cron log, and retains only the last 8 KiB of stderr in
the error. The report has `during.kind=backup` and `job`/`exit_code` tags;
intake groups it into a bug like other box errors. A successful backup writes no
report. Reporting failure never changes the backup's exit code. A restore
(`bin/backup restore`) is a person's: it runs unbounded and reports nothing.

The existing cron command invoking `bin/backup` needs no change. It reads the
box config (`$YAK_CONFIG`, otherwise `$HOME/.yak/yak.json`) only for reporting,
and the vault beside the data dir only for the R2 key pair; it opens no graph.
To use another spool, set `YAK_CONFIG=/path/to/yak.json` on that cron command.
Keep its existing `>> ~/.tasks-backup.log 2>&1` redirection. `YAK_BACKUP_BOUND`
is internal to the supervised child, not a cron setting.

### Box request traces

Every box host records request, effect and apply span trees in memory. HTTP
`/query`, `/apply`, the web UI's applies, socket messages (`ws subscribe`,
`ws unsubscribe`, `ws relay`, `ws message`) and subscription refreshes
(`ws
refresh`) retain phase, plugin and SQL ancestry. A web reader thread
returns its query/SQL tree and counts to the requesting server; it does not send
a duplicate trace. A streamed import has an independent `http stream apply` root
lasting through the whole import rather than only the HTTP response head.

Only selected completed roots go to `tracker.spool`: work strictly over 10,000
rows read or written, an armed capture, or an ordinary random sample. Automatic
traces are admitted once per operation and code name per rolling hour in a host;
suppressed repeats accompany the next admitted trace as root `repeats{n}`.
Captures and samples bypass that automatic quota. Sampling defaults to zero.
Unselected trees stay in memory only: no extra SQL, projection or delivery.
There are no per-minute timing rows. Traces use `@yaks/timing`'s span entities
and independent metric components, not JSON trees in the watched store.

Arm the next operations without opening the database:

```sh
yak trace --config /path/to/yak.json --next 3
yak trace --config /path/to/yak.json --rate 0.01
# Only the already-running web server consumes this capture:
yak trace --config /path/to/yak.json --process <serve-pid> --next 3
# Disable ordinary sampling for that process:
yak trace --config /path/to/yak.json --process <serve-pid> --rate 0
```

`--next` replaces the remaining capture count; omitted settings are unchanged.
`--rate` is a probability from zero to one. Without `--process`, next captures
are shared across processes over that database. A PID-specific rate overrides
the shared rate; PID-specific pending captures are consumed before shared ones.
The controls are persisted in `<db>.trace.json`, with advisory locking for
capture consumption and a 250 ms unref poll updating each host's cache. Idle
requests consult memory only. The command can arm an absent database and never
opens or creates it; the sidecar directory must be writable. Controls do not
require a service restart. To target the web server, use its `yak serve` PID,
not a `yak work` PID.

The separate tracker config must compose `@yaks/timing` beside `@yaks/tracker`
and its browser/inspect plugins, then be installed with
`yak upgrade --config
/path/to/tracker.json`. Both the watched config's
`tracker.spool` and the tracker service's `with.spool` name the same spool
directory. Browse `/?q=.trace` on the tracker for grouped traces and each
trace's flamegraph and places list.
