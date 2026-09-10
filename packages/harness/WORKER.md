# Web Worker pilot

The optional worker mode separates terminal rendering from the database and
agent runtime. It is not the default:

```sh
HARNESS_WORKER=1 HARNESS_DB=/path/to/candidate.db deno task harness
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
- Shutdown rejects new commands, waits for admitted operations and idle
  sessions, then closes SQLite. The frontend terminates the worker after two
  seconds if graceful shutdown cannot finish. This does not stop independently
  supervised tool processes. The daemon still lacks a general cancellation/drain
  contract.
- One isolated benchmark initially segfaulted when closing the inline agent
  while turns were active. Waiting for idle removed that reproduction. A stack
  trace was unavailable; this is not proof of the native failure's exact cause.
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
machine and workload before making worker mode the default. There are no claims
yet for many concurrent children, p99 input latency, or streaming backpressure.

Tests exercise a real worker with isolated SQLite, command errors, selected fork
replication, shutdown, and the existing App: typing a draft after the view is
ready sends zero messages to the backend. Generic UI tests continue to cover
visual selection, scroll anchors, mouse routing, and lazy rendering.

An isolated tmux smoke test started worker mode on a new temporary database,
rendered the sidebar and composer, accepted an unsent draft, and exited on
Ctrl+C. The test session was removed and no diagnostic journal was created. This
does not verify a live provider or sustained interactive streaming.
