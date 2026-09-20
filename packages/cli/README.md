# @yaks/cli

The `yak` command, and the server behind it.

Two halves, one vocabulary of tools:

- **the client** — every tool an MCP server lists is a subcommand, read at run
  time, with the command line mapped through each tool's own input schema;
- **the host** (`yak serve`, [./serve.ts](./serve.ts)) — one config file naming
  plugin packages, whose facets are imported one subpath at a time and composed
  into a running graph with its doors on it. There is no other server wiring: a
  server IS a config and a list of packages.

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
  "plugins": ["@yaks/harness", "./plugins/mail"],
  "port": 8787,
  "actor": "me"
}
```

| field      | what it says                                                                  |
| ---------- | ----------------------------------------------------------------------------- |
| `db`       | the SQLite file, or `:memory:`. Relative to the config file itself.           |
| `plugins`  | the packages, by import specifier; a relative one resolves against the config |
| `port`     | what to listen on (default 8787)                                              |
| `hostname` | which interface                                                               |
| `actor`    | the eid every request is signed with, where no plugin authenticates           |
| `numbers`  | whether the store mints human numbers beside eids (default true)              |
| `name`     | what the MCP door calls itself                                                |

**There is no default database.** `db`, or `DB_PATH` in the environment, or the
host refuses to start: the path anybody would pick as a default is somebody's
live graph.

## A plugin is a package, and a facet is a subpath

No manifest, no registry, no activation. A plugin's `exports` map names one
subpath per FACET it has, and the host imports `<plugin>/<facet>` for the facets
it runs. A subpath the package does not export is a facet it does not have, and
is skipped; a subpath that exists and fails to import is an error, never a skip.
A specifier naming a package with none of the five is a typo in the config, and
says so.

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

| subpath     | what it exports                                               | may import          |
| ----------- | ------------------------------------------------------------- | ------------------- |
| `./vocab`   | `docs`, `keywords?`, `derived?`                               | nothing server-side |
| `./rules`   | `rules: (host) => Plugin[]`                                   | anything            |
| `./tools`   | `runs: Runs` — the runs behind its `tool: true` declarations  | ajv, SQL, anything  |
| `./effects` | `effects: (host) => Watch[]`                                  | anything            |
| `./routes`  | `routes: (host) => Route[]`, `authenticate?`                  | anything            |
| `./views`   | `views` — @yaks/render renderers for the web door and a TUI   | nothing server-side |
| `.`         | types, and the pure functions the package offers as a library |                     |

```ts
// @yaks/mail/vocab
export let docs = [mailDoc]
export let keywords = [mailKeywords]
export let derived = (vocab) => mailRead(vocab)

// @yaks/mail/rules
export let rules = (host) => [mailbox({ domain: host.config.domain })]

// @yaks/mail/routes
export let routes = (host) => [{ method: 'POST', path: '/inbound', handle }]
export let authenticate = (request) => who(request) // at most one plugin may say
```

`./vocab` and `./views` are the two the WEB door imports, of every package, so
neither may reach storage, SQL or a runtime; `deno task check:browser` type-
checks both with only the web platform in scope. That is what lets a browser
load what a plugin SAYS without loading what it DOES — `@yaks/process/vocab`
describes a running program where `@yaks/process` starts one.

`yak serve` takes the first five. `./views` is nobody's server business.

`host` is `{ config, vocab, storage, sql, graph }`. `graph` is live from the
moment the graph is open — a factory may keep it, and may not call it before it
returns. A `rules` factory runs at compose time and may install tables of its
own through `host.sql`. A facet factory need not take the whole host: it names
the parts it uses (`(host: { vocab: Vocab }) => …`), which is how a package says
what it needs without importing this one.

A **route** is `{ method, path, handle }` (@yaks/api `Route`): `handle` is a
plain `(Request) => Response`, `path` is exact or ends in `*` for a prefix, and
`method` is the verb or `*` for any. Anything no route claims falls through to
the graph's own doors, which refuse it in the wire's shape.

## What `compose` does

[`compose(config)`](./serve.ts) is the whole host, in order:

1. imports each plugin's facets, one subpath apiece, skipping the subpaths it
   does not export and refusing a plugin that exports none;
2. loads every `./vocab`'s `docs` and `keywords` into one vocabulary
   (@yaks/vocab `loadVocab` — a word declared twice is a conflict);
3. opens the SQLite file (@yaks/sqlite), runs the migration control, and binds
   the store with every `./vocab`'s `derived` columns;
4. builds the graph over it with every `./rules` plus the effects registry
   (@yaks/effects), whose writes go through the graph's own `apply()`, trusted;
5. registers every `./effects`;
6. joins the vocabulary's `tool: true` declarations to the `./tools` runs
   (@yaks/graph `loadTools`) — a declaration nobody implements is a load error,
   not a word that lists and then fails;
7. mounts the doors: @yaks/api at `/apply`, `/query` and `/ws`, @yaks/mcp at
   `/mcp`, then the `./routes`.

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
