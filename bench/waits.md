# Waiting-path inventory

A **waiting path** is an operation from a person's action to usable content or a
complete answer. The benchmark names below identify the boundary, not every
possible entity, query, account or third-party service.

| Surface / waiting path                                | Benchmark                                                                                    | Boundary                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| CLI startup/help                                      | `person-commands:cli/help`                                                                   | Spawn through complete output and exit                                           |
| CLI task list, graph show and graph query             | `person-commands:cli/*`                                                                      | Spawn through populated answer and exit over 2,000 tasks                         |
| CLI graph write                                       | `person-commands:cli/graph-apply`                                                            | Spawn through committed write and exit                                           |
| UserPromptSubmit hook                                 | `person-commands`                                                                            | Actual hook response over a one-MiB transcript, including process startup        |
| Box connector graph read/write                        | `person-commands`                                                                            | Actual MCP HTTP request through serialized answer / saved write                  |
| Platform management page                              | `platform-waits:management/html`                                                             | Original HTML response workloads and populated HTML for all ten management views |
| Platform app page                                     | `platform-waits:app/html`                                                                    | Complete HTML response over the isolated kernel                                  |
| Platform connector app/file list and graph read/write | `platform-waits:connector/*`                                                                 | Real connector HTTP request through populated answer / saved write               |
| Managed worker pressure                               | `worker-health:workers/cpu`                                                                  | CPU of all active worker cgroups, including threads and children                 |
| Browser local-cache update and rendering input        | `web-client`, `client-frame`, `client-rules`                                                 | Cache folds, frame/part reads, rule keystrokes                                   |
| Session status lookup                                 | `session-status`                                                                             | Identity and query lookup beside 2,700 calls                                     |
| Native session start, transcript, switch and stream   | `harness-startup`, `harness-switch`, `harness-window`, `harness-streaming`, `harness-worker` | Open/resume/mount/paint, streaming writes and event-loop delay                   |
| Graph storage and write throughput                    | `throughput`, `graph-activity`, `relay-admission`                                            | Seeded reads/writes/admission, SQL statements and recording overhead             |
| App and platform deployment                           | `app-deploy`, `deploy`                                                                       | Deployment timing records; platform deployment is measured where it runs         |
| Test/check commands                                   | `suite-*`                                                                                    | Command wall/control ratio, measured where commands run                          |

Chrome is removed from this box. The `pages`, `page-content` and `inbox-content`
suites and all Chrome paint measurements are removed. Page behavior runs in
process on a linkedom document in Deno; terminal paint uses @yaks/tui's `lay`.
No monitored suite starts a separate server process, so `operation-lifecycle`,
`terminal-interactions` and the tmux figures of `person-commands` are removed.
`box.ts` remains a manual investigation requiring a snapshot/config, outside the
unattended command regression monitor.

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

`hook-waits` measures the SessionStart, SubagentStart, SessionEnd and
PostToolUse HTTP handlers in process, without a listener or child process. These
figures exclude shell/curl transport and are checked against the older
installed-hook ceilings; they do not measure the same end-to-end boundary as
those baselines. Starts return held-work context, SessionEnd releases a claim, a
main-thread HTTP hook delivers and marks pending bus work, and a subagent HTTP
hook leaves that work pending. UserPromptSubmit remains measured by
`person-commands`. There is no installed Stop or PreCompact hook to time.

```sh
deno task bench operation-commands accept
deno task bench operation-scale check
deno task bench hook-waits check
```

These suites each have a half-hour monitor entry. The hourly shell dispatch
reads `HOURLY` from `monitor.ts`, so adding a suite there also schedules it
rather than leaving a second hard-coded list behind.

### Remaining local operation families

`operation-remaining` banks 28 additional families as 55 independent figures:
CLI and MCP design new/decide, effect retry/drop, claim/session check, session
context/brief/wrap, memory source/around/target/thread/session, hook
installation, persona sync, search, entity citation verify/check, connection
need/list, mail send/reply/show/check, visualize anatomy/activity; code sync is
CLI-only. Preparation and readback are outside the complete production response
clock. Three samples per collection, three rounds per run and three runs per
acceptance bank the best run with the noise the runs measured.

The fixture has 2,000 tasks, a real three-entry transcript, a comment thread, an
independent tracked two-file checkout, owned persona files and received mail.
Connection requests create credential-free custom integrations. Mail figures
measure queued requests and attention marks, not transport delivery. Duties are
disabled. CLI network permission is loopback-only. Activity captures observe
queries on the serving host; the native CLI reads that same host over HTTP.

```sh
deno run -A bench/run.ts operation-remaining accept
deno run -A bench/run.ts operation-remaining check
```

### Local controls and retained builders

`operation-controls` measures eight additional safe families (11 figures): CLI
and MCP retained-output choice, existing-artifact supply and builder planning;
CLI populated cache report, listener delivery, trace arming, init and land.
Builder planning writes calls with duties disabled; it does not run a model.
Supply reuses an existing artifact, and choice checks exclusive selection. Init
verifies the created person through a fresh CLI read. Land creates an
independent primary checkout and branch with no upstream or remote, then
verifies the exact base SHA and contents. Trace arming verifies its private
sidecar; it is not operation-capture latency. Listener delivery verifies the
pending item is marked. The suite has its own measured baseline.

```sh
deno run -A bench/run.ts operation-controls check
```

### Registered doors still outside these fixtures

`inventory(config?)` in `operation-commands.ts` lists declared tools, CLI doors,
HTTP-eligible declarations and measured operation names without opening a graph.
The configured box has 96 CLI doors (including `trace`) and 82 declared tools.
HTTP tools/list is also checked by collection; declaration is not visibility.

```sh
deno eval 'import { inventory } from "./bench/operation-commands.ts"; import { read } from "./packages/cli/config.ts"; console.log(JSON.stringify(await inventory(read(Deno.env.get("HOME") + "/.yak/yak.json")), null, 2))'
```

## Isolated lifecycle and diagnostic acceptance

`operation-sessions` banks twelve independent production-door figures: CLI
list/new/peek/send/spawn/stop/wait and HTTP MCP list/peek/spawn/stop/wait. A
private SQLite graph and a deterministic local model complete real native turns
through the production effects runner. Transcript readback proves replies, spawn
claims and stopped/idle transitions. Stop starts with a held active turn; wait
races actual local completion. New/send are declared CLI-only, not imaginary
HTTP doors. These are local lifecycle waits, not remote generation latency.

`operation-diagnostics` banks CLI model-list local catalogue handling plus
CLI/HTTP session-home saved workspace changes and CLI/HTTP vector-check over a
built native index containing 2,001 offline hash vectors. Model listing crosses
the actual CLI parser/runner and owned loopback HTTP catalogue; the only
external URL is redirected before transport. Dummy local authentication never
represents real credentials or OpenAI latency. Vector-check verifies the
populated native index, not an empty or waiting check.

`operation-checkout` banks CLI file-citation verify/check and three separate
HTTP cwd-refusal figures. Successful file verification reads the owned
checkout's commit and saves its revision. MCP code-sync, land and file-citation
verification lack `process.cwd` in the production fallback runner. Their refusal
figures measure that real boundary; **successful MCP completion remains
unavailable**. No handler is called directly and no process provenance is
manufactured. Entity citations and private CLI land remain covered by their
existing suites.

All four suites bank best-of-three runs, three round medians per run, three
samples per round, with tolerance zero. All are registered in `SUITES` and
`HOURLY`, under the persistent scheduler's 25-minute window. The installed cron
invokes that lane every 30 minutes; a collection that fails twice running
reports a failure. Existing baseline, budget and floor records are not raised or
reaccepted.

### Explicit dependencies, not successful local coverage

- The seventeen external admin doors require the appropriate administrator
  account and service availability; no admin credential or live mutation is
  used.
- Real OpenAI catalogue authentication, provider generation and remote session
  completion require an independently authorized provider run. The local model
  and catalogue fixtures prove local handling only.
- Managed process-transport session spawn/stop/wait require exclusively owned
  managed runs; native fixture sessions do not stand in for those runs. No
  existing managed run is reaped. MCP conversation start/send are separate
  variants, not the CLI-only session new/send declarations.
- OAuth completion, SMTP delivery, upstream pushes, deployment/payment and
  provider builder execution depend on external credentials/services/authorized
  spending. Local planning, stash mail and retained artifacts do not prove them.
- Successful MCP code-sync/land/file-citation verification depend on a genuine
  checkout-bound runner capability. Current production HTTP doors refuse them.
- Live owner-service handover and live owner-graph mutation are deliberately not
  executed; private lifecycle readiness is measured instead.

## Boundaries and exclusions

Terminal, CLI writes, connector writes and platform pages use isolated graphs,
accounts and processes and delete their scratch data after each collection.
Platform waits use the production kernel with local bindings: they do not claim
to measure Cloudflare routing, cold Durable Objects, external OAuth or arbitrary
app JavaScript. Provider generation, payment checkout and deployment include
external waits and have their own tests/records; a local kernel number is not
those waits.

The half-hour monitor screens user-facing suites and judges a screen past its
limit by measuring the code beside the code its baseline was banked at
([README](README.md#the-monitor)). A check is bounded at ten minutes, so a hang
cannot hide later suites; a run past that cap tells nothing and reports nothing.

The registered-door gaps above, external provider latency and remote Cloudflare
timings remain outside these isolated fixture measurements. Platform management
coverage is described by its own suite; CLI results do not stand in for it.

## Platform management and submissions

`platform-waits` runs the production kernel, directory, connector and page
renderers over local Durable Object, R2, mail and vault bindings. All ten
management views (`/manage`, `/manage/people`, `/manage/connect`,
`/manage/connections`, `/manage/new`, `/manage/visits`, `/manage/selling`,
`/manage/settings`, `/manage/billing`, `/manage/trash`) have populated HTML
measurements. A shell, empty list, refusal or sign-in page does not meet the
fixture predicates. The six original HTML measurements and their records remain
separate.

Submission waits include the complete response and saved-state readback:

| Door                                 | Operations banked                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `POST /manage/settings`              | Save name; rename a space                                                                          |
| `POST /manage/trash`                 | Restore a genuinely trashed app                                                                    |
| `POST /manage/people`                | Resend a pending invitation through another local mail delivery                                    |
| `POST /manage/connections`           | Add key, replace key, disconnect, attach to an app, open/close sharing, begin service OAuth        |
| `POST /deploy` on the space hostname | Multipart new app and existing app update through deployed marker content                          |
| `POST /manage/selling`               | Start onboarding through a stored local account and hosted redirect; disconnect a connected seller |
| `POST /manage/billing`               | Checkout and portal through exact locally returned hosted URLs and stored customer                 |
| `POST /oauth/agents/disconnect`      | Remove the selected agent while retaining another agent's grant                                    |

Preparation and resets run outside each timed submission. Each HTTP operation
has seven samples per collection. Three collections make a round-median run;
acceptance banks the best of three runs with the noise they measured. Existing
records can only fall. The unchanged suite workload key identifies the retained
app/connector/original HTML fixture; added metric names identify the separate
populated fixture.

Global fetch permits loopback and only exact authenticated local Stripe
responses and an explicitly named local analytics response. Every other external
request fails collection, including a caught attempt. Dummy credentials and a
private D1 vault are created for this process; no account keys, deployed writes
or payments are used. Stripe redirects and service OAuth authorization URLs are
inspected, never followed. Analytics answers are local fixture data. These
numbers are local kernel/form/render waits, **not Cloudflare, Stripe or OAuth
provider latency**.

The streaming builder at `/api/build`, service OAuth completion, hosted
checkout, login/mail-code forms and destructive account/space confirmation pages
are outside these management operation families. Provider generation and
external payment completion are not replaced by a fast local response. The daily
and half-hour monitor include `platform-waits` through shared `HOURLY`; a
side-by-side slowdown or a collection that fails twice running files a tracker
bug. A long throughput lane cannot delay it.
