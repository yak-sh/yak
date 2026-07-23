# Query subscriptions (T-3683)

A socket says `subscribe <query>`; the server answers with the query's current
matches as one Change batch, then pushes only the deltas that change _that
query's_ membership. `query.ts` already is the language — a board is a saved
query. This moves `matchQuery` out of every client's render loop
(`boardTasks`/`boardAll`/`sieve`, `live.ts:241-279`) into one place on the
server, and makes the client cache a **union of its subscriptions** instead of a
mirror of the whole graph.

The mechanism is not new machinery — it is `matchQuery` (`query.ts:423`, already
run server-side in `/query` at `server.ts:355`) relocated to run over the 1–5
entities a batch touched instead of the whole cache every render.

## 1. Protocol — object frames on the existing /ws

`/ws` (`server.ts:136-166`) today speaks one client→server frame: a JSON
**array** = a batch. Subscriptions add **object** frames, structurally disjoint
(`JSON.parse` distinguishes `[...]` from `{...}`) — nothing existing changes.

- client→server: `{sub:"b1", q:".task.status=open,wip"}` (subscribe/replace —
  re-send same id = live query edit, server diffs member sets) and
  `{unsub:"b1"}`.
- server→client: `{sub:"b1", changes: Change[], drop: string[], cursor: 12843}`
  — one frame type for the initial set and every delta:
  - `changes` — adds (full eager comps) and updates (the committed patch), both
    landed through the **existing** `applyLocal` (`live.ts:94`), unchanged.
  - `drop` — eids that **left this query's set but still exist.** The hard "you
    no longer see this" message. NOT an entity-null — handled by the
    subscription cache layer, never `applyLocal`.
  - `cursor` — the journal rowid (`db.ts:258`) this frame is current as of. The
    reconnect/catch-up key and the bridge to T-6823.
  - A true **death** rides in `changes` as `{name:'entity', comp:null}` (gone
    for everyone) — distinct from `drop` (gone for this query only).

Per-socket registry `Map<subId, Sub>`; `onclose` (`server.ts:144`) drops it — GC
free. **Backward compatible:** a socket that never sends `sub` keeps today's
full rebroadcast (`server.ts:158-162`) exactly; the first `sub` frame flips it
into filtered mode. That flag is the whole migration switch.

## 2. Server-side incremental maintenance — the hard part

Per subscription: `{preds, members:Set<eid>, cursor}`.
`preds = resolveRefs(parseQuery(q), findEid)`, computed once (the same call the
browser makes at `live.ts:242` and `/query` at `server.ts:347`).

**Per committed batch, NOT a rescan.** `apply()` returns `out`
(`server.ts:150`); touched eids = `new Set(out.map(c => c.eid))` — typically
1–5. For each subscription × each touched eid `e`: read `e`'s current eager
comps (one keyed read), `now = matchQuery(comps(e), preds, ent)` — the identical
function clients ran per-render (`query.ts:423`) — then transition:

| was in               | matches now | action                                          |
| -------------------- | ----------- | ----------------------------------------------- |
| no                   | yes         | **ADD** — members.add, queue full eager comps   |
| yes                  | yes         | **UPDATE** — queue the batch's patches for e    |
| yes                  | no          | **REMOVE** — members.delete, push e into `drop` |
| no                   | no          | ignore                                          |
| entity-null in batch | —           | if member, forward `entity:null`, delete        |

The membership `Set` is the memory that makes `drop` as cheap as add. No client
can emit "you no longer match" today because no client knows another's query —
centralizing evaluation is what makes it expressible.

**Cost:** O(B×K) predicate tests per batch (B = touched ~1–5, K = subs), each a
keyed read + `matchQuery` (µs). Versus today: every committed batch triggers a
full-cache rescan on every client, per board, per render (`live.ts:246` — the
exact cost T-6772 fought). A small bounded server cost replaces large repeated
client scans. Scaling K: an inverted `comp→subIds` index (deferred to stage
2/3).

**Two pred classes that don't fit the touched-eid test:**

- **Path preds** (`.assignee.title~=j`, `query.ts:438`, depth-1) — the deref
  _target_ changes, not the entity. Bounded fix (stage 2): per path-pred sub,
  track the deref-target eids its members point through; a batch touching one
  re-tests those members (bounded, never recurses — depth capped at 1).
- **Time-phrase preds** (`.updated.at>=today`) — truth moves with the clock, no
  write. Evaluate at push time; between writes as stale as the clock — which is
  **exactly today's board behavior** (boards recompute on cache tick, never at
  midnight). No regression.

Both are staged, not blocking — stage-1 subscribers use only own-comp equality
preds.

**Consistency:** `apply()` is synchronous, Deno single-threaded — no `await`
between "compute initial set" and "start streaming," so no batch interleaves.
Snapshot-then-updates is gapless for free (the same property that fixes the boot
race).

## 3. Eager / lazy partitions

Two granularities; `snapshot(opts)` (`db.ts:1352`) generalizes to both.

- **Whole-component lazy:** one line beside `comps` in `types.ts` —
  `export let lazy = new Set(['log','telemetry','conflict','embedding'])`.
  `snapshot()`'s comp loop (`db.ts:1355-1368`) skips these. Server-mint lazy
  comps are already outside `comps` (like `conflict`, `types.ts:191`) so never
  wire-writable. **Logs = first lazy partition:** the stdout file stays the
  capture medium (invariant); a `log` comp is _projected_ from the file on
  demand (seq = line number), served via subscription, never in `snapshot()`.
  Needs T-3684 so log lines are entities without minting a num.
- **Within-component lazy column:** `doc.body` (48% of boot).
  `snapshot(db,
  {bodies:false})` drops the key; `body===undefined` = unloaded,
  `===''` = loaded-empty. **The data-loss guard carries over verbatim:** a
  body-editing view must have the body in cache before it arms, or a keystroke
  overwrites the stored body. In the subscription world: opening a card
  subscribes `card:<eid>` to full comps incl. body; the editor arms on the body
  landing. This subsumes T-6788, reusing its `snapshot(opts)`/hydrate/edit-gate
  seams.

## 4. Client integration

Cache becomes a **union of subscription result sets** + a refcount layer
`subMembers: Map<subId, Set<eid>>`.

- `{sub,changes}` → `applyLocal(changes)` (unchanged) + add eids to
  `subMembers[sub]`.
- `{sub,drop}` → remove from `subMembers[sub]`; an eid now in **no**
  subscription is evicted (`delete cache.value[eid]`). The only new cache
  mechanic.
- `boardTasks`/`boardAll` (`live.ts:241-269`) → the board subscribes its
  `e.board.query`; returns `[...subMembers[boardSub]].map(ent)` — no scan, no
  `matchQuery`.
- `sieve` (`live.ts:275`) → ephemeral subscription, OR keep local `matchQuery`
  over an already-subscribed small set (the one place local eval may stay, since
  it composes with a subscription).
- Incidental whole-cache scans (`projects`, `domains`, `backlinks`,
  `rootCanvas`, `live.ts:295-391`) keep working during migration via the eager
  "shape" subscription (§6), tightened per-view in stage 3.
- Subscription lifecycle = component lifecycle (Board subs on mount / unsubs on
  unmount; Card subs `card:<eid>` on open). This is what lets an arduino-class
  client hold one small subscription and nothing else.

## 5. Boot — the fetch-vs-socket race falls out

Today `boot()` (`live.ts:183-188`) does `fetch('/snapshot')` then `sock()` — the
race the `live.ts:182` comment admits (batches between fetch-return and
socket-open are missed). New `boot()`: open the socket **first**, send
`{sub:"boot", q:<what the route needs>}`; the initial frame is the snapshot and
every delta arrives on the **same ordered socket** after it. No gap — the race
is gone structurally, not patched. `deps` ride as `dependency` Changes (already
do on the live path, `live.ts:104-118`). `/snapshot` stays alive for the CLI;
decommissioned last.

## 6. Migration / coexistence — never retire the old door first

Two modes, one boolean gate: **legacy** (no `sub` ever → full rebroadcast,
unchanged, retired last) and **subscription** (first `sub` sets `filtered=true`,
rebroadcast loop skips it). Bridge that keeps incidental scans alive: the eager
"shape" subscription `{sub:"boot", q:""}` = the old snapshot expressed as a
subscription; shrink its query per-view later.

**Ladder:**

- **Stage 1 (LANDED, `71d8ecf`)** — `sub`/`unsub` frames + registry + `filtered`
  gate; `evalQuery(db, q)` factored from `/query`; own-comp-eq maintenance only;
  client `subMembers` + evict; proven end-to-end by a both-doors probe
  (`scripts/subs_probe.ts`). The channel-plugin conversion was scoped OUT:
  `channels/tasks/filter.ts` grew past its two filter shapes and now also ships
  identity resolution (`learn`/`findSession`/`humanId`, following `/clear`
  pid-rotation) and mail routing/injection — none replaced by own-comp subs, so
  flipping the plugin to a `filtered` socket would regress mail, author-id
  rendering, and rotation-follow. T-4459's "filter.ts is the only file that
  dies" was optimistic; the conversion moves to stage 2 (T-6843) behind
  server-side id resolution. The mechanism is nonetheless proven against a real
  subscriber, satisfying "never retire the old door first."
- **Stage 2** — boards/lists subscribe; cache union + refcount; path-target
  index; `doc.body` lazy (subsumes T-6788); boot conversion; inverted
  `comp→subIds` index when K grows; server-side identity resolution → the
  channel plugin becomes a dumb subscription and `filter.ts` finally dies
  (T-6843); logs as the first entity-shaped lazy partition (needs T-3684).
- **Stage 3** — telemetry/conflicts/embeddings/frozen bytes lazy; federation
  rung 3 (a peer is a subscribing client); IndexedDB delta (T-6823).

## 7. Problems it solves (the owner's "number of other problems")

1. **Boot cost** — eager partition sheds lazy comps + bodies; no longer O(total
   graph).
2. **Client-scan cost** — `boardTasks`/`sieve` stop rescanning per cache tick;
   the T-6772 preact-diff / `ent()` fights get structurally easier.
3. **Memory / scalability** — partial caches; arduino = one tiny query.
4. **Fetch-vs-socket race** — one ordered channel (§5).
5. **T-4459's three-filterers debt** — ONE server `matchQuery` instead of
   channel filter + browser + TUI.
6. **Federation** — a peer graph is a subscribing client, same sentence.
7. **Privacy / attention scoping** — the server decides what a socket hears.
8. **One grammar, many doors** — boards, bus, subscriptions, search, `/query`
   all through `query.ts`.
9. **Returning-client delta (T-6823)** — shares the journal cursor.

## 8. Interaction with T-6823 (IndexedDB + delta)

Shared primitive: the journal (`db.ts:258`, implicit monotonic rowid). T-3683 =
a **spatial cut** (filter the live tail by `matchQuery`); T-6823 = a **temporal
cut** (`select batch where rowid > X`). They compose: a returning subscription
client asks "since cursor X, deltas matching my queries" = journal replay piped
through the sub predicate. Build `filterBatch(batch, preds) → {changes, drop}`
**once**; the live path runs it over each batch, the catch-up path over a
journal range. The `cursor` field is the shared handoff.

**The journal crux, traced by both design passes** (`db.ts:1066-1089`): the
journaled batch = `[...changes, ...extra]` minus only `created`/`updated`. Since
cascade entity-nulls, release-nulls, detach-nulls, and births ride in `extra`
(`db.ts:898/908/930/1064`), **cascaded removals ARE journaled** — a
journal-replaying subscriber learns about cascade casualties; no ghosts. **The
one gap (affects BOTH workstreams):** `created`/`updated` provenance stamps are
excluded, so journal-replay hydration drifts on `.updated.at` and `hot`
ordering. Fix once — re-derive on replay from each batch's `ts`/`actor` (which
ARE the provenance; lossless, no journal bloat). This is the single owner
decision that serves both epics.

## 9. Risks & open questions

1. Path/time pred maintenance correctness (§2) — a stance on time-pred staleness
   (matches today) and the stage-2 path-target index.
2. Sub bookkeeping/GC — per-socket, reaped on close; leak risk only within a
   live socket.
3. Ordering relies on synchronous `apply()` + single-threaded Deno — keep the
   subscribe path synchronous or the gap reopens (invariant comment).
4. **T-3684 (num off spine) blocks this.** Lazy entity-shaped partitions (log
   lines) must not hit the num allocator — num is a PM affordance, and a global
   sequential allocator is a contention + federation-collision point. Confirmed
   `requires`.
5. `graph_query`/`/query` is the one-shot PULL; a subscription is the LIVE PUSH
   of the same preds/matcher — subscriptions generalize `graph_query`, share
   `evalQuery`; the `code_run` sandbox stays pull-only (no new capability
   surface).
6. The provenance-in-journal decision gates correct `.updated.at`/hot for every
   replay-hydrated client (§8).

## 10. First shippable slice

1. Object frames + registry + `filtered` gate (`server.ts:136-166`).
2. Factor `evalQuery(db, q)` from `/query` (`server.ts:345-355`).
3. Delta maintenance after `apply()` (`server.ts:150`) for own-comp preds; also
   route `cast()` writes (`server.ts:116`, the MCP/effect path) through it so
   subscriptions hear MCP/HTTP writes.
4. Client (`live.ts`): handle `{sub,…}` frames — `applyLocal` + `subMembers` +
   evict on `drop`; add `subscribe`/`unsubscribe`.
5. ~~Convert `channels/tasks/` to two subscriptions; delete `filter.ts`.~~ Moved
   to stage 2 (T-6843): `filter.ts` also carries identity resolution + mail
   routing that own-comp subs don't replace.
6. Verify (unique probe port): subscribe `.comment.target_eid=<S>`, comment on S
   via MCP, assert exactly one matching frame and NOT the rest of the graph;
   reassign target, assert a `drop`; clean up probe entities.

Steps 1–4 + 6 shipped in `71d8ecf`. Nothing retires `/snapshot` or the full
rebroadcast until the subscription path is proven against a real client.
