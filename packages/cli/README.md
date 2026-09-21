# @yaks/cli

`yak`, the command line for a [@yaks/graph](https://jsr.io/@yaks/graph) — either
one this machine can open as a file, or one an MCP server holds somewhere else.

```sh
deno install -gAf jsr:@yaks/cli/yak
```

A GRAPH is a store of entities: an entity has a stable id, carries components
(named objects of columns), and a write is a list of those bundles applied in
one transaction. [@yaks/graph](../graph/README.md) defines those terms; this
package is how a person and a script reach one.

```sh
yak --config yak.json task list    # opens that graph, runs the tool, exits
yak land                           # the same, in the checkout you are in
yak serve --config yak.json        # an HTTP server over the same graph
yak app_list                       # a tool yaks.app lists, called over /mcp
```

Every subcommand is a TOOL. `yak` itself carries only `help`, `login`, `logout`,
`serve` and `apply`; everything else is a tool of the graph the command opens,
or a tool the MCP server it names lists, read at run time and parsed through
that tool's own input schema. So the command line cannot drift from what an
agent is calling, and a tool a release adds is a subcommand the day it ships,
without publishing this package again.

Two halves, one set of tools:

- **the composition** ([./serve.ts](./serve.ts)) — one config file naming plugin
  packages, whose subpath exports are imported one at a time and composed into a
  running graph. A command line composes it to run one tool and exit
  ([./local.ts](./local.ts)); `yak serve` composes the same thing and serves
  HTTP over it. There is no other wiring: a graph IS a config file and a list of
  packages.
- **the client** ([./platform.ts](./platform.ts)) — for a graph this machine
  cannot open as a file, every tool an MCP server lists becomes a subcommand of
  the same name, with that tool's input schema as its grammar and its own help
  page.

## Where a command runs

**There is no server process to start.** A config names a GRAPH — a SQLite file
and the plugins that read and write it — and a `yak` command OPENS it, imports
them, runs the tool in its own process and exits. SQLite in WAL mode accepts as
many writers as there are commands running, each serialized by the file itself,
so nothing bottlenecks on a process somebody had to remember to start.
`yak serve` is one more process over the same file.

`--host` is for a graph this machine cannot open as a file — yaks.app, another
machine — and then the command talks to that machine's MCP server at `/mcp`.
Given together with `--config`, the two name two places and the command is
refused.

In order, a command runs:

| what it was given | where it runs                                         |
| ----------------- | ----------------------------------------------------- |
| `--config <path>` | here, over the graph that config names                |
| `--host <host>`   | there — a bare name is `https://`, an origin as given |
| `$YAKS_HOST`      | there                                                 |
| `$YAK_CONFIG`     | here, over the graph that config names                |
| `~/.yak/yak.json` | here, over this machine's own graph, when it exists   |
| nothing           | `yaks.app`                                            |

So a machine whose shell exports `YAK_CONFIG=/etc/yak.json` types
`yak task list` and opens its own graph; `yak --host yaks.app app_list` still
reaches the platform from the same shell.

A tool runs the same way either way: the command line writes a CALL entity and
the runner runs it (@yaks/tools), so the record of a tool a person typed and a
tool an agent called is the same record, and the rules, the post-commit effects
and the attribution are one set for both.

## The config

One JSON file. `--config` names it, else `$YAK_CONFIG`, else the one this
machine keeps for its own graph.

```json
{
  "db": "graph.db",
  "plugins": [
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

| field      | what it declares                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `db`       | the SQLite file, or `:memory:`. Relative to the config file itself                                                                |
| `plugins`  | the packages, by import specifier; a relative one resolves against the config                                                     |
| `port`     | what `serve` listens on (default 8787)                                                                                            |
| `hostname` | which interface `serve` binds                                                                                                     |
| `numbers`  | whether the store mints a short human-readable number beside each entity id. Opt-in: left out, no entity gets one                 |
| `adopt`    | reuse the `num` an incoming entity already carries instead of minting one — what a store seeded from another store's export needs |
| `name`     | what the MCP server calls itself (default `yak`)                                                                                  |
| `lease`    | how long this process's hold on a background job stands before another process may take it over, in ms (default 30_000)           |

### What a config passes to one plugin

A `plugins` entry is a bare specifier, or `{"use": "<specifier>", "with": {…}}`
— that plugin's own options, handed to each of its factories beside the HOST,
the object holding the graph being assembled and everything under it
(`rules(host, options)`, `effects(host, options)`, `routes(host, options)`; its
fields are listed below). A plugin nobody configured is handed `{}`, so a
factory reads its options without guarding first. The keys belong to the PLUGIN;
nothing here interprets them, which is what keeps a config from growing a field
per package.

That is the answer to the one thing a plugin cannot state alone: what an effect
ACTS ON. `@yaks/mail`'s outbound half hands a letter to a transport — an
account, a token, an endpoint — and none of that is a fact about the graph, so
the config names it and `@yaks/mail/effects` builds it. Name no sender and there
is no outbound watch, which is what a graph that only receives mail wants.

**A secret is named, not stored.** An option written `{"env": "NAME"}` — at any
depth — is the environment's value at the moment it is READ, so a config file is
committable, the token is not in it, and a variable exported after the process
started is picked up by the next code that asks for one. A name nothing exports
reads as undefined, and the plugin reports, in its own words, what it is waiting
for.

**Missing config never prevents startup.** A plugin's factory does not throw
over config that has not arrived or cannot be used: it contributes nothing,
reports why once, and its `check` tool keeps answering the question. A process
comes up with its mail unsent, its uploads unmounted or its vectors unbuilt, and
starts doing each the moment its config is there — rather than refusing to start
at all.

**There is no default database.** `db`, or `DB_PATH` in the environment, or the
process refuses to start: the path anybody would pick as a default is somebody's
live graph.

## A plugin is a package, and each part of it is a subpath export

No manifest, no registry, no activation. A plugin's `exports` map names one
subpath per part it has, and the process opening the graph imports
`<plugin>/<subpath>` for the parts it runs — serve.ts calls those six subpaths a
plugin's `FACETS`. A subpath the package does not export is a part it does not
have, and is skipped; a subpath that exists and fails to import is an error,
never a skip. A package that exports none of the six is a typo in the config,
and composing refuses it by name.

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

| subpath     | what it exports                                                                      | may import          |
| ----------- | ------------------------------------------------------------------------------------ | ------------------- |
| `./vocab`   | `docs`, `keywords?`, `derived?`                                                      | nothing server-side |
| `./rules`   | `rules: (host, options) => Plugin[]`, `extend?` (@yaks/sql)                          | anything            |
| `./tools`   | `runs: (host, options) => Runs` — the functions behind its `tool: true` declarations | ajv, SQL, anything  |
| `./effects` | `effects: (host, options) => Watch[]`                                                | anything            |
| `./routes`  | `routes: (host, options) => Route[]`, `authenticate?`                                | anything            |
| `./service` | `service: (host, options, signal)` — what keeps running                              | anything            |
| `./views`   | `views` — @yaks/render renderers for the web UI and the TUI                          | nothing server-side |
| `.`         | types, and the pure functions the package offers as a library                        |                     |

```ts
// @yaks/mail/vocab
export let docs = [mailDoc]
export let keywords = [mailKeywords]
export let derived = (vocab) => mailRead(vocab)

// @yaks/mail/rules
export let rules = (host, options) => [mailbox({ domain: options.domain })]

// @yaks/embedding/rules — the same subpath's other half: what a QUERY may ask
export let extend = (host, options) => [semantic(host.sql, embedderOf(options))]

// @yaks/sqlite/tools — a tool function reads the host's own connection, and
// its options
export let runs = (host, options) => ({ storage_check: (_, ctx) => … })

// @yaks/mail/routes
export let routes = (
  host,
  options,
) => [{ method: 'POST', path: '/inbound', handle }]
export let authenticate = (request) => who(request) // at most one plugin
```

`./vocab` and `./views` are the two subpaths the web UI imports, from every
package, so neither may reach storage, SQL or a server runtime;
`deno task check:browser` type-checks both with only the web platform in scope.
That is what lets a browser load what a plugin DECLARES without loading what it
DOES — `@yaks/process/vocab` describes a running program where `@yaks/process`
starts one.

`compose` imports every subpath but `./views`, which is the web UI's business
rather than the graph's.

### A tool that acts on the MACHINE

Some tools are not about the graph at all. `land` fast-forwards a branch;
`hooks install` writes a settings file. They are tools like any other — declared
in a `vocab.json`, listed over `/mcp`, run by the same runner — and what tells
them where to act is `ctx.cwd`, the working directory of the process running the
call. On a command line that is the directory the person typed in, because the
command opened the graph itself and ran the tool in the same process.

```ts
// @yaks/git/tools
export let runs = () => ({
  land: async (_bundles, ctx) => {
    let outcome = await land({ cwd: ctx.cwd, write })
    if (!('landed' in outcome)) throw new CallError('diverged', said)
    return [{ entity: { eid: '$landed' }, content: { body: … } }]
  },
})
```

A tool that REFUSES rather than doing the work throws a `CallError`: the runner
records it, and the command's exit code reports which it was.

`host` is `{config, vocab, storage, sql, graph, me, who, stopping}`. `storage`
and `graph` are live from the moment each is open — a factory may keep a
reference, and must not call it before it returns. A `rules` factory runs while
the graph is being composed and may install tables of its own through
`host.sql`; the `extend` factory beside it returns the @yaks/sql extensions the
STORE is built with, which is how a package holding an index of its own teaches
the query compiler a clause the compiler would otherwise reject (`.near` over
vectors, a text term over an index) — every read path then has it, and nobody
wires one up. A factory need not take the whole host: it names the parts it uses
(`(host: { vocab: Vocab }) => …`), which is how a package states what it needs
without importing this one.

A **route** is `{method, path, handle}` (@yaks/api `Route`): `handle` is a plain
`(Request) => Response`, `path` is exact or ends in `*` for a prefix, and
`method` is the HTTP method or `*` for any. A request no route claims falls
through to @yaks/api, which answers `/apply`, `/query` and `/ws` and returns an
error for anything else.

A route that WRITES signs what it writes: `host.who(request)` is the same answer
`/apply` beside it gets, and `signed(change, actor)` (@yaks/api) attaches it —
without it an upload or a capture is attributed to nobody while the write next
to it is attributed. One plugin may name the caller (`authenticate` on its
`./routes`, a factory like every other export, so it can read the graph to
answer); where it names nobody, the answer is this process itself.

## Who a process writes as, and what starting up IS

There is no configured actor, because a run of a program is not a singleton: two
`yak` commands and a `yak serve` over one file are three writers. Every `yak`
process — a command, an HTTP server, a TUI — writes its own row when it opens a
graph (@yaks/process `started`):

```
process{pid, command, cwd}   …and exit{code} when it is over
```

That row is what its own writing is attributed to. A change reaching `apply()`
with no `$actor` at all — a rule's effect, a bulk load poured in through
`yak apply` — is this process's writing and is stored attributed to it, so
`created.by` answers _which run wrote this_ and a child process's row, written
by its parent, records whose child it is without needing a column for it. A
request that authenticated somebody is signed with that identity instead.

STARTING UP is that row appearing, so start-up work is an ordinary post-commit
effect: a plugin registers `created(process)` and compares the entity against
`host.me` (`@yaks/spawn/effects` re-adopts the agents a restart left running,
`@yaks/session/effects` frees the locks a dead holder left). Each takes a
`lease` (@yaks/effects) named for the work, so two processes starting together
do not both do it. There is no `./boot` subpath and no start-up hook this
package has to offer.

## What `compose` does

[`compose(config)`](./serve.ts) assembles the whole thing, in order:

1. imports each plugin's subpath exports, one subpath apiece, skipping the ones
   it does not export and refusing a plugin that exports none;
2. loads every `./vocab`'s `docs` and `keywords` into one vocabulary
   (@yaks/vocab `loadVocab` — a component declared twice is a conflict);
3. opens the SQLite file (@yaks/sqlite), runs the migrations, and builds the
   store with every `./vocab`'s `derived` columns, every `./rules`'s `extend`
   clause compilers, and a full-text index over every column any vocabulary
   declared `search: true` (@yaks/fts) — so a bare word in any query is a text
   match and `/mcp` lists a ranked `search`;
4. builds the graph over it with every `./rules` plus the post-commit effect
   registry (@yaks/effects), whose writes go through the graph's own `apply()`,
   trusted;
5. registers every `./effects`;
6. joins the vocabulary's `tool: true` declarations to the functions each
   `./tools` exports (@yaks/graph `loadTools`) — a declaration nobody implements
   is a load error, not a tool that lists and then fails;
7. mounts the HTTP endpoints: @yaks/api at `/apply`, `/query` and `/ws`,
   @yaks/mcp at `/mcp`, then the plugins' own routes;

and finally writes this process's own `process` row, whose creation is every
plugin's start-up pass.

It returns a `Served`: the host, its `me`, its `tools`, its `runner`, its `fx`,
one `handler`, its `duties` and `close`. `serve(config)` is that plus
`Deno.serve`, the `tool` rows a call points at, and the calls a crash left
claimed and unanswered. Reading the config file is [./config.ts](./config.ts),
which imports nothing, so a command that only needs to know WHERE the graph is
never opens a database.

## Background jobs: the work nobody is asking for

The effect sweep and every plugin's `./service` are background jobs — `duties`
in the code: functions any process may run, one at a time, under a `lease`
(@yaks/effects) named for the package that owns the work.

```ts
await host.duties() //                    hold them while this process is up
await host.duties(AbortSignal.abort()) // one pass each, then release them
```

`serve` makes the first call and a `yak` command makes the second on its way in
(local.ts), and that is the whole difference between them — nothing here assumes
a separate process. A long-running process takes each job and renews its lease
on a timer; a one-shot command does what nobody is doing and leaves alone what
somebody is; a second long-running process waits, and takes a job over when a
killed holder's lease expires. A machine where the only thing anybody runs is
`yak tui` still fires its scheduled wakes; a machine that splits the HTTP
server, the clock and the sweep across three processes still fires each exactly
once.

A process releases every lease it holds in the same transaction that stamps its
`exit`, so an ordinary ending hands the work straight on and only a kill leaves
a lease to expire.

`close()` aborts `host.stopping` FIRST — before that last transaction and before
the database is closed — so a plugin that armed a timer of its own hangs it off
that signal and nothing is left pending over a store that is gone. A process
ending is one fact, and everything it was doing on its own stops on it.

## The command line

`cli(commands, opts)` is the entry point: hand it commands and it reads the
command line — the subcommand, either order of a two-word tool, the arguments
through that tool's own input schema — runs the one it found, and returns the
exit code (0 succeeded, 1 the tool or the server refused, 2 the command line was
wrong). A program with subcommands of its own passes more; the first to claim a
name wins, so the order of the list is the precedence.

```ts
import { cli, helpTool } from '@yaks/cli'

Deno.exitCode = await cli([helpTool(opts), ...mine], opts)
```

Flags lifted off every command line: `--host`, `--config`, `--json`, `--timing`,
`--help`. An argument value written `@path` is read from that file, and `-` is
read from stdin. `$YAKS_TOKEN` is the bearer token when set, otherwise the one
`yak login` saved.

The usage page groups a noun's verbs under it — `graph` holds `apply`, `query`,
`show` and `schema` — and a tool that declared one word alone stands above them.
A noun on its own prints that block by itself. So `yak graph`, the same word
with `--help`, and `yak help graph` all ask one question: what can this word do.
