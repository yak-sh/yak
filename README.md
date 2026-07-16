# Tasks v2 — the fleet entity graph

v2 of the holdco task board. One SQLite file is the fleet's memory substrate,
modelled as a **star ECS** graph, rendered by a no-build Preact app.

- **`entity`** — the spine. Every thing (task, comment, design doc, persona…) is
  an entity with a shared primary key (`eid`), a `kind`, and a `created_at`.
- **Component tables** hang off that id: `task`, `project`, `card`, `pin`,
  `client`, `camera` so far; more kinds slot in without touching the spine.
- **`dependency`** — typed `eid ↔ eid` edges, so anything relates to anything:
  - `requires` — hard gate (the parent waits on the child),
  - `contains` — decomposition (children roll up to the parent),
  - `reads` — read-first, never gates.

Not yet here (follows the migration plan): v1 data, auth, the API surface,
sqlite-vector embeddings, typed short ids (T-123 / C-123).

## Schema sketch

```sql
entity(eid uuid pk, num server-minted, kind, created_at)
task(eid pk→entity.eid, title, status, body)
project(eid pk→entity, title)
card(eid pk→entity, target_eid→entity, view)
pin(eid pk→card, canvas_eid→entity, x, y, w, h)
client(eid pk→entity, user_agent, ip)
camera(eid pk→entity, client_eid→entity, canvas_eid→entity, x, y, zoom, w, h)
dependency(parent_eid→entity, type ∈ requires|contains|reads, child_eid→entity)
```

`src/db.ts` owns the file. By default it lives at `~/.tasks/tasks.db` — outside
the repo; set `DB_PATH` to move it. It plants the schema on first boot
(`create if not exists`) and seeds a handful of neutral demo tasks with one edge
of each type.

## How it runs

No bundler, no framework. `src/server.ts` is a `deno serve` module that does
everything:

- serves `src/` as-is — `index.html`, `styles.css`, icons;
- translates `.ts`/`.tsx` to JS per request (sucrase: strip types, compile JSX)
  — no type-checking at serve time, `deno task check` is the type gate;
- bare imports (`preact`, `@preact/signals`) resolve through the import map in
  `index.html` to the vendored ESM in `src/vendor/`;
- `/snapshot` hands a new client the whole graph; the `/ws` socket carries flat
  component-patch batches both ways and rebroadcasts to everyone else;
- a `src/` watcher tells clients to reload — and since all state lives in the db
  (camera, pins, views) and localStorage (identity), a reload comes back exactly
  where you were. `--watch` restarts the server for its own modules.

The browser fills an entity cache from the snapshot (`src/live.ts`), renders
everything from it, and keeps it current from the socket. Local edits land in
the cache first (instant), then go out as patches.

## Run

```sh
deno task dev    # http://localhost:5173
deno task seed   # bootstrap ~/.tasks/tasks.db (optional; dev does it)
deno task check  # deno fmt --check + lint + type-check
```

## Stack

- **Deno 2.9** — runtime, task runner, type-checker.
- **Preact + signals** — vendored as plain ESM in `src/vendor/`, no
  node_modules.
- **sucrase** — TS/JSX translation at serve time (server-side dependency, cached
  by Deno).
- **SQLite via `node:sqlite`** (`DatabaseSync`) — Deno's built-in driver, no
  external dependency.
