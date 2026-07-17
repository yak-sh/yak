# Tasks v2 — the fleet entity graph

v2 of the holdco task board. One SQLite file is the fleet's memory substrate,
modelled as a **star ECS** graph, rendered by a no-build Preact app.

- **`entity`** — the spine. Every thing (task, comment, design doc, persona…) is
  an entity with a shared primary key (`eid`), a `kind`, and a `created_at`.
- **Component tables** hang off that id: `task`, `board`, `card`, `pin`,
  `client`, `camera` so far; more kinds slot in without touching the spine.
- **`dependency`** — typed `eid ↔ eid` edges, so anything relates to anything:
  - `requires` — hard gate (the parent waits on the child),
  - `contains` — decomposition (children roll up to the parent),
  - `reads` — read-first, never gates.

Not yet here (follows the migration plan): v1 data, auth, the API surface,
sqlite-vector embeddings, typed short ids (T-123 / C-123).

## Schema sketch

```sql
entity(eid uuid pk, num server-minted, created_at)  -- no kind: components decide
doc(eid pk→entity.eid, title, body)      -- the written face; anything can carry one
task(eid pk→doc carrier, status, priority, project_eid→entity)
project(eid pk→entity)                     -- a tag: this doc fronts a project
board(eid pk→entity)                       -- a tag: this doc fronts a kanban
card(eid pk→entity, target_eid→entity, view)
pin(eid pk→card, canvas_eid→entity, x, y, w, h)
client(eid pk→entity, user_agent, ip)
camera(eid pk→entity, client_eid→entity, canvas_eid→entity, x, y, zoom, w, h)
session(eid pk→entity, id unique)  -- an agent session; grows model/persona/provider
claim(eid pk→entity, session_eid→entity, claimed_at)  -- a session's lease
comment(eid pk→entity, target_eid→entity, author_eid)  -- a doc aimed at ANYTHING
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

## The TUI

The same app renders in a terminal: `src/tui/` swaps the document for a
just-enough fake DOM (the undom trick), paints it as ANSI lines, and feeds raw
keys to the same vim mode machine. Everything below the paint layer is shared —
cache, socket, signals, and the view registry; the TUI prepends its own
renderers (a Board becomes a nested list) and every other view renders through
the exact components the browser uses. It's another live client: edits made in a
browser appear on the next frame.

```sh
deno task tui    # vim keys: j/k/h/l browse, : commands, q quits
```

## Run

```sh
deno task dev    # http://localhost:5173
deno task tui    # browse the board in the terminal (needs dev running)
deno task seed   # bootstrap ~/.tasks/tasks.db (optional; dev does it)
deno task check  # deno fmt --check + lint + type-check
```

## CLI

`deno task install` puts a global `task` on PATH (`deno install -g`). Dot-params
route by prop through the component vocabulary — `.title=` can only mean
`doc.title`, so it routes bare; the few collisions (pin/camera geometry) take
the explicit `.comp.prop=` spelling. The same grammar filters and creates:

```sh
task tui                          # the terminal UI
task list .status=open            # filter with dot-params
task new .title="Hello, world!"   # bare words become the title too
task set T-3 .status=done .priority=1
task show T-3                     # one entity, whole, as JSON
task claim T-3 my-session         # lease it ($TASKS_SESSION works too)
task release T-3                  # hand it back
```

## MCP

The dev server IS an MCP server: point an agent at `http://host:5173/mcp`
(Streamable HTTP, stateless — restarts can't strand a session, no auth on the
tailnet) and it gets self-documenting `task_list` / `task_new` / `task_update` /
`task_show` / `task_claim` / `task_release` tools speaking the same dot-param
grammar. Claims are leases: the server refuses to hand a held lease to another
session, so agents can pick work without stepping on each other. `deno task mcp`
serves the identical registry over stdio for clients that launch a process.
Agent writes broadcast live to every canvas and TUI.

## Stack

- **Deno 2.9** — runtime, task runner, type-checker.
- **Preact + signals** — vendored as plain ESM in `src/vendor/`, no
  node_modules.
- **sucrase** — TS/JSX translation at serve time (server-side dependency, cached
  by Deno).
- **SQLite via `node:sqlite`** (`DatabaseSync`) — Deno's built-in driver, no
  external dependency.
