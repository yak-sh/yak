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
- **[@yaks/yaml](./yaml)** — the warm path for the files a vocabulary and its
  neighbours are DECLARED in: YAML as a value (JSON is YAML, so nothing has to
  be migrated), a markdown file's frontmatter as a bundle, and the named holes
  in a passage filled. Depends on nothing but the graph's `Bundle` type.
- **[@yaks/vocab](./vocab)** — describe a component vocabulary as JSON Schema
  (2020-12) plus a small custom keyword vocabulary, and interrogate it at
  runtime: column types, path routing, display ordering, instance checks.
- **[@yaks/id](./id)** — entity ids: mint an eid, and turn the `prefix` a
  component declares plus a number into a human id (`B-7`) and back. The first
  splinter off `@yaks/vocab`: the meta-model carries the keyword, this package
  is what it means.
- **[@yaks/names](./names)** — the other way an entity is addressed: the
  components a vocabulary marks `by_name`, the column their name lives in, and
  the match for a name someone typed.
- **[@yaks/sql](./sql)** — compile a `@yaks/query` AST against a `@yaks/vocab`
  schema into a SQL string and bound params, through a dialect-agnostic
  relational IR (a SQLite dialect ships with the package).
- **[@yaks/archetype](./archetype)** — one content-addressed entity per
  component-table set: portable SHA-256 identity, cached table-presence matches
  and add/remove transitions, and the graph plugin maintaining each entity's
  archetype. SQLite backfills from the physical file and retires descriptors
  whose tables disappeared; readers with narrower vocabularies still agree.
- **@yaks/sqlite** — the storage adapter: composes the three packages above to
  answer queries as result bundles and write bundles back to a SQLite database.
  (In development.)
- **[@yaks/blob](./blob)** — content-addressed storage for a text column,
  applied without anybody noticing: mark the column, and the row keeps the
  value's hash while the value itself goes to a table, a directory or a bucket —
  once, however many rows hold it.
- **[@yaks/fts](./fts)** — full-text search over any text property: the FTS5
  index a vocabulary implies, and the `@yaks/sql` extension that compiles a bare
  word in a query line to a `match`.
- **[@yaks/embedding](./embedding)** — the other kind of search: a vector per
  entity, kept current by a sweep, and the `@yaks/sql` extension that compiles
  `.near=<entity>` and `.order=similar` into a nearest-neighbour ranking.
- **[@yaks/telemetry](./telemetry)** — RETIRED: the graph holds what the
  tool-call log held. A call is a `call` settled as a `result` with its `ms` and
  its `created.by`, and a failure is the `error` or `exception` beside it
  ([@yaks/tools](./tools/README.md#what-the-tool-call-log-was)), so `/telemetry`
  is a query. Nothing composes this package; it dies with the fleet server that
  imports it.
- **[@yaks/match](./match)** — the other evaluator of the same grammar: a
  `@yaks/query` AST run as a predicate over bundles held in memory, with no
  database. Tested query by query for parity with `@yaks/sql`.
- **[@yaks/graph](./graph)** — the core the rest are plugins to: the
  entity/component model, the bundle a write is sent as, and the phased,
  pluggable `apply()` that admits, normalizes, guards and commits a batch
  atomically over any `Storage`.
- **[@yaks/render](./render)** — views selected by query specificity and a
  role-rightmost name, actions contributed per component, and column schemas
  matched by the same registry. Renderers take an injected hyperscript, so the
  host owns what a tree becomes.
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
  `@yaks/match`, synchronous, browser-ready. Tested batch for batch against
  `@yaks/sqlite`.
- **[@yaks/edge](./edge)** — links between entities as a component: the
  `edge{from, to}` an entity carries, the id it derives from the sentence it
  states, the relations a vocabulary declares, and traversal — as a walk over
  storage, and as the `@yaks/sql` extension compiling `.cites->p1`/`.edges`.
- **[@yaks/key](./key)** — the values an entity answers to, as entities: the
  `key{of, value}` carrier tagged by your own kinds (`isbn`, `email`, `alias`),
  each key named by `sha256("<kind>|<value>")` — so a value is unique within its
  kind by construction and stating it twice writes one row. To a has-many value
  what `@yaks/edge` is to a link.
- **[@yaks/alias](./alias)** — the kind of key that is a NAME: `alias{name}` on
  an entity, lifted into a key of its own, so a seed written twice patches one
  entity — and a name goes wherever an eid goes, in a reference column and at a
  door.
- **[@yaks/git](./git)** — git objects as entities: an object's eid IS its SHA-1
  object id, with its SHA-256 name beside it as a key, its body in a @yaks/blob
  store, and the two walks a pack makes (`entry`, `parent`) as edges — plus the
  builders that turn a `path → sha256` manifest into trees and a commit. Source
  as a graph says it too: the `repository` and `worktree` a checkout is, the
  landed `commit` attached to the work it is about, and the `anchor` a document
  makes into source.
- **[@yaks/effects](./effects)** — what a graph DOES about what it commits:
  handlers run after the transaction, each isolated, with an optional durable
  ledger. Registered on a component and one of the three things that happen to
  it (`created`/`changed`/`removed`), or on a PATTERN — any query, run wherever
  the batch just made it hold, so nothing has to be derived into the graph to
  trigger an effect. The mechanism — it ships no effect of its own.
- **[@yaks/journal](./journal)** — who wrote what, when: every committed batch
  recorded inside its own transaction, in three append-only tables off the
  spine, after-images only — and the three things that fall out: the history of
  one entity, the inverse of a batch (undo), and a cursor feed of what has
  committed since.
- **[@yaks/doc](./doc)** — the words a person reads: `doc{title, body}`, the one
  component a task, a letter and a recipe all wear, so search, editing and
  rendering are written once. Its `body` NAMES `@yaks/blob`'s `store` keyword
  without depending on the package that reads it — content-addressed where blob
  is composed in, plain text everywhere else.
- **[@yaks/tools](./tools)** — a tool is a function from bundles to bundles, and
  this runs one and keeps the record: the `tool` registered, the `call` that
  asked for it, the `execution` it is claimed under and the `result` it comes to
  rest as. A host calls the function itself; the calls nobody is waiting on —
  scheduled, or left by a crash — are found by registering the rules this
  vocabulary declares as effects.
- **[@yaks/member](./member)** — who belongs and what they may touch: a space
  roster (`member`), per-thing grants (`grant`), an access mode (`access`), the
  `precondition` hook that refuses a write the actor's role does not allow, and
  the `canRead` a door consults before it answers a query.
- **[@yaks/session](./session)** — a session is a transcript: its `entry` lines
  (prose as `content`, an `ask` of a model, a tool `call` and its `result`, a
  `stop`), a status read off the newest one and never stored, the daemon that
  reacts to it, its lock on any entity (`claim`), and the `conflict` written
  down when two sessions want one thing.
- **[@yaks/process](./process)** — a running program as an entity, so whatever
  needs one points at it instead of keeping a pid: `process{pid, command, cwd}`
  for the one that is running, `service{command, cwd, restart, attempts}` for
  the one that should be, `exit{code}`, and its output as @yaks/session's
  `content{body}` + `output{source}`. Four entry points over one loop — launch a
  child detached, adopt one by pid, re-adopt every unfinished row at boot, and
  supervise the wanted ones from a host's tick — plus the same rows as a
  session's `shell`, `wait` and `stop` tools, so a long tool call answers with
  the process instead of blocking on it.
- **[@yaks/context](./context)** — the instructions a transcript was given, as
  entries: a `prompt` entry with its source and a hash of the snapshot it was
  made from, so what the model read is a row and not a guess. It persists
  nothing; the host admits sources and writes the bundles.
- **[@yaks/model](./model)** — the seam between a conversation and the model
  that serves it: provider-neutral items, one request and reply shape, and the
  `provider`, `model` and `tool` entities a graph keeps about serving.
- **[@yaks/openai](./openai)** — that seam over OpenAI's Responses API: one
  streamed exchange over `fetch`, a bearer from `OPENAI_API_KEY` or the Codex
  sign-in, the two endpoints those bearers open.
- **[@yaks/kernel](./kernel)** — the base words a graph of work wears: the
  entity spine, the provenance marks (`created`, `updated`, `decided`,
  `quarantined`…), the things attached to an entity (`comment`, `image`,
  `favorite`) and the relation tags its edges say — plus the keywords the core
  meta-model does not describe (`governed`, `lazy`, `well`).
- **[@yaks/task](./task)** — a to-do list as a component domain: tasks,
  projects, boards that are saved queries rather than stored membership, and a
  status nobody writes — read off the `completed` and `cancelled` marks a task
  wears, by one rule both `@yaks/sql` and `@yaks/match` are given.
- **[@yaks/wake](./wake)** — coming back to something later, as data: a
  `wake{at, every, target, note}` on any entity, the wakes due at an instant,
  and the recurrence — a duration or a cron line — that moves one on. It fires
  no handler: `tick` writes `fired` and advances the wake; graph rules do the
  rest. Cloudflare and Deno drivers share that same write.
- **[@yaks/mail](./mail)** — letters as entities: a `mail` addressed to any
  entity, the `deliver` that asks for it to go, the `delivered`/`bounced` it
  comes to rest as, the `created(mail)` effect that hands it to an injected
  sender, and an arrival read into bundles.
- **[@yaks/memory](./memory)** — what a person said, kept in their own words: a
  `memory` on a `doc` whose body is the sentence itself with a few lines of
  context, the filter line that recalls them, and the passage handed to an agent
  at the start of its next conversation.
- **[@yaks/persona](./persona)** — who is speaking, what they are for, and what
  they say: the people a graph knows, the personas an agent wears, the roles
  those personas are hired into, and a persona materialized — its own voice plus
  the docs it carries and names — as the one markdown document an agent reads.
- **[@yaks/project](./project)** — a portfolio: the `project` work is filed
  under, the `filed` that files it, the `board` that is a saved filter over it,
  and the `venture` being built.
- **[@yaks/goal](./goal)** — a purpose that is never finished, and the
  `satisfies` edge that says which work satisfied it.
- **[@yaks/design](./design)** — what was proposed, the review it got, and the
  architecture that stands.
- **[@yaks/dreaming](./dreaming)** — what an agent returns to when nothing is
  asking: a `dream` with a floor under it, and the `recall` it consolidates.
- **[@yaks/notify](./notify)** — how somebody is told: a knock, what they watch
  or mute, and an open chat.
- **[@yaks/hook](./hook)** — an event another system delivered, kept as it
  arrived.
- **[@yaks/page](./page)** — a page as witnessed: its address, and when its
  bytes were frozen.
- **[@yaks/tmux](./tmux)** — a terminal somebody can watch: `tmux{of, pane}`,
  what is running in it and the target tmux answers to. Words only — a session
  is a transcript and a process is a pid, and the terminal is the third fact.
- **[@yaks/platform](./platform)** — what a hosting platform keeps about the
  apps it serves: `space`, `app`, `deploy`, `published`, `hostname`,
  `installed`, `plan`, `meter`, `signin` and `report`. Belonging to a space is
  [@yaks/member](./member)'s `member`, and the access ladder over it is its
  `grant` — two facts, not one enum.
- **[@yaks/api](./api)** — the transport: a plain `Request` → `Response` handler
  over a graph (`/apply`, `/query`, `/ws`), where the door authenticates the
  writer, and a subscription is a saved query whose answer is pushed again when
  a committed batch changes it.
- **[@yaks/mcp](./mcp)** — the agent's door onto the same graph: an MCP server
  of five generic tools that take and answer bundles, served as a portable
  `fetch` handler or over stdio, each tool's output schema derived from the
  vocabulary.
- **[@yaks/mcp-client](./mcp-client)** — the other side of that door: a remote
  MCP server's tools over Streamable HTTP, exposed as the same `Tool`
  definitions a graph hands its own model, with the host resolving credentials.
- **[@yaks/cli](./cli)** — that door from a shell: the `yak` command, which
  reads an MCP server's `tools/list` at run time and makes every tool a
  subcommand, mapping the command line through each tool's own input schema. It
  has no verb list of its own, so it cannot drift from the connector an agent is
  talking to — and a PLUGIN, a table of tools contributed at boot, is how a box
  adds words of its own beside them under one help. It is also the HOST:
  `yak serve` reads one config naming plugin modules, imports each, and composes
  what they export — vocabulary, rules, tool runs, effects, routes — into a
  graph with the doors on it. A plugin is a plain module; there is no registry
  and no other server wiring.
- **[@yaks/harness](./harness)** — the packages above as a working agent, with
  nothing under it but a file: one SQLite database it makes itself, the session
  daemon in the same process, the shell and the generic graph tools handed to
  the model, and a command (`new`, `send`, `ls`, `show`, `tasks`, `models`) over
  @yaks/cli's plugin seam. No server, no sync — everything in and out is a
  bundle or a query, so the same rows move into a fleet's graph unchanged.
- **[@yaks/workerd](./workerd)** — that handler as a Cloudflare Worker: the
  `WebSocketPair` upgrade `/ws` needs, the `fetch` entrypoint a Worker exports,
  a door that reads a cookie or a bearer token, and the hop to a Durable Object
  when the graph lives in one.
- **[@yaks/durable-object](./durable-object)** — the storage adapter inside that
  Durable Object: its embedded SQLite driven through `@yaks/sqlite`, plus the
  plumbing that hands a hibernatable WebSocket's frames to `@yaks/api`'s
  subscriptions.
- **[@yaks/d1](./d1)** — the other Cloudflare database, and the one that is only
  reachable asynchronously: the same `Storage`, answered with promises, where a
  transaction defers its writes and sends them as one atomic `batch()` because
  D1 has no interactive transaction to hold open.
- **[@yaks/sync](./sync)** — the other end of that transport: a plugin that
  forwards a client graph's committed writes to a server, applies what the
  server pushes back, and reconciles — or reverts — the optimistic write in
  between. A `sync` keyword says per component which state syncs, which stays in
  the browser, and which dies with the tab.
- **[@yaks/canvas](./canvas)** — the interface as data: a `canvas` of `card`s
  each `pin`ned somewhere, the `camera` a window looks through, a `cursor`,
  split `layout`s of `pane`s, folds and a shelf — layout stored, queried, shared
  and undone like the content it frames, plus the geometry to paint it.
- **[@yaks/client](./client)** — the frontend tier over all of that: one call
  assembles the graph, the wire and the plugins; a query becomes a value that
  changes as commits move it; and the components declared `local` are kept in
  IndexedDB between page loads.

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

These are designed for the use-case, not ported from the fleet server: that
server is being dismantled, and `docs/transition.md` says, one row per fleet
component, which package component its rows become when its data is exported
into a plugin-powered graph — or why nothing takes them. A word has ONE home, so
all of these load together with no name declared twice
(`bin/transition_test.ts`).

## Facets: a plugin is a package, a facet is a subpath

A host does not import a plugin. It imports the FACETS of one, a subpath apiece,
and takes the ones it runs (`@yaks/cli` `compose`, `packages/cli`):

| subpath     | what it exports                                               | may import          |
| ----------- | ------------------------------------------------------------- | ------------------- |
| `./vocab`   | `docs`, `keywords?`, `derived?`                               | nothing server-side |
| `./rules`   | `rules: (host, options) => Plugin[]`, `extend?` (@yaks/sql)   | anything            |
| `./tools`   | `runs: Runs`, behind its `tool: true` declarations            | ajv, SQL, anything  |
| `./effects` | `effects: (host, options) => Watch[]`                         | anything            |
| `./routes`  | `routes: (host, options) => Route[]`, `authenticate?`         | anything            |
| `./views`   | `views` — `@yaks/render` renderers                            | nothing server-side |
| `.`         | types, and the pure functions the package offers as a library |                     |

A subpath a package does not export is a facet it does not have, and the host
skips it; a subpath that exists and fails to import is an error, never a skip. A
facet factory names the parts of the host it uses — `(host: { vocab: Vocab })` —
so no package imports `@yaks/cli` to say what it needs.

`./rules` says two things because they have one reason — SQL over the host's own
connection. `rules` is what a batch MEANS, as @yaks/graph plugins; `extend` is
what a QUERY may say, as @yaks/sql extensions handed to the store when it is
built, so a package holding an index of its own answers a clause the compiler
declines alone and every door that reads gets it without wiring
(`@yaks/embedding/rules` is the worked example: the vector table, and `.near`).

The facet file is named after the facet. Where a package already owns that
filename for something else, the subpath maps to another file and the SUBPATH is
still the facet's name (`@yaks/harness` has a `tools.ts` of its own, so its
`./tools` is `./runs.ts`).

**`./vocab` and `./views` are the web door's half.** The browser imports those
two of every package, so neither may reach storage, SQL or a runtime, and
`deno task check:browser` type-checks both with only the web platform in scope.
That is what "this package fits the split" MEANS, and it is why
`@yaks/process/vocab` describes a running program in a page that could never
start one. `packages/facets_test.ts` walks the set: every package with words
exports them, every facet is shaped the way a host reads it, and `compose` over
the fleet's own config takes all of them.

### Facets that do not split cleanly

Named here rather than forced. Each is a real seam, and the paragraph is the
shape proposed for it.

- **`pane` is a word two ideas want.** `@yaks/canvas` declares
  `pane{layout, parent, dir, content, view}` — a region of a layout — and a
  terminal is the other thing anybody calls a pane. Component names are one flat
  namespace and `loadVocab` refuses a word declared twice
  (`bin/transition_test.ts` holds every package vocabulary to loading beside
  every other), so the two cannot both have it and a host may well want a canvas
  and a terminal at once. Resolved by moving the word down a level: `@yaks/tmux`
  says `tmux{of, pane}`, the package's own word carrying the component and
  `pane` naming the thing tmux addresses — which is also what the fleet's own
  note in `src/sessions.ts` had proposed. The alternative, renaming the canvas's
  `pane` to `region`, is a better word for a layout split and a change that
  belongs with the canvas's own move, not with the facet split.
- **The status ladder is a composition, not a package's.** `task.status` is
  computed from the marks a task wears, and a graph that LEASES its tasks reads
  a held claim as `wip` — a rung `@yaks/task` cannot know about, since `claim`
  is `@yaks/session`'s. Resolved by ordering: `@yaks/session/vocab` restates
  `task.status` with the wider ladder, and a config listing it after
  `@yaks/task` gets that reading. What still does not fit is
  `@yaks/project/rules`, whose board guard validates a saved query against the
  ladder and sees only the narrow one; a host wanting the wider guard composes
  `projects(vocab, marks)` itself. The proposal: the ladder becomes a value the
  host passes, not a package's default — which is a change to `@yaks/task`'s
  signature and wants its own decision.
- ~~**An effect needs a configured thing to act on.**~~ Answered: a `plugins`
  entry is a specifier or `{"use", "with"}`, and the options in `with` are
  handed to each of that plugin's facet factories beside the host. So
  `@yaks/mail/effects` builds its own transport from what the config named
  (`{"via": "cloudflare", "account", "token": {"env": "…"}}`), and a value
  written `{"env": "NAME"}` is read from the environment when the config is
  read, so a config names a secret without holding one. See
  [@yaks/cli](./cli/README.md#what-a-config-says-to-one-plugin).
- **`authenticate` is storage policy, not a route.** It lives on `./routes`
  because a door is where trust is, but it is not an HTTP path and at most one
  plugin in a host may say it. `@yaks/member` is where the answer belongs, and
  its `members(where)` needs an app-specific `Guard` that nothing in a config
  names — which is why `@yaks/member` exports `./vocab` and no `./rules`. The
  options above are half the answer: a config can now name the guard's policy.
  What it still cannot name is a FUNCTION, so this one waits on `@yaks/member`'s
  own decision about what a config-shaped guard looks like.
- **`numbers` is the host's, and a word's.** Whether the store mints a human
  number beside an eid is a config field today, though which components HAVE a
  prefix is a vocabulary fact. The two should be one statement. The proposal:
  the store mints a number for a component whose schema declares a `prefix`, and
  the config field goes.
- **`./tools` is a reserved name that two core packages already use.**
  `@yaks/graph/tools` and `@yaks/vocab/tools` are the tool MECHANISM — loading a
  declaration, checking its input — not a plugin's runs, and they predate the
  facets. Nobody composes either as a plugin, so nothing breaks; the facet check
  in `packages/facets_test.ts` reserves facet names on plugin-shaped packages
  only. The proposal, if it ever bites: those two become `./tool`, singular —
  one declaration, not a table of runs.
- **A view that needs SQL.** No package has one yet. When one does — a renderer
  that wants a computed column the store answers — the column is the `derived`
  in `./vocab` and the renderer reads it off the bundle; a `./views` that
  imports a driver is a view that has gone to the wrong side of the door, and
  the browser gate will say so.
- **Two packages still answer a clause nobody composed.** `@yaks/fts` (a text
  term) and `@yaks/edge` (`.cites[<=3]->p1`) register through the same @yaks/sql
  seam `@yaks/embedding` does, but only when an APPLICATION hands `compile()` an
  extension itself — neither exports `./rules`, so a host composed from a config
  cannot search or walk. Each wants the three lines `@yaks/embedding/rules` has:
  its indexes raised through `host.sql`, its compiler returned from `extend`.
- **`@yaks/render`'s `vocab.json` describes a column schema**, not a component
  domain, so it is the one vocabulary document with no `./vocab` subpath and the
  one the facet test names as an exception.

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
- `@yaks/blob` moves the long values out of the rows without telling anyone: one
  keyword on the column, a plugin that swaps the text for its hash inside the
  write's own transaction, and a read override that resolves it back in the
  statement — so a writer sends text and a reader gets text.
- `@yaks/fts` adds search on top: it indexes the text properties and registers a
  clause compiler with `@yaks/sql`, which is the same seam the other search and
  traversal packages use.
- `@yaks/embedding` adds the other half of search through that same seam —
  keyword recall from `@yaks/fts`, meaning-nearest from here — with the embedder
  injected, so nothing commits you to a model. It is also the package that shows
  what that seam looks like from a HOST: its `./rules` raises the vector table
  and hands the store its `.near` compiler (`extend`), its `./effects` nudges
  the sweep when embedded text moves, and the model, endpoint and key are the
  options the config names beside the plugin.
- `@yaks/match` is the path with no storage at all: hand it the same AST and
  vocabulary and it filters the bundles you already hold, so a saved filter
  means one thing in the database and in the page.
- `@yaks/ram` puts that evaluator behind the storage seam: a whole graph in a
  Map, with the same `apply()` and the same queries as the database path, for a
  page, a worker, or a test that has no database to install.
- `@yaks/edge` adds relationships the same way search was added: a component
  your entities carry, and a clause compiler registered with `@yaks/sql` — so
  `.cites[<=3]->p1` is answered by the database rather than by a walk in your
  own code.
- `@yaks/effects` is the other end of a write: the graph's phases decide what a
  batch MEANS, and this decides what to do about it once it is true — a
  notification, a receipt, a spawned process — registered per component or as a
  pattern over what committed, run post-commit, and isolated so a broken
  observer never breaks a write.
- `@yaks/journal` is the memory of the same write: it records what each batch
  moved in tables of its own, inside the transaction, so a refused batch leaves
  nothing and a committed one always left a record. History, undo and the delta
  feed a live client replays are three readings of that one log.
- `@yaks/doc` is the smallest domain plugin there is — one component, no hooks —
  and it is here because a base word deserves one home: `@yaks/mail` keeps a
  letter's subject and body in it, and anything else with a title reads through
  the same renderer. It ships the `store: "blob"` declaration and none of the
  machinery, which is what lets a graph grow into content-addressed bodies
  without touching its vocabulary.
- `@yaks/member` is the other kind of rule over the same `apply()`: not what a
  batch MEANS but who is allowed to say it, enforced as a `precondition` hook so
  a refusal rolls the batch back, and mirrored as a `canRead` the door asks for
  the reads that never reach `apply()` at all.
- `@yaks/session` is the third kind: not who may write, but who is writing right
  now and what they hold while they do it. A lock rides the entity it locks, a
  take of somebody else's rolls the batch back, and the collision is written
  down on the `audit` phase — after the rollback, where the record survives.
- `@yaks/task` is a domain rather than a mechanism — the shape a plugin takes
  when it ships components instead of machinery. Its one interesting move is
  that a task's status is not stored: it is derived from the marks a task wears,
  and the rule is a list the package hands to both evaluators, so a saved board
  filter means the same thing in a database and in a page.
- `@yaks/mail` is what a domain plugin looks like once both halves are there: it
  contributes components like `@yaks/edge`, depends on `@yaks/doc` for the words
  a letter carries, and registers an effect like the mechanism `@yaks/effects`
  ships empty. Sending is post-commit, so a mail server that is down cannot
  refuse a write; the outcome is written back as components, so what became of a
  letter is a query. It also fills the `created(member)` slot `@yaks/member`
  documents and leaves for it — an invitation is a letter, written through the
  same `apply()` as everything else.
- `@yaks/api` puts the whole stack behind three routes. It composes
  `@yaks/graph` (for writes) with a storage adapter (for reads) and
  `@yaks/match` (to decide cheaply which subscription a committed batch
  changed), and speaks only web-standard types, so the same handler serves on
  Deno, Node and a Worker.
- `@yaks/mcp` is that same door for an agent instead of a program: it takes
  `@yaks/api`'s `Authenticate` and its signing, so both doors onto one graph
  agree about who is writing, and it answers in the same bundles — described by
  an output schema derived from `@yaks/vocab`, so an agent reads a typed value
  rather than parsing prose.
- `@yaks/workerd` is the last inch of that on Cloudflare: the three things a
  Worker does differently — make a socket, export a `fetch`, name the writer —
  so a graph is served from the edge without `@yaks/api` learning a Cloudflare
  name.
- `@yaks/durable-object` is the storage under it, where the database comes with
  the host: one Durable Object is one graph, strongly consistent, with nothing
  to connect to — and its hibernatable sockets are where the subscriptions live.
- `@yaks/d1` is the same seam where the database is across a network instead of
  in the host, which is what makes the sync pass-through worth having: one
  `apply()` runs synchronously over SQLite and a Durable Object and returns a
  promise here, with the phases, plugins and cascade unchanged. Its README
  states exactly what D1's lack of an interactive transaction costs, rather than
  claiming an isolation D1 does not offer.
- `@yaks/sync` closes the loop: a `@yaks/graph` over `@yaks/ram` in a page, plus
  this plugin, is a client that writes locally at once and agrees with the
  `@yaks/api` at the other end afterwards. Both transports are injected, so the
  whole round trip runs in one process in a test.
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
