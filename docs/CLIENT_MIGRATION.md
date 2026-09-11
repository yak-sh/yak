# Tasks browser client migration: boundary and parity audit

Status: **not integrated**. T-37276/T-37035 remain open. Phase 3a (T-37330) adds
a server-evaluated watch path and storage-only row observation to the packages.
It does not change `src/live.ts` or any renderer, does not create a second
frontend cache, and does not claim browser measurements.

## Audited contract

| Surface                   | Existing Tasks contract                                                                                            | Package status / required adapter work                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FTS/search                | `src/query.ts` textual queries are server-owned; result components are separate from entity data                   | RAM has a word matcher, not exact FTS5 semantics. `watch(line, {evaluate: 'server'})` now accepts opaque server queries without locally screening delivered hits. Preserve Tasks FTS and result components in the adapter.                                               |
| `.near`                   | Semantic server result ordering and scores                                                                         | RAM declines nearest-neighbour. The server-evaluated path can transport its entity membership, but scores/result metadata still need the Tasks result signal bridge.                                                                                                     |
| Projection                | `Sub.fields`, `loaded()` and waking/volatile field signatures in `live.ts`                                         | Generic sync snapshots currently replace the whole wire tier. Do NOT feed projected Tasks frames to `snapshot()` as whole rows: omitted columns are unloaded, not deleted, and may belong to another owner. Add a generic coverage-aware frame path before switching.    |
| Windows/ranking           | Authoritative server membership plus `Sub.window`; local caches cannot invent omitted hits                         | Server-evaluated watches now retain delivery order, including same-members/different-order replacements. The server must send resets for reordered sets. Window bounds/totals and provisional bounded ownership reconciliation remain adapter work.                      |
| Tallies                   | `Sub.agg` is a map and never creates entities; replacement and delta have different meanings                       | `Watch.value` remains `Bundle[]`. Sending an opaque tally query is possible but does NOT implement its result shape. Keep a typed app result signal and a protocol bridge, not synthetic graph entities.                                                                 |
| `->` walks                | Complete graph traversal on the server, including relation and reference walks                                     | `@yaks/match` already supports fixpoint walks over the set it has. This is not a complete partial-cache answer. Server evaluation avoids that false inference; test actual Tasks walk frames in the adapter.                                                             |
| Edge peer riders          | Edges and projected peer rows are sub-owned, peers never enter result membership; `edgeWindow` states completeness | Sync `Frame` has only bundles/gone/reset/refused. Add generic payload ownership distinct from result membership, with coverage and peer release semantics. Do not merge peers into result bundles.                                                                       |
| Reopen before first frame | Retained rows paint with readiness false                                                                           | Existing local-evaluated package watches prime from retained/epoch-restored rows. Newly opened server-evaluated watches deliberately start empty: bounded semantic membership retention has not been implemented. A disconnected standing watch retains its last answer. |
| Ready/refusal             | Cache absence is never proof of absence; successful answer, failed read and pending read differ                    | Package ready/dedupe/reconnect works in both evaluation modes. Bridge addressed Tasks read refusals without turning a failure into a successful empty answer.                                                                                                            |

The phase-3a tests exercise opaque queries, unloaded matching fields/references,
server ranking resets, shared payload ownership, independent disposal, refusal,
reconnect/late frames, synchronous transport answers, epoch restore without
local evaluation and cache eviction observation. They are **package transport
tests**, not SQLite semantic parity tests or proof of aggregate/projection/rider
support.

## Target ownership boundary (not yet switched)

- **Packages:** one RAM payload store behind graph; shared watches and
  readiness; sync frame and lifecycle bookkeeping; bounded payload
  retention/epoch wire persistence; generic matching where a local answer is
  valid. Generalized partial payload/coverage and member-versus-rider ownership
  belong here too.
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

1. Generic coverage/rider frame contract plus bounded server-answer retention;
   test full/projected overlap, omitted body versus deleted field, peer-only
   ownership, replacement/departure, ranking and same-epoch reopen. Ensure these
   frames do not erase another subscription's loaded data.
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
