# Waiting-path inventory

A **waiting path** is an operation from a person's action to usable content or a
complete answer. The benchmark names below identify the boundary, not every
possible entity, query, account or third-party service.

| Surface / waiting path                                | Benchmark                                                                                    | Boundary                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Browse home and task detail                           | `pages`                                                                                      | Cold and warm navigation to populated home / task title                          |
| Session list and long session transcript              | `page-content`                                                                               | Cold and warm navigation to session list / actual transcript content             |
| Project task list                                     | `page-content`                                                                               | Navigation to populated list, not project heading                                |
| Query and map                                         | `page-content`                                                                               | Navigation to returned rows / populated map                                      |
| Package, component and property inspector             | `page-content`                                                                               | Navigation to the appropriate schema content                                     |
| Platform anatomy                                      | `page-content`                                                                               | Navigation to populated anatomy list                                             |
| CLI startup/help                                      | `person-commands:cli/help`                                                                   | Spawn through complete output and exit                                           |
| CLI task list, graph show and graph query             | `person-commands:cli/*`                                                                      | Spawn through populated answer and exit over 2,000 tasks                         |
| CLI graph write                                       | `person-commands:cli/graph-apply`                                                            | Spawn through committed write and exit                                           |
| UserPromptSubmit hook                                 | `person-commands`                                                                            | Actual hook response over a one-MiB transcript, including process startup        |
| Box connector graph read/write                        | `person-commands`                                                                            | Actual MCP HTTP request through serialized answer / saved write                  |
| Terminal startup and query navigation                 | `person-commands`                                                                            | CLI startup to terminal content; query keypress to returned content              |
| Platform management page                              | `platform-waits:management/html`                                                             | Production kernel HTTP through complete HTML (secondary pages assert shell only) |
| Platform app page                                     | `platform-waits:app/html`, `app/paint-cold`, `app/paint-warm`                                | Complete HTML and Chrome content paint over the isolated kernel                  |
| Platform connector app/file list and graph read/write | `platform-waits:connector/*`                                                                 | Real connector HTTP request through populated answer / saved write               |
| Managed worker pressure                               | `worker-health:workers/cpu`                                                                  | CPU of all active worker cgroups, including threads and children                 |
| Browser local-cache update and rendering input        | `web-client`, `client-frame`, `client-rules`                                                 | Cache folds, frame/part reads, rule keystrokes                                   |
| Session status lookup                                 | `session-status`                                                                             | Identity and query lookup beside 2,700 calls                                     |
| Native session start, transcript, switch and stream   | `harness-startup`, `harness-switch`, `harness-window`, `harness-streaming`, `harness-worker` | Open/resume/mount/paint, streaming writes and event-loop delay                   |
| Graph storage and write throughput                    | `throughput`, `graph-activity`, `relay-admission`                                            | Seeded reads/writes/admission, SQL statements and recording overhead             |
| App and platform deployment                           | `app-deploy`, `deploy`                                                                       | Deployment timing records; platform deployment is measured where it runs         |
| Test/check commands                                   | `suite-*`                                                                                    | Command wall/control ratio, measured where commands run                          |

The home/task titles and package microbenchmarks do not stand in for a loaded
session, terminal paint, command startup, a connector round trip or app paint.
Each has its own measurement. `box.ts` is a manual investigation requiring a
snapshot/config; it is not the unattended command regression monitor.

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

Specialized CLI commands and connector tools, terminal editing, Inbox (not
offered by the running host), and platform people/new/visits/selling pages are
not individually banked. The common-path benchmarks do not claim to cover those
operations. Large live-graph command scale, external provider latency and remote
Cloudflare timings are outside the isolated fixture measurements.
