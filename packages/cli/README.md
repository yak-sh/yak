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
yak --config yak.json task list    # a line aimed at that server
```

## Where a line is aimed

**A config names a SERVER, not a second copy of the graph.**
`yak serve
--config yak.json` binds the `hostname` and `port` that config says,
and every other line naming the same config talks to whatever is listening
there, over `/mcp`. One graph, one writer, one tool list — the same words
whether the caller is a person, a lifecycle hook or an agent. There is no local
path that opens the database a server is holding, and there will not be one:
that is a second writer, a second runner and a second boot.

In order, a line goes to:

| said                       | where it goes                                                       |
| -------------------------- | ------------------------------------------------------------------- |
| `--host <host>`            | there — a bare name is `https://`, an origin is as given            |
| `$YAKS_HOST`               | there                                                               |
| `--config` / `$YAK_CONFIG` | `http://<hostname>:<port>` of that config (`127.0.0.1:8787` unsaid) |
| nothing                    | `yaks.app`                                                          |

So a box whose shell exports `YAK_CONFIG=/etc/yak.json` types `yak task list`
and reaches its own server; `yak --host yaks.app app_list` still reaches the
platform from the same shell.

## The config

One JSON file. `--config` names it, else `$YAK_CONFIG`.

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
  "port": 8787,
  "actor": "me"
}
```

| field      | what it says                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `db`       | the SQLite file, or `:memory:`. Relative to the config file itself.                                                      |
| `plugins`  | the packages, by import specifier; a relative one resolves against the config                                            |
| `port`     | what `serve` listens on, and so where a client aimed at this config talks (default 8787)                                 |
| `hostname` | which interface `serve` binds; a client reads it as the host to talk to                                                  |
| `actor`    | the eid every request is signed with, where no plugin authenticates                                                      |
| `numbers`  | whether the store mints human numbers beside eids (default true)                                                         |
| `adopt`    | take the `num` a batch's identity carries instead of minting one — what a store seeded from another store's export needs |
| `name`     | what the MCP door calls itself                                                                                           |

### What a config says to one plugin

A `plugins` entry is a bare specifier, or `{"use": "<specifier>", "with": {…}}`
— that plugin's own options, handed to each of its facet factories beside the
host (`rules(host, options)`, `effects(host, options)`,
`routes(host, options)`). A plugin nobody configured is handed `{}`, so a
factory reads its options without guarding first. The keys are the PLUGIN's;
nothing here interprets them, which is what keeps a config from growing a field
per package.

That is the answer to the one thing a plugin could not say alone: what an effect
ACTS on. `@yaks/mail`'s outbound half hands a letter to a transport — an
account, a token, an endpoint — and none of that is a fact about the graph, so
the config names it and `@yaks/mail/effects` builds it. Name no sender and there
is no outbound watch, which is what a graph that only receives mail wants.

**A secret is named, not held.** An option written `{"env": "NAME"}` — at any
depth — is the environment's value at the moment the config is read, so a config
file is committable and the token is not in it. A name nothing exports reads as
undefined and the plugin refuses in its own words.

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

| subpath     | what it exports                                                 | may import          |
| ----------- | --------------------------------------------------------------- | ------------------- |
| `./vocab`   | `docs`, `keywords?`, `derived?`                                 | nothing server-side |
| `./rules`   | `rules: (host, options) => Plugin[]`, `extend?` (@yaks/sql)     | anything            |
| `./tools`   | `runs: (host, options) => Runs` — behind its `tool: true` words | ajv, SQL, anything  |
| `./effects` | `effects: (host, options) => Watch[]`                           | anything            |
| `./routes`  | `routes: (host, options) => Route[]`, `authenticate?`           | anything            |
| `./boot`    | `boot: (host, options)` — the one pass made at start-up         | anything            |
| `./service` | `service: (host, options, signal)` — what keeps running         | anything            |
| `./views`   | `views` — @yaks/render renderers for the web door and a TUI     | nothing server-side |
| `./words`   | `words` — what the package adds to a COMMAND LINE               | anything            |
| `.`         | types, and the pure functions the package offers as a library   |                     |

```ts
// @yaks/mail/vocab
export let docs = [mailDoc]
export let keywords = [mailKeywords]
export let derived = (vocab) => mailRead(vocab)

// @yaks/mail/rules
export let rules = (host, options) => [mailbox({ domain: options.domain })]

// @yaks/embedding/rules — the same subpath's other half: what a QUERY may say
export let extend = (host, options) => [semantic(host.sql, embedderOf(options))]

// @yaks/sqlite/tools — a run reads the host's own connection, and its options
export let runs = (host, options) => ({ storage_check: (_, ctx) => … })

// @yaks/mail/routes
export let routes = (
  host,
  options,
) => [{ method: 'POST', path: '/inbound', handle }]
export let authenticate = (request) => who(request) // at most one plugin may say
```

`./vocab` and `./views` are the two the WEB door imports, of every package, so
neither may reach storage, SQL or a runtime; `deno task check:browser` type-
checks both with only the web platform in scope. That is what lets a browser
load what a plugin SAYS without loading what it DOES — `@yaks/process/vocab`
describes a running program where `@yaks/process` starts one.

`yak serve` takes the first five. `./views` is nobody's server business.

### A word is a tool that runs HERE

`./words` is the one facet no server takes. A tool runs where the graph is; a
word runs on the box that typed it, against the checkout it is standing in —
`yak land` fast-forwards THIS branch, and a `land` tool would fast-forward a
branch on the server's box instead, which is nobody's intent. So a word is not
declared in a `vocab.json`, is never listed by `/mcp`, and is not read from the
config: the `yak` command imports the ones it ships with (`here` in
[./yak.ts](./yak.ts)), because a word has to work in a checkout with no config
and no server in sight.

It is declared the way a tool is — a name, a description, an input schema the
line is mapped through — so it is listed, helped and completed from the one
declaration. Only the run differs: arguments in and an exit code out, printing
as it goes, where a tool's is bundles in and bundles out. That shape is `Word`
(./run.ts), and a contributing package writes the literal without importing it:

```ts
// @yaks/git/words
export let words = [{
  name: 'land',
  description: 'Land the branch you are standing on…',
  inputSchema: { type: 'object', properties: { 'allow-revert': … } },
  run: async (args, c) => (c.out(`landed ${sha}`), 0),
}]
```

`host` is `{ config, vocab, storage, sql, graph, who }`. `storage` and `graph`
are live from the moment each is open — a factory may keep them, and may not
call them before it returns. A `rules` factory runs at compose time and may
install tables of its own through `host.sql`; an `extend` factory, beside it,
answers with the @yaks/sql extensions the STORE is built with, which is how a
package holding an index of its own teaches the query compiler a clause it
declines alone (`.near` over vectors, a text term over an index) — every door
that reads then has it, and nobody wires one up. A facet factory need not take
the whole host: it names the parts it uses (`(host: { vocab: Vocab }) => …`),
which is how a package says what it needs without importing this one.

A **route** is `{ method, path, handle }` (@yaks/api `Route`): `handle` is a
plain `(Request) => Response`, `path` is exact or ends in `*` for a prefix, and
`method` is the verb or `*` for any. Anything no route claims falls through to
the graph's own doors, which refuse it in the wire's shape.

A route that WRITES signs what it writes: `host.who(request)` is the same answer
`/apply` beside it gets, and `signed(batch, actor)` (@yaks/api) is how it rides
along — without it an upload or a capture is by nobody while the write next to
it is attributed. One plugin may say who is calling (`authenticate` on its
`./routes`, a factory like every facet, so it can read the graph to say it);
where it says nobody, the answer is the host itself.

## Who the host writes as

`actor` in the config is one sentence about a whole server: who its own writing
is by. A NAME is the host's own identity — it mints that entity at start-up and
derives its id from the name (@yaks/kernel `hosted`), so `"actor": "yak"` is a
server that is `yak` in every graph it writes to and nothing has to be looked
up. An id this family minted (a uuid, a content hash) names something somebody
else made, and is signed with as it stands.

It is not only the doors. A batch that reaches `apply()` with no `$actor` at all
— a rule's effect, a plugin's boot pass, a load poured in through `yak apply` —
is the host's own writing and lands signed with it, so there is no such thing
here as a row nobody wrote. A door that authenticated somebody signs over it.

## What `compose` does

[`compose(config)`](./serve.ts) is the whole host, in order:

1. imports each plugin's facets, one subpath apiece, skipping the subpaths it
   does not export and refusing a plugin that exports none;
2. loads every `./vocab`'s `docs` and `keywords` into one vocabulary
   (@yaks/vocab `loadVocab` — a word declared twice is a conflict);
3. opens the SQLite file (@yaks/sqlite), runs the migration control, and binds
   the store with every `./vocab`'s `derived` columns, every `./rules`'s
   `extend` clause compilers, and a full-text index over every column any
   vocabulary declared `search: true` (@yaks/fts) — so a bare word on any query
   line is a match and `/mcp` lists a ranked `search`;
4. builds the graph over it with every `./rules` plus the effects registry
   (@yaks/effects), whose writes go through the graph's own `apply()`, trusted;
5. registers every `./effects`;
6. joins the vocabulary's `tool: true` declarations to the `./tools` runs
   (@yaks/graph `loadTools`) — a declaration nobody implements is a load error,
   not a word that lists and then fails;
7. mounts the doors: @yaks/api at `/apply`, `/query` and `/ws`, @yaks/mcp at
   `/mcp`, then the `./routes`.

It answers a `Served`: the host, its `tools`, its `fx`, one `handler`, and
`close`. `serve(config)` is that plus `Deno.serve`. Reading the config file is
`./config.ts`, which imports nothing — a line that only needs the ADDRESS must
never drag a database in.

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
