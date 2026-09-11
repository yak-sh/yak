# Tasks browser client migration: boundary and parity audit

T-37276 integrates `src/live.ts` with `@yaks/client`. The renderers,
`components/registry.ts`, `Entity.tsx`, and views are unchanged. `ent()` and the
narrow UI signals keep their existing shape. The implementation and browser
measurement land together; the task comments record the final landed SHA.

## One payload owner

- **Packages:** RAM payloads behind graph, server-evaluated watches, shared
  watch identity, readiness, sync lifecycle, active member/rider coverage,
  pending pins, bounded inactive retention and epoch-scoped wire IndexedDB.
  Local matching remains available for complete/local graphs, not browser query
  membership. Retained exact-key answer metadata is separately byte-bounded; it
  contains ids/order/coverage, not another copy of row payloads.
- **Tasks (`live_client.ts`):** vocabulary adaptation, Tasks patch-to-snapshot
  translation, projections, named transport aliases and peer-role coverage. All
  browser membership watches use `evaluate: 'server'`. Result/tally/window
  channels remain app metadata, not synthetic entity components.
- **Tasks (`live.ts`):** the `Ent` facade and render signals, derived human-id,
  reference, edge and topology indexes; grammar serialization and original query
  source; Web Locks/BroadcastChannel leadership and client identity;
  boot/cursor/epoch negotiation; durable outbox, refusal ledger and reload
  drain. Compatibility `cache` signals expose the replica's components;
  `cache.onRows` drives them for commits, hydration **and storage eviction**.
  Test/host wholesale fixture assignments are imported explicitly. Production
  has no separate retained payload map.
- **Disk:** only the package's `tasks-client-wire` database restores replica
  rows, and only after an authoritative server epoch. The legacy `schema/idb.ts`
  resolver is no longer imported by `live.ts`; its standalone tests remain.
  `?store=idb` is accepted as a legacy probe flag but does not select another
  owner. Outbox/refusal persistence is distinct from read cache persistence and
  remains app-owned.
- **Writes:** optimistic Tasks changes use echoed graph patches with authority
  provenance disabled. They never also trigger sync's automatic POST. Outbox
  entries pin affected rows until ack/refusal; reload recovery still drains
  durable delivery ids through the existing POST/refusal path. An uncertain
  delivery remains pinned until reconciliation, not silently discarded.

### Retained paint versus read knowledge

Inactive rows have the package default **20,000-row** limit. Active/pending rows
are not truncated by that limit. Exact-key answer metadata has a separate
**1,000,000-byte** budget; oversized answers are not retained, not truncated.

Tasks opts into `retainUnownedColumns`: a one-shot body can remain in the **same
RAM row** after that read closes while a bodyless list still holds the entity.
Without this policy the body's successful response was immediately unloaded and
cards reverted to placeholders. The package default remains strict column
unloading. This option creates neither a permanent subscription nor a second
payload store. Explicit null, covered omission, tombstone, changed epoch and row
LRU eviction still reconcile/remove values. `cache.loaded()` still consults
**active coverage only**, never the presence of a retained body. A reopened
watch may paint retained content but stays unready until an authoritative reply.
Row eviction/epoch invalidation clears the app's completed body-request markers;
a successful absent field does not create a render/refetch loop.

Storage-only eviction removes the facade row and derived indexes, but does not
cascade independently held edge sentences. Only an authoritative entity death
can do that. A refused read preserves payload, membership and coverage and
cannot become a successful empty answer. Tally/refusal frames need not carry
`changes`.

## Audited query contract

| Surface           | Integrated behavior and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FTS membership    | SQLite owns token/diacritic/prefix membership, including incremental add/remove. Browser watches never re-screen delivered hits with RAM's approximate word matcher. `live_client_sql_test.ts` proves the real SQLite-to-adapter path, including the `o` versus `ộ` distinction.                                                                                                                                                                                                                     |
| Ranked search     | Search's existing `client.ts` → HTTP `/query` (`.order=search`) path remains app-side, including `rank` snippets, score and open target; `ranked_read_test.ts`, `content_fts_test.ts` and Search tests cover it. Ordinary WS text membership is not represented as a ranked search-result object.                                                                                                                                                                                                    |
| `.near`           | Query serialization preserves the semantic source. The existing Similar view still uses async HTTP `/query` → `askRows`/ranker with score/order metadata. This is **not a new live semantic WS service**. `evalSub` now explicitly refuses similarity ranking before its index/capped paths can silently answer ordinary rows; the adapter preserves the addressed failure. Native KNN/provider behavior is tested through the injected ranking seam, not claimed from CDP with embeddings disabled. |
| Projection        | Declared `Sub.fields` become per-row coverage. Unasked bodies are never full coverage. Covered snapshots merge through RAM; projection metadata is repeated on order resets. One-shot paint retention is distinct from active coverage as above.                                                                                                                                                                                                                                                     |
| Windows/order     | Delivered membership and order are authoritative, even if the sort/filter columns are unloaded. Bounds/totals stay app signals. When append-style deltas cannot express a recomputed window's order, `subserve` sends a replacement and its complete bounded rider; the SQLite test reorders the same two projected members and checks peer coverage.                                                                                                                                                |
| Tallies           | `Sub.agg` stays a value map outside graph. Replacement and zero-count deletion/delta semantics are preserved. Value-only frames make the watch ready without inventing entities.                                                                                                                                                                                                                                                                                                                     |
| Walks             | Relation and reference `->`/`<-` walks serialize to the server; no browser partial-cache traversal can decide the query's answer. Real SQLite relation/reference walks cross the adapter test.                                                                                                                                                                                                                                                                                                       |
| Edge riders       | Peers have independent coverage/ownership and never become result members. Shared release, projected peer payloads, replacements and `edgeWindow` metadata preserve the existing contract.                                                                                                                                                                                                                                                                                                           |
| Unsupported/empty | The browser must round-trip predicates or retain the original line; otherwise it refuses rather than silently scanning an incomplete cache. The grammar's NEVER predicate is locally empty without opening a remote subscription.                                                                                                                                                                                                                                                                    |
| Reopen/readiness  | Retained exact-query membership paints while loading. First replacement reconciles it, including an empty answer. Error/retry, epoch reset, late/disposed frames and synchronous transport replies have adapter/package tests.                                                                                                                                                                                                                                                                       |

`live_client_test.ts` exercises protocol translation and generic opaque answers;
it does **not** prove that SQLite implements arbitrary semantic queries. The
separate `live_client_sql_test.ts` exercises the actual subscription door.
`retention_live_test.ts`, package retention/server-watch tests and the live read
and outbox tests exercise integration. A queue cancellation regression found
with CDP is fixed in `subqueue.ts`: cancelling the last ask during its async hop
must not dereference a missing item and kill the socket worker.

## Same-snapshot CDP measurement

Machine-readable, payload-free evidence: `CLIENT_MIGRATION_CDP.json`.
Reproducible driver:
`deno run -A bin/probe-client.ts <loopback-probe-url>
<shared-six-targets.json>`.
It uses an ephemeral CDP port, fresh unique Chrome profile, waits for addressed
subscription answers plus network quiet, and reaps Chrome/profile in `finally`.
Servers must be scratch-copy `PROBE=1` instances, never a production URL.

- Before frontend: `c3da85be02cae568a12ed7dbb7755139850e219c`; only the server
  queue cancellation guard was backported to keep the comparison's socket
  usable.
- After frontend/server: the commit containing this report (rescued adapter
  `e89cd137` plus integration fixes). Final landed SHA is on T-37276/T-37035.
- Both servers freshly copied snapshot SHA-256
  `cfe241eb832a19286b33f85ec124ae85d8a8ae8da4c6053d9959287a17817dc7`. Ports
  35909/35907; isolated HOME/TMPDIR; sync and embeddings disabled. Both
  scenarios ran at the same wall-clock time. Fresh browser identity and
  clock-sensitive maintenance can still change counts between runs.
- 1440×1000 cold root canvas (11 cards), six fixed target cards opened and
  closed, then first card reopened with incoming JS WebSocket delivery paused.
  Bytes count all inbound WebSocket UTF-8 payloads, not HTTP assets or
  compressed network transfer; distinct IDs count row changes/peers/snapshot
  changes.

| Scenario           | Before bytes / IDs | After bytes / IDs | Before sub/unsub sends | After sub/unsub sends |
| ------------------ | -----------------: | ----------------: | ---------------------: | --------------------: |
| Cold canvas        |      464,461 / 399 | 3,510,992 / 2,225 |                 64 / 6 |              136 / 10 |
| Six opens + closes |      151,728 / 369 |     152,645 / 369 |                48 / 42 |               49 / 50 |
| Reopen first       |        19,742 / 56 |       19,742 / 56 |                  6 / 0 |                 6 / 1 |

The earlier T-37034 baseline was **479,778 B / 297 IDs**, not this snapshot/run.
The integrated migration is **not a cold-byte improvement**: current cold
traffic is ~7.56× the same-snapshot before. Most additional bytes are now-real
mail/deliver inbox queries with missing-component/property-presence predicates;
the old serializer declined these and silently scanned the incomplete local
cache. Do not regain the old number by restoring that correctness bug. Narrowing
these authoritative reads is a separate performance opportunity. Closing the six
cards does not leave six additional query sets/transport subscriptions.

All six body lengths and SHA-256s agree across before/after. The first card
paints its full retained body before any queued response lands (six replies
paused), with all six reads `loading`; after release all six become `ready` in
the new adapter. The old aggregate read state remained `loading`. Neither run
reported browser runtime exceptions. Text lengths differ because the
now-authoritative inbox/relationship state changes surrounding UI, not body
truncation.

Retention improves **immediate paint**, not wire freshness: reopen still asks
for authoritative confirmation and transfers 19,742 B in this scenario. No claim
of a delta-only or zero-byte reopen is made.

## Gates and cleanup

Required gates: `deno task check` and `DB_PATH=:memory: deno task test`; both
passed on the integrated branch before landing. Re-run after a landing rebase.
The task's final comment is the receipt for the landed SHA and post-rebase
gates. Probe servers are reaped by their registered PIDs and scratch DB/profile
trees removed. No live graph, credentials, renderer, `src/db.ts`, harness, TUI
or session implementation was changed for this migration.
