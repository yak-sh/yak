# Tasks v2 — the fleet entity graph

v2 of the holdco task board. A walking skeleton: one SQLite file is the fleet's
memory substrate, modelled as a **star ECS** graph, rendered by a Fresh app.

- **`entity`** — the spine. Every thing (task, comment, design doc, persona…) is
  an entity with a shared primary key (`eid`), a `kind`, and a `created_at`.
- **Component tables** hang off that id. `task` (`eid` PK/FK, `title`, `status`,
  `body`) is the only one so far; more kinds slot in without touching this one.
- **`dependency`** — typed `eid ↔ eid` edges, so anything relates to anything:
  - `blocks` — hard gate,
  - `subtask` — decomposition (the parent rolls up),
  - `informs` — read-first, never gates.

Not yet here (follows the migration plan): v1 data, auth, the API surface,
sqlite-vector embeddings, typed short ids (T-123 / C-123).

## Schema sketch

```sql
entity(eid pk, kind, created_at)
task(eid pk→entity.eid, title, status, body)
dependency(src_eid→entity, dst_eid→entity, type ∈ blocks|subtask|informs)
```

`db.ts` owns the file. By default it lives at `~/.tasks/tasks.db` — outside the
repo; set `DB_PATH` to move it. It plants the schema on first boot
(`create if not exists`) and seeds a handful of neutral demo tasks with one edge
of each type. The index route (`routes/index.tsx`) opens the db once, queries
the task-to-entity join, and composes the small components in `components/`
(`Tasks`, `Task`, `Dot`, `Edge`) to render each task with its outgoing edges.

## Run

```sh
deno task seed   # bootstrap ~/.tasks/tasks.db from the seed (optional; dev does it)
deno task dev    # Fresh dev server (Vite) at http://localhost:5173
deno task check  # deno fmt --check + lint + type-check
```

## Stack

- **Deno 2.9** — runtime + task runner.
- **Fresh 2.3** (`jsr:@fresh/core`) — Vite-based; islands architecture, but this
  skeleton is server-render only (no client JS).
- **SQLite via `node:sqlite`** (`DatabaseSync`) — Deno's built-in driver, no
  external dependency. Synchronous API, which suits a server-side read path.
