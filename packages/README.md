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
- **[@yaks/api](./api)** — the transport: a plain `Request` → `Response` handler
  over a graph (`/apply`, `/query`, `/ws`), where the door authenticates the
  writer, and a subscription is a saved query whose answer is pushed again when
  a committed batch changes it.

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
- `@yaks/api` puts the whole stack behind three routes. It composes
  `@yaks/graph` (for writes) with a storage adapter (for reads) and
  `@yaks/match` (to decide cheaply which subscription a committed batch
  changed), and speaks only web-standard types, so the same handler serves on
  Deno, Node and a Worker.

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
