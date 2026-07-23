# Boot partition — lazy-load doc bodies out of the snapshot

The boot is the app's slowest moment: on connect the whole graph ships (~10.5MB,
27k changes) and the client builds its entire cache before first paint (~1.4s),
and it grows O(total graph size). Doc **bodies are 48%** of that payload — and
no board, canvas, list, or dot view reads a body. Bodies are read only when a
card is opened. So: ship the _shape_ eagerly, load a _body_ on demand.

This is the thin end of T-3683 (eager/lazy partitions + query subscriptions):
same seams, narrowest first instance. Nothing here is undone by T-3683.

## The fork

- **Quick win (this doc):** lite snapshot omits `doc.body`; a view fetches a
  body when it needs one. ~4 small edits + one endpoint + one edit-gate. Halves
  boot payload/parse. Bounded, one hard constraint.
- **Full (T-3683):** server-evaluated query subscriptions replace
  "ship-everything, filter client-side"; the eager set becomes "subscribe to the
  shape," a card becomes "subscribe to this entity's full comps." Bigger, and
  the quick win installs its two reusable seams (`snapshot(opts)`, `hydrate` via
  `applyLocal`).

Recommend shipping the quick win first, then T-3683 reusing its seams.

## Why it's safe (invariants, each checked)

- **FTS search — fine.** The index and `search()` are server-side only; every
  search door (`/search`, CLI, MCP, web) hits the server. The client never reads
  `body` to search. Bodies can leave the cache with zero search impact.
- **Wire reconciliation — fine, and it's the enabler.** `applyLocal` merges
  column-wise (`row.doc = {...row.doc, ...comp}`). A body arriving later — as an
  ordinary `{name:'doc', comp:{body}}` patch — merges onto the bodyless doc,
  keeping its already-present `title`. This is _exactly_ what live edits already
  do. No new cache mechanics.
- **Sync/freeze/embed — fine.** All server-side against `db`; none reads the
  client cache.

## The hard constraint (data-loss risk — the reason this is load-bearing)

`Edit` seeds its value from the cache. A body absent from the lite snapshot
opens the editor **empty**, and its commit fires `mutate(body: typed)` when the
text changed — so a keystroke into an unloaded body would **overwrite the stored
body with a fragment.** Likewise `Show.Body`/`Md` would render an empty document
as if it were real.

**Rule:** any body-rendering-or-editing view must have the body in cache
_before_ it is interactive. The body section shows a loading placeholder and the
body editor refuses to arm until the fetched body lands. This gate is the
correctness bar; the build's tests must cover "edit an unloaded body doesn't
clobber it."

## Design

**Distinguish unloaded from empty.** Empty bodies are common
(`body … default
''`). In lite mode **omit the `body` key entirely** →
`doc.body === undefined` means _unloaded_, `=== ''` means _loaded-empty_.
Render/`?? ''` fallbacks already treat `undefined` as blank; the load-gate is
what stops a blank from reading as real content or being edited.

**Strip seam (shared):** `snapshot(db, opts?: {bodies?: boolean})`; when
`bodies === false` the `doc` branch drops `body` from each row.
`/snapshot?
bodies=0` passes it; **default stays full** — the CLI (`task show`,
headless `snapshot()`) needs bodies and must keep hitting plain `/snapshot`.
Browser AND TUI boot through the shared `boot()`, so both fetch `?bodies=0` and
both wire the on-demand fetch (one change covers both).

**Land seam (shared):** a `needBody(eid)` helper fetches the body and calls
`applyLocal([{eid, name:'doc', comp:{body}}])` — the merge lands it, the cache
signal ticks, the view re-renders. An in-flight `Set` dedupes concurrent
requests (mirror the one-poller discipline). No new intake path.

**Fetch endpoint — `GET /body?eids=a,b,c`** (recommended over reusing `/query`):
returns `{changes:[{eid,name:'doc',comp:{body}}…]}` from a keyed
`select eid, body from doc where eid in (…)`. The response **is** a Change batch
→ drops into `applyLocal` verbatim, and it's batch-shaped so a card opens its
own body **and all its comment bodies in one round trip** (comments are docs;
their bodies were stripped too). Reusing `/query` was rejected: it returns
graph-query shape (needs reshaping), over-fetches, and re-runs
`snapshot()`+filter — a heavier, awkward fit for "land as a patch."

**Triggers:** `Show.Body` / `Md` / `Comments` / `tui` card render, on seeing
`e.doc && e.doc.body === undefined`, call `needBody(eid)` (batching the card's
comment eids) and show a one-line placeholder; `Edit`'s body editor guards on
body-present before arming.

## Seams for a builder (file:line)

- strip → `db.ts:1352-1368` (the `doc` branch, `select *`)
- param → `server.ts:297` (`/snapshot`)
- browser/TUI boot fetch → `live.ts:184` (`?bodies=0`); keep-full guard →
  `client.ts:36` (plain `/snapshot`) + a test
- land helper + in-flight set → `live.ts` beside `applyLocal` (~:94)
- new `/body` route → `server.ts`
- render triggers → `Show.tsx:182-205`, `Md.tsx:38`, `Comments.tsx:113`,
  `tui/App.tsx:195-206`
- **edit gate (the data-loss guard)** → `Edit.tsx:35/54/83`

## Verify

Before/after boot payload + parse (bin/perf / a real trace). The bar test: open
an unloaded doc, double-click the body, type, blur → the STORED body is
unchanged until the real body has loaded (no clobber). `/snapshot` (no param)
still carries bodies (CLI). `/search` still returns body snippets.

## Composition toward T-3683

- `snapshot(opts)` generalizes from `{bodies:false}` to arbitrary eager/lazy
  column+component partitions.
- `needBody` generalizes to `hydrate(eid, comps?)` — the on-demand door landing
  any deferred slice through `applyLocal`.
- `/body` is the degenerate `/subscribe`: query subscriptions replace the
  full-cache scans (`boardTasks`/`sieve`) with server-evaluated result sets
  pushed over `/ws` — same cache, same `applyLocal`, same merge. The quick win
  proves the merge-in-a-deferred-slice pattern subscriptions run at scale.
