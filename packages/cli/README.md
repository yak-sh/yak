# @yaks/cli

`@yaks/cli` provides `yak`, a command-line client for a
[@yaks/graph](../graph/README.md), and the functions that assemble a graph from
a JSON config file. A graph stores entities. Each entity has a stable ID and
components, which are named objects containing properties. A bundle is one
entity's components represented as a JSON object; it can describe the entity's
current state or a change to it. A batch is a list of changes applied in one
transaction.

```sh
deno install -gAf jsr:@yaks/cli/yak

yak --config yak.json task list # Open a local graph, run a tool, and exit.
yak land                        # Run a tool against the selected graph.
yak serve --config yak.json     # Run that graph's serve tool: HTTP.
yak app_list                    # Call a tool on the selected MCP server.
```

A tool is an operation declared by a graph, with a name, an input schema, and an
implementation. `yak` turns each tool in the selected graph into a subcommand.
Its arguments and help come from the tool's input schema, so a new tool does not
require a new CLI release.

`yak` provides four commands itself: `help`, `login`, `logout`, and `apply`. Its
other commands come from either a graph opened in the current process or an MCP
server queried at run time. `yak serve` is one of those tools rather than a
command of this package: [@yaks/api](../api/README.md) declares and implements
it, so a config listing that package is a config whose graph can be served.

The package has two main responsibilities:

- [`host.ts`](./host.ts) imports configured plugin modules, opens storage, and
  assembles the graph. It serves no HTTP of its own: the request handler is
  built by the listed plugin that hosts routes, which is @yaks/api.
- [`platform.ts`](./platform.ts) lists and calls tools on a remote MCP server.
  [`local.ts`](./local.ts) exposes the same command interface for a graph opened
  by the current process.

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

Local and remote tool invocations both create a call entity and run it through
`@yaks/tools`. Tool calls made by people and agents therefore use the same
validation, rules, effects, attribution, and stored record. CLI-only commands
such as `help`, `login`, `logout`, and `apply` use their own command
implementations.

## The config

Pass a config path with `--config`, set `$YAK_CONFIG`, or place the file at
`~/.yak/yak.json`:

```json
{
  "db": "graph.db",
  "plugins": [
    "@yaks/api",
    "@yaks/harness",
    {
      "use": "@yaks/mail",
      "with": {
        "domain": "books.example",
        "sender": {
          "via": "cloudflare",
          "account": "a1b2",
          "token": { "env": "CF_EMAIL_TOKEN" }
        }
      }
    }
  ],
  "port": 8787
}
```

Relative database paths and plugin specifiers are resolved relative to the
config file.

| Field      | Meaning                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `db`       | SQLite path or `:memory:`. Required unless `$DB_PATH` is set.                                    |
| `plugins`  | Package specifiers, optionally paired with plugin-specific options.                              |
| `port`     | Port the `serve` tool listens on; defaults to `@yaks/api`'s `PORT`.                              |
| `hostname` | Network interface used by `serve`.                                                               |
| `numbers`  | Enables short entity numbers. `{ "except": [...] }` excludes entities carrying named components. |
| `adopt`    | Preserves incoming entity numbers instead of minting new ones. Intended for store imports.       |
| `name`     | MCP server name; defaults to `yak`.                                                              |
| `lease`    | Background-job lease duration in milliseconds; defaults to `30000`.                              |
| `jobs`     | Whether this process runs the background jobs; defaults to `true`.                               |

There is no default database path. `compose` throws unless `db` or `$DB_PATH` is
present.

### What a config passes to one plugin

A plugin entry is either a package specifier or an object with `use` and `with`
fields. Each exported plugin factory receives `(host, options)`. The host
contains the config, vocabulary, database connection, store, graph, request
handler, tool runner, background jobs, process entity, request authentication
function, and shutdown signal. An entry without `with` receives an empty object.
Option keys belong to the plugin.

At any depth in `with`, an object containing only `{ "env": "NAME" }` reads that
environment variable when the property is accessed. This keeps secrets out of
the JSON file and lets a long-running plugin observe a value supplied after
startup. An unset variable produces `undefined`; the plugin decides how to
handle it.

Plugin factories may omit functionality when configuration is unavailable. Any
diagnostic behavior, including a `check` tool, belongs to the plugin; the CLI
does not impose a startup policy for missing plugin options.

## A plugin is a package, and each part of it is a subpath export

A facet is a sub-module export: one optional plugin subpath that supplies a
specific part of the running graph. `compose` looks for six facets in every
configured package: `./vocab`, `./rules`, `./tools`, `./effects`, `./routes`,
and `./service`. An unexported facet is skipped. An exported facet that fails to
import causes composition to fail, as does a package that exports none of the
six.

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

| Subpath     | Expected exports                                                                              |
| ----------- | --------------------------------------------------------------------------------------------- |
| `./vocab`   | `docs?`, `keywords?`, and `derived?` declarations                                             |
| `./rules`   | `rules?: (host, options) => Plugin[]` and query `extend?` functions                           |
| `./tools`   | `runs?: (host, options) => Runs`, keyed by declared tool name                                 |
| `./effects` | `effects?: (host, options) => Watch[]` for post-commit work                                   |
| `./routes`  | `routes?: (host, options) => Route[]`, and at most one each of `authenticate?` and `handler?` |
| `./service` | `service?: (host, options, signal)` for leased background work                                |
| `.`         | Public types and library functions; not loaded by `compose`                                   |

The web UI separately imports `./vocab` and `./views`. Those modules must work
in a browser and must not import SQL, storage drivers, or server-only APIs.
`deno task check:browser` verifies this constraint. `compose` does not load
`./views`.

```ts
// @yaks/mail/vocab
export let docs = [mailDoc]
export let keywords = [mailKeywords]
export let derived = (vocab) => mailRead(vocab)

// @yaks/mail/rules
export let rules = (host, options) => [mailbox({ domain: options.domain })]

// @yaks/embedding/rules
export let extend = (host, options) => [semantic(host.sql, embedderOf(options))]

// @yaks/sqlite/tools
export let runs = (host, options) => ({
  storage_check: (_bundles, ctx) => check(host.sql, options),
})
```

### A tool that acts on the machine

Some tools change the machine running them instead of only changing the graph.
For example, `land` updates a checkout, `hooks install` writes a settings file,
and `serve` binds a TCP port. Tool implementations receive `ctx.cwd`, the
working directory of the process that executes the call. A locally opened graph
uses the directory where the user ran `yak`; a remote call uses the server
process's directory.

A tool that declines a call throws `CallError`. The runner records the error,
and `yak` returns exit code `1`.

Factories can retain `host.storage`, `host.graph`, `host.handler`,
`host.runner`, and `host.duties`, but must not access them before
initialization. In particular, `rules.extend` runs before the store exists. A
route is an `@yaks/api` `Route` with `method`, `path`, and a
`(Request) => Response` handler. Paths are exact unless they end in `*`; `*`
also matches any method.

A host answers requests only where a listed plugin exports `handler` from
`./routes`. @yaks/api is that plugin: it is handed the host once `host.routes`
holds every listed plugin's routes, and returns them in front of `/apply`,
`/query` and `/ws`, which answer whatever no route claimed. A config that does
not list it composes a host with no `handler`, no `serve` tool, and no call to
any plugin's `routes` factory — the routes are ignored rather than built for a
listener that does not exist. `/mcp` is the same arrangement one level down:
@yaks/mcp contributes it as a route, so a config that wants an agent's door
lists that package too.

Routes that write should use `host.who(request)` and `signed` from `@yaks/api`
to attribute their changes. At most one plugin may export `authenticate`.
Without an authenticated caller, writes are attributed to the host process.

## Who a process writes as, and what starting up IS

Every command, server, or TUI that opens a graph creates its own process entity:

```text
process{pid, command, cwd} ...and exit{code} when it closes
```

Writes without an explicit actor are attributed to that process. Authenticated
requests are attributed to the authenticated identity. On shutdown, `close()`
records the exit and releases the process's leases in one transaction.

Creating the process entity also provides the startup event. Plugins can
register an effect for `created(process)` and compare its entity ID with
`host.me`; there is no separate `./boot` facet. A lease prevents two processes
opening the same graph from performing the same startup work.

## What `compose` does

[`compose(config)`](./host.ts) performs these steps:

1. Imports every available server facet from each configured plugin.
2. Combines vocabulary documents and keywords, rejecting duplicate component
   declarations.
3. Opens SQLite, runs migrations, and builds storage with derived columns, query
   extensions, optional entity numbers, and full-text indexes for fields
   declared with `search: true`.
4. Builds the graph from plugin rules and the post-commit effect registry.
5. Registers plugin effects and joins tool declarations to their `runs`
   implementations. A declared tool without an implementation is an error.
6. Asks the plugin that hosts routes, if the config listed one, for the one
   handler this host answers with.
7. Creates the current process entity after registrations are ready.

It returns a `Served` object: the `Host` fields — which include `tools`,
`routes`, `handler`, `runner`, and `duties` — plus `fx` and `close`. Nothing
here binds a port. The `serve` tool does that, reading the handler off the host
it was composed into, reconciling interrupted calls, and taking over the
background jobs for as long as it listens.

## Background jobs: the work nobody is asking for

The effect sweep and each plugin's `./service` export are background jobs,
represented as `duties`. Each job runs under a lease named for its owning
package, so only one process over a graph runs it at a time.

```ts
await host.duties() // Run until the host shuts down.
await host.duties(AbortSignal.abort()) // Run one pass, then release leases.
```

The `serve` tool uses the long-running form. A one-shot local command uses the
second form before executing its tool, allowing overdue effects and scheduled
work to progress when no server is running. A live process renews its lease;
another process can take over after the lease expires or is released.

`yak --no-background-jobs` (config `jobs: false`) turns them off for one
process: it takes no lease, and runs neither the sweep, the services, nor the
start-up passes `@yaks/session` and `@yaks/spawn` hold a lease for. A one-shot
command then only runs its tool, and `yak --no-background-jobs serve` answers
requests while another process, or none, does the background work.

`close()` first aborts `host.stopping`, then releases leases, records the
process exit, and closes SQLite. Plugin timers and loops should listen to
`host.stopping` or the signal passed to `service`.

## The command line

`cli(commands, opts)` parses and runs one command and returns an exit code:

| Code | Meaning                                        |
| ---- | ---------------------------------------------- |
| `0`  | Success                                        |
| `1`  | A tool or server refused or failed the request |
| `2`  | Invalid command-line usage                     |

```ts
import { cli, helpTool } from '@yaks/cli'

Deno.exitCode = await cli([helpTool(opts), ...mine], opts)
```

Commands earlier in the array take precedence. Tools with a noun and verb can be
written in either order, such as `yak task list` or `yak list task`. The usage
page groups verbs under their noun. `yak graph`, `yak graph --help`, and
`yak help graph` print the commands in the `graph` group.

| Global flag            | Meaning                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `--config <path>`      | Open the graph described by a local config.                            |
| `--host <host>`        | Call a remote MCP server.                                              |
| `--json`               | Print structured results as JSON.                                      |
| `--timing`             | Print response timing to stderr. `$YAKS_TIMING=1` enables it globally. |
| `--no-background-jobs` | Take no lease and run no background jobs (config `jobs: false`).       |
| `--help`, `-h`         | Print general or command-specific help.                                |

An argument value written as `@path` is read from that file; `-` reads from
stdin. `yak apply` accepts a JSON array or newline-delimited JSON. For streamed
input, it groups bundles into batches of 50; `--dry-run` validates and reports
the result while rolling back the transaction.

Remote authentication uses `$YAKS_TOKEN` when set. Otherwise,
`yak login <token>` stores a token for the selected host and `yak logout`
removes it. Tokens and cached tool lists are stored separately under
`$YAKS_HOME`, or the platform config directory followed by `/yaks`:

| File         | Contents                                                    |
| ------------ | ----------------------------------------------------------- |
| `token.json` | Per-host bearer tokens; mode `0600` on non-Windows systems  |
| `tools.json` | Per-host tool schemas, protocol version, and roster version |

The tool cache avoids an MCP round trip for ordinary calls. A server response
that reports a changed roster invalidates or updates the cache.

The package exports three entry points:

- `@yaks/cli` exports command parsing, schema conversion, display and completion
  helpers, MCP transport, token and roster storage, config reading, remote tool
  listing, app-command adapters, and the `main`, `YAK`, `TOOLS`, and `HOST`
  values used by the installed command.
- `@yaks/cli/yak` exports the executable `main`, built-in commands, and
  defaults. Run it directly or pass additional commands to `main(argv, extra)`.
- `@yaks/cli/host` exports config and host types, the facet loader, `compose`,
  and supporting host functions for programs that assemble a graph.

Application commands use `yak command <name> --app <app> key=value`, or the
short form `yak <app> <name> key=value`. Values are parsed as JSON when
possible. A graph tool with the same command name takes precedence.
