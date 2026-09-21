# @yaks packages

Small, focused, independently publishable building blocks (npm + JSR) for a
query → schema → SQL → storage pipeline over an entity/component data model.
Each package does one job well and composes with the others; none requires the
rest.

In dependency order:

- **[@yaks/query](./query)** — parse a query string to a plain, serializable
  AST, or build the same AST from code. Schema-agnostic: it knows the format
  (operators, any-of lists, ranges, time literals, directives), not what any
  field means.
- **[@yaks/yaml](./yaml)** — reads the files a vocabulary and its neighbours are
  declared in: YAML parsed to a value (JSON is valid YAML, so nothing has to be
  converted), a markdown file's frontmatter read as a bundle, and placeholders
  in a template filled in. Depends on nothing but the graph's `Bundle` type.
- **[@yaks/vocab](./vocab)** — describe a component vocabulary as JSON Schema
  (2020-12) plus a small custom keyword vocabulary, and interrogate it at
  runtime: column types, path routing, display ordering, instance checks.
- **[@yaks/id](./id)** — entity ids: generate an eid, and turn the `prefix` a
  component declares plus a number into a human-readable id (`B-7`) and back.
  The first package split out of `@yaks/vocab`: the schema keywords live there,
  the code that interprets them lives here.
- **[@yaks/names](./names)** — the other way to address an entity: the
  components a vocabulary marks `by_name`, the column each one stores its name
  in, and the lookup for a name somebody typed.
- **[@yaks/sql](./sql)** — compile a `@yaks/query` AST against a `@yaks/vocab`
  schema into a SQL string and bound params, through a dialect-agnostic
  relational IR (a SQLite dialect ships with the package).
- **[@yaks/archetype](./archetype)** — one content-addressed entity per
  component-table set: portable SHA-256 identity, cached table-presence matches
  and add/remove transitions, and the graph plugin that maintains each entity's
  archetype. SQLite backfills from the physical file and retires descriptors
  whose tables disappeared; readers with narrower vocabularies still agree.
- **@yaks/sqlite** — the storage adapter: composes the three packages above to
  answer queries as result bundles and write bundles back to a SQLite database.
  (In development.)
- **[@yaks/blob](./blob)** — content-addressed storage for a text column,
  transparent to the code reading and writing it: mark the column, and the row
  stores the value's hash while the value itself is written to a table, a
  directory or a bucket — once, however many rows hold the same value.
- **[@yaks/fts](./fts)** — full-text search over any text property: the FTS5
  index implied by the vocabulary, and the `@yaks/sql` extension that compiles a
  bare search term in a query string into a `match` clause.
- **[@yaks/embedding](./embedding)** — the other kind of search: a vector per
  entity, kept current by a sweep, and the `@yaks/sql` extension that compiles
  `.near=<entity>` and `.order=similar` into a nearest-neighbour ranking.
- **[@yaks/telemetry](./telemetry)** — RETIRED: the graph holds what the
  tool-call log held. A call is a `call` settled as a `result` with its `ms` and
  its `created.by`, and a failure is the `error` or `exception` stored with it
  ([@yaks/tools](./tools/README.md#what-the-tool-call-log-was)), so `/telemetry`
  is a query. Nothing composes this package; it dies with the fleet server that
  imports it.
- **[@yaks/match](./match)** — the other evaluator of the same grammar: a
  `@yaks/query` AST run as a predicate over bundles held in memory, with no
  database. Tested query by query for parity with `@yaks/sql`.
- **[@yaks/graph](./graph)** — the core the rest are plugins to: the
  entity/component model, the bundle a write is sent as, and the phased,
  pluggable `apply()` that filters, normalizes, validates and atomically commits
  a list of changes over any `Storage`.
- **[@yaks/render](./render)** — views selected by query specificity and a
  role-rightmost name, actions contributed per component, and column schemas
  matched by the same registry. Renderers are passed a hyperscript function, so
  the program using them decides what a tree is rendered into.
- **[@yaks/preact](./preact)** — the Preact host for that registry: an Entity
  component reading a function store, subscribing while mounted, and handing
  Preact's hyperscript to the same portable renderers.
- **[@yaks/html](./html)** — server-side HTML from the same registry, composed
  through the Preact host and its server serializer without a DOM.
- **[@yaks/text](./text)** — Markdown and plain text from those same trees,
  preserving headings, lists, links, code and emphasis while stripping control
  bytes from every text leaf and destination.
- **[@yaks/markdown](./markdown)** — GFM Markdown parsed to structural nodes for
  that same element vocabulary, never an HTML string or a terminal escape, with
  a link filter that refuses every scheme but `http`, `https` and `mailto`.
- **[@yaks/tui](./tui)** — the same Preact trees on a terminal: a fake DOM, a
  swappable backend (a diffing ANSI painter today), and the three widgets a
  console app is made of — a scrolling transcript, a multi-line input box, and a
  frame with a sidebar of pluggable panels.
- **[@yaks/ram](./ram)** — the storage adapter with nothing underneath it: a
  `Map` of bundles answering `@yaks/graph`'s `Storage`, reads through
  `@yaks/match`, synchronous, browser-ready. Tested change for change against
  `@yaks/sqlite`.
- **[@yaks/edge](./edge)** — links between entities as a component: the
  `edge{from, to}` component an entity carries, the id derived from the
  from/relation/to triple it records, the relations a vocabulary declares, and
  traversal — both as a walk over storage and as the `@yaks/sql` extension that
  compiles `.cites->p1` and `.edges`.
- **[@yaks/key](./key)** — the values an entity can be looked up by, stored as
  entities: a `key{of, value}` component tagged with your own kinds (`isbn`,
  `email`, `alias`), each key's eid being `sha256("<kind>|<value>")` — so a
  value is unique within its kind by construction, and writing it twice writes
  one row. What `@yaks/edge` is to a link, this is to a has-many value.
- **[@yaks/alias](./alias)** — the kind of key that is a name: `alias{name}` on
  an entity, stored as a key of its own, so seed data written twice updates one
  entity rather than creating two — and a name can be used anywhere an eid can,
  in a reference column and in an API request.
- **[@yaks/git](./git)** — git objects as entities: an object's eid IS its SHA-1
  object id, with its SHA-256 name beside it as a key, its body in a @yaks/blob
  store, and the two traversals a pack supports (`entry`, `parent`) as edges —
  plus the builders that turn a `path → sha256` manifest into trees and a
  commit. It also models the working copy: the `repository` and `worktree` a
  checkout consists of, the landed `commit` attached to the work it is about,
  and the `anchor` that ties a document to source. Its `land` tool is the one
  that acts on the local machine: it fast-forwards the branch checked out at
  `ctx.cwd`, which for the CLI is the directory the command was run in.
- **[@yaks/effects](./effects)** — what a graph DOES about what it commits:
  handlers run after the transaction, each isolated, with an optional durable
  ledger. Registered on a component and one of the three things that happen to
  it (`created`/`changed`/`removed`), or on a PATTERN — any query, run wherever
  the transaction just made it true, so nothing has to be stored in the graph
  just to trigger an effect. This package is the mechanism only; it ships no
  effects of its own. Alongside the ledger it defines
  `lease{name, holder, until}`: one background job, one row, its eid derived
  from the job's name and the claim settled by the graph's own precondition — so
  every process can attempt a job and exactly one gets it.
- **[@yaks/journal](./journal)** — who wrote what, when: every committed
  transaction recorded inside that same transaction, in three append-only
  tables, storing after-images only — which gives three things: the history of
  one entity, the inverse of a transaction (undo), and a cursor-based feed of
  everything committed since a given point.
- **[@yaks/doc](./doc)** — the text a person reads: `doc{title, body}`, the one
  component a task, a letter and a recipe all share, so search, editing and
  rendering are implemented once. Its `body` uses `@yaks/blob`'s `store` keyword
  without depending on the package that implements it — content-addressed when
  blob is loaded, plain text otherwise.
- **[@yaks/tools](./tools)** — a tool is a function from bundles to bundles, and
  this runs one and keeps the record: the `tool` registered, the `call` that
  asked for it, the `execution` it is claimed under and the `result` it comes to
  rest as. The calling program invokes the function itself; calls nobody is
  waiting on — scheduled ones, or ones left behind by a crash — are picked up by
  registering this vocabulary's rules as effects.
- **[@yaks/member](./member)** — who belongs and what they may touch: a space
  roster (`member`), per-entity grants (`grant`), an access mode (`access`), the
  `precondition` hook that rejects a write the actor's role does not allow, and
  the `canRead` check the HTTP and MCP servers run before answering a query.
- **[@yaks/session](./session)** — a session is a transcript: its `entry` lines
  (prose as `content`, an `ask` of a model, a tool `call` and its `result`, a
  `stop`), a status computed from the newest entry and never stored, the daemon
  that responds to it, its lock on any entity (`claim`), and the `conflict`
  recorded when two sessions want the same thing.
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
- **[@yaks/spawn](./spawn)** — the previous three combined: a session whose
  provider is an agent CLI. The `using` component on a session's first entry is
  the request; a provider that is a command line (`claude`, `codex`) is started
  as a detached child process through @yaks/process, recorded on the session's
  own entity; and its JSON-lines stdout is read back as that session's entries —
  exactly once, tracked by the `imported{source, line}` component on each. It
  defines no components of its own.
- **[@yaks/context](./context)** — the instructions a transcript was given, as
  entries: a `prompt` entry with its source and a hash of the snapshot it was
  made from, so what the model read is recorded rather than guessed at. It
  persists nothing itself; the calling program decides which sources are allowed
  and writes the rows.
- **[@yaks/model](./model)** — the interface between a conversation and the
  model serving it: provider-neutral message items, one request and reply shape,
  and the `provider`, `model` and `tool` entities a graph stores about them.
- **[@yaks/openai](./openai)** — that interface implemented over OpenAI's
  Responses API: one streamed exchange over `fetch`, a bearer token from
  `OPENAI_API_KEY` or from the Codex sign-in, and the two endpoints those tokens
  are valid for.
- **[@yaks/kernel](./kernel)** — the base components every graph of work uses:
  the entity spine, the provenance marks (`created`, `updated`, `decided`,
  `quarantined`…), the things attached to an entity (`comment`, `image`,
  `favorite`) and the relation tags its edges carry — plus the schema keywords
  the core meta-model does not define (`governed`, `lazy`, `well`).
- **[@yaks/task](./task)** — a to-do list as a component domain: tasks,
  projects, boards that are saved queries rather than stored membership, and a
  status nobody writes — computed from the `completed` and `cancelled` marks a
  task carries, by one rule given to both `@yaks/sql` and `@yaks/match`.
- **[@yaks/wake](./wake)** — coming back to something later, as data: a
  `wake{at, every, target, note}` on any entity, the wakes due at an instant,
  and the recurrence — a duration or a cron expression — that schedules the next
  one. It calls no handler: `tick` writes `fired` and advances the wake, and
  graph rules do the rest. The Cloudflare and Deno drivers share that same
  write.
- **[@yaks/mail](./mail)** — letters as entities: a `mail` addressed to any
  entity, the `deliver` that asks for it to go, the `delivered`/`bounced` it
  comes to rest as, the `created(mail)` effect that hands it to an injected
  sender, and an arrival read into bundles.
- **[@yaks/memory](./memory)** — what a person said, kept in their own words: a
  `memory` component on a `doc` whose body is what they said plus a few lines of
  context, the query that recalls them, and the text handed to an agent at the
  start of its next conversation.
- **[@yaks/persona](./persona)** — who is speaking and what they are for: the
  people a graph knows, the personas an agent can adopt, the roles those
  personas fill, and a persona rendered — its own instructions plus the
  documents it references — into the single markdown file an agent reads.
- **[@yaks/project](./project)** — a portfolio: the `project` work is filed
  under, the `filed` that files it, the `board` that is a saved filter over it,
  and the `venture` being built.
- **[@yaks/goal](./goal)** — an objective that is never finished, and the
  `satisfies` edge recording which work contributed to it.
- **[@yaks/design](./design)** — what was proposed, the review it got, and the
  architecture that stands.
- **[@yaks/dreaming](./dreaming)** — what an agent works on when nothing else is
  asking for its attention: a `dream` with an earliest-start time, the `recall`
  it consolidates, and the effect that starts a session on a dream whose start
  time has passed (`./effects`; the config names what gets started).
- **[@yaks/notify](./notify)** — how somebody is told something: a notification,
  the subscriptions and mutes that decide who gets it, and an open chat.
- **[@yaks/hook](./hook)** — an event another system delivered, kept as it
  arrived.
- **[@yaks/page](./page)** — a web page as captured: its URL, and when its bytes
  were archived.
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
- **[@yaks/mcp](./mcp)** — the same graph exposed to an agent: an MCP server of
  five generic tools that accept and return bundles, served either as a portable
  `fetch` handler or over stdio, with each tool's output schema generated from
  the vocabulary.
- **[@yaks/mcp-client](./mcp-client)** — the client side of MCP: a remote MCP
  server's tools reached over Streamable HTTP and presented as the same `Tool`
  definitions a graph hands to its own model, with credentials resolved by the
  calling program.
- **[@yaks/cli](./cli)** — the same graph from a shell: the `yak` command. A
  config file names a graph, and each command opens it directly — loading the
  plugins the config lists, running the tool in that same process, and exiting.
  There is no server to connect to; SQLite's WAL mode allows as many concurrent
  writers as there are commands running. `--host` is for a graph this machine
  cannot open as a file, in which case the command reads that server's
  `tools/list` at run time instead. Either way the CLI has no built-in command
  list, so it cannot drift out of step with the graph it is talking to, and a
  program can contribute its own commands at start-up to appear alongside the
  rest under one `--help`. `yak serve` is the same composition with the HTTP
  endpoints added — one more process over the same file, not a server everything
  else has to go through.
- **[@yaks/harness](./harness)** — the packages above as a working agent, with
  nothing under it but a file: one SQLite database it makes itself, the session
  daemon in the same process, the shell and generic graph tools handed to the
  model, and the commands (`new`, `send`, `ls`, `show`, `tasks`, `models`)
  contributed through @yaks/cli's plugin interface. No server and no sync —
  everything going in or out is a bundle or a query, so the same rows can be
  moved into a larger graph unchanged.
- **[@yaks/workerd](./workerd)** — that handler as a Cloudflare Worker: the
  `WebSocketPair` upgrade that `/ws` needs, the `fetch` entrypoint a Worker
  exports, authentication from a cookie or a bearer token, and the forwarding to
  a Durable Object when the graph lives in one.
- **[@yaks/durable-object](./durable-object)** — the storage adapter inside that
  Durable Object: its embedded SQLite driven through `@yaks/sqlite`, plus the
  plumbing that hands a hibernatable WebSocket's frames to `@yaks/api`'s
  subscriptions.
- **[@yaks/d1](./d1)** — the other Cloudflare database, and the one that is only
  reachable asynchronously: the same `Storage`, answered with promises, where a
  transaction buffers its writes and sends them as one atomic `batch()`, because
  D1 has no interactive transaction to hold open.
- **[@yaks/sync](./sync)** — the other end of that transport: a plugin that
  forwards a client graph's committed writes to a server, applies what the
  server pushes back, and reconciles — or reverts — the optimistic write in
  between. A `sync` schema keyword declares, per component, which state is
  synced to the server, which stays in the browser, and which is discarded when
  the tab closes.
- **[@yaks/canvas](./canvas)** — the user interface stored as data: a `canvas`
  of `card`s each `pin`ned at a position, the `camera` a window looks through, a
  `cursor`, split `layout`s of `pane`s, folds and a shelf. The layout is stored,
  queried, shared and undone exactly like the content it frames, and the package
  ships the geometry needed to draw it.
- **[@yaks/client](./client)** — the browser layer over all of that: one call
  assembles the graph, its connection to the server and its plugins; a query
  becomes a value that updates as commits change its results; and components
  declared `local` are kept in IndexedDB between page loads.

## Domain plugins

`@yaks/kernel`, `@yaks/doc`, `@yaks/member`, `@yaks/session`, `@yaks/process`,
`@yaks/task`, `@yaks/wake`, `@yaks/mail`, `@yaks/memory`, `@yaks/tools`,
`@yaks/context`, `@yaks/canvas`, `@yaks/platform`, `@yaks/persona`,
`@yaks/project`, `@yaks/goal`, `@yaks/design`, `@yaks/dreaming`, `@yaks/notify`,
`@yaks/hook`, `@yaks/page` and `@yaks/tmux` ship components rather than
machinery. Each is a `vocab.json` (JSON Schema 2020-12, loaded by `@yaks/vocab`)
plus, where it needs one, a graph plugin or an effect — the same shape a
customer app declares its own components in, so an app's entities and these
compose by eid with nothing in between.

These are designed for the use case rather than ported from the fleet server.
That server is being dismantled, and `docs/transition.md` lists, one row per
fleet component, which package's component its rows become when the data is
exported into a plugin-powered graph — or why nothing takes them. Each component
name has exactly ONE home, so all of these load together with no name declared
twice. `bin/transition_test.ts` checks that of the `vocab.json` FILES;
`packages/facets_test.ts` checks it of the `./vocab` export a program actually
imports, which is the place a package could still copy another package's
components into its own document and make the two impossible to load together.

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
| `./routes`  | `routes: (host, options) => Route[]`, `authenticate?`                           | anything            |
| `./service` | `service: (host, options, signal) => void \| Promise<void>`                     | anything            |
| `./views`   | `views` — `@yaks/render` renderers                                              | nothing server-side |
| `.`         | types, and the pure functions the package offers as a library                   |                     |

Throughout this section, `host` is the program that opened the graph — a server,
the CLI, a Worker — and `options` is whatever its config file passed to this
plugin.

Every one of these exports is a factory taking `(host, options)`, `./tools`
included: a check that queries a package's own SQL table gets the connection
through `host.sql`, and a threshold or a relation name comes from config rather
than being hard-coded. Everything a tool needs per CALL — the graph, the caller,
the arguments — is passed in the tool context instead.

### Health checks are just tools named `check`

A health check is a tool whose verb is `check`. That is the entire mechanism:
there is no doctor package and no registry. Running "the doctor" means running
every tool the loaded vocabulary declares with that verb (`checks(host.tools)`,
@yaks/tools), so a program that loads a plugin gets that plugin's invariants
checked, one that drops the plugin drops them too, and no hand-maintained list
can go out of date.

A check belongs to the package whose invariant it is — `@yaks/mail` checks for a
letter that arrived with no sender, `@yaks/session` for a lock whose holder has
exited, `@yaks/sqlite` for the database file's own keys. It returns bundles like
any other tool: its message in `content{body}`, `output{source}` naming the call
it came from, and `error{code}` set to `fail` (a violation it measured) or
`warn` (a possible problem, or something it could not verify). A check that
finds nothing still returns a result, and one that cannot run reports that
rather than passing silently. `packages/cli/checks_test.ts` shows the whole idea
end to end.

What does NOT belong in a package: checks on a particular deployment's health.
The fleet doctor read Cloudflare Email Routing's live rule set, and a provider
credential file on one machine. Both are questions about a deployment, answered
using a credential that deployment holds, and both give the same answer whatever
graph is running. A package's check only reads the graph its own components
describe.

There used to be a `./digest` export, where each plugin contributed its part of
the text a session reads before its first turn. It was removed (T-37707). What a
session should be told is still undecided, and `session_context` now returns
only what a lifecycle hook needs: the session's own id, and the work it holds a
lock on.

There used to be a `./boot` export, the single pass a plugin made at start-up.
It was removed (T-37703), and what it did is now an ordinary effect. Every `yak`
process — a CLI command, a server, a TUI — writes its own `process` row when it
opens a graph (`@yaks/process` `started`), so a plugin's start-up work is a
`created(process)` handler that checks the row is this process
(`@yaks/session/effects` releases the locks a dead holder left behind;
`@yaks/spawn/effects` picks up the agents a restart left running). Each takes a
`lease` (`@yaks/effects`) so that two processes starting at the same time do not
both do the work. Start-up is not a special moment the program has to provide
for; it is a row appearing, visible to everything that reads the graph.

`./service` is work a plugin keeps doing for as long as the program is running:
a clock, a poll, a periodic sweep (`@yaks/wake/service` fires the wakes that
have come due). It is neither a response to a request nor a reaction to a
commit, which is why neither `routes` nor `effects` could hold it: a scheduled
time arriving, and a mailbox that has to be polled, are things nobody is calling
in about.

It is given an `AbortSignal`, makes at least ONE pass, and then keeps going
until that signal aborts — which is what lets the same function work in both a
long-running process and a one-shot command. A service, and the sweep that
retries failed effects, are background jobs (`@yaks/cli` `Served.duties`). Each
is held under a `lease` named after the package that owns it (`@yaks/effects`
`holding`): a server or a TUI claims the job and holds it for as long as it is
running, renewing periodically. A one-shot `yak` command passes its jobs a
signal that has already aborted, so each makes exactly one pass and releases the
lease immediately — clearing anything overdue on the way through, and leaving
alone whatever another process is already holding. A second long-running process
waits for the job and takes it over when a killed holder's lease expires.

None of this assumes a separate process exists. A machine where the only thing
anybody runs is `yak tui` still fires its wakes, and one that splits the HTTP
server, the clock and the sweep across three processes still fires each of them
exactly once.

A subpath a package does not export is a contribution it does not make, and the
program skips it. A subpath that exists but fails to import is an error, never a
skip. Each factory declares only the parts of the host it uses — for example
`(host: { vocab: Vocab })` — so no package has to import `@yaks/cli` in order to
state its requirements.

`./rules` exports two things because they share one reason — both run SQL over
the host's own connection. `rules` decides what a transaction MEANS, as
@yaks/graph plugins. `extend` decides what a QUERY may contain, as @yaks/sql
extensions handed to the store when it is built, so a package that maintains an
index of its own can answer a clause the compiler could not compile by itself,
and every reader gets that clause with no extra wiring. `@yaks/embedding/rules`
is the worked example: it creates the vector table and compiles `.near`.

Each file is named after the subpath it is exported at. Where a package already
uses that filename for something else, the subpath maps to a different file and
the SUBPATH is still the canonical name (`@yaks/harness` has a `tools.ts` of its
own, so its `./tools` export points at `./runs.ts`).

**`./vocab` and `./views` are the browser's half.** The browser imports those
two subpaths from every package, so neither may touch storage, SQL or a server
runtime, and `deno task check:browser` type-checks both with only the web
platform's types in scope. That is what it means for a package to "fit the
split", and it is why `@yaks/process/vocab` can describe a running program
inside a page that could never start one. `packages/facets_test.ts` walks the
whole set: every package with components exports them, every subpath has the
shape a program expects, and `compose` over the fleet's own config loads all of
them.

### Cases that do not split cleanly

Listed here rather than forced into a shape that does not fit. Each is a genuine
design question, and each paragraph records the resolution proposed for it.

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
- **The list of statuses depends on which packages are loaded.** `task.status`
  is computed from the marks a task carries, and a graph that also locks its
  tasks reads a held claim as `wip` — a status `@yaks/task` cannot know about,
  since `claim` belongs to `@yaks/session`. Resolved by load order:
  `@yaks/session/vocab` redeclares `task.status` with the longer list, and a
  config that lists it after `@yaks/task` gets that version. What still does not
  fit is `@yaks/project/rules`, whose board validation checks a saved query
  against the status list and only ever sees the short one; a program that wants
  the longer list has to call `projects(vocab, marks)` itself. The proposal: the
  status list becomes a value the program passes in rather than a package
  default — a change to `@yaks/task`'s signature that needs its own decision.
- ~~**An effect needs a configured object to act on.**~~ Resolved: an entry in
  the config's `plugins` list is either a module specifier or an object with
  `use` and `with`, and whatever is under `with` is passed to each of that
  plugin's factories alongside the host. So `@yaks/mail/effects` builds its own
  transport from what the config named
  (`{"via": "cloudflare", "account", "token": {"env": "…"}}`), and a value
  written as `{"env": "NAME"}` is read from the environment when the config is
  loaded — so a config can name a secret without containing one. See
  [@yaks/cli](./cli/README.md#what-a-config-says-to-one-plugin).
- **`authenticate` is access policy, not a route.** It is exported from
  `./routes` because the HTTP server is where authentication happens, but it is
  not an HTTP path, and at most one plugin in a program may define it.
  `@yaks/member` is where it belongs, but its `members(where)` needs an
  application-specific `Guard` that nothing in a config file can name — which is
  why `@yaks/member` exports `./vocab` and no `./rules`. Plugin options are half
  the answer: a config can now specify the guard's policy. What it still cannot
  specify is a FUNCTION, so this waits on `@yaks/member`'s own decision about
  what a config-expressible guard looks like.
- **`numbers` is set in two places at once.** Whether the store assigns a
  human-readable number alongside an eid is a config field today, even though
  which components HAVE a prefix is declared in the vocabulary. These should be
  one statement. The proposal: the store assigns a number for any component
  whose schema declares a `prefix`, and the config field is removed.
- **`./tools` is a reserved subpath that one core package still uses for
  something else.** `@yaks/vocab/tools` is the tool MECHANISM — validating a
  declaration's input — rather than one plugin's implementations, and it
  predates this convention. Nothing loads it as a plugin, so nothing breaks; the
  check in `packages/facets_test.ts` reserves these subpath names only on
  packages that declare components of their own. `@yaks/graph/tools` was the
  same until the generic tool tier moved into that package's own `vocab.json`:
  it now exports `loadTools` AND the implementations behind `graph apply` and
  the rest, which is exactly what the subpath name means. The proposal, if the
  remaining one ever causes a problem: rename it to `./tool`, singular — one
  declaration, not a table of implementations.
- **A tool call that another process already ran.** A provider CLI's transcript
  is full of them, and `call{to, args}` plus `result{call}` are exactly the
  right components to describe what it did — except that a `call` in this graph
  is an INSTRUCTION: @yaks/tools registers "a call with no result" as an effect
  and runs any call naming a tool this program has, which covers most of what a
  fleet agent calls. So `@yaks/spawn`'s adapters leave another process's tool
  calls in the log file rather than writing a row that would be executed a
  second time. The proposal: a component marking a call as a RECORD rather than
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
- **`@yaks/harness`'s `./vocab` is an application's LIST** of packages, rather
  than the components that package owns. It is a program shaped like a plugin,
  so it cannot be loaded alongside the packages it lists, and
  `packages/facets_test.ts` records it as the other exception. It is a list
  rather than a copy: every document in it is another package's own `./vocab`,
  referenced once, so each still loads alongside every other. What it should
  really be is a config file (`yak serve`), which is T-37580.

## How they compose

Each package depends only on the ones before it in this list, and each is useful
on its own:

- Use `@yaks/query` alone to parse or build a query AST for your own evaluator —
  an in-memory filter, a different backend, a UI that just needs the structure.
- Add `@yaks/vocab` to describe your data's shape as a loadable schema and
  interrogate it (routing, types, ordering) without committing to SQL.
- Add `@yaks/sql` once you want that AST and schema compiled straight to a SQL
  string and params for a real database.
- `@yaks/sqlite` is the batteries-included path: point it at a SQLite database
  and it handles reading and writing entities for you, built entirely from the
  three packages above.
- `@yaks/blob` moves long values out of the rows transparently: one schema
  keyword on the column, a plugin that substitutes the text for its hash inside
  the write's own transaction, and a read override that resolves it back in the
  SQL statement — so a writer sends text and a reader gets text.
- `@yaks/fts` adds search on top: it indexes the text properties and registers a
  clause compiler with `@yaks/sql` — the same extension point the other search
  and traversal packages use.
- `@yaks/embedding` adds the other half of search through that same extension
  point — keyword matching comes from `@yaks/fts`, nearest-by-meaning from here
  — with the embedding function passed in, so nothing ties you to one model. It
  is also the clearest example of what that extension point looks like in
  practice: its `./rules` creates the vector table and gives the store its
  `.near` compiler (`extend`), its `./effects` triggers the sweep when indexed
  text changes, and the model, endpoint and API key are options the config
  passes to the plugin.
- `@yaks/match` is the path with no storage at all: give it the same AST and
  vocabulary and it filters bundles you already hold in memory, so a saved
  filter means the same thing in the database and in the browser.
- `@yaks/ram` puts that evaluator behind the same `Storage` interface: a whole
  graph in a `Map`, with the same `apply()` and the same queries as the database
  path, for a page, a worker, or a test with no database to install.
- `@yaks/edge` adds relationships the same way search was added: a component
  your entities carry, and a clause compiler registered with `@yaks/sql` — so
  `.cites[<=3]->p1` is answered by the database rather than by a walk in your
  own code.
- `@yaks/effects` is the other end of a write: the graph's phases decide what a
  transaction MEANS, and this decides what to DO about it once it has committed
  — send a notification, write a receipt, start a process — registered per
  component or as a pattern over what committed, run after the commit, and
  isolated so that a broken handler can never break a write.
- `@yaks/journal` is the record of the same write: it stores what each
  transaction changed in tables of its own, inside that transaction, so a
  rejected transaction leaves nothing behind and a committed one always leaves a
  record. History, undo, and the change feed a live client replays are three
  different reads of that one log.
- `@yaks/doc` is the smallest domain plugin there is — one component, no hooks —
  and it exists because a shared component deserves a single home: `@yaks/mail`
  stores a letter's subject and body in it, and anything else with a title
  renders through the same renderer. It ships the `store: "blob"` declaration
  and none of the machinery behind it, which is what lets a graph adopt
  content-addressed bodies later without changing its vocabulary.
- `@yaks/member` is the other kind of rule over the same `apply()`: not what a
  transaction MEANS, but who is allowed to make it — enforced as a
  `precondition` hook, so a rejection rolls the whole transaction back, and
  mirrored as a `canRead` that the HTTP and MCP servers call for reads, which
  never reach `apply()` at all.
- `@yaks/session` is the third kind: not who may write, but who is writing right
  now and what they hold while they do it. A lock is stored on the entity it
  locks, taking somebody else's lock rolls the transaction back, and the
  collision is recorded in the `audit` phase — after the rollback, where the
  record survives.
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
  everything else. Receiving is the mirror image: a pure function from message
  to bundles, the two lookups that need a graph, and an HTTP endpoint for a mail
  provider to POST to — idempotent on the Message-ID, so a retry and a sweep
  record one letter, not two.
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
- `@yaks/sync` closes the loop: a `@yaks/graph` over `@yaks/ram` in a page, plus
  this plugin, is a client that writes locally straight away and reconciles with
  the `@yaks/api` server afterwards. Both transports are passed in, so the whole
  round trip can run inside one process in a test.
- `@yaks/client` is that loop with the page's half already wired: the assembly
  in one call, subscriptions surfaced as values a renderer can hold (a signal
  when you hand it a signal factory, `useSyncExternalStore` when you hand it to
  React), and IndexedDB under the components the server never sees.

## Publishing requirements

Every package here publishes to [JSR](https://jsr.io) (and npm), so each one
must meet JSR's bar before it ships. When you add or change a package:

- **Every exported symbol has a doc comment.** Functions, types, constants —
  anything in the public API is documented where it is declared.
- **The entrypoint has a module doc.** `mod.ts` opens with a module-level doc
  comment (`/** … */` at the top) describing what the package is.
- **`deno.json` has a `description`.** One clear sentence naming what the
  package does.
- **Works on at least two runtimes.** JSR derives runtime compatibility by
  analysing the published code, so keep each package runtime-agnostic (Deno and
  Node at minimum) and state its supported runtimes in the README's
  Compatibility section — there is no `deno.json` field for it.

Run `deno publish --dry-run` in a package to check it before landing — it
reports missing docs, slow types, and metadata gaps.
