# @yaks packages

TypeScript libraries for storing, querying and rendering records, plus packages
for agent sessions, tools and application domains. Packages can be imported
individually, but many depend on other `@yaks/*` packages. They are intended for
publication through JSR and npm; runtime requirements vary by package.

## Start here

An **entity** is a record identified by `entity.eid`. Its **components** are
named objects describing different aspects of the record. A **bundle** is one
entity's components as a JSON object. A **batch** is a list of bundles applied
in one transaction. A **vocabulary** is the schema declaring the components,
properties and relationships a graph accepts.

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

- **[@yaks/benchmark](./benchmark)** — Named workloads, raw samples, JSON runs
  and explicit baseline ratchets, with process-configured reporters.

- **[@yaks/tracker](./tracker)** — Error capture, bug grouping, regression,
  notification and retention, shared by box and hosted tracker stores.

- **[@yaks/timing](./timing)** — Timing summaries, stored span-entity traces and
  trace views for insight into request time and rows in tracker stores.

- **[@yaks/trace](./trace)** — Subscriber-only, bounded, value-free runtime
  activity and causal spans, keyed by the observed graph. Unsubscribed producers
  allocate nothing and read no clock.

- **[@yaks/query](./query)** — Parse query strings into an abstract syntax tree
  (AST), or build the same tree from code. It understands operators, lists,
  ranges and directives, not application field meanings. Time-parsing helpers
  are separate from parsing scalar query values. Given a loaded vocabulary, it
  resolves a bare property from the rest of the line and completes a query at
  the caret.

- **[@yaks/yaml](./yaml)** — Parse YAML or JSON text and split Markdown
  frontmatter from its body. Frontmatter can contain a partial bundle. Its graph
  dependency is type-only; it uses the standard YAML parser. `fill()`
  substitutes `{{name}}` placeholders. The package performs no file I/O.

- **[@yaks/vocab](./vocab)** — describe a component vocabulary as JSON Schema
  (2020-12) plus a small custom keyword vocabulary, and interrogate it at
  runtime: property types, path routing, display ordering, instance checks. It
  also holds a vocabulary as `_comp`/`_prop` entities and reads it back.
- **[@yaks/id](./id)** — entity ids: generate an eid, and turn the `prefix` a
  component declares plus a number into a human-readable id (`B-7`) and back. It
  also owns the number itself — the `num` property on the `entity` row, the
  allocator behind `$num`, and the resolver from `B-7` to an eid — so a graph
  that does not load this package has no numbers and no prefixes anywhere.
- **[@yaks/names](./names)** — the other way to address an entity: the
  components a vocabulary marks `by_name`, the property each one stores its name
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
  text property stores a hash while a table, directory or object store holds the
  content. Text substitution requires both the graph plugin and read resolution.
  SQL content and component writes share a transaction only on the same
  connection; files and object-store writes cannot roll back with SQL.

- **[@yaks/fts](./fts)** — Build SQLite FTS5 indexes and compile text search
  terms. By default it indexes stored scalar text properties marked
  `search: true`, with one index per component. A bare query term needs this or
  another search extension.

- **[@yaks/embedding](./embedding)** — Store vectors and compile
  `.near=<entity>` and `.order=similar`. An injected embedding function
  determines what similarity means; as a plugin, a config names a provider and a
  model, and a provider reached over HTTP (Ollama, an OpenAI-compatible server)
  is a `provider` row serving the `model` row. Triggers queue the entities whose
  text a write touched, from any process, and the plugin's service settles the
  queue a batch at a time.

- **[@yaks/model2vec](./model2vec)** — Embed text in-process with a Model2Vec
  static model read from the Hugging Face hub: a millisecond a text, no native
  code, the same vector on a server, in a Worker and in a browser. The embedder
  `@yaks/embedding` names `provider: "model2vec"`.

- **[@yaks/match](./match)** — Evaluate supported query AST clauses against
  bundles in memory. Tests compare shared behavior with SQL, but search,
  ordering and unsupported queries differ; see the package's compatibility
  table.

- **[@yaks/host](./host)** — The portable plugin assembly and capabilities a
  host lends its plugins; concrete hosts own connections, directories and
  resource lifetime.
- **[@yaks/graph](./graph)** — The entity/component API and phased `apply()`
  operation: filter, normalize, validate and commit changes using a supplied
  `Storage` adapter. Plugins add schema declarations and lifecycle hooks.
  `apply()` returns composed patches, not complete entity snapshots.

- **[@yaks/render](./render)** — Select renderers by query specificity and a
  requested view name (more specific name segments are on the right), collect
  component actions, and select property renderers by schema. Renderers receive
  an element-construction function so the caller chooses the output
  representation.

- **[@yaks/preact](./preact)** — Connect the render registry to Preact. Its
  `Entity` component reads a function-based store and subscribes while mounted,
  using Preact's element-construction function for portable renderers.

- **[@yaks/html](./html)** — Render the same registry to server-side HTML using
  @yaks/preact and Preact's serializer, without a browser DOM.

- **[@yaks/text](./text)** — Markdown and plain text from those same trees,
  preserving headings, lists, links, code and emphasis while stripping control
  bytes from every text leaf and destination.

- **[@yaks/web](./web)** — The browser door: the page, bundle, stylesheet and
  assets that run configured applications through @yaks/api. An application
  contributes source assets through its `./web` facet.
- **[@yaks/browse](./browse)** — The graph browsing app: domain views, editing
  and navigation painted through @yaks/ui in browsers and terminals. Packages
  offer it their views, sidebar destinations, the owner's home page and entity
  tabs through their `./views` facets. Its browser entry is served by @yaks/web;
  @yaks/tui paints its terminal.
- **[@yaks/markdown](./markdown)** — Parse GitHub Flavored Markdown into
  structural nodes, not an HTML string or terminal control sequence. Its link
  filter permits relative URLs and explicit `http`, `https` and `mailto`
  schemes.

- **[@yaks/tui](./tui)** — the same Preact trees on a terminal: a fake DOM, a
  swappable backend (a diffing ANSI painter today), and the three widgets a
  console app is made of — a scrolling transcript, a multi-line input box, and a
  frame with a sidebar of pluggable panels.
- **[@yaks/ui](./ui)** — the UI components: display-only parts with semantic
  variants (`Dot`, `Id`, `Stamp`, `Tabs`, `Menu`, `Tip`, `Field`, `Choices`,
  `Button`, `Chip`, `Value`, `Pairs`, `Tile`, `Rows`, `Section`, `Timeline`,
  `Shell`, `Edit`) built with `el` and `block`, each a Preact component, a CSS
  file and terminal sheet entries, so it paints in a browser and in @yaks/tui
  alike. Themes (Everforest first), `relative` for a moment in words, and the
  style guide at `/ui`.
- **[@yaks/filter](./filter)** — the query field: completion wherever a query is
  typed, in a browser and in a terminal. A domain component built of @yaks/ui's
  `Field` and `Choices`, its state the `filter` component in the page's own
  graph, its actions patches to it, completing through @yaks/query `complete`
  from a vocabulary and a data source the host supplies.
- **[@yaks/ux](./ux)** — UX components, between @yaks/ui's look and a domain
  component's meaning: each controlled by a bundle and emitting a bundle of the
  same shape, its own state a CamelCase component (`Edit`) in the page's graph.
  `Edit` is a property's value changed where it stands: typed over in place so
  nothing moves, or picked from a popout, each control selected by the
  property's type through @yaks/render and drawn with @yaks/ui, under the host a
  page hands down (web's and the inspector's alike). `Disclosure` is a summary
  opening optional content.
- **[@yaks/inspect](./inspect)** — Inspect views for entities, vocabulary
  components, packages, properties, query rows and the map. Browse mounts them
  in its shared renderer registry; the views know neither door nor store.
- **[@yaks/visualize](./visualize)** — the platform MRI at `/visualize`: its
  composed parts, value-free contracts and relationships, with bounded causal
  activity from the exact serving graph's shared trace channel. Agents use the
  same anatomy and capture contracts through tools and `yak visualize`; this
  standalone page does not depend on the stored-data inspector.
- **[@yaks/ram](./ram)** — Implement graph storage with a synchronous in-memory
  `Map` and @yaks/match queries, suitable for browsers and tests. Shared
  operations and declared rules are tested against SQLite, but RAM does not
  support every SQL query.

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
  an eid can, in a reference property and in an API request.
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
  somebody looked. Its `land` tool operates on the checkout at the calling
  process's `cwd` (the CLI working directory), fast-forwarding its branch into
  the base in the primary worktree. If the base moved, it rebases and returns
  without landing; rerun tests and land again.

- **[@yaks/code](./code)** — a codebase read into the graph: a `package` per
  manifest, a `module` per file (wearing @yaks/git's `file`), a `symbol` per
  export and an `imports` link per import, each with its doc comment in `doc`
  for search. `code sync` reads only the files whose Git blob moved. Each
  process starting describes the vocabulary the graph is served with as
  @yaks/vocab's `_package`, `_comp` and `_prop` rows (`vocab_describe`).

- **[@yaks/mirror](./mirror)** — one sync between files and a graph: a binding
  names its files and carries a `read` (files → graph), a `values` (graph →
  files), or both. Each path remembers the Git blob and value hash it last
  agreed on, so a path both sides changed is reported as a conflict and never
  overwritten.
- **[@yaks/effects](./effects)** — Run code after committed component changes or
  newly matching query patterns, isolating failures from the original
  transaction. What a commit owes is declared in the vocabulary
  (`effect: true`); with the optional `effect` component, each commit writes its
  runs down in its own transaction and any number of processes claim and run
  them, with retries and backoff. It does not guarantee exactly-once external
  effects. `lease{name, holder, until}` records named duty ownership using
  deterministic ids and transactional preconditions. Coordination requires
  suitable storage isolation and lease configuration. This package provides
  mechanisms, not domain-specific actions.

- **[@yaks/threads](./threads)** — Start a Deno or browser Worker for a graph's
  roles, using its own connection or authoritative access over a MessagePort.
  The ordinary effects pool and leased services run on the same graph, and
  shutdown stops new work and drains what was started.

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
- **[@yaks/draft](./draft)** — what a person has typed and not yet sent:
  `draft{by, place, text}` on an entity derived from the person and the place,
  kept by the store and seen by every interface they use until it is sent or
  discarded. A write says what it was typed over and the store merges, so two
  interfaces typing at once lose nothing; `desk()` is an interface's side, typed
  into at once and kept across a reload.

- **[@yaks/lens](./lens)** — reversible JSON document operations, including
  bundle patches. Private `_lens{package, step, ops}` rows compile vocabulary
  changes into writes, old read views, queries, and rows still to move; the
  graph plugin translates at generic read and write boundaries.

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

- **[@yaks/secrets](./secrets)** — Write a secret through the graph and keep it
  elsewhere: `secret{name, value}` holds a random handle, and an effect seals
  the value into the host's vault once the write commits, the secret wearing
  @yaks/effects' `provisional` until it has. The package defines the vault and
  keeps one in memory; a box's files are @yaks/cli's and yaks.app's D1 is
  @yaks/d1's. Trusted code reads it back by name; a config names one as
  `{"secret": "NAME"}`; code that calls out gets its sentinel, the handle hashed
  under the vault's salt.

- **[@yaks/connections](./connections)** — The outside services a graph can
  reach: `integration` (a service as data: OAuth endpoints or a pasted key, and
  the hosts its credential may go to) and `connection` (one link owned by a
  space or a person, whose credential is a @yaks/secrets secret), with the
  `uses` link from an app. Verbs to need, connect, disconnect, list, resolve a
  sentinel, read a credential and refresh a token; `need` and `list` are its
  tools.

- **[@yaks/egress](./egress)** — Calls going out with a credential the caller
  never holds: `forward` swaps each sentinel for its connection's key or token,
  in a header, the query or the body, once the caller may call out through it
  (@yaks/member `callsOut`) and the request goes to a host its integration
  names. A refused access token is refreshed and the call made once more.

- **[@yaks/session](./session)** — Store agent transcripts as `entry` entities:
  content, model requests, tool calls/results and stops. Status is derived from
  transcript entries and outstanding calls. The package also provides model
  execution, claims on entities and conflict records for competing claims.

- **[@yaks/machine](./machine)** — Commands and files through a `Machine`, with
  providers that lend sandboxes or attach existing machines. Owns
  `machine{provider, address, from, image, state}` and the provider interface,
  and offers the Cloudflare container provider; opens no graph storage.

- **[@yaks/process](./process)** — a running program as an entity, so whatever
  needs one points at it instead of keeping a pid: `process{pid, command, cwd}`
  for the one that is running, `service{command, cwd, restart, attempts}` for
  the one that should be, and `exit{code}`; its output stays in its files, read
  with `tail`. Four entry points over one loop — launch a child detached, adopt
  one by pid, re-adopt every unfinished row at start-up, and supervise the ones
  that should be running on a timer. The program doing the launching gets a row
  too: `started()`/`ended()` are what a process writes about itself, which is
  what it signs its writes with and what a start-up effect fires on. The same
  rows back the harness's `shell`, `wait` and `stop` tools, so a long-running
  tool call returns the process instead of blocking on it.
- **[@yaks/spawn](./spawn)** — combine tools, sessions and processes: a session
  whose provider is an agent CLI. The `using` component on a session's first
  entry is the request; a provider that is a command line (`claude`, `codex`) is
  started as a detached child process through @yaks/process, recorded on the
  session's own entity; and its JSON-lines stdout is read back as that session's
  entries — exactly once, tracked by the `imported{source, line}` component on
  each. It defines no components of its own.
- **[@yaks/heal](./heal)** — follows a separate tracker graph. Each bug gets one
  task and an `about` edge; its count and stack stay in the tracker. The
  follower requests a @yaks/spawn session holding the task's claim, marked
  `fixer{bug}`, behind the provider, `nofix`, cap and cooldown gates. Tracker
  regressions can start another fixer on completed work.
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
- **[@yaks/oauth](./oauth)** — The authorization-code client for a provider
  described as data (begin, complete, token, refresh), and its building blocks:
  a private-store interface, PKCE (Proof Key for Code Exchange) and expiring
  attempts. Secrets remain outside graph data.
- **[@yaks/openrouter](./openrouter)** — Implement the model interface over
  OpenRouter's Responses API, with response metadata schemas and optional PKCE
  authorization. The application supplies credentials or a private store.
- **[@yaks/workers-ai](./workers-ai)** — Implement the model interface over
  Cloudflare Workers AI through the `AI` binding a Worker is given, with no key:
  chat messages out, either of the catalog's answer shapes back.
- **[@yaks/kernel](./kernel)** — Shared identity, provenance and metadata
  schemas: `entity`, `created`, `updated`, `decided`, `quarantined`, `comment`,
  `image`, `favorite` and relationship tags, and the lifecycle marks a status is
  read from (`completed`, `failed`, `broken`, `resolved`, `verified`). It also
  defines schema keywords such as `governed`, `lazy` and `well`. Its one plugin
  keeps who completed something.

- **[@yaks/task](./task)** — Task records, plans and containment relationships.
  Status is computed from marks such as @yaks/kernel's `completed` and its own
  `cancelled`, using rules for both SQL and in-memory evaluation. Projects and
  saved boards belong to @yaks/project, not this package.

- **[@yaks/wake](./wake)** — coming back to something later, as data: a
  `wake{at, every, target, note}` on any entity, the wakes due at an instant,
  and the recurrence — a duration or a cron expression — that schedules the next
  one. It calls no handler: `tick` writes `fired` and advances the wake, and
  graph rules do the rest. The Cloudflare and Deno drivers share that same
  write.
- **[@yaks/mail](./mail)** — Store messages and delivery requests/outcomes. An
  effect on `created(mail)` sends messages that also have `deliver`, through a
  supplied transport. Incoming messages become bundles; subjects and bodies use
  @yaks/doc, and a configured package's `./mail` facet says what else one means.
  Failed delivery cannot roll back the original graph transaction.

- **[@yaks/inbox](./inbox)** — A person's inbox, as a plugin a config may leave
  out: the thread and attention policy (Needs you, Replies, Updates and Recent
  lanes, unread state, said/received search), its `inbox_summary` read, the
  `inbox new|list|archive` tools, its views, and its email door (blocking
  decisions and a daily digest by mail, and the replies that answer them).
  Starts no sessions.

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

- **[@yaks/builders](./builders)** — a `builder` query and tool define a
  transformation. Each outer query binding has one durable `build`; changed
  content starts a tool `call`, and named `built` outputs keep their identity. A
  model is one tool adapter, using `content.body` and `using` on the builder.
- **[@yaks/dreaming](./dreaming)** — what an agent works on when nothing else is
  asking for its attention: a `dream`, which runs as a @yaks/builders builder,
  and the `recall` it consolidates.
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
- **[@yaks/rtc](./rtc)** — voice between pages over Cloudflare Realtime: a page
  `join`s a call, publishes its microphone and hears the tracks it asks for,
  naming what it says in the relayed `rtc` component; `./door` is the host half,
  which answers Realtime's own API for one app, keeps each session as an `sfu`
  row under a lease, and weighs what a session receives on the host's meter.
- **[@yaks/tunnel](./tunnel)** — a hosted space's tunnel to a machine without an
  open port: the Cloudflare Tunnel and Workers VPC Service that carry a Worker's
  requests to one service on the machine, the account calls that make and remove
  them, `./routes`, which keeps what comes through the link to the paths the
  machine opened, and `./service`, which keeps `cloudflared` running there.
- **[@yaks/platform](./platform)** — what a hosting platform keeps about the
  apps it serves: `space`, `app`, `deploy`, `published`, `hostname`,
  `installed`, `plan`, `meter`, `signin` and `report`. Membership of a space is
  [@yaks/member](./member)'s `member`, and the access level on top of it is its
  `grant` — two separate facts, not one enum.
- **[@yaks/esbuild](./esbuild)** — compiles a web app's TypeScript and npm
  imports at deploy: `plan` reads an app's files and says what must be compiled
  (the server source, each page's module scripts), or nothing, and `./compile`
  compiles it with native esbuild, pinned by `package-lock.json`.
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
  `fetch` handler or over stdio, with one output schema on every tool: the
  bundle answer itself. Its `./routes` is that handler at `/mcp`, one route on
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
  than being mandatory for local commands. The host keeps the graph's secrets in
  private files beside its database and hands that vault to every plugin.
  `./page` is what a plugin's routes serve a page with: a body made once and
  kept, and a page's script bundled for the browser.

- **[@yaks/admin](./admin)** — Platform operations on yaks.app as the selected
  connection: stores, fee, deploys, logs, rollback and revert, and the deploy
  catch-up that builds a main head Workers Builds left undeployed. Unpublished.

- **[@yaks/harness](./harness)** — A local agent application combining SQLite,
  model execution, shell tools, graph tools and a terminal interface. As a `yak`
  plugin, its verbs are tools (`session new`, `session send`, `model list`) and
  its terminal app is how `--tui` draws a session (`./tui`). The TUI backend
  runs in a Web Worker. Blob text is stored in SQLite; artifacts, private
  authorization state and draft recovery files also use the filesystem. It
  starts no HTTP server by default and does not require synchronization.

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
  D1 has no interactive transaction to hold open. It also keeps a vault of
  secrets in D1, encrypted under a key the caller holds, meeting @yaks/secrets'
  vault shape without importing it.
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

- **[@yaks/testing](./testing)** — declare tests (`test`, `suite`), check them
  (`equal`, `ok`, `match`, `throws`) and wait on facts (`tick`, `until`); its
  runner loads every test module into one runtime, runs the examples beside the
  code (fenced blocks and `///` doctests) as tests, and leaves out a file that
  passed while nothing it depends on has changed.
- **[@yaks/voxel](./voxel)** — voxel and box meshing into packed quads,
  distance-based chunk detail and cached heightfield charts. Plain values, no
  renderer or graph, safe in a worker.
