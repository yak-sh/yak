# Tasks browser client migration: boundary and parity audit

Status: **not integrated**. T-37276/T-37035 remain open. Phases 3a/3b
(T-37330/T-37334) add server-evaluated watches, storage-only row observation,
coverage/rider ownership, and bounded server-answer reopen floors to the
packages. This does not change `src/live.ts` or any renderer, does not create a
second frontend cache, and does not claim browser measurements.

## Audited contract

| Surface                   | Existing Tasks contract                                                                                            | Package status / required adapter work                                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FTS/search                | `src/query.ts` textual queries are server-owned; result components are separate from entity data                   | RAM has a word matcher, not exact FTS5 semantics. `watch(line, {evaluate: 'server'})` now accepts opaque server queries without locally screening delivered hits. Preserve Tasks FTS and result components in the adapter.                                                                            |
| `.near`                   | Semantic server result ordering and scores                                                                         | RAM declines nearest-neighbour. The server-evaluated path can transport its entity membership, but scores/result metadata still need the Tasks result signal bridge.                                                                                                                                  |
| Projection                | `Sub.fields`, `loaded()` and waking/volatile field signatures in `live.ts`                                         | `Frame.coverage` declares per-row loaded scope; `cache.loaded` reads active ownership. Projected omissions do not delete other owners’ columns. The adapter must exclude omitted body columns explicitly, never call a projected row full.                                                            |
| Windows/ranking           | Authoritative server membership plus `Sub.window`; local caches cannot invent omitted hits                         | Server-evaluated watches now retain delivery order, including same-members/different-order replacements. The server must send resets for reordered sets. Bounded retained server membership preserves ranking without local matching; window bounds/totals and the result bridge remain adapter work. |
| Tallies                   | `Sub.agg` is a map and never creates entities; replacement and delta have different meanings                       | `Watch.value` remains `Bundle[]`. Sending an opaque tally query is possible but does NOT implement its result shape. Keep a typed app result signal and a protocol bridge, not synthetic graph entities.                                                                                              |
| `->` walks                | Complete graph traversal on the server, including relation and reference walks                                     | `@yaks/match` already supports fixpoint walks over the set it has. This is not a complete partial-cache answer. Server evaluation avoids that false inference; test actual Tasks walk frames in the adapter.                                                                                          |
| Edge peer riders          | Edges and projected peer rows are sub-owned, peers never enter result membership; `edgeWindow` states completeness | `Frame.peers`/`peerGone` are a distinct payload role, never result membership. Reset replaces both roles. The Tasks adapter still owns edge triple translation and edgeWindow metadata.                                                                                                               |
| Reopen before first frame | Retained rows paint with readiness false                                                                           | Server watches reopen from byte-bounded exact-key membership/order, using only payloads still in RAM or epoch-validated wire storage. Reopened watches stay unready; first successful reset reconciles the floor. Unknown keys never run local matching.                                              |
| Ready/refusal             | Cache absence is never proof of absence; successful answer, failed read and pending read differ                    | Package ready/dedupe/reconnect works in both evaluation modes. Bridge addressed Tasks read refusals without turning a failure into a successful empty answer.                                                                                                                                         |

The package tests exercise opaque queries, unloaded matching fields/references,
server ranking resets, shared payload ownership, independent disposal, refusal,
reconnect/late frames, synchronous transport answers, epoch restore without
local evaluation, cache eviction observation, full/projected overlap,
independent member/rider release, unloaded bodies versus null, pending pins,
bounded answer metadata, ranked memory/IndexedDB restore, and
epoch/late-hydration invalidation. They are **package transport tests**, not
SQLite semantic parity or adapter/aggregate proof.

## Target ownership boundary (not yet switched)

- **Packages:** one RAM payload store behind graph; shared watches and
  readiness; sync frame and lifecycle bookkeeping; bounded payload
  retention/epoch wire persistence; generic matching where a local answer is
  valid; partial payload/coverage and member-versus-rider ownership. There is
  one payload store, plus bounded id/order/coverage metadata (no query payload
  mirror).
- **Tasks:** `Ent` facade and narrow UI signals, vocabulary-derived reference,
  edge and human-id indexes; query serialization (`predsToQuery`) and Tasks
  FTS/semantic/ranking semantics; result/tally/window signals; topology and
  leader identity; durable outbox, refusal ledger and reload drain;
  authoritative boot epoch negotiation; translation of Tasks' existing wire
  frames.
- **Remove at the switch:** live.ts's payload-owning `cache`/`retained` split,
  durable query mirror in `src/schema/idb.ts`, and duplicate
  membership/retention ownership. Compatibility signals may expose package RAM
  but may not own a separately retained payload map. `cache.onRows` now reports
  commits, hydration, epoch invalidation and storage-only eviction so derived
  indexes can follow the one payload owner without inventing graph deletions.
- **Preserve:** renderers (`components/registry.ts`, `Entity.tsx`, views),
  `ent()`/signals, field/read readiness and the existing durable outbox. Do not
  route Tasks writes simultaneously through its outbox and sync's automatic POST
  hook. An uncertain POST intentionally stays pinned today; transport recovery
  must explicitly reconcile/release it rather than leaking pending pins forever.

## Remaining implementation order

1. **Package prerequisite complete:** coverage/rider frame ownership and bounded
   semantic-answer reopen, tested independently. This is not the adapter switch.
2. Tasks wire/query adapter and result channels. Adapt existing subscriptions,
   boot/epoch/topology and outbox behavior without a second cache. Replace local
   resolver/query persistence and attach derived indexes to cache row
   observation. Add integration tests for all audit rows, especially read-door
   readiness.
3. Same-snapshot scratch-copy PROBE CDP: unique port and profile/TMPDIR, cold
   boot, reopen before first frame, six-card subscription count and inbound
   bytes; compare baseline T-37034 (479,778 B / 297 distinct IDs) and
   same-snapshot before versus after. Record the exact snapshot/commit/scenario.
   Reap browser/server and remove scratch DB/profile. Required checks:
   `deno task check` and `DB_PATH=:memory: deno task test`. Land via
   `task land`; T-37276 and T-37035 are done only after the integrated
   measurement, not on package results.

## Generic frame adapter contract (phase 3b)

- `bundles` are result row snapshots, ordered on reset. `peers` are payload-only
  row snapshots. An eid may have both roles, in the same or different watches.
  `gone` releases only membership; `peerGone` releases only the rider role.
  `reset: true` replaces both sets, including a wholly empty reply. A refusal
  does neither, and cannot make a watch ready.
- `coverage[eid]` is `true` for a whole wire row, or an object such as
  `{doc: ['title'], task: [], filed: true}`. This covers title, task presence,
  and all of filed. Omission outside that scope is **unloaded**, not null.
  `peerCoverage[eid]` independently declares the rider role’s scope, even when
  the same eid also appears in results. Absent coverage means full for result
  rows, delivered columns only for peers. Every row delivery replaces that
  role's coverage: repeat the projection on maintenance frames. Translate Tasks
  patch deltas to covered snapshots using the existing RAM row; do not introduce
  an adapter-owned payload mirror.
- Covered omissions clear previously held values only where another role does
  not still cover them. Explicit null is authoritative deletion, not omission.
  Unsubscribing retains a bounded floor; authoritative departure forgets an
  unowned row. If another role still holds it, only unowned columns are unloaded
  through storage maintenance. Pending writes pin the row and suppress incoming
  subscription snapshots until reconciliation releases the pin.
- `cache.loaded(eid, component, property)` answers current ownership knowledge,
  not read success. It is false without an active covering role. Restored roles
  conservatively intersect their saved coverage with columns present in RAM;
  they cannot claim evicted columns loaded. Use watch readiness separately.
- `ClientOpts.answerBytes` defaults to `ANSWER_BYTES` (1,000,000 encoded bytes),
  counting keys, ids, coverage, and empty answers. Over-budget answers are not
  retained; live answers are never truncated by this budget. Restored answers
  omit evicted payloads and are only an unready paint floor. Exact query/options
  keys prevent semantic mixing. The optional WireVault answer methods share the
  payload tier's authoritative epoch guard. IndexedDB checks the stored byte
  envelope before loading a checkpoint; a smaller budget can discard it whole.
- Coverage/rider query frames require a working-set replica (provided by
  `client`); standalone sync and raw feeds refuse this shape rather than
  silently treating projected rows as whole payloads.
- Tasks tallies, result components, score/window metadata, topology, outbox and
  boot negotiation remain app-side. Nothing in this phase changes `src/live.ts`,
  renderers, or the parent’s required same-snapshot PROBE measurements.
