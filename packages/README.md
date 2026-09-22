# @yaks packages

TypeScript libraries for storing, querying and rendering records, plus packages
for agent sessions, tools and application domains. Packages can be imported
individually, but many depend on other `@yaks/*` packages. They are intended for
publication through JSR and npm; runtime requirements vary by package.

## Start here

An **entity** is a record identified by `entity.eid`. Its **components** are
named objects describing different aspects of the record. A **bundle** is one
entity's components as a JSON object. A **batch** is a list of changes applied
in one transaction. A **vocabulary** is the schema declaring the components,
columns and relationships a graph accepts.

This complete example stores documents in memory. `loadVocab()` loads the
schema, `ram()` provides storage, and `graph()` validates and applies changes:

```ts
import { docDoc } from '@yaks/doc'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab([docDoc])
let g = graph({ storage: ram(vocab), vocab })
await g.apply([{
  entity: { eid: 'first-note' },
  doc: { title: 'Getting started', body: 'A document stored as components.' },
}])
console.log(await g.read('.doc.title="Getting started"'))
```

RAM contents disappear when the process exits. Use [@yaks/sqlite](./sqlite) for
persistent local storage, [@yaks/api](./api) for HTTP access, and
[@yaks/client](./client) for a synchronized browser graph. Each README documents
its exports, setup, storage behavior and limitations. The package index below is
grouped approximately by function, **not** by dependency order.

## Package index

- **[@yaks/query](./query)** — Parse query strings into an abstract syntax tree
  (AST), or build the same tree from code. It understands operators, lists,
  ranges and directives, not application field meanings. Time-parsing helpers
  are separate from parsing scalar query values.

- **[@yaks/yaml](./yaml)** — Parse YAML or JSON text and split Markdown
  frontmatter from its body. Frontmatter can contain a partial bundle. Its graph
  dependency is type-only; it uses the standard YAML parser. `fill()`
  substitutes `{{name}}` placeholders. The package performs no file I/O.

- **[@yaks/vocab](./vocab)** — describe a component vocabulary as JSON Schema
  (2020-12) plus a small custom keyword vocabulary, and interrogate it at
  runtime: column types, path routing, display ordering, instance checks.
- **[@yaks/id](./id)** — entity ids: generate an eid, and turn the `prefix` a
  component declares plus a number into a human-readable id (`B-7`) and back. It
  also owns the number itself — the `num` column on the `entity` row, the
  allocator behind `$num`, and the resolver from `B-7` to an eid — so a graph
  that does not load this package has no numbers and no prefixes anywhere.
- **[@yaks/names](./names)** — the other way to address an entity: the
  components a vocabulary marks `by_name`, the column each one stores its name
  in, and the lookup for a name somebody typed.
- **[@yaks/sql](./sql)** — Compile a query AST against a loaded vocabulary into
  SQL and bound parameters. Its intermediate representation describes relational
  operations but also contains SQL fragments; the supplied renderer targets
  SQLite. Extensions implement full-text, relationship and vector queries.

- **[@yaks/archetype](./archetype)** — Record each distinct set of
  component-table names in one entity with a SHA-256-derived id, and maintain an
  `archetype` reference on entities. Cached table-presence matches and
  component-add/remove transitions reduce repeated work. SQLite backfills from
  physical tables and retires obsolete descriptors (records describing a table
  set); readers loading fewer schemas still derive the same ids for the same
  sets.

- **[@yaks/sqlite](./sqlite)** — A SQLite storage adapter. It compiles queries,
  returns bundles and applies component changes through the graph `Storage`
  interface. The caller supplies a database driver; the adapter creates
  component tables from schemas.

- **[@yaks/blob](./blob)** — Store text and binary content by hash. A marked
  text column stores a hash while a table, directory or object store holds the
  content. Text substitution requires both the graph plugin and read resolution.
  SQL content and component writes share a transaction only on the same
  connection; files and object-store writes cannot roll back with SQL.

- **[@yaks/fts](./fts)** — Build SQLite FTS5 indexes and compile text search
  terms. By default it indexes stored scalar text columns marked `search: true`,
  with one index per component. A bare query term needs this or another search
  extension.

- **[@yaks/embedding](./embedding)** — Store vectors and compile
  `.near=<entity>` and `.order=similar`. An injected embedding function
  determines what similarity means. Watched writes schedule debounced update
  passes; they are not an unconditional startup or periodic refresh. Bounded
  passes need further scheduling to process all stale rows.

- **[@yaks/telemetry](./telemetry)** — Retired standalone SQLite tool-call log.
  New code records `call`, `execution`, `result`, timing, attribution and
  failures in the graph through
  [@yaks/tools](./tools/README.md#what-replaced-the-tool-call-log), which can be
  queried for telemetry. Only the legacy server imports this package; removal is
  planned with that server.

- **[@yaks/match](./match)** — Evaluate supported query AST clauses against
  bundles in memory. Tests compare shared behavior with SQL, but search,
  ordering and unsupported queries differ; see the package's compatibility
  table.

- **[@yaks/graph](./graph)** — The entity/component API and phased `apply()`
  operation: filter, normalize, validate and commit changes using a supplied
  `Storage` adapter. Plugins add schema declarations and lifecycle hooks.
  `apply()` returns composed patches, not complete entity snapshots.

- **[@yaks/render](./render)** — Select renderers by query specificity and a
  requested view name (more specific name segments are on the right), collect
  component actions, and select column renderers by schema. Renderers receive an
  element-construction function so the caller chooses the output representation.

- **[@yaks/preact](./preact)** — Connect the render registry to Preact. Its
  `Entity` component reads a function-based store and subscribes while mounted,
  using Preact's element-construction function for portable renderers.

- **[@yaks/html](./html)** — Render the same registry to server-side HTML using
  @yaks/preact and Preact's serializer, without a browser DOM.

- **[@yaks/text](./text)** — Markdown and plain text from those same trees,
  preserving headings, lists, links, code and emphasis while stripping control
  bytes from every text leaf and destination.
- **[@yaks/markdown](./markdown)** — Parse GitHub Flavored Markdown into
  structural nodes, not an HTML string or terminal control sequence. Its link
  filter permits relative URLs and explicit `http`, `https` and `mailto`
  schemes.

- **[@yaks/tui](./tui)** — the same Preact trees on a terminal: a fake DOM, a
  swappable backend (a diffing ANSI painter today), and the three widgets a
  console app is made of — a scrolling transcript, a multi-line input box, and a
  frame with a sidebar of pluggable panels.
- **[@yaks/ram](./ram)** — Implement graph storage with a synchronous in-memory
  `Map` and @yaks/match queries, suitable for browsers and tests. Shared
  operations are tested against SQLite, but RAM does not support every SQL query
  or the multi-entity declarative rules that need `Tx.bindings`.

- **[@yaks/edge](./edge)** — links between entities as a component: the
  `edge{from, to}` component an entity carries, the id derived from the
  from/relation/to triple it records, the relations a vocabulary declares, and
  traversal — both as a walk over storage and as the `@yaks/sql` extension that
  compiles `.cites->p1` and `.edges`.
- **[@yaks/key](./key)** — Store lookup values as entities with `key{of, value}`
  plus an application tag such as `isbn`, `email` or `alias`. Each key id is
  derived from `sha256("<kind>|<value>")`, making a value unique within its
  kind. An entity can have several such values, each referencing its owner
  through `of`.

- **[@yaks/alias](./alias)** — the kind of key that is a name: `alias{name}` on
  an entity, expanded into a separate key entity, so seed data written twice
  updates one entity rather than creating two — and a name can be used anywhere
  an eid can, in a reference column and in an API request.
- **[@yaks/git](./git)** — git objects as entities: an object's eid is its SHA-1
  object id, with its SHA-256 name beside it as a key, its body in a @yaks/blob
  store, and the two traversals a pack supports (`entry`, `parent`) as edges —
  plus the builders that turn a `path → sha256` manifest into trees and a
  commit. It also models the working copy: the `repository` and `worktree` a
  checkout consists of, the landed `commit` attached to the work it is about,
  the `file` a path in a repository is, and the `cites` edge that ties a
  document to a place in one — with `revision`, `symbol`, `lines` and `quote`
  beside it, and staleness re-derived from Git. `cites check` reports the
  citations that moved or were never checked, and `cites verify` records that
  somebody looked. Its `land` tool operates on the checkout at `ctx.cwd` (the
  CLI working directory), fast-forwarding its branch into the base in the
  primary worktree. If the base moved, it rebases and returns without landing;
  rerun tests and land again.
- **[@yaks/effects](./effects)** — Run registered handlers after committed
  component changes or newly matching query patterns, isolating handler failures
  from the original transaction. An optional durable attempt log supports
  retries; it does not guarantee exactly-once external effects.
  `lease{name, holder, until}` records named background-job ownership using
  deterministic ids and transactional preconditions. Coordination requires
  suitable storage isolation and lease configuration. This package provides
  mechanisms, not domain-specific actions.

- **[@yaks/journal](./journal)** — Record committed transactions as after-images
  in three append-oriented tables on the same database transaction/connection.
  APIs read entity history, produce limited inverse changes for undo, and
  provide a cursor-based change feed. Provenance fields are skipped by default;
  explicit redaction is supported. Undo cannot reconstruct deleted entities.

- **[@yaks/doc](./doc)** — the text a person reads: `doc{title, body}`, the one
  component a task, a letter and a recipe all share, so search, editing and
  rendering are implemented once. Its `body` uses `@yaks/blob`'s `store` keyword
  without depending on the package that implements it — content-addressed when
  blob is loaded, plain text otherwise.
- **[@yaks/tools](./tools)** — Run functions that accept and return bundles,
  recording the tool declaration, `call`, claimed `execution`, and `result`.
  Direct callers invoke the runner; configured effects execute queued or
  recoverable calls. The graph stores both the operation and its outcome,
  including errors and timing.

- **[@yaks/member](./member)** — Declare space memberships, app grants and app
  access modes. A `precondition` hook rejects unauthorized writes; callers must
  separately enforce `canRead` for reads. Authentication and graph opening are
  supplied by the application. HTTP and MCP signing alone do not enforce read
  permission.

- **[@yaks/session](./session)** — Store agent transcripts as `entry` entities:
  content, model requests, tool calls/results and stops. Status is derived from
  transcript entries and outstanding calls. The package also provides model
  execution, claims on entities and conflict records for competing claims.

- **[@yaks/process](./process)** — a running program as an entity, so whatever
  needs one points at it instead of keeping a pid: `process{pid, command, cwd}`
  for the one that is running, `service{command, cwd, restart, attempts}` for
  the one that should be, `exit{code}`, and its output as @yaks/session's
  `content{body}` + `output{source}`. Four entry points over one loop — launch a
  child detached, adopt one by pid, re-adopt every unfinished row at start-up,
  and supervise the ones that should be running on a timer. The program doing
  the launching gets a row too: `started()`/`ended()` are what a process writes
  about itself, which is what it signs its writes with and what a start-up
  effect fires on — and the same rows back a session's `shell`, `wait` and
  `stop` tools, so a long-running tool call returns the process instead of
  blocking on it.
- **[@yaks/spawn](./spawn)** — combine tools, sessions and processes: a session
  whose provider is an agent CLI. The `using` component on a session's first
  entry is the request; a provider that is a command line (`claude`, `codex`) is
  started as a detached child process through @yaks/process, recorded on the
  session's own entity; and its JSON-lines stdout is read back as that session's
  entries — exactly once, tracked by the `imported{source, line}` component on
  each. It defines no components of its own.
- **[@yaks/context](./context)** — Build instruction entries with source ids and
  snapshot hashes so a transcript can record what a model was given.
  `promptEntry()` itself performs no writes; `outputView()` stores projection
  snapshots. The caller selects permitted sources and persists prompt entries.

- **[@yaks/model](./model)** — Provider-neutral conversation items,
  request/reply types and a model function interface, plus schemas for
  `provider` and `model` entities. It exports the `Tool` TypeScript type; stored
  `tool` declarations belong to @yaks/tools.

- **[@yaks/openai](./openai)** — that interface implemented over OpenAI's
  Responses API: one streamed exchange over `fetch`, a bearer token from
  `OPENAI_API_KEY` or from the Codex sign-in, and the two endpoints those tokens
  are valid for.
- **[@yaks/oauth](./oauth)** — Shared authorization-attempt and PKCE (Proof Key
  for Code Exchange) helpers, a private-store interface, and an optional Deno
  filesystem implementation. Secrets remain outside graph data.
- **[@yaks/openrouter](./openrouter)** — Implement the model interface over
  OpenRouter's Responses API, with response metadata schemas and optional PKCE
  authorization. The application supplies credentials or a private store.
- **[@yaks/kernel](./kernel)** — Shared identity, provenance and metadata
  schemas: `entity`, `created`, `updated`, `decided`, `quarantined`, `comment`,
  `image`, `favorite` and relationship tags. It also defines schema keywords
  such as `governed`, `lazy` and `well`. It ships no plugins.

- **[@yaks/task](./task)** — Task records, plans and containment relationships.
  Status is computed from marks such as `completed` and `cancelled`, using rules
  for both SQL and in-memory evaluation. Projects and saved boards belong to
  @yaks/project, not this package.

- **[@yaks/wake](./wake)** — coming back to something later, as data: a
  `wake{at, every, target, note}` on any entity, the wakes due at an instant,
  and the recurrence — a duration or a cron expression — that schedules the next
  one. It calls no handler: `tick` writes `fired` and advances the wake, and
  graph rules do the rest. The Cloudflare and Deno drivers share that same
  write.
- **[@yaks/mail](./mail)** — Store messages and delivery requests/outcomes. An
  effect on `created(mail)` sends messages that also have `deliver`, through a
  supplied transport. Incoming messages become bundles; subjects and bodies use
  @yaks/doc. Failed delivery cannot roll back the original graph transaction.

- **[@yaks/memory](./memory)** — what a person said, kept in their own words: a
  `memory` component on a `doc` whose body is what they said plus a few lines of
  context, the query that recalls them, and the text handed to an agent at the
  start of its next conversation.
- **[@yaks/persona](./persona)** — Declare human identities, agent instruction
  sets and assigned roles. Read a persona's own document and its
  included/reference documents, then render one Markdown string. The caller
  decides whether to write a file or use it directly as model context.

- **[@yaks/project](./project)** — a portfolio: the `project` work is filed
  under, the `filed` that files it, the `board` that is a saved filter over it,
  and the `venture` being built.
- **[@yaks/goal](./goal)** — an objective that is never finished, and the
  `satisfies` edge recording which work contributed to it.
- **[@yaks/design](./design)** — Store design proposals, review verdicts and
  adopted architecture as separate components. CLI/MCP tool implementations
  create and decide proposals; an approved review does not automatically add
  `architecture`.

- **[@yaks/dreaming](./dreaming)** — what an agent works on when nothing else is
  asking for its attention: a `dream` with an earliest-start time, the `recall`
  it consolidates, and the effect that starts a session on a dream whose start
  time has passed (`./effects`; the config names what gets started).
- **[@yaks/notify](./notify)** — Declare notification records, subscriptions
  (`watch` or `mute`) and chats. It stores intent and relationships, not a
  delivery service.

- **[@yaks/hook](./hook)** — Declare stored external events: source, event name,
  payload, HTTP method/path/headers and verification result. Receipt handling
  and signature verification are responsibilities of the importing application.

- **[@yaks/page](./page)** — Capture web pages with source URL, archive
  timestamp and document content. Fetching, asset capture, rewriting and
  scrubbing helpers are optional operations; the graph stores the resulting
  metadata.

- **[@yaks/tmux](./tmux)** — a terminal somebody can watch: `tmux{of, pane}`,
  what is running in it, and the target string tmux itself accepts. Components
  only — the session is the transcript, the process is the pid, and the terminal
  is the third, separate fact.
- **[@yaks/platform](./platform)** — what a hosting platform keeps about the
  apps it serves: `space`, `app`, `deploy`, `published`, `hostname`,
  `installed`, `plan`, `meter`, `signin` and `report`. Membership of a space is
  [@yaks/member](./member)'s `member`, and the access level on top of it is its
  `grant` — two separate facts, not one enum.
- **[@yaks/api](./api)** — the HTTP layer: a plain `Request` → `Response`
  handler over a graph, serving `/apply`, `/query` and the `/ws` WebSocket
  endpoint. It authenticates the writer, and a subscription is a saved query
  whose results are pushed again whenever a committed transaction changes them.
  It is also the plugin that makes a host answer HTTP at all: its `./routes`
  builds that host's one handler out of every listed plugin's routes, and its
  `serve` tool binds a port and answers with it — so `yak serve` is a plugin's
  verb rather than a command of the CLI, and a config that does not list this
  package has neither.
- **[@yaks/mcp](./mcp)** — the same graph exposed to an agent: an MCP server of
  five generic tools that accept and return bundles, served either as a portable
  `fetch` handler or over stdio, with each tool's output schema generated from
  the vocabulary. Its `./routes` is that handler at `/mcp`, one route on
  whatever is serving the host's routes.
- **[@yaks/mcp-client](./mcp-client)** — the client side of MCP: a remote MCP
  server's tools reached over Streamable HTTP and presented as the same `Tool`
  definitions a graph hands to its own model, with credentials resolved by the
  calling program.
- **[@yaks/cli](./cli)** — The `yak` command and reusable CLI APIs. Local graph
  commands load configured plugins and open storage in the same process;
  `--host` selects remote MCP and discovers its tools at runtime. Built-ins are
  `help`, `login`, `logout` and `apply`; graph tools and application commands
  add others. Multiple processes can share a SQLite WAL database, but writes
  serialize. `yak serve` runs @yaks/api's tool over the same composition rather
  than being mandatory for local commands.

- **[@yaks/harness](./harness)** — A local agent application combining SQLite,
  model execution, shell tools, graph tools and a terminal interface. Its `new`,
  `send`, `ls`, `show`, `tasks` and `models` commands use the flat @yaks/cli
  API. The default TUI backend runs in a Web Worker. Blob text is stored in
  SQLite; artifacts, private authorization state and draft recovery files also
  use the filesystem. It starts no HTTP server by default and does not require
  synchronization.

- **[@yaks/workerd](./workerd)** — that handler as a Cloudflare Worker: the
  `WebSocketPair` upgrade that `/ws` needs, the `fetch` entrypoint a Worker
  exports, authentication from a cookie or a bearer token, and the forwarding to
  a Durable Object when the graph lives in one.
- **[@yaks/durable-object](./durable-object)** — the storage adapter inside that
  Durable Object: its embedded SQLite driven through `@yaks/sqlite`, plus the
  adapter that passes a hibernatable WebSocket's frames to `@yaks/api`'s
  subscriptions.
- **[@yaks/d1](./d1)** — the other Cloudflare database, and the one that is only
  reachable asynchronously: the same `Storage`, answered with promises, where a
  transaction buffers its writes and sends them as one atomic `batch()`, because
  D1 has no interactive transaction to hold open.
- **[@yaks/sync](./sync)** — Send local graph changes to a server and reconcile
  or revert optimistic updates. Deletion batches wait for the server. Schema
  keywords `sync` and `durable` separately describe delivery and intended
  lifetime. There is no durable offline write queue or automatic retry of failed
  writes.

- **[@yaks/canvas](./canvas)** — the user interface stored as data: a `canvas`
  of `card`s each `pin`ned at a position, the `camera` a window looks through, a
  `cursor`, split `layout`s of `pane`s, folds and a shelf. The layout is stored,
  queried, shared and undone exactly like the content it frames, and the package
  ships the geometry needed to draw it.
- **[@yaks/client](./client)** — the browser layer over all of that: one call
  assembles the graph, its connection to the server and its plugins; a query
  becomes a value that updates as commits change its results; and components
  declared `sync: none` with `durable: forever` are kept in IndexedDB between
  page loads when local persistence is enabled.

## Domain plugins

Domain packages declare application data: documents, tasks, sessions, processes,
mail, memories, tools, people, projects, goals, proposals, notifications and UI
layout. A package's `vocab.json` is JSON Schema 2020-12; optional graph rules,
tools, effects or views implement behavior. An application defines its own
components the same way and combines them on entities by id.

The legacy server in `src/` is being replaced by this package composition.
[`docs/transition.md`](../docs/transition.md) maps its components to package
components, or records why a component is not migrated. Each component name has
one declaring package. `bin/transition_test.ts` checks the JSON files;
`packages/facets_test.ts` also checks the actual `./vocab` imports so an export
cannot silently include a second package's declarations.

## A plugin is a package; its parts are subpath exports

A program does not import a plugin as a whole. It imports the specific subpath
exports it needs, one per kind of contribution, and loads only the ones it runs
(`@yaks/cli` `compose`, `packages/cli`):

| subpath     | what it exports                                                                 | may import          |
| ----------- | ------------------------------------------------------------------------------- | ------------------- |
| `./vocab`   | `docs`, `keywords?`, `derived?`                                                 | nothing server-side |
| `./rules`   | `rules: (host, options) => Plugin[]`, `extend?` (@yaks/sql)                     | anything            |
| `./tools`   | `runs: (host, options) => Runs` — the code behind its `tool: true` declarations | ajv, SQL, anything  |
| `./effects` | `effects: (host, options) => Watch[]`                                           | anything            |
| `./routes`  | `routes: (host, options) => Route[]`, `authenticate?`, `handler?`               | anything            |
| `./service` | `service: (host, options, signal) => void \| Promise<void>`                     | anything            |
| `./views`   | `views` — `@yaks/render` renderers                                              | nothing server-side |
| `.`         | the library API and types; runtime requirements vary by package                 |                     |

Throughout this section, **host** means the process that opened the graph — a
server, CLI command or Worker. The `host` argument is an object exposing that
process's graph, vocabulary and other resources, not an operating-system process
object. `options` contains the plugin configuration.

Server behavior exports (`rules`, `runs`, `effects` and `routes`) are factories
taking `(host, options)`; `service` additionally takes an `AbortSignal`. Schema
`docs`, `keywords` and renderer `views` are values, while `derived(vocab)`
produces computed-column definitions. A **facet** is one of these sub-module
exports, not another kind of plugin. For example, a check that queries a
package's own SQL table gets the connection through `host.sql`, and a threshold
or a relation name comes from config rather than being hard-coded. Everything a
tool needs per call — the graph, the caller, the arguments — is passed in the
tool context instead.

### Health checks are just tools named `check`

A health check is a tool whose verb is `check`. That is the entire mechanism:
there is no health-check package and no registry. Running the health checks
means running every tool the loaded vocabulary declares with that verb
(`checks(host.tools)`, @yaks/tools), so a program that loads a plugin gets that
plugin's invariants checked, one that drops the plugin drops them too, and no
hand-maintained list can go out of date.

A check belongs to the package whose invariant it is — `@yaks/mail` checks for a
letter that arrived with no sender, `@yaks/session` for a lock whose holder has
exited, `@yaks/sqlite` for the database file's own keys. It returns bundles like
any other tool: its message in `content{body}`, `output{source}` naming the call
it came from, and `error{code}` set to `fail` (a violation it measured) or
`warn` (a possible problem, or something it could not verify). A check that
finds nothing still returns a result, and one that cannot run reports that
rather than passing silently. `packages/cli/checks_test.ts` shows the whole idea
end to end.

What does not belong in a package: checks on a particular deployment's health.
The fleet doctor read Cloudflare Email Routing's live rule set, and a provider
credential file on one machine. Both are questions about a deployment, answered
using a credential that deployment holds, and both give the same answer whatever
graph is running. A package's check only reads the graph its own components
describe.

There used to be a `./digest` export, where each plugin contributed its part of
the text a session reads before its first turn. It was removed (T-37707). What a
session should be told is still undecided, and `session_context` now returns
only what a lifecycle hook needs: the session's own id, and the work it holds a
lock on. It can create or update that session; file-based instruction loading is
a separate harness operation.

There used to be a `./boot` export, the single pass a plugin made at start-up.
It was removed (T-37703), and what it did is now an ordinary effect. A `yak`
process using the full graph composition writes its own `process` row when it
opens the graph (`@yaks/process` `started`), so a plugin's start-up work is a
`created(process)` handler that checks the row is this process
(`@yaks/session/effects` releases the locks a dead holder left behind;
`@yaks/spawn/effects` picks up the agents a restart left running). Each takes a
`lease` (`@yaks/effects`) so that two processes starting at the same time do not
both do the work. Startup handlers use that ordinary graph event rather than a
separate `./boot` callback.

`./service` is work a plugin keeps doing for as long as the program is running:
a clock, a poll, a periodic sweep (`@yaks/wake/service` fires the wakes that
have come due). It is neither a response to a request nor a reaction to a
commit, which is why neither `routes` nor `effects` could hold it: a scheduled
time arriving, and a mailbox that has to be polled, are things nobody is calling
in about.

It is given an `AbortSignal`, is expected to make an initial pass when it
acquires the lease, and then keeps going until that signal aborts — which is
what lets the same function work in both a long-running process and a one-shot
command. A service, and the sweep that retries failed effects, are background
jobs (`@yaks/cli` `Served.duties`). Each is held under a `lease` named after the
package that owns it (`@yaks/effects` `holding`): a server or a TUI claims the
job and holds it for as long as it is running, renewing periodically. A one-shot
`yak` command passes its jobs a signal that has already aborted, so a service
that acquires its lease makes one pass and then releases it — clearing anything
overdue on the way through, and leaving alone whatever another process is
already holding. A second long-running process waits for the job and takes it
over when a killed holder's lease expires.

None of this assumes a separate process exists. A machine where the only thing
anybody runs is `yak tui` still fires its wakes, and one that splits the HTTP
server, the clock and the sweep across three processes can coordinate ownership
of those jobs. Leases do not guarantee exactly-once external side effects after
a crash.

A subpath a package does not export is a contribution it does not make, and the
program skips it. A subpath that exists but fails to import is an error, never a
skip. Each factory declares only the parts of the host it uses — for example
`(host: { vocab: Vocab })` — so no package has to import `@yaks/cli` in order to
state its requirements.

`./rules` can export graph plugins through `rules`, and query compiler
extensions through `extend`. Graph plugins need not use SQL. When a package
maintains a SQL index, both exports can use the same host connection and
configuration: `rules` maintains the index and `extend` compiles queries against
it. The store receives these extensions during construction, so callers do not
register them separately for each read. `@yaks/embedding/rules` is the worked
example: it creates the vector table and compiles `.near`.

Each file is named after the subpath it is exported at. Where a package already
uses that filename for something else, the subpath maps to a different file and
the subpath is still the canonical name (`@yaks/harness` has a `tools.ts` of its
own, so its `./tools` export points at `./runs.ts`).

**`./vocab` and `./views` are the browser's half.** The browser imports those
two subpaths from every package, so neither may touch storage, SQL or a server
runtime, and `deno task check:browser` type-checks both with only the web
platform's types in scope. This separation lets `@yaks/process/vocab` describe a
running program inside a page that could never start one.
`packages/facets_test.ts` walks the whole set: every package with components
exports them, every subpath has the shape a program expects, and `compose` over
the fleet's own config loads all of them.

### Cases that do not split cleanly

Listed here rather than forced into a shape that does not fit. These notes
distinguish implemented behavior from remaining proposals.

- **Two different things both want the name `pane`.** `@yaks/canvas` declares
  `pane{layout, parent, dir, content, view}` — a region of a layout — and a
  terminal pane is the other thing people call a pane. Component names share one
  flat namespace and `loadVocab` rejects a name declared twice
  (`bin/transition_test.ts` checks that every package's vocabulary can load
  alongside every other), so only one of them can have it — and a program may
  well want both a canvas and a terminal. Resolved by nesting one: `@yaks/tmux`
  declares `tmux{of, pane}`, where the component is named after the package and
  `pane` is just a column naming what tmux addresses. That is also what the
  fleet's own note in `src/sessions.ts` proposed. The alternative, renaming the
  canvas's `pane` to `region`, is a better name for a layout split but belongs
  with the canvas's own redesign rather than with this split.
- **The list of statuses depends on loaded schemas.** `task.status` is computed
  from marks. `@yaks/session/vocab` contributes computed-column rules including
  `claim` as `wip`; load it after `@yaks/task/vocab` to select that calculation.
  The schemas' status enums are combined for board validation, so
  `@yaks/project/rules` already recognizes `wip` when session schemas are
  loaded. `projects(vocab, marks)` remains available for an explicit status
  list; it is not required just to enable the loaded session statuses.
- **Effects may require configuration.** Implemented: an entry in the config's
  `plugins` list is either a module specifier or an object with `use` and
  `with`, and whatever is under `with` is passed to each of that plugin's
  factories alongside the host. So `@yaks/mail/effects` builds its own transport
  from what the config named
  (`{"via":"cloudflare","account":"account-id","token":{"env":"MAIL_TOKEN"}}`),
  and a value written as `{"env": "NAME"}` is read from the environment when the
  config is loaded — so a config can name a secret without containing one. See
  [@yaks/cli](./cli/README.md#what-a-config-passes-to-one-plugin).
- **`handler` is what hosts the routes.** It is exported from `./routes` by at
  most one plugin in a program — @yaks/api — and is handed the host once
  `host.routes` holds every listed plugin's routes. What it returns is the one
  handler that host answers with. A program whose config lists no such plugin
  has no handler and never calls the other plugins' `routes` factories: a route
  with nothing listening is a facet the host ignores.
- **`authenticate` is access policy, not a route.** It is exported from
  `./routes` because the HTTP server is where authentication happens, but it is
  not an HTTP path, and at most one plugin in a program may define it.
  Authentication identifies the caller; `@yaks/member` implements authorization
  after that identification. Its `members(where)` needs an application-specific
  `Guard`, so it exports `./vocab` but no `./rules`. Plugin options can describe
  policy data, not executable guard functions. A config-expressible guard is a
  remaining design question, not an implemented authentication service.
- **Numbers and prefixes are one package, and they are opt in.**
  [@yaks/id](./id) declares the `num` column, ships `numbers(allocate)` for
  explicit `$num` requests and `ids(vocab)` for resolving what a person typed;
  storage numbering (`number: true`) is the other, plugin-free way to have them.
  A component's `prefix` controls formatting, not allocation: a proposal to
  allocate numbers automatically for prefixed components remains unimplemented,
  so do not rely on it. A graph that loads none of this refuses `$num` rather
  than ignoring it.
- **`./tools` is a reserved subpath that one core package still uses for
  something else.** `@yaks/vocab/tools` is the tool mechanism — validating a
  declaration's input — rather than one plugin's implementations, and it
  predates this convention. Nothing loads it as a plugin, so nothing breaks; the
  check in `packages/facets_test.ts` reserves these subpath names only on
  packages that declare components of their own. `@yaks/graph/tools` was the
  same until the generic tool tier moved into that package's own `vocab.json`:
  it now exports `loadTools` and the implementations behind `graph apply` and
  the rest, which is exactly what the subpath name means. The proposal, if the
  remaining one ever causes a problem: rename it to `./tool`, singular — one
  declaration, not a table of implementations.
- **A tool call that another process already ran.** A provider CLI's transcript
  is full of them, and `call{to, args}` plus `result{call}` are exactly the
  right components to describe what it did — except that a `call` in this graph
  is an instruction: @yaks/tools registers "a call with no result" as an effect
  and runs any call naming a tool this program has, which covers most of what a
  fleet agent calls. So `@yaks/spawn`'s adapters leave another process's tool
  calls in the log file rather than writing a row that would be executed a
  second time. The proposal: a component marking a call as a record rather than
  a request — one extra component, matched by the runner's pattern — so an
  imported transcript can record everything it saw.
- **A view that needs SQL.** No package has one yet. When one does — a renderer
  that wants a computed column the store produces — the column is declared as
  `derived` in `./vocab` and the renderer reads it off the bundle. A `./views`
  that imports a database driver has crossed into the server half, and
  `deno task check:browser` will fail it.
- **`@yaks/render`'s `vocab.json` describes a column schema**, not a set of
  domain components, so it is the one vocabulary document with no `./vocab`
  subpath, and `packages/facets_test.ts` lists it as an exception.
- **`@yaks/harness`'s `./vocab` is an application's list** of packages, rather
  than the components that package owns. It is a program shaped like a plugin,
  so it cannot be loaded alongside the packages it lists, and
  `packages/facets_test.ts` records it as the other exception. It is a list
  rather than a copy: every document in it is another package's own `./vocab`,
  referenced once, so each still loads alongside every other. What it should
  really be is a config file (`yak serve`), which is T-37580.

## How they compose

Choose packages for the required operations. Their imports, not the order of
this list, determine dependencies. Storage adapters share an interface but
differ in supported queries, rules and transaction guarantees:

- Use `@yaks/query` alone to parse or build a query AST for your own evaluator —
  an in-memory filter, a different backend, a UI that just needs the structure.
- Add `@yaks/vocab` to describe your data's shape as a loadable schema and
  interrogate it (routing, types, ordering) without committing to SQL.
- Add `@yaks/sql` once you want that AST and schema compiled straight to a SQL
  string and params for a real database.
- `@yaks/sqlite` provides persistent local storage: point it at a SQLite
  database and it handles reading and writing entities for you, using the query,
  vocabulary and SQL packages plus schema/storage support.
- `@yaks/blob` moves long values out of the rows transparently: one schema
  keyword on the column, a plugin that substitutes the text for its hash inside
  the write's own transaction, and a read override that resolves it back in the
  SQL statement — so a writer sends text and a reader gets text.
- `@yaks/fts` adds search on top: by default it indexes stored scalar text
  properties marked `search: true` and registers a clause compiler with
  `@yaks/sql` — the same extension point the other search and traversal packages
  use.
- `@yaks/embedding` adds the other half of search through that same extension
  point — keyword matching comes from `@yaks/fts`, vector similarity from here —
  with the embedding function passed in, so nothing ties you to one model. It is
  also the clearest example of what that extension point looks like in practice:
  its `./rules` creates the vector table and gives the store its `.near`
  compiler (`extend`), its `./effects` schedules a debounced pass when indexed
  text changes, and the model, endpoint and API key are options the config
  passes to the plugin.
- `@yaks/match` is the path with no storage at all: give it the same AST and
  vocabulary and it filters bundles you already hold in memory, for the
  supported shared subset. Unsupported clauses fail rather than silently
  approximate a database result.
- `@yaks/ram` puts that evaluator behind the same `Storage` interface: a whole
  graph in a `Map`, with the same graph `apply()` API and a subset of database
  queries, for a page, a worker, or a test with no database to install.
- `@yaks/edge` adds relationships the same way search was added: a component
  your entities carry, and a clause compiler registered with `@yaks/sql` — so
  `.cites[<=3]->p1` is answered by the database rather than by a walk in your
  own code.
- `@yaks/effects` responds to committed writes: graph hooks validate and
  transform changes inside a transaction; effect handlers respond after it
  commits — send a notification, write a receipt, start a process — registered
  per component or as a pattern over what committed, run after the commit, and
  isolated so that a broken handler can never break a write.
- `@yaks/journal` is the record of the same write: it stores what each
  transaction changed in tables of its own, inside that transaction, so a
  rejected transaction leaves nothing behind. Its default skip list excludes
  provenance fields; only recorded changes appear in history. History, undo, and
  the change feed a live client replays are three different reads of that one
  log.
- `@yaks/doc` is the smallest domain plugin there is — one component, no hooks —
  and it exists because a shared component deserves a single home: `@yaks/mail`
  stores a letter's subject and body in it, and anything else with a title
  renders through the same renderer. It ships the `store: "blob"` declaration
  and none of the machinery behind it, which is what lets a graph adopt
  content-addressed bodies later without changing its vocabulary.
- `@yaks/member` checks who may make a write through `apply()` — enforced as a
  `precondition` hook, so a rejection rolls the whole transaction back, and
  paired with a `canRead` check that applications must integrate for reads,
  which never reach `apply()` at all.
- `@yaks/session` adds ownership claims for concurrent work. A lock is stored on
  the entity it locks, taking somebody else's lock rolls the transaction back,
  and the collision is recorded in the `audit` phase — after the rollback, where
  the record survives.
- `@yaks/task` is a domain rather than a mechanism — what a plugin looks like
  when it ships components instead of machinery. Its one interesting decision is
  that a task's status is not stored: it is computed from the marks a task
  carries, and the rule is a list the package gives to both evaluators, so a
  saved board filter means the same thing in the database and in the browser.
- `@yaks/mail` is what a domain plugin looks like with both halves present: it
  contributes components like `@yaks/edge`, depends on `@yaks/doc` for a
  letter's subject and body, and registers an effect using the mechanism
  `@yaks/effects` ships empty. Sending happens after the commit, so a mail
  server being down cannot reject a write, and the outcome is written back as
  components, so what became of a letter is answerable by a query. It also
  implements the `created(member)` handler that `@yaks/member` documents and
  leaves open — an invitation is a letter, written through the same `apply()` as
  everything else. Receiving uses a pure function from message to bundles, the
  two lookups that need a graph, and an HTTP endpoint for a mail provider to
  POST to — idempotent on the Message-ID, so a retry and a sweep record one
  letter, not two.
- `@yaks/api` puts the whole stack behind three HTTP routes. It combines
  `@yaks/graph` (for writes), a storage adapter (for reads) and `@yaks/match`
  (to decide cheaply which subscriptions a committed transaction changed), and
  uses only web-standard types, so the same handler runs on Deno, Node and a
  Cloudflare Worker.
- `@yaks/mcp` serves the same graph to an agent instead of to a program: it uses
  `@yaks/api`'s `Authenticate` and its signing, so the HTTP and MCP servers
  agree about who is writing, and it returns the same bundles — described by an
  output schema generated from `@yaks/vocab`, so an agent reads typed values
  instead of parsing text.
- `@yaks/workerd` is the last step of that on Cloudflare: the three things a
  Worker does differently — create a WebSocket, export a `fetch` handler,
  identify the writer — so a graph can be served from Cloudflare without
  `@yaks/api` referring to a single Cloudflare API.
- `@yaks/durable-object` is the storage underneath, where the database ships
  with the compute: one Durable Object is one graph, strongly consistent, with
  nothing to connect to — and its hibernatable WebSockets are where the
  subscriptions live.
- `@yaks/d1` is the same `Storage` interface where the database is across a
  network rather than in the same process, which is what makes the synchronous
  pass-through worth having: one `apply()` runs synchronously over SQLite and a
  Durable Object and returns a promise here, with the phases, plugins and
  cascade unchanged. Its README states exactly what D1's lack of an interactive
  transaction costs, rather than claiming an isolation level D1 does not offer.
- `@yaks/sync` synchronizes a client graph: a `@yaks/graph` over `@yaks/ram` in
  a page, plus this plugin, optimistically applies eligible writes and
  reconciles with the `@yaks/api` server afterwards. Both transports are passed
  in, so the whole round trip can run inside one process in a test.
- `@yaks/client` assembles that browser configuration: the assembly in one call,
  subscriptions surfaced as values a renderer can hold (a signal when you hand
  it a signal factory, `useSyncExternalStore` when you hand it to React), and
  IndexedDB under the components the server never sees.

## Publishing requirements

Packages are intended for [JSR](https://jsr.io) and npm publication. Each must
meet the registry's requirements before publication. When you add or change a
package:

- **Every exported symbol has a doc comment.** Functions, types, constants —
  anything in the public API is documented where it is declared.
- **The entrypoint has a module doc.** `mod.ts` opens with a module-level doc
  comment (`/** … */` at the top) describing what the package is.
- **`deno.json` has a `description`.** One clear sentence naming what the
  package does.
- **State runtime support accurately.** Portable libraries should target Deno
  and Node at minimum, but host-specific packages may require Deno, Linux or
  Cloudflare. JSR analyses the code to derive compatibility; there is no
  `deno.json` compatibility field. State and test actual requirements in each
  README's Compatibility section rather than promising every runtime.

Run `deno publish --dry-run` in a package to check it before landing — it
reports missing docs, slow types, and metadata gaps.
