# Web Worker runtime

The default TUI separates terminal rendering from the database and agent
runtime. The inline `agent()` API remains available for diagnostics:

```sh
HARNESS_DB=/path/to/candidate.db deno task harness
```

Use a separate candidate database. Changing working directory does not isolate
storage. The worker opens the configured database and runs normal migrations.

## Ownership

The main thread owns terminal input, Preact, layout, Markdown rendering, VISUAL
selection, and the private ephemeral frontend graph. It also holds a separate
`@yaks/client` domain replica. The worker exclusively owns the authoritative
SQLite/blob graph, daemon, providers, and tools. Neither drafts nor selection
state are transmitted.

`@yaks/sync`'s `portLink` carries structured request/reply messages and existing
subscription frames over `postMessage`. `@yaks/api` supplies subscription
membership and deltas; `land` applies them to the replica. The worker exposes a
fixed list of operations rather than arbitrary function invocation. This pilot
does not offer optimistic graph mutations: send/start/archive/task admission are
authoritative commands with explicit responses.

Session and task entities are subscribed globally. Transcript subscriptions
cover only the selected session and its inherited fork prefix. Previous
transcript subscriptions are removed on selection changes. The initial selected
transcript still arrives as a full set; rendering virtualization is not data
pagination. This worker is a thread in the same process, not a sandbox or a
separate fault-isolated process.

## What is incomplete

- Session titles and derived statuses still use the existing asynchronous
  summary projections. Those RPC results are not yet live query projections.
  `subscriptions` gained an explicit dependency invalidation callback: entry
  commits refresh the session set. This is correct but coarse; it is not the
  fully granular frontend architecture we want.
- Requests are bounded and timed out, but frames lack credit-based backpressure.
  Large initial transcripts can still stall the main thread during structured
  clone and replica application. Overlapping transcript queries are arranged as
  disjoint session ranges; generic overlapping-subscription retention is not
  solved by this pilot.
- The existing graph `land` API applies received entities. The pilot manually
  tracks subscription membership/readiness. A reusable client transport with
  subscription readiness, errors, and ownership would remove this boilerplate.
- No transparent worker restart or mutation retry: a timeout does not prove a
  write failed. Worker errors reject pending calls and surface in diagnostics.
- `Daemon.stop()` synchronously stops admission and new turns, then drains all
  admitted callbacks and storage-reading effects. It does not mark sessions or
  tasks stopped/completed. `Agent.close()` is idempotent and async: it drains
  admitted operations and the daemon before diagnostics and SQLite are closed.
  Inline callers must await it; a callback that never returns keeps storage
  open.
- Remote close stops commands immediately, allows two seconds for drain, then
  terminates the worker. It returns `{ drained: boolean }`; reaching the
  deadline on Ctrl+C is expected, not an exception. The terminal is restored by
  the TUI before backend shutdown. No independent supervised process receives a
  signal. Termination is not a provider cancellation acknowledgment: an
  unfinished request can still consume provider resources, and external side
  effects may have happened. Committed entries remain resumable; uncommitted
  model replies are not saved.
- Port close notifies its peer and rejects pending requests. Transport error and
  messageerror events do likewise. A silent disappear without an event or close
  packet can only be detected by request timeout; there is no heartbeat/restart.
- Native SQLite close never races callbacks in graceful shutdown. Deadline exit
  terminates the worker rather than calling SQLite close beneath a live
  callback.
- No live-provider test or production-database experiment was performed.

## Measurements

Run `deno run -A packages/harness/worker_bench.ts`. It creates isolated
in-memory stores and a temporary working directory. It compares startup and a
burst of 11 100,000-character messages using an immediate fake model, while
sampling a 2ms main-thread timer. The final yield ensures blocked time is
observed. It reports message counts, not byte-accurate clone costs. Model
scheduling can coalesce asks differently between runs; this is not a controlled
throughput benchmark or an interactive latency guarantee.

An initial run measured inline startup 32ms / worker startup 255ms, burst 123ms
/ 169ms, maximum timer delay 112ms / 2ms. This suggests better event-loop
availability at the cost of startup and throughput overhead. Repeat on your
machine and workload; default promotion does not change these tradeoffs. There
are no claims yet for many concurrent children, p99 input latency, or streaming
backpressure.

Tests exercise a real worker with isolated SQLite, command errors, selected fork
replication, shutdown, and the existing App: typing a draft after the view is
ready sends zero messages to the backend. Generic UI tests continue to cover
visual selection, scroll anchors, mouse routing, and lazy rendering.

An isolated tmux smoke test started worker mode on a new temporary database,
rendered the sidebar and composer, accepted an unsent draft, and exited on
Ctrl+C. The test session was removed and no diagnostic journal was created. This
does not verify a live provider or sustained interactive streaming.

A later isolated run on this checkout measured inline startup 115ms / worker
693ms, burst 380ms / 613ms, max timer delay 331ms / 6ms (31 / 33 entries). This
is a noisy single run under concurrent development, not a p99 claim. Shutdown
tests cover an active held model, a never-returning worker model, burst writes,
duplicate close, peer disconnect, and a real worker crash. The diagnostic
journal confirmed the reported normal Ctrl+C failure was the old two-second
`Worker shutdown timeout` exception; that deadline now returns an expected
non-drained result instead.

A private-HOME tmux smoke test of the default TUI exited 0 on Ctrl+C, restored
identical `stty -g` settings, and produced no exception journal. The
stuck-worker test also reopens its private file-backed database, resumes, and
gets a reply. An admitted storage-callback test verifies an independently
spawned process is still alive after Agent close. This is not a
live-provider/subagent load test.

A private-HOME tmux smoke test of the default TUI exited 0 on Ctrl+C, restored
identical `stty -g` settings, and produced no exception journal. The
stuck-worker test also reopens its private file-backed database, resumes, and
gets a reply. An admitted storage-callback test verifies an independently
spawned process is still alive after Agent close. This is not a
live-provider/subagent load test.

## Session-switch measurements

`deno run -A packages/harness/switch_bench.ts 1000 1000` creates an isolated
SQLite database with 1,000 sessions, two 1,000-entry transcripts and ten entries
in each remaining session. Bodies contain about 1,000 characters. It mounts the
frontend at 120×32 cells and measures frontend selection through the first paint
containing the selected transcript. The first sample is cold; eleven subsequent
samples alternate between the two transcripts. No provider requests are made.

One before/after run on the same host measured:

| Measurement                    |   Before |  After |
| ------------------------------ | -------: | -----: |
| Cold selection to paint        | 1,459 ms | 657 ms |
| Warm median                    | 1,036 ms | 152 ms |
| Warm p95 (11 samples; maximum) | 1,537 ms | 190 ms |
| Outbound worker messages       |       88 |     40 |
| Maximum 2 ms timer delay       |    97 ms | 185 ms |

The change bounds title reads to the first eligible local entry instead of
materializing every transcript. The remote adapter reuses asynchronous session
and task projection results until their authoritative subscription changes.
Initial transcript frames satisfy the waiting read without triggering a second
application refresh. Each concurrent transcript request returns its own selected
snapshot, not a later request's selection.

These are synthetic measurements, not production latency guarantees. The larger
maximum timer delay in this run remains a concern: initial replica application,
text extraction in the test terminal, and full transcript transfers still do
synchronous work. The change reduces elapsed switching latency, not every
main-thread stall. There is no pagination or retained offscreen transcript
cache; revisiting a session still transfers its full selected transcript. Under
active writes, summary subscriptions still invalidate broadly. First-class
incremental summary projections and bounded transfer/application remain
follow-up work.

After integration with the independent input-publication fix, another run of the
same fixture measured 786 ms for the cold selection, 194 ms warm median, 284 ms
warm p95, and 142 ms maximum timer delay. Runs were taken on a shared host, not
under controlled load. Both elapsed time and main-thread stalls should continue
to be measured as the projection and transfer APIs change.

## Startup reconciliation

Startup previously woke every settled child to reconcile completion receipts.
For forks, this read each inherited transcript before checking whether the
receipt already existed. Finished pooled children could also enter scheduling
again. A large parent shared by many forks therefore caused repeated reads and
status evaluation ahead of the first sidebar response.

Resume now queues receipt reconciliation directly, tracked by daemon shutdown,
rather than another child execution. Reconciliation checks the child's latest
local entry and existing receipt first. Only missing receipts require the full
inherited transcript. A child that finishes during those reads uses the final
snapshot for both receipt identity and content.

An isolated benchmark is available:

```sh
HARNESS_DB=:memory: deno run -A packages/harness/startup_bench.ts 150 4000
```

It creates a temporary database with 150 sessions, a 4,000-entry parent, and
settled forks with existing receipts. It never opens the configured database.
Three cached-module runs on a shared host measured:

| Stage                                                 | Before           | After      |
| ----------------------------------------------------- | ---------------- | ---------- |
| SQLite open                                           | 10–23 ms         | 15–16 ms   |
| Worker initialization                                 | 271–295 ms       | 276–333 ms |
| Resume command response                               | 33–37 ms         | 33–38 ms   |
| First session summary, including queued recovery work | 12,204–12,468 ms | 287–309 ms |
| Selected transcript replication/read                  | 257–385 ms       | 223–346 ms |

A separate process importing the application with cached modules took 310 ms
wall time (216 ms in dynamic imports). These results reproduce a roughly
12-second recovery stall; they do not prove every live startup has that cause.
The benchmark also reports mounted frontend paint after the initial read. That
stage used 14–41 ms in another three-run sample. Initial full-transcript
transfer and summary derivation are still required; this change is not
pagination. First installation downloads, module compilation, missing-receipt
delivery, and live provider recovery can have different costs. Timing results
are not latency guarantees, and the fixture uses a fake provider only.
