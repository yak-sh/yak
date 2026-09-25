# @yaks/process

`@yaks/process` starts, adopts, monitors, stops, and supervises operating-system
processes while recording their state in a graph.

```sh
deno add jsr:@yaks/process
```

## Stored components

<a id="the-components"></a>

A **bundle** is one entity's components as a JSON object. This package defines:

| Component                                  | Meaning                       |
| ------------------------------------------ | ----------------------------- |
| `service{command, cwd, restart, attempts}` | a program that should run     |
| `process{pid, command, cwd}`               | a tracked running process     |
| `exit{code}`                               | the observed end of a process |

An adopted process may contain only `pid`; `command` and `cwd` are recorded for
processes launched by this package. A missing `exit` means the process is still
considered active. On a supervised entity, starting the next attempt removes the
previous `exit` in the same transaction. An unsupervised process retains its
`exit`; launching it again creates a new entity.

`service.restart` accepts `never`, `on-failure`, or `always`, and defaults to
`never`. To stop a service, add the `stop` marker from `@yaks/session` to the
same entity.

Process output uses `content{body}` and `output{source}` from `@yaks/session`,
where `source` is the process entity. The graph stores process state and output.
Supervisor files are stored under `opts.dir`, then `$PROCESS_DIR`, then
`$TASKS_HOME/processes`, then `~/.tasks/processes`. For tests, set `TASKS_HOME`
instead of changing `HOME` so Deno can reuse its module cache. This changes
supervisor file locations, not the child environment.

## Launching and adopting processes

<a id="the-process-you-are-in"></a>
<a id="four-entry-points-one-loop"></a>

Given an application graph loaded with the process and output vocabulary:

```ts
import { adopt, launch, store, watch } from '@yaks/process'

const processes = store(graph)
const run = await launch(processes, {
  command: 'sh',
  args: ['-c', 'echo hi'],
})
const code = await run.done

// Replace 4242 with the PID of an existing process to monitor.
await adopt(processes, 4242)
await watch(processes)
```

`launch()` records the process, writes stdout and stderr to files, and returns
`{ eid, pid, done }`. `adopt()` monitors a process that this package did not
start. `watch()` resumes monitoring every stored process without an `exit`.
`launch()` passes only the environment supplied in its specification.

Launched processes run through a short-lived launcher and a `setsid` wrapper in
a `systemd-run --user --scope` unit. The wrapper writes pid, exit-code, start,
and end files. Its pidfile contains the wrapper's process-group ID and the
child's PID. Monitoring uses signals and the files because the tracked program
is not a direct child; this package does not call `waitpid` or reap children.
This allows a child to outlive the process that opened the graph and be
monitored again after restart. The implementation requires Linux, `setsid`, and
a systemd user manager.

The process that opens a graph is the **host**. `started()` returns the bundle
that records the host's process entity, `ended()` records its exit, and
`selfEid()` returns the stable in-memory entity ID for that host run. The host
can sign writes with this entity, so `created.by` identifies the specific
program run that wrote a row. A `created(process)` event for the host also gives
effects a normal post-commit event on which to perform startup recovery.

```ts
import { ended, started } from '@yaks/process'

await graph.apply([started()])
// on shutdown:
await graph.apply([ended(0)])
```

## Supervision

`supervise(store, options)` returns one reconciliation pass. Call it from the
host's timer:

```ts
import { store, supervise } from '@yaks/process'

const pass = supervise(store(graph))
setInterval(pass, 2000)
```

Each pass starts services without a process, restarts eligible exited services
with exponential backoff capped by the configured `ceiling`, stops entities
marked `stop`, and stops processes whose service entity was deleted. Monitoring
code writes `exit`; the supervisor does not infer an exit from missing in-memory
state. The `refuse` option prevents specified commands from being supervised and
always refuses the supervisor's own command.

`Store` is the minimal persistence interface used by launch and supervision:
`apply()` writes a **batch** (a list of changes committed in one transaction),
`running()` reads processes without an exit, and `services()` reads service
entities. `store(graph)` implements it with graph queries.

## Exports

<a id="the-store"></a>

The main module exports:

- vocabulary: `processDoc`, `SERVICE`, `PROCESS`, `EXIT`, and their TypeScript
  types;
- host identity: `selfEid()`, `started()`, and `ended()`;
- storage: `Store`, `store()`, `RUNNING`, and `SERVICES`;
- graph integration: `processes()`;
- process operations: `dirOf()`, `paths()`, `launch()`, `adopt()`, `watch()`,
  `signal()`, and `supervise()`.

Additional entry points are `@yaks/process/vocab` and `@yaks/process/rules`.
