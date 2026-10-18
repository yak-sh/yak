# Waiting-path inventory

A **waiting path** is an operation from a person's action to usable content or a
complete answer. The benchmark names below identify the boundary, not every
possible entity, query, account or third-party service.

| Surface / waiting path                                | Benchmark                                                                                    | Boundary                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Browse home and task detail                           | `pages`                                                                                      | Cold and warm navigation to populated home / task title                                              |
| Session list and long session transcript              | `page-content`                                                                               | Cold and warm navigation to session list / actual transcript content                                 |
| Project task list                                     | `page-content`                                                                               | Navigation to populated list, not project heading                                                    |
| Query and map                                         | `page-content`                                                                               | Navigation to returned rows / populated map                                                          |
| Package, component and property inspector             | `page-content`                                                                               | Navigation to the appropriate schema content                                                         |
| Platform anatomy                                      | `page-content`                                                                               | Navigation to populated anatomy list                                                                 |
| CLI startup/help                                      | `person-commands:cli/help`                                                                   | Spawn through complete output and exit                                                               |
| CLI task list, graph show and graph query             | `person-commands:cli/*`                                                                      | Spawn through populated answer and exit over 2,000 tasks                                             |
| CLI graph write                                       | `person-commands:cli/graph-apply`                                                            | Spawn through committed write and exit                                                               |
| UserPromptSubmit hook                                 | `person-commands`                                                                            | Actual hook response over a one-MiB transcript, including process startup                            |
| Box connector graph read/write                        | `person-commands`                                                                            | Actual MCP HTTP request through serialized answer / saved write                                      |
| Terminal startup and query navigation                 | `person-commands`                                                                            | CLI startup to terminal content; query keypress to returned content                                  |
| Platform management page                              | `platform-waits:management/html`                                                             | Production kernel HTTP through complete HTML (secondary pages assert shell only)                     |
| Platform app page                                     | `platform-waits:app/html`, `app/paint-cold`, `app/paint-warm`                                | Complete HTML and Chrome content paint over the isolated kernel                                      |
| Platform connector app/file list and graph read/write | `platform-waits:connector/*`                                                                 | Real connector HTTP request through populated answer / saved write                                   |
| Managed worker pressure                               | `worker-health:workers/cpu`                                                                  | CPU of all active worker cgroups, including threads and children                                     |
| Browser local-cache update and rendering input        | `web-client`, `client-frame`, `client-rules`                                                 | Cache folds, frame/part reads, rule keystrokes                                                       |
| Session status lookup                                 | `session-status`                                                                             | Identity and query lookup beside 2,700 calls                                                         |
| Native session start, transcript, switch and stream   | `harness-startup`, `harness-switch`, `harness-window`, `harness-streaming`, `harness-worker` | Open/resume/mount/paint, streaming writes and event-loop delay                                       |
| Graph storage and write throughput                    | `throughput`, `graph-activity`, `relay-admission`                                            | Seeded reads/writes/admission, SQL statements and recording overhead                                 |
| App and platform deployment                           | `app-deploy`, `deploy`                                                                       | Deployment timing records; platform deployment is measured where it runs                             |
| Test/check commands                                   | `suite-*`                                                                                    | Command wall/control ratio, measured where commands run                                              |
| Person/project Inbox and expanded conversation        | `inbox-content`                                                                              | Private offered Inbox through all thread titles/newest replies; expansion through historical comment |

The home/task titles and package microbenchmarks do not stand in for a loaded
session, terminal paint, command startup, a connector round trip or app paint.
Each has its own measurement. `box.ts` is a manual investigation requiring a
snapshot/config; it is not the unattended command regression monitor.

## Inbox on an isolated host

`inbox-content` measures cold and warm navigation on a private starter browse
host with `@yaks/inbox`, `@yaks/inspect`, `@yaks/notify` and `@yaks/mail`
loaded. Only graph/web roles run; no mail sender, importer or duty worker runs.
Its fixed fixture has 100 assigned person threads (each with an older comment
and newest reply) and 100 project-addressed threads. Paint requires every thread
title inside the actual Inbox frame and every newest person reply;
`person-thread` additionally expands a thread and waits for its historical
comment in the conversation. Empty Inbox frames, loading shells and fallback
Show pages fail rather than producing timings. The graph, ephemeral port and
browser profiles belong to the collection and are removed in `finally`.

```sh
deno task bench inbox-content accept
deno task bench inbox-content check
```

Acceptance uses the shared best-of-three runner with zero slack and a separate
`inbox-content.baseline.json`; existing page workloads and references do not
change. Daily and half-hour monitor lanes include this suite, including the
monitor’s bounded failure reporting and local no-slack moving best. This is
local fixture coverage, not a claim that the live host offers Inbox or that a
100-thread fixture represents every owner inbox.

## CLI, connector, hook and terminal operation families

`operation-commands` measures separate CLI process and MCP HTTP answers for
`graph-schema`, `task-new`, `task-update`, `decision-new`, `decision-answer`,
`comment-new`, `history`, `board-check`, `project-check`, `claim`, `topic-new`,
`topic-find`, `persona-read`, `memory-save`, `memory-recall`, `archetype-check`,
`storage-check` and `effect-check`: 38 independent figures. Claim take and claim
release have separate figures. Each operation checks populated output or its
committed effect; a successful empty answer is not a stand-in for a write or a
populated list.

`operation-scale` measures CLI and MCP task lists, filtered queries, history and
transcript queries independently over 50,000 tasks and 1,000 two-KiB transcript
entries. This fixed corpus catches scale-dependent work without depending on,
modifying or claiming to reproduce every shape of the owner's live graph.

`hook-waits` measures the installed SessionStart, SubagentStart, SessionEnd and
PostToolUse doors. Starts return held-work context, SessionEnd releases a real
claim, a main-thread HTTP hook delivers and marks pending bus work, and a
subagent HTTP hook leaves that work pending. UserPromptSubmit remains measured
by `person-commands`. There is no installed Stop or PreCompact hook to time.

`terminal-interactions` measures real PTY comment typing to paint, typing to
durable draft and Enter to committed comment. Inspector title/body/component
edits are browser-only: the terminal explicitly paints those controls read-only.
These figures do not pretend to bank an unsupported terminal mutation. Query
palette editing/paint/submission remains an explicit gap: the probe found blank
field paint, an aggregate-preview array assumption and unstable repeated focus.

```sh
deno task bench operation-commands accept
deno task bench operation-scale check
deno task bench hook-waits check
deno task bench terminal-interactions check
```

These suites each have a half-hour monitor entry and no slack. The hourly shell
dispatch reads `HOURLY` from `monitor.ts`, so adding a suite there also
schedules it rather than leaving a second hard-coded list behind.

### Registered doors still outside these fixtures

`inventory(config?)` in `operation-commands.ts` enumerates declared tools and
CLI commands without opening a graph; each collection also verifies its actual
HTTP tools/list. The starter-plus-SQLite fixture declares 41 tools (38 on HTTP);
the configured box inventory has 95 CLI doors and 82 declared tools. The
selected families above do not establish universal coverage. To repeat the
configured inventory without live writes:

```sh
deno eval 'import { inventory } from "./bench/operation-commands.ts"; import { read } from "./packages/cli/config.ts"; console.log(JSON.stringify(await inventory(read(Deno.env.get("HOME") + "/.yak/yak.json")), null, 2))'
```

Remaining independent registered families include admin commands; builder
build/choose/supply; citation check/verify; code sync; connection list/need;
design new/decide; effect retry/drop; mail check/reply/send/show; model list;
memory around/session/source/target/thread; persona sync; search; session
cache/check/list/new/peek/send/spawn/stop/wait/listen/brief; vector check;
visualize activity/anatomy; and land/restart/serve. Many can use isolated
fixtures; external operations need separate safe boundaries, not a generic
read/write result. Journal undo and box graph-value tools are not registered
CLI/HTTP tools in this inventory, so no invented command is counted.

## Boundaries and exclusions

Live browse benchmarks read only: non-GET/HEAD/OPTIONS traffic is refused.
Terminal, CLI writes, connector writes and platform pages use isolated graphs,
accounts and processes and delete their scratch data after each collection.
Platform waits use the production kernel with local bindings: they do not claim
to measure Cloudflare routing, cold Durable Objects, external OAuth or arbitrary
app JavaScript. Provider generation, payment checkout and deployment include
external waits and have their own tests/records; a local kernel number is not
those waits. Inbox is benchmarkable only when its view is loaded and offered; a
fallback detail page is never accepted as an Inbox measurement.

The half-hour monitor screens user-facing suites and confirms slower figures
with a three-run check. A check is bounded at ten minutes, so a hang itself is
reported rather than hiding later suites. The local moving best banks drops
without changing source baselines or allowing any slack.

The registered-door gaps above, external provider latency and remote Cloudflare
timings remain outside these isolated fixture measurements. Platform management
coverage is described by its own suite; CLI results do not stand in for it.
