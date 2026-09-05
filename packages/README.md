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
- **[@yaks/match](./match)** — the other evaluator of the same grammar: a
  `@yaks/query` AST run as a predicate over bundles held in memory, with no
  database. Tested query by query for parity with `@yaks/sql`.
- **[@yaks/memory](./memory)** — the storage adapter with nothing underneath it:
  a `Map` of bundles answering `@yaks/graph`'s `Storage`, reads through
  `@yaks/match`, synchronous, browser-ready. Tested batch for batch against
  `@yaks/sqlite`.
- **[@yaks/edge](./edge)** — links between entities as a component: the
  `edge{from, to}` an entity carries, the id it derives from the sentence it
  states, the relations a vocabulary declares, and traversal — as a walk over
  storage, and as the `@yaks/sql` extension compiling `.reaches`/`.edges`.
- **[@yaks/effects](./effects)** — what a graph DOES about what it commits:
  `created`/`changed`/`removed` handlers per component, run after the
  transaction, each isolated, with an optional durable ledger. The mechanism —
  it ships no effect of its own.
- **[@yaks/api](./api)** — the transport: a plain `Request` → `Response` handler
  over a graph (`/apply`, `/query`, `/ws`), where the door authenticates the
  writer, and a subscription is a saved query whose answer is pushed again when
  a committed batch changes it.
- **[@yaks/mcp](./mcp)** — the agent's door onto the same graph: an MCP server
  of five generic tools that take and answer bundles, served as a portable
  `fetch` handler or over stdio, each tool's output schema derived from the
  vocabulary.
- **[@yaks/workers](./workers)** — that handler as a Cloudflare Worker: the
  `WebSocketPair` upgrade `/ws` needs, the `fetch` entrypoint a Worker exports,
  a door that reads a cookie or a bearer token, and the hop to a Durable Object
  when the graph lives in one.
- **[@yaks/durable-object](./durable-object)** — the storage adapter inside that
  Durable Object: its embedded SQLite driven through `@yaks/sqlite`, plus the
  plumbing that hands a hibernatable WebSocket's frames to `@yaks/api`'s
  subscriptions.
- **[@yaks/sync](./sync)** — the other end of that transport: a plugin that
  forwards a client graph's committed writes to a server, applies what the
  server pushes back, and reconciles — or reverts — the optimistic write in
  between. A `persist` keyword says per component which state syncs, which stays
  in the browser, and which dies with the tab.
- **[@yaks/client](./client)** — the frontend tier over all of that: one call
  assembles the graph, the wire and the plugins; a query becomes a value that
  changes as commits move it; and the components declared `local` are kept in
  IndexedDB between page loads.

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
  injected, so nothing commits you to a model.
- `@yaks/match` is the path with no storage at all: hand it the same AST and
  vocabulary and it filters the bundles you already hold, so a saved filter
  means one thing in the database and in the page.
- `@yaks/memory` puts that evaluator behind the storage seam: a whole graph in a
  Map, with the same `apply()` and the same queries as the database path, for a
  page, a worker, or a test that has no database to install.
- `@yaks/edge` adds relationships the same way search was added: a component
  your entities carry, and a clause compiler registered with `@yaks/sql` — so
  `.reaches[cites,<=3]=p1` is answered by the database rather than by a walk in
  your own code.
- `@yaks/effects` is the other end of a write: the graph's phases decide what a
  batch MEANS, and this decides what to do about it once it is true — a
  notification, a receipt, a spawned process — registered per component, run
  post-commit, and isolated so a broken observer never breaks a write.
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
- `@yaks/workers` is the last inch of that on Cloudflare: the three things a
  Worker does differently — make a socket, export a `fetch`, name the writer —
  so a graph is served from the edge without `@yaks/api` learning a Cloudflare
  name.
- `@yaks/durable-object` is the storage under it, where the database comes with
  the host: one Durable Object is one graph, strongly consistent, with nothing
  to connect to — and its hibernatable sockets are where the subscriptions live.
- `@yaks/sync` closes the loop: a `@yaks/graph` over `@yaks/memory` in a page,
  plus this plugin, is a client that writes locally at once and agrees with the
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
