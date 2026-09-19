# @yaks/cli

The `yak` command, and the server behind it.

Two halves, one vocabulary of tools:

- **the client** — every tool an MCP server lists is a subcommand, read at run
  time, with the command line mapped through each tool's own input schema;
- **the host** (`yak serve`, [./serve.ts](./serve.ts)) — one config file naming
  plugin modules, imported and composed into a running graph with its doors on
  it. There is no other server wiring: a server IS a config and a list of
  modules.

```sh
deno install -gAf jsr:@yaks/cli/yak

yak app_list                       # a tool the server lists
yak serve --config yak.json        # the doors onto the graph that config names
yak --config yak.json session list # that graph's own tools, locally
```

## The config

One JSON file. `--config` names it, else `$YAK_CONFIG`.

```json
{
  "db": "graph.db",
  "plugins": ["@yaks/harness/plugin", "./plugins/mail.ts"],
  "port": 8787,
  "actor": "me"
}
```

| field      | what it says                                                                 |
| ---------- | ---------------------------------------------------------------------------- |
| `db`       | the SQLite file, or `:memory:`. Relative to the config file itself.          |
| `plugins`  | the modules, by import specifier; a relative one resolves against the config |
| `port`     | what to listen on (default 8787)                                             |
| `hostname` | which interface                                                              |
| `actor`    | the eid every request is signed with, where no plugin authenticates          |
| `numbers`  | whether the store mints human numbers beside eids (default true)             |
| `name`     | what the MCP door calls itself                                               |

**There is no default database.** `db`, or `DB_PATH` in the environment, or the
host refuses to start: the path anybody would pick as a default is somebody's
live graph.

## A plugin is a plain module

No manifest, no registry, no activation. A plugin exports named parts and the
host takes the ones it runs; a part it does not have is a part it does not
export. Every export is optional.

```ts
export let vocab = [mailDoc] // the components and tools it declares
export let keywords = [mailKeywords] // JSON Schema keywords those use
export let derived = (vocab) => mailRead(vocab) // columns computed, not kept
export let rules = (host) => [mail(host.vocab)] // what a batch means
export let runs = { mail_send } // the runs behind its tool declarations
export let effects = (host) => [{ comp: 'mail', created: deliver }] // after a commit
export let routes = [{ method: 'POST', path: '/inbound', handle }] // HTTP it adds
export let authenticate = (request) => who(request) // at most one plugin may say
```

`host` is `{ config, vocab, storage, sql, graph }`. `graph` is live from the
moment the graph is open — a factory may keep it, and may not call it before it
returns. A `rules` factory runs at compose time and may install tables of its
own through `host.sql`.

A **route** is `{ method, path, handle }`: `handle` is a plain
`(Request) => Response`, `path` is exact or ends in `*` for a prefix, and
`method` is the verb or `*` for any. Anything no route claims falls through to
the graph's own doors, which refuse it in the wire's shape.

## What `compose` does

[`compose(config)`](./serve.ts) is the whole host, in order:

1. imports each plugin module;
2. loads every `vocab` document and `keywords` into one vocabulary (@yaks/vocab
   `loadVocab` — a word declared twice is a conflict);
3. opens the SQLite file (@yaks/sqlite), runs the migration control, and binds
   the store with every plugin's `derived` columns;
4. builds the graph over it with every plugin's `rules` plus the effects
   registry (@yaks/effects), whose writes go through the graph's own `apply()`,
   trusted;
5. registers every plugin's `effects`;
6. joins the vocabulary's `tool: true` declarations to the plugins' `runs`
   (@yaks/graph `loadTools`) — a declaration nobody implements is a load error,
   not a word that lists and then fails;
7. mounts the doors: @yaks/api at `/apply`, `/query` and `/ws`, @yaks/mcp at
   `/mcp`, then the plugins' own routes.

It answers a `Served`: the host, its `tools`, its `fx`, one `handler`, and
`close`. `serve(config)` is that plus `Deno.serve`. `words(host)` is the same
tools as command-line words, which is what `yak --config …` runs.

## The client half

`cli(tools, opts)` is the seam: hand it tools and it reads the line — the word,
either order of a two-word tool, the arguments through that tool's own input
schema — runs the one it found, and answers the exit code (0 said, 1 refused, 2
the line was wrong). A program with words of its own passes more tools; the
first tool to name a word wins, so the order of the list is the precedence.

```ts
import { cli, helpTool } from '@yaks/cli'

Deno.exitCode = await cli([helpTool(opts), ...mine], opts)
```

Globals lifted off every line: `--host`, `--config`, `--json`, `--timing`,
`--help`. A value that is `@path` is that file and `-` is stdin. `$YAKS_TOKEN`
is the bearer when set, otherwise the one `yak login` wrote.
