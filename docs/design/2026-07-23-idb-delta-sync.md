# Client IndexedDB cache + delta sync (T-6823)

A returning browser client persists its graph cache in IndexedDB and, on reload,
fetches only the changes since its last sync — not the whole ~10.5 MB graph.
First paint drops from "await full `/snapshot` (~1.4 s)" to "await a local IDB
read (tens of ms) + a small delta."

The delta primitive is shared with query subscriptions (T-3683): both are
"replay the journal since a point." IDB cuts the journal by **cursor** (time);
subscriptions cut it by **query predicate** (space). Build `delta()` once.

## The journal is already the oplog — and already correct

`apply()` (`src/db.ts:730`) journals the batch **as applied**, not as asked
(`db.ts:1077-1080`):

```
logged = [...changes, ...extra.filter(c => c.name != 'created' && c.name != 'updated')]
```

`extra` is everything the rules synthesized — cascade casualty tombstones
(`db.ts:930`), freed soft-refs like a dead session's claims (`db.ts:898`),
detached columns like a task's gone project (`db.ts:908`), and server-minted
birth spines carrying `num` (`db.ts:1061-1065`). So a client that replays
`journal.rowid > cursor` through the existing `applyLocal` (`live.ts:94`)
reproduces every tombstone and detach: **no ghosts.** This is the crux question,
and the answer is that "journal the returned batch" (chosen so `task history`
shows what the rules did) already carries deletes and cascades.

### The one gap: provenance, reconstructed not stored

`created`/`updated` are excluded from the journal on purpose (they are the actor
column's twins — `db.ts:1069-1073`). `snapshot()` DOES include them, so a
delta-hydrated cache would diverge from a snapshot-seeded one. Fix, no journal
bloat: `delta()` synthesizes them from each journal row's own `ts`+`actor`,
mirroring how `apply()` stamps them (`db.ts:1037-1055`):

- each birth in a row's batch (`{name:'entity', comp:{num}}`) →
  `{name:'created', comp:{at: ts, by: actor}}`
- each distinct touched eid → `{name:'updated', comp:{at: ts, by: actor}}` (last
  row wins = "updated is the last edit")

## The cursor is the journal rowid

The journal has no explicit PK; its implicit `rowid` is monotonic, assigned in
the apply transaction, and already the ordering key for `journalOf`/`journalBy`
(`db.ts:1154,1175`). The batch `ts` is NOT safe (clock, same-ms collisions).

- `snapshot()` returns `cursor = max(journal.rowid)` — consistent because the
  server is single-threaded and `apply()` is atomic, so nothing interleaves.
  Extend `Snapshot` (`types.ts:825`) to
  `{changes, deps, cursor, epoch, vocabHash}`.
- Server-controlled invalidation stamps, all checked on every `/delta`:
  - `epoch` — random id minted at server boot; a db restore/reseed resets
    rowids, so epoch invalidates every stale cursor.
  - `vocabHash` — hash of the `comps` vocabulary; a component-shape change →
    full reseed.
  - `minRowid` — lowest retained journal rowid; `since < minRowid` → window gone
    → full snapshot. (v1 never trims the journal — it also powers `task history`
    — so the window is effectively unbounded; `minRowid` is the future escape
    hatch.)

## The delta protocol

Server primitive, built once beside `snapshot`/`journalOf` in `db.ts`:

```
delta(db, since) → { changes: Change[], cursor: number }
```

Replays
`select rowid, ts, actor, batch from journal where rowid > ? order by
rowid`,
concatenates each `batch` (already carries cascades + births), appends
synthesized `created`/`updated`. Dependency changes ride in the stream
(`applyLocal:104` already threads them into `deps`), so `/delta` needs no
separate deps array (unlike `/snapshot`).

Endpoint beside `/snapshot` (`server.ts:297`):

```
GET /delta?since=<rowid>&epoch=<e>&vocab=<hash>
  200 → { changes, cursor }
  409 "stale" → epoch/vocab mismatch or since < minRowid  ⇒ client full-resnapshots
```

The client applies `changes` through the **unchanged** `applyLocal`.

**Advancing the persisted cursor from live `/ws`** — two phases:

- **v1:** ws frames unchanged; the persisted cursor advances only on
  snapshot/delta fetches. On reload the client re-runs `/delta` from its last
  fetched cursor, re-applying any ws changes it already has — **idempotent**
  (re-deleting a gone key, re-merging identical columns, re-minting a known
  `num` are all no-ops). Window = "since last delta/reload." Zero wire change.
- **v2:** server stamps each broadcast with its rowid as `{v, changes}`; client
  advances the cursor live, shrinking the reload delta to near-zero. Deferred to
  land with T-3683, which restructures the frame anyway.

## Storage schema — `src/idb.ts`, raw IndexedDB

Mirror the in-memory shape 1:1 (`cache = signal<Record<eid, Comps>>`
`live.ts:24`; `deps = signal<Dep[]>` `live.ts:25`). One db `tasks`, three
stores:

| store  | key                              | value                                                              | written from                                           |
| ------ | -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| `ents` | `eid`                            | the whole `Comps` record (spine + all components, bodies included) | one `put` per touched eid in `applyLocal`              |
| `deps` | `"${parent}\|${type}\|${child}"` | `{parent,type,child}`                                              | `put` on link, `delete` on gone/entity-null — per-edge |
| `meta` | fixed keys                       | `cursor`, `epoch`, `vocabHash`, `schemaVersion`, `scope`           | on every delta/snapshot apply                          |

Whole-Ent-per-record (not per-component stores) so hydration is `getAll(ents)` →
reduce to the `Record` the signal wants, no cross-store join. `deps` keyed
per-edge so one edge change is one `put`/`delete`, not a full-blob rewrite.

**Persist hook:** wrap the tail of `applyLocal` — the sole land path (boot, ws
`live.ts:154`, `mutate` `live.ts:131`) — persisting the exact touched eids/edges
**async, fire-and-forget.** The signal stays the synchronous render truth; IDB
is a shadow. A failed IDB write is telemetry, never a broken render (the effects
doctrine, `server.ts:123-125`); worst case is a bigger next delta.

## Cold-boot flows

```
boot():
  meta = idb.meta()
  if !idb || !meta.cursor:                 -- FIRST VISIT --
      snap = GET /snapshot                  // {changes, deps, cursor, epoch, vocabHash}
      deps.value = snap.deps ; applyLocal(snap.changes) ; render()
      idb.seed(cache, deps, snap.cursor, …) ; sock()
  else:                                     -- RETURNING VISIT --
      {ents, deps} = idb.hydrate()          // getAll → Record, LOCAL, fast
      cache.value = ents ; deps.value = deps ; render()   // paint before network
      sock()                                // ws frames land live (idempotent overlap)
      d = GET /delta?since=meta.cursor&epoch&vocab
      if d==409: full snapshot + reseed
      else: applyLocal(d.changes) ; idb.setCursor(d.cursor)
```

The returning path's first paint waits only on a local read. `sock()` opening
before the delta fetch closes the "missed between fetch and open" gap noted at
`live.ts:182`; the delta/ws overlap is idempotent, so no ordering lock is
needed. `main.tsx:36` (`await boot()`) is unchanged.

## Scope boundaries

- **Offline WRITE is out of scope.** `mutate` still goes to the wire; a down
  socket queues as today (`live.ts:178`). Local-first write buffering / LWW is
  T-3683's federation ladder rung 4. This round is read cache + delta catch-up.
- **Doc bodies (48% of the graph) are persisted in v1** — IDB is disk, and
  instant body render on reload is the point. When the T-3683 lazy-`doc.body`
  partition lands, `doc.body` stops being eager and drops out of the IDB cache
  automatically (driven by the one comps list). Don't pre-split.
- **Double cache cost:** memory unchanged; IDB adds ~10.5 MB on disk
  (best-effort store; eviction just forces a full snapshot next boot).

## Interaction with query subscriptions (T-3683)

Shared primitive: `delta(db, since)`. Build it once; both consume it.

- **IDB delta** = temporal cut: all eager components since rowid C; cache stays
  **complete.**
- **Subscription** = spatial cut: everything matching query Q, snapshot-then-
  updates; cache becomes **partial**. A subscription is `delta()` filtered by
  predicate (forward a change if its eid matches Q; always forward entity-nulls
  so a subscriber hears deaths).

**The partial-cache tension:** once caches are partial, a persisted IDB cache
must record _which_ partitions it holds or a delta implies a completeness it
lacks. Forward-compatible seam: `meta.scope`, v1 = `"full-eager"` (all eager
components as of cursor C). When T-3683 lands, `scope` becomes
`{query → perQueryCursor}` and hydrate/delta run per-partition — additive,
nothing built now is thrown away.

## Risks / open questions for the owner

1. **Journal growth as the delta window.** Unbounded reach (good) vs a growing
   table — but it already grows unbounded for `task history`, so no new
   obligation. `minRowid` + the 409 fallback is the trim escape hatch. _Cap it,
   or leave it?_
2. **`homeReads` derived edges are not journaled** (`snapshot()` injects
   computed persona `reads` edges, `db.ts:1375`); a delta won't recompute them
   when a `home_eid` changes, so they go stale until a full reload. The
   underlying `home_eid` IS journaled. _Leaning "accept staleness for v1."_
3. **Provenance-synthesis equivalence** is the one subtle correctness claim —
   pinned by the round-trip test below.
4. **Persisting doc bodies** doubles the 48% on disk — recommended yes for v1,
   revisited by the lazy partition.

## Staged build plan

**Slice 0 — server primitive (pure addition, no client behavior change):**

- `delta(db, since) → {changes, cursor}` in `db.ts`.
- `snapshot()` returns `cursor`; extend `Snapshot` (`types.ts:825`) +
  `/snapshot` (`server.ts:297`) with `cursor`, `epoch`, `vocabHash`.
- `/delta?since=&epoch=&vocab=` endpoint in `server.ts`.
- **THE key test** (`db_test.ts`, the pattern at 773/841): apply a scripted
  sequence including a cascading delete; assert
  `applyLocal(snapshot@C0) then applyLocal(delta(C0))` deep-equals `snapshot@Cn`
  (cache + deps). Proves cascade correctness AND provenance equivalence in one
  shot.

**Slice 1 — client IDB (the user-visible win):** new `src/idb.ts` (small, raw
IndexedDB, feature-detected: `open/hydrate/persist/seed/meta`); `boot()` gains
the returning-vs-first branch; `applyLocal` gains the async persist tail;
invalidation via epoch/vocabHash → full-snapshot fallback.

**Slice 2 — minimal delta window (optional):** ws frames stamped with rowid;
cursor advances live. Defer until T-3683 restructures the frame.

**Slice 3 — converge with T-3683:** `delta()` becomes the subscription feed;
`meta.scope` goes partition-aware.

Slice 0 lands alone (no behavior change) and is the correctness-critical,
independently-testable piece — T-3683 inherits a proven temporal feed. Slice 1
is the shippable win. Wire stays JSON patches throughout; raw IndexedDB, no
wrapper lib (vendored-only philosophy).
