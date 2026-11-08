# Waiting-path inventory

A **waiting path** is an operation from a person's action to usable content or a
complete answer. The benchmark names below identify the boundary, not every
possible entity, query, account or third-party service.

| Surface / waiting path                              | Benchmark                                                                                    | Boundary                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| CLI startup/help                                    | `person-commands:cli/help`                                                                   | Spawn through complete output and exit                                    |
| CLI task list, graph show and graph query           | `person-commands:cli/*`                                                                      | Spawn through populated answer and exit over 2,000 tasks                  |
| CLI graph write                                     | `person-commands:cli/graph-apply`                                                            | Spawn through committed write and exit                                    |
| UserPromptSubmit hook                               | `person-commands`                                                                            | Actual hook response over a one-MiB transcript, including process startup |
| Box connector graph read/write                      | `person-commands`                                                                            | Actual MCP HTTP request through serialized answer / saved write           |
| Managed worker pressure                             | `worker-health:workers/cpu`                                                                  | CPU of all active worker cgroups, including threads and children          |
| Browser local-cache update and rendering input      | `web-client`, `client-frame`, `client-rules`                                                 | Cache folds, frame/part reads, rule keystrokes                            |
| Session status lookup                               | `session-status`                                                                             | Identity and query lookup beside 2,700 calls                              |
| Native session start, transcript, switch and stream | `harness-startup`, `harness-switch`, `harness-window`, `harness-streaming`, `harness-worker` | Open/resume/mount/paint, streaming writes and event-loop delay            |
| Graph storage and write throughput                  | `throughput`, `graph-activity`, `relay-admission`                                            | Seeded reads/writes/admission, SQL statements and recording overhead      |
| App and platform deployment                         | `app-deploy`, `deploy`                                                                       | Deployment timing records; platform deployment is measured where it runs  |
| Test/check commands                                 | `suite-*`                                                                                    | Command wall/control ratio, measured where commands run                   |

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

`hook-waits` measures the SessionStart, SubagentStart, SessionEnd and
PostToolUse HTTP handlers in process, without a listener or child process. These
figures exclude shell/curl transport and are checked against the older
installed-hook ceilings; they do not measure the same end-to-end boundary as
those baselines. Starts return held-work context, SessionEnd releases a claim, a
main-thread HTTP hook delivers and marks pending bus work, and a subagent HTTP
hook leaves that work pending. UserPromptSubmit remains measured by
`person-commands`. There is no installed Stop or PreCompact hook to time.

```sh
deno run -A bench/run.ts accept operation-commands
deno run -A bench/run.ts check hook-waits
```

These suites each have a half-hour monitor entry. The hourly shell dispatch
reads `HOURLY` from `monitor.ts`, so adding a suite there also schedules it
rather than leaving a second hard-coded list behind.

### Registered doors still outside these fixtures

`inventory(config?)` in `operation-commands.ts` lists declared tools, CLI doors,
HTTP-eligible declarations and measured operation names without opening a graph.
The configured box has 96 CLI doors (including `trace`) and 82 declared tools.
HTTP tools/list is also checked by collection; declaration is not visibility.

```sh
deno eval 'import { inventory } from "./bench/operation-commands.ts"; import { read } from "./packages/cli/config.ts"; console.log(JSON.stringify(await inventory(read(Deno.env.get("HOME") + "/.yak/yak.json")), null, 2))'
```

## Isolated lifecycle acceptance

The lifecycle suites bank best-of-three runs, three round medians per run, three
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
