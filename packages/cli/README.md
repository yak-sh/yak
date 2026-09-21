# @yaks/cli

The `yak` command, and the graph behind it.

Two halves, one vocabulary of tools:

- **the composition** ([./serve.ts](./serve.ts)) — one config file naming plugin
  packages, whose facets are imported one subpath at a time and composed into a
  running graph. A command line composes it to run one tool and exits
  ([./local.ts](./local.ts)); `yak serve` composes the same thing and puts the
  HTTP doors on it. There is no other wiring: a graph IS a config and a list of
  packages.
- **the client** ([./platform.ts](./platform.ts)) — for a graph this box cannot
  open as a file, every tool an MCP server lists is a subcommand, read at run
  time, with the command line mapped through each tool's own input schema.

```sh
deno install -gAf jsr:@yaks/cli/yak

yak --config yak.json task list    # opens that graph, runs the tool, exits
yak land                           # the same, on the checkout you stand in
yak serve --config yak.json        # the HTTP doors onto the same graph
yak app_list                       # a tool yaks.app lists, over /mcp
```

## Where a line runs

**There is no server.** A config names a GRAPH — a SQLite file and the plugins
that speak over it — and a `yak` line OPENS it, composes them, runs the tool in
its own process and exits. SQLite in WAL mode takes as many writers as there are
lines typed, each serialized by the file itself, so nothing bottlenecks on a
process somebody had to remember to start. `yak serve` is one more process over
the same file.

`--host` is for a graph this box cannot open as a file — yaks.app, a box
somewhere else — and then the line talks to that door over `/mcp`. Said with
`--config`, the two name two places and the line is refused.

In order, a line runs:

| said              | where                                                 |
| ----------------- | ----------------------------------------------------- |
| `--config <path>` | here, over the graph that config names                |
| `--host <host>`   | there — a bare name is `https://`, an origin as given |
| `$YAKS_HOST`      | there                                                 |
| `$YAK_CONFIG`     | here, over the graph that config names                |
| nothing           | `yaks.app`                                            |

So a box whose shell exports `YAK_CONFIG=/etc/yak.json` types `yak task list`
and opens its own graph; `yak --host yaks.app app_list` still reaches the
platform from the same shell.

A tool runs the same way either way: the line writes a CALL and the runner
answers it (@yaks/tools), so the transcript says the same thing about a tool a
person typed and a tool an agent asked for, and the rules, the effects and the
attribution are one set for both.

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
  "port": 8787
}
```

| field      | what it says                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `db`       | the SQLite file, or `:memory:`. Relative to the config file itself.                                                      |
| `plugins`  | the packages, by import specifier; a relative one resolves against the config                                            |
| `port`     | what `serve` listens on (default 8787)                                                                                   |
| `hostname` | which interface `serve` binds                                                                                            |
| `numbers`  | whether the store mints human numbers beside eids (default true)                                                         |
| `adopt`    | take the `num` a batch's identity carries instead of minting one — what a store seeded from another store's export needs |
| `name`     | what the MCP door calls itself                                                                                           |
| `lease`    | how long this process's hold on a DUTY stands before another may take it, in ms (default 30_000)                         |

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
depth — is the environment's value at the moment it is ASKED FOR, so a config
file is committable, the token is not in it, and a key exported after the host
booted is read by the next pass that wants one. A name nothing exports reads as
undefined and the plugin says, in its own words, what it is waiting for.

**Missing config never prevents boot.** A facet factory does not throw over
config that has not arrived or cannot be used: it contributes nothing, says why
once, and its `check` tool keeps answering the question. A host comes up with
its mail unsent, its uploads unmounted or its vectors unbuilt, and starts doing
each the moment its config is there — rather than refusing to start at all.

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
| `./service` | `service: (host, options, signal)` — what keeps running         | anything            |
| `./views`   | `views` — @yaks/render renderers for the web door and a TUI     | nothing server-side |
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

`compose` takes every facet but `./views`, which is nobody's business here.

### A tool that acts on the BOX

Some tools are not about the graph at all. `land` fast-forwards a branch;
`hooks install` writes a settings file. They are tools like any other — declared
in a `vocab.json`, listed by `/mcp`, run by the same runner — and what tells
them where to act is `ctx.cwd`, the directory the process running the call
stands in. On a command line that is where the person typed, because the line
opened the graph itself and ran the tool in the same process.

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

A tool that ANSWERS a refusal rather than landing throws a `CallError`: the
runner records it, and the command line's exit code says which it was.

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

## Who a process writes as, and what a start IS

There is no configured actor, because a run of a program is not a singleton: two
`yak` lines and a `yak serve` over one file are three writers. Every `yak`
process — a line, a door, a TUI — writes its own row when it opens a graph
(@yaks/process `started`):

```
process{pid, command, cwd}   …and exit{code} when it is over
```

That row is what its own writing is signed by. A batch reaching `apply()` with
no `$actor` at all — a rule's effect, a load poured in through `yak apply` — is
this process's writing and lands signed with it, so `created.by` answers _which
run wrote this_ and a child's row, written by its parent, says whose child it is
without a column for it. A door that authenticated somebody signs over it.

A START is that row appearing, so start-up work is an ordinary effect: a plugin
registers `created(process)` and compares the entity against `host.me`
(`@yaks/spawn/effects` re-adopts the agents a restart left running,
`@yaks/session/effects` frees the locks a dead holder left). Each takes a
`lease` (@yaks/effects) named for the duty, so two processes starting together
do not both do it. There is no `./boot` facet and no moment a host has to offer.

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

and finally writes this process's own `process` row, whose birth is every
plugin's start-up pass.

It answers a `Served`: the host, its `me`, its `tools`, its `runner`, its `fx`,
one `handler`, its `duties` and `close`. `serve(config)` is that plus
`Deno.serve` and the call reconciliation a door owes its own ledger. Reading the
config file is `./config.ts`, which imports nothing, so a line that only needs
to know WHERE never drags a database in.

## Duties: the work nobody is asking for

The effect sweep and every plugin's `./service` are DUTIES: functions any
process may hold, one at a time, under a `lease` (@yaks/effects) named for the
package that owns the work.

```ts
await host.duties() //                    hold them while this process is up
await host.duties(AbortSignal.abort()) // one pass each, then hand them back
```

`serve` makes the first call and a `yak` line makes the second on its way in
(local.ts), and that is the whole difference between them — nothing here assumes
a separate process. A door or a TUI takes each duty and renews it on a beat; a
line does what nobody is doing and leaves alone what somebody is; a second
long-lived process waits, and takes a duty over when a killed holder's lease
lapses. A box where the only thing anybody runs is `yak tui` still fires its
wakes; a box that splits the doors, the clock and the sweep across three
processes still fires each exactly once.

A process lets go of every duty it holds in the same batch that stamps its
`exit`, so an ordinary ending hands the work straight on and only a kill leaves
a lease to lapse.

`close()` aborts `host.stopping` FIRST — before that last batch and before the
database is let go — so a facet that armed a timer of its own hangs it off that
signal and nothing is left pending over a store that is gone. A host ending is
one fact, and everything this process was doing on its own stops on it.

## The command line

`cli(commands, opts)` is the seam: hand it commands and it reads the line — the
word, either order of a two-word tool, the arguments through that tool's own
input schema — runs the one it found, and answers the exit code (0 said, 1
refused, 2 the line was wrong). A program with commands of its own passes more;
the first to name a word wins, so the order of the list is the precedence.

```ts
import { cli, helpTool } from '@yaks/cli'

Deno.exitCode = await cli([helpTool(opts), ...mine], opts)
```

Globals lifted off every line: `--host`, `--config`, `--json`, `--timing`,
`--help`. A value that is `@path` is that file and `-` is stdin. `$YAKS_TOKEN`
is the bearer when set, otherwise the one `yak login` wrote.

The usage page gathers a noun's verbs under it — `graph` holds `apply`, `query`,
`show` and `schema` — and a tool that said one word alone stands above them. A
noun on its own is that block by itself, so `yak graph`, `yak graph
--help` and
`yak help graph` all ask the same question: what can this word do.
