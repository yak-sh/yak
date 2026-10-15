# T-125341 — serving-directory audit and incomplete implementation

This branch is **not a production fix**. No request path imports
`directory-copy.ts`. Do not mark T-125341 done or deploy a stale authorization
cache based on it alone.

## Reads before a request can answer

The common client seam is `directory.ts directory()` -> `recall()` ->
`door.query()`; `directoryFor` does not exist on main. Most callers construct it
using `directory(bound(env.DIRECTORY, dirPart.fetch, env))`; MCP uses
`now=true`.

- `apps.ts served()`: `space` starts speculatively even before
  `page-cache.ts
  asked()` can answer a Site hit. On misses `routing` selects
  requested app + HOME coherently, always fresh; former addresses,
  role/member/grant and release selection can add reads. Direct files, own
  workers, APIs and store calls all depend on this routing/access decision.
- `kernel.ts settling()` and `aimed()`: `serves(host)` resolves verified
  hostname -> app/space before custom domains serve. Per-request recall
  deduplicates the same query but not across requests.
- `mcp.ts`: door/auth/seated, app selection and member/grant standing all use
  directory reads before connector tools run. An app row alone is insufficient.
- `site.ts`: apex/gallery listings and anonymous app rendering read the
  directory.
- `app-address.ts`, `identity.ts`, `connections.ts`, `page-graph.ts`,
  `git_door.ts`, `unseen.ts` and tool internals also construct directory
  clients. Read-only tool work must use the same serving seam, while directory
  writes and write-side compare/read-back must remain authoritative.
- `directory.ts part()`: 30-second nonempty-result Map, cleared only locally by
  `apply`/`stamp`. App selection explicitly bypasses it. `directoryOf` is a
  different client used inside Stores; do not blindly replace authoritative
  metering/admission/writes with stale results (`memberless` is explicitly
  fresh).

## Existing page invalidation is not an authorization protocol

`facets/pages-graph.ts owed()` derives app/space tags after commit; `purge.ts`
serializes account-limited purges through Purger -> Site. This runs before the
writer answers, but Cloudflare purge propagation is explicitly not synchronous.

- Ordinary app settings purge app; slug/space/HOME/trash/former and space plan/
  quota/routing changes purge space.
- `tools.ts released()` raises fence and prepurges formerly keepable pages.
  Final fence lowering deliberately owes no second page purge. Copies MUST
  nevertheless receive both transitions and final source/version/worker.
- Private/worker apps can have no page-cache entry: their row changes still
  count.
- Member/grant and hostname changes are not covered by page tags. A tombstone
  emits app:<deleted-eid>,space:<deleted-eid>, not the former
  parent/host/person. Cascades and old relationships are essential to targeted
  invalidation.
- A late pre-invalidation refresh must never repopulate old data.
- A cache key must include exact directory identity and query/routing identity;
  no app slug alone and no content-only deduplication across tenants.

## Store cannot independently reject stale gateway authorization

`directory.ts storeAt/appStore` sends app access/release every request.
`graph.ts #ready -> #learn -> #heard/#remember/#mode` accepts that access and
can overwrite a newer local mode. There is no monotonic policy epoch.
`authenticating` trusts `v.level`; `#vouching` can mirror it into grants.
`#socketWriter` does not reread standing for already `#vouched` people. Thus
stale public app + stale member is not merely stale display: it can reauthorize
a private/deleted/revoked app. Header stripping prevents user forgery, not
trusted stale state.

## Safe integration still required

A checked serving-policy authority must be independent of yak/platform;
unchecked per-isolate or edge snapshots alone cannot provide immediate
revocation. Cache content keyed by its accepted revision; never authorize from
an unchecked stale policy copy. Options to evaluate:

1. Per-request independent/sharded authority check. Warm Site hits acquire an
   extra coordination hop; measure this honestly against the no-directory-hit
   baseline, not merely against a cold directory query.
2. Revocable/expiring authority leases. Local warm policy can then be free of a
   network hop, but writers must revoke/replace or wait out all old leases
   BEFORE acknowledgement. Failure/clock/restart semantics need proof. Do not
   describe ordinary TTL as immediate invalidation.

Either needs pre-commit fencing, a transactional durable publication outbox,
recovery after crash/rollback, monotonic Store policy acceptance, and gates
before Site hits/direct files/dispatch/API/tool returns. A postcommit effect
alone is not sufficient: graph isolates and reports effect failures without
failing the write. Do not put asynchronous RPC in a SQLite transactionSync
commit hook. Avoid one new global DO plus recomputing every historical query per
directory write: that just relocates the single failure point and makes writes
unbounded.

Define immediate as new authorization decisions after mutation acknowledgement;
already delivered bytes cannot be withdrawn. Socket revocation is a separate
standing decision and must be handled, not assumed to follow page purge.

## Prototype core / proof

`directory-copy.ts` is an unintegrated owner-local state machine with injected
atomic persistence/timers, warm no-I/O read, deduplicated background refresh,
25ms stale/cold bounds, durable fail-closed fence, complete revision-matched
publication and protection against late fills. Sixteen controlled-time tests
cover the core. `deno task test:budget workers/yak/directory-copy_test.ts` and
`deno check workers/yak/directory-copy.ts workers/yak/directory-copy_test.ts`
pass. This is NOT the requested request-seam page/deploy-event test and proves
no production availability change. Neither edge cache integration nor warm
request path cost has been implemented/measured.

## Live observations, October 15, 2026

Before: recipes 200, TTFB 1.237242s / total 1.247603s; root 200, TTFB .450431s /
total .461991s. Later, still unchanged production: recipes 200 .966197s /
.968383s; root 200 .560141s / .562981s. These are observations, not an
improvement claim. `yak admin deploys --as admin` and
`yak admin errors --as admin` were queried; there was no deployment from this
branch.
