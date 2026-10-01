# @yaks/process

`@yaks/process` starts, adopts, monitors, stops, and supervises operating-system
processes while recording their state in a graph.

```sh
deno add jsr:@yaks/process
```

## Stored components

<a id="the-components"></a>

A **bundle** is one entity's components as a JSON object. This package defines:

| Component                                  | Meaning                        |
| ------------------------------------------ | ------------------------------ |
| `service{command, cwd, restart, attempts}` | a program that should run      |
| `process{pid, command, cwd}`               | a tracked running process      |
| `runtime{name, version, os}`               | what a process of ours runs on |
| `exit{code}`                               | the observed end of a process  |

A process that opens a graph writes its own row when it starts (`started()`),
with `runtime` beside `process`: `deno`, its version, and the operating system
and its release (`linux 6.8.0-45-generic`).

An adopted process may contain only `pid`; `command` and `cwd` are recorded for
processes launched by this package. A missing `exit` means the process is still
considered active. On a supervised entity, starting the next attempt removes the
previous `exit` in the same transaction. An unsupervised process retains its
`exit`; launching it again creates a new entity.

`service.restart` accepts `never`, `on-failure`, or `always`, and defaults to
`never`. To stop a service, add the `stop` marker from `@yaks/session` to the
same entity.

The graph stores process state, never output. What a process prints stays in its
stdout and stderr files: `tail(eid, n)` reads their last lines, and `clean(eid)`
removes a finished run's files once its reader is done with them, and
`sweep(age)` cleans every run that ended longer ago than that. A service's
output files are its log, appended to across attempts. Supervisor files are
stored under `opts.dir`, then `$PROCESS_DIR`, then `$TASKS_HOME/processes`, then
`~/.tasks/processes`. For tests, set `TASKS_HOME` instead of changing `HOME` so
Deno can reuse its module cache. This changes supervisor file locations, not the
child environment.

## Launching and adopting processes

<a id="the-process-you-are-in"></a>
<a id="four-entry-points-one-loop"></a>

Given an application graph loaded with the process vocabulary (the example
starts a process under systemd, so it is not run as a test):

```ts ignore
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
`vanished()` finds the rows without an `exit` whose pid is gone from this
machine and that this package did not launch: a process that ended without
writing its own ending, for whoever cleans up after it. `gone()` asks whether
one process is over: its row records an `exit`, or it is among the vanished.
`launch()` passes only the environment supplied in its specification.

Launched processes run through a short-lived launcher and a wrapper in a session
and process group of its own. The wrapper writes a pidfile and an exit-code
file; the launch writes a start file. The pidfile contains the wrapper's
process-group ID and the child's PID. Monitoring uses signals and the files
because the tracked program is not a direct child; this package does not call
`waitpid` or reap children. This allows a child to outlive the process that
opened the graph and be monitored again after restart.

Only the detaching differs by operating system:

| OS    | Detached by                                         | Needs                              |
| ----- | --------------------------------------------------- | ---------------------------------- |
| Linux | `systemd-run --user --scope`, then `setsid`         | util-linux, a systemd user manager |
| macOS | perl's `setsid()`; launchd stops only a job's group | `/usr/bin/perl`                    |

Any other OS is refused at launch. `opts.os` picks another OS's launcher, which
is how a Linux machine tests the macOS one.

The process that opens a graph is the **host**. `started()` returns the bundle
that records the host's process entity, `ended()` records its exit, and
`selfEid()` returns the stable in-memory entity ID for that host run. The host
can sign writes with this entity, so `created.by` identifies the specific
program run that wrote a row. A host's row also says which roles it serves
(`process.roles`, from @yaks/cli `compose`): `graph`, `web`, `effects`, or a
plugin's service by its name.

A Worker thread that opens a graph is a host of its own, with its own row in the
pid it runs in. The pid lives on after the thread, so its `exit` is what
`gone()` reads: a process that ends its thread where it stands names it first
with `become(eid)`, and writes that `exit` for it.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { ended, processDoc, processes, started } from '@yaks/process'

let vocab = loadVocab([processDoc])
let g = graph({ storage: ram(vocab), vocab, plugins: [processes()] })

await g.apply([started()])
// on shutdown:
await g.apply([ended(0)])
```

## Supervision

`supervise(store, options)` returns one reconciliation pass. Call it from the
host's timer: `setInterval(supervise(store(graph)), 2000)`.

Each pass starts services without a process, restarts eligible exited services
with exponential backoff capped by the configured `ceiling`, stops entities
marked `stop`, and stops processes whose service entity was deleted. Monitoring
code writes `exit`; the supervisor does not infer an exit from missing in-memory
state. The `refuse` option prevents specified commands from being supervised and
always refuses the supervisor's own command.

`Store` is the minimal persistence interface used by launch and supervision:
`apply()` writes a **batch** (a list of changes committed in one transaction),
`get()` reads given rows, `running()` reads processes without an exit, and
`services()` reads service entities. `store(graph)` implements it with graph
reads.

## Exports

<a id="the-store"></a>

The main module exports:

- vocabulary: `processDoc`, `SERVICE`, `PROCESS`, `EXIT`, and their TypeScript
  types;
- host identity: `selfEid()`, `become()`, `started()`, and `ended()`;
- storage: `Store`, `store()`, `RUNNING`, and `SERVICES`;
- graph integration: `processes()`;
- process operations: `dirOf()`, `paths()`, `clean()`, `launch()`, `adopt()`,
  `watch()`, `vanished()`, `gone()`, `signal()`, and `supervise()`.

Additional entry points are `@yaks/process/vocab`, `@yaks/process/rules` and
`@yaks/process/wind`.

## Winding down

`@yaks/process/wind` is how a process ends when it is asked to. An interrupt is
a signal (`listen()` hears SIGTERM, SIGINT and SIGHUP) or a Ctrl-C typed into a
raw terminal. Whatever keeps the process open calls
`wind.hold({ drain, force })`. The first interrupt asks every hold to drain,
with no deadline; a second forces them. `wind.done` settles with the interrupt's
code once every hold has answered. There is one `wind` per process; `winding()`
makes another for a test.
