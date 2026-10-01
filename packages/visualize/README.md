# @yaks/visualize

A system MRI at **`/visualize`**: the serving platform's parts and their
relationships, with the real causal work passing through that process. This is a
standalone package, not an inspector extension. It does not read stored entity
contents to draw the picture.

## Compose it

Add `@yaks/visualize` to the serving config's plugins. In a checkout use
`packages/visualize`. Its facets are deliberately separate:

- The portable front door exports snapshots, selection, finite captures and
  authenticated HTTP handlers. Importing it creates no observer or timer.
- `./routes` is the native asset adapter and `/visualize` page. It bundles a
  local browser client; it has no `@yaks/inspect` dependency.
- `./cli`, `./tools` and `./vocab` advertise agent and terminal doors.
- `./front` is page-private vocabulary, **not** the host vocabulary facet.
  `./model` is the graph-owned page model.

A host supplies its **actual composed** `anatomy()` and its **exact** `graph`
object. The mapper belongs to `@yaks/code/anatomy`; visualize never reruns a
package factory, forces a lazy tool, or composes a second graph to improve its
picture. A missing supplier means **unobserved**, not an empty platform. Native
composition and a Worker store have different observation seams; a category not
observed by that seam must not be advertised as globally absent.

Every page, asset, snapshot, capture and SSE request requires `host.who`. It can
be synchronous or asynchronous; returning `null` intentionally allows anonymous
access when the supplied policy permits that. Missing policy fails closed.
Authentication errors are sanitized, not a channel for arbitrary exception
fields or messages. Assets are built lazily after authorization.

## Anatomy contract

`GET /visualize/anatomy` returns a version-1 `Snapshot`:

- `anatomy`: the supplied contract, unchanged on an unfiltered request, with
  host, parts and relationships. Groups are packages, roles, facets, comps,
  tools, commands, effects, rules, hooks, routes, views, inspectViews, tui,
  kits, themes, skills and secrets.
- `coverage`: scope, `activity: process-local`, per-group `observed` flags,
  `recording: subscriber-only`, `clock: monotonic` and `capacity: 256`.
- `takenAt`: the metadata snapshot's wall-clock time, not a trace clock.

A part's declaration, loading and binding are independent facts. A lazy
unattempted facet is not an absent implementation; an imported browser view is
not a mounted renderer. A secret part reports a **name**, never its value or a
getter's result. Schema metadata is a contract, not returned row data.

Optional `group`, `search`, `id` and `limit` select parts:

- Group is one of the 17 names above. `search` is a case-insensitive plain-text
  match over name, package, facet and description, **not graph query syntax**.
- `id` is an exact anatomy identity, not a stored entity eid.
- The global part cap defaults to 1000 and cannot exceed 5000. It applies in
  group order. Edges do not consume the cap; both endpoints must be included.
- A selected response adds `selection: { total, matched, shown, truncated }`.
  `matched` is counted before the cap. The source arrays are not mutated.

Unknown/repeated parameters, empty groups, invalid numeric bounds and malformed
cursors are refused. Plain unfiltered HTTP anatomy preserves the supplier DTO;
the anatomy tool always runs selection and reports its counts. The page projects
the same contract into its private graph. Its pipeline labels are explanatory
client nodes, not another server anatomy category or claims of bound handlers.
The spine includes normalize, admit, mint, prepare, precondition, rules, mutate,
cascade, stamp, journal, commit, effect and audit. **Audit is rollback
notification, not a successful apply's continuation.**

## Activity contract and lifecycle

`@yaks/trace` owns measurement. Producers record names, stages, causal span IDs,
monotonic times, finite counts and outcomes only while subscribers exist. No
query text, entity values, payloads, credentials or secret values cross this
stream. `apply(change, { trace })` remains the domain trace contract;
performance observation does not repurpose persisted effects/trace components.

`observe(graph)` leases that exact graph's shared stream. It adds one local
`epoch` and increasing `seq` to each shared record and retains at most 256.
Start and end share a span ID. Durations of **0 ms are valid**, including on a
clock that advances only during I/O. Counts provide useful evidence there.
Independent observers close independently; the last lease unsubscribes. No
recording timer or clock survives an idle stream. Multiple graphs or processes
sharing a database do not share this channel.

`GET /visualize/activity?limit=32&wait=250` takes a finite observation:

- `limit`: default/max 256; minimum 1.
- `wait`: integer milliseconds, default 0, maximum 2000. The lease stays open
  during the wait. Abort releases it.
- The `Capture` is `{ epoch, events, gap, coverage: process-local }`. **`gap`
  counts known omitted records**, including records removed by the limit or
  overwritten during that capture. It cannot count unrecorded work.

`GET /visualize/events` is bounded SSE with `hello`, `activity` and `gap`
frames. Activity IDs are `epoch:seq`. A same-epoch `Last-Event-ID` replays only
available newer records and reports known overflow. A changed epoch signals that
continuity cannot be established. An invalid or future same-epoch cursor is
refused. Each reader has a 256-record queue; backpressure reports dropped
records, never grows without bound. Disconnect, cancellation and host closing
release the lease. Keepalives exist only while the reader is connected.

The page retains 256 raw records, oldest first, and displays one row per span. A
causal view follows retained parents and descendants, never inventing a missing
parent or a complete distributed trace. Epoch change clears prior records and
cause selection, so clocks and span identity are not compared across processes.
UI offsets use the latest retained record, not a timer.

**Pause closes EventSource**, not merely the drawing. Anatomy and retained
records stay available; metadata refresh while paused is allowed. Resume uses
`tail=1`, adds one observation-gap episode and does not reconstruct paused work.
The page's `gap` indicator counts **episodes**, not omitted records. A
disconnect alone does not prove that any records were lost. Other remaining
subscribers may still observe the host, but they do not backfill this page's
pause. Subscribers such as D-61711 consume this same measured stream; they do
not introduce a competing timing system or persist these records by default.

## Humans and agents

The page has an anatomy map/list, explicit relationship and schema detail,
pipeline spine, timeline and bounded causal drill-down. The map draws at most
160 parts, 320 relationships and the latest 48 shared-record pulses; phases
belong to the spine. Filtering and pagination keep larger compositions
explorable. No activity animation or polling clock invents a busy platform.

Keyboard: `/` search, arrows select, Enter focus detail, Esc clear selection,
`+`/`-` zoom, `0` reset camera, `P` pause/resume, `L`/`M` list/map, `?` help.
Appearance is real shared Everforest or Rosé Pine with explicit dark/light.
Domain state, camera, selection, search drafts and observations belong to a
page-private local `@yaks/client` graph, with `signal`, no server URL and both
vaults disabled. Cleanup closes the stream, requests, desk, watches and client.

Agent tools are `visualize_anatomy` and `visualize_activity` on their actual
tool host. The CLI reads the selected **serving** process instead of composing
one to answer:

```sh
yak visualize anatomy --group tools --json
yak visualize activity --limit 32 --wait 250 --json
```

Use `--url` for another HTTP(S) serving origin. JSON mode prints the exact DTO;
human mode summarizes it. The selected origin determines the saved token;
`YAKS_TOKEN` remains the explicit override. URL userinfo/non-HTTP schemes and
redirects are refused; an unrelated default host's credential is not forwarded.
`x-via` names provenance, not authentication.

## Verification

The package's fresh Deno tests cover snapshots, selection, leases, finite
captures, authentication, SSE replay/backpressure and the graph-owned model:

```sh
deno task test --tag=deno --all packages/visualize
deno check --no-lock --config packages/visualize/browser.json packages/visualize/main.ts
```

The standalone page and both CLI examples were also exercised on an isolated
native host, not the live graph. A successful mutation produced a retained
request → apply → phase/rule/fan-out cause path without exposing its private
contents. Pause closed observation while a second mutation succeeded; resume
reported one gap episode. Restarting only the scratch host reconnected the page
and reset the observation epoch. A burst remained bounded to 256 records, 160
map nodes, 320 edges and 48 pulses. Themes, keyboard search/list navigation,
pointer pan/reset/zoom and a 390-pixel reduced-motion layout were checked.

Native and Worker suppliers have separate tests against their actual composition
seams. Worker runtime deployment and a live-box restart are not implied by those
checks. A host must include the plugin before serving the route; a running
process receives source changes on its next start.

Inactive observation is not zero-cost: repeated runtime benchmarks measured
roughly 128–214 ns/query (5.5–9.2%) for the inactive channel branch. Idle-path
interface tests observed no telemetry begin/instant calls, clock reads or UUID
creation during apply/read/get. This is not a heap-allocation profiling claim.
D-61711 consumes the same stream, not another measurement system.
