# Working in this repo

Tasks v2: the holdco fleet's entity graph — one SQLite file, a web canvas, a
TUI, a CLI, and an MCP server, all speaking the same wire. This file is for any
agent working here without prior context. README.md explains the product; this
explains how to change it safely.

## The one idea

Everything is an **entity** (a uuid + a server-minted number) that carries
**components** (one row per component table, same eid). There is no `kind`
column — an entity _is_ what its components make it:

- a **task** is `doc` (title/body) + `task` (status/priority/project)
- a **board** is `doc` + the `board` tag; a **project** is `doc` + `project`
- a **comment** is `doc` + `comment(target_eid)` — aimed at ANY entity
- a **claim** is a session's lease on any entity; a **session** is an agent

`kindOf()` derives a display name; renderers never check it — they pattern-
match on components, most specific match wins (see Rendering).

## The vocabulary is one list

`src/types.ts` `comps` maps component → wire-writable columns. From that one
list flow, with **zero further edits**:

- the db sync allowlist and entity-delete order (db.ts `cmps`)
- CLI/MCP dot-param routing (`.title=x` → doc because only doc has title)
- the MCP tools' self-documentation (GRAMMAR is generated)
- the browser/TUI cache shape (live.ts `Comps` derives from `Ent`)

**To add a component**: add it to `comps`, its type + `Ent` field, and (if it
should name entities) `kindOrder`, all in types.ts; add the table in db.ts
`schema`. Done — cache, Debug view, JSON, CLI filters, and MCP pick it up.
Columns that only the server may write (timestamps, ip) stay OUT of `comps` and
get stamped in server code (see `frozen_at`, `claimed_at`, `ip`).

## The wire

A `Change` is `{eid, name, comp}` — a PATCH: omitted columns untouched,
`prop: null` clears a column, `comp: null` deletes the component,
`{name:'entity', comp:null}` deletes the entity (tombstoned — nothing can
resurrect the eid). A batch is a flat array; db.ts `apply()` runs it atomically.
Clients mint eids (uuid v4); the spine + num appear on first touch. Browser tabs
sync over `/ws`; headless clients POST `/apply`; both broadcast to everyone
else. Special apply rules (the claim lease check) live in `apply()` and hold for
every entry path.

## Rendering (web + TUI, one registry)

`components/registry.ts` is the machinery: a **Renderer** =
`{view, match,
Render}` where `match(e)` returns a score — `has('doc','task')`
counts matched components, `true` = 0.5 for catch-alls; highest score wins the
view, ties go to registration order. `components/View.tsx` is the curated list +
the `<View eid view/>` front door. The TUI boots by `extend()`ing overrides
(same views, painted as terminal lines) — that's also the seam a future renderer
plugin would use. registry.ts imports no views, so anything may import matchers
from it without cycles.

**To add a view**: component file under `components/views/`, entry in View.tsx's
`define()` list; to make it a card tab, add its name to the tabs array there and
an icon row in `Card.tsx` + `components/icons.tsx` (vendored Lucide paths — add
a row, not a dependency).

## Map

| file              | owns                                                                      |
| ----------------- | ------------------------------------------------------------------------- |
| `src/types.ts`    | THE vocabulary: comps, statuses, kindOrder/kindOf, prefix/idOf, all types |
| `src/db.ts`       | SQLite schema, seed, `apply()` (patches in), `snapshot()` (graph out)     |
| `src/server.ts`   | Deno.serve: static+sucrase, /ws sync, /apply, /mcp mount, watcher         |
| `src/freeze.ts`   | URL → monolith archive → scrub() → CSP-served, server-only                |
| `src/client.ts`   | headless HTTP client: rows(), dot-params, find, change builders           |
| `src/cli.ts`      | the `task` CLI (thin verbs over client.ts)                                |
| `src/mcp.ts`      | MCP tool registry (io-agnostic; served in-process at /mcp and over stdio) |
| `src/sandbox.ts`  | code mode's worker: permissionless, graph-only, postMessage SDK           |
| `src/live.ts`     | browser/TUI half: cache signal, socket, applyLocal/mutate, ent()          |
| `src/paste.ts`    | clipboard/drop text → entity spec (ids, URLs, JSON, plain text)           |
| `src/components/` | web UI: registry.ts + View.tsx, Canvas (camera), Card, Edit, Comments     |
| `src/tui/`        | fake DOM (dom.ts), ANSI painter (paint.ts), Md, App (vim keys), main      |
| `src/vendor/`     | preact/signals/snarkdown as plain ESM — no node_modules                   |

## Invariants — break these and things rot

- **The db is LIVE owner data** (`~/.tasks/tasks.db`). Never delete or reseed
  it. Schema changes: new columns get an `alter table` guard in db.ts `open()`
  (additive, in place); anything shapier needs the owner.
- **This repo is open source.** Never commit the db, fleet data, secrets, or
  anything from `~/code/holdco/.env`.
- **Server-stamped columns never ride the wire** — that's what keeps `frozen_at`
  (archive exists) and `claimed_at` honest.
- **Frozen pages must render from their own bytes.** Self-containment is
  enforced at freeze time (scrub removes every external ref); the CSP at serve
  time is defense-in-depth, not the mechanism.
- **TUI: text content must never move the terminal cursor.** The painter
  sanitizes `\n`/`\r`/`\t` in text nodes; only the layout emits cursor moves.
- **One reconnect poller per process** (live.ts `polling`) — a down server must
  not stack pollers that all fire reload together.
- **The watcher's `graph` list in server.ts must cover every server import**, or
  edits to a server file merely reload clients against a stale process.
- Deleting an entity tombstones it; late patches for that eid are void. Death
  CASCADES to entities that exist about the dead one (cards viewing it, comments
  aimed at it, pins/cameras on a dead canvas or client) and detaches soft refs
  (claims by a dead session, tasks of a dead project). apply() returns the input
  batch plus a synthesized entity-null per casualty — always cast the RETURN, or
  client caches keep ghosts.
- There is NO 'blocked' status. Blocked is a fact about edges — an open
  `requires` dep turns the Dot red (`gated()` in live.ts); resolve the blocker
  or drop the edge.
- Full-text search is FTS5 over `doc` (external-content, trigger-synced —
  out-of-band doc writes are healed by the boot-time integrity check + rebuild
  in open()). One surface, four doors: `/search?q=`, `task search`, MCP
  `search`, `/` in the web UI. User words are quoted into terms (trailing `*` =
  prefix); snippets mark hits with \x01…\x02 — never HTML.
- Bounced claims are audited: apply() records each rejection as a server-minted
  `conflict` entity (loser/holder as strings — the loser's session row may die
  in the same rollback). `graph_query kind=conflict` is the contention report.

## Working here

- Run: `deno task dev` (port 5173), `deno task tui`, `task` CLI
  (`deno task install`), MCP at `POST /mcp`.
- Gate: `deno task check` (fmt + lint + typecheck) AND `deno task test` must be
  green. Tests live beside their subject as `*_test.ts` — pure seams only (apply
  semantics, dot-params, change builders, scoring); the interactive layers are
  verified by probes (below), not mocks.
- **Verify end-to-end before done** — the holdco standard. Recipes that work
  headless: screenshot
  `google-chrome --headless=new --screenshot=x.png
  http://127.0.0.1:5173/`;
  drive hovers/keys/clicks over CDP (`--remote-debugging-port`); TUI via
  `tmux new-session -d` + `send-keys` + `capture-pane -p` (`-e` keeps ANSI).
  Clean up any entities a probe creates (delete = `{name:'entity', comp:null}`).
- **The injection loop**: `.claude/settings.json` runs `bin/task-context` on
  SessionStart — agent sessions in this repo boot into their claimed work
  (`task context` / MCP `task_context`, same digest). The hook must NEVER fail
  loudly; a dead server means no digest, not a broken session. SessionEnd
  mirrors it: `bin/task-lapse` releases the session's claims, commenting on
  anything not done ("lease lapsed") — no timers, ending the session IS the
  lapse. SessionStart also reifies the session entity (id + cwd, the worktree it
  ran in).
- The MCP surface has two tiers: task_* sugar and the generic tier
  (graph_query/graph_apply/ui_state/card_*/code_run). The generic tier is
  possible because the UI is data — cards/pins/cameras are entities; keep it
  that way. code_run REQUIRES `--unstable-worker-options` (already on the
  dev/mcp tasks) and `deno: { permissions: 'none' }` on the worker — never widen
  those permissions; the sandbox's only capability must stay the postMessage
  graph SDK.
- Hot reload: client-file edits broadcast `reload`; server-graph edits restart
  the process (websockets close, clients poll back). The TUI exits 42 to ask its
  wrapper loop to relaunch it — don't "fix" that exit code.
- Git: work in a worktree, merge with `--ff-only`, focused commits.

## Backups

`~/.tasks` is itself a git repo, pushed to a PRIVATE remote
(github.com/jeffpeterson/tasks-data — data never enters THIS repo). `bin/backup`
runs hourly from cron: it snapshots the live db atomically
(`VACUUM INTO snap/tasks.db` + integrity_check — the live `tasks.db` is
gitignored and must never commit, a commit could catch it mid-transaction), then
commits and pushes everything else (frozen/, future images/md) as plain files.
Restore = clone, copy `snap/tasks.db` → `tasks.db`, start the server. If blobs
ever outgrow git, the planned escape hatch is restic → R2 (encrypted, deduped,
retention) — see the holdco board.

## Style

- Deno + TypeScript, `let` everywhere (no `const` ceremony), no classes, no
  frameworks beyond vendored preact. Prefer small exported arrow functions.
- Comments explain the WHY and the invariant, not the next line. Every file
  opens with a paragraph saying what it owns. Keep that true.
- CSS is hand-written (src/styles.css): `Block_Element-modifier` names, custom
  properties as the variant mechanism (`--bleed`, `--dot`), modern CSS, no build
  step. Everforest palette; the TUI mirrors it in paint.ts.
- Known trap: CSS `anchor()` does not resolve inside a transformed ancestor (the
  canvas plane) — tooltips position off their trigger instead.

## Plugins (direction, not yet built)

The seams a plugin story will use already exist: `extend()` for renderers, the
`comps` list for data models, `mcpServer(io)` for tools, the CLI verb table.
Keep those narrow and curated — a plugin should be "a module that exports
Renderer[] / a comps fragment", not a framework. If a change makes one of these
seams wider or leakier, that's the wrong direction.
