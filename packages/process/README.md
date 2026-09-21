# @yaks/process

Starts, tracks and supervises operating-system processes, recording each one as
a graph entity. The graph holds the pids, the configuration for a program that
should be running, the output, and the exit codes; the code in this package
makes the operating-system calls.

```sh
deno add jsr:@yaks/process
```

Throughout this README, "the server" means whichever process opened the graph
and loaded this package — usually a long-running `yak serve`, sometimes just the
CLI.

## The components

`service{command, cwd, restart, attempts}` describes a program that should be
running. There is no HTTP endpoint that starts a program and no stop call:
inserting this component is the whole request, and the supervisor acts on it. It
is stored on the same entity as the `process` component, so one entity is one
supervised program, and reading that entity tells you what is wanted, what is
running, how the last attempt ended and how often it has crashed and been
restarted. `restart` takes systemd's three values, `never`, `on-failure` and
`always`; leaving it out means `never`.

`process{pid, command, cwd}` describes a program running on this machine. `pid`
is the only column an adopted process has, because a pid is the only handle you
get on a process nobody here started. `command` and `cwd` are present exactly
when this package launched it.

`exit{code}` records that the process is over. No `exit` component means it is
still running, which is the query the server makes when it starts up. `exit` is
never rewritten: on a supervised entity, the transaction that records the next
attempt deletes it, so nothing ever reads a fresh pid beside a stale exit code.
An unsupervised process keeps its `exit` forever, and running the program again
creates a new entity.

To stop a service, write a `stop` component on the service entity. `stop` is the
bare marker [@yaks/session](../session) already defines for "nothing happens
after this". Putting it on the service entity itself means there is no second
entity to clean up and no reference to fill in, and the service entity stays
where it was: the fact that the program was once wanted is recorded as over
rather than deleted.

## The process you are in

The program doing the launching is a process too. `started()` returns the
components a process writes about ITSELF when it opens a graph, and
`ended(code)` the ones it writes on the way out. `selfEid()` is the entity both
land on, minted once per process.

```ts
import { ended, selfEid, started } from '@yaks/process'

await graph.apply([started()]) // …and, at the end:
await graph.apply([ended(0)])
```

Two things follow from that entity, and they are why it is worth writing.

The server signs its writes with it ([@yaks/cli](../cli)), so `created.by` on
any row names which run of which program wrote it, and a child process's row —
written by its parent — identifies its parent without needing a column for it.

A process starting is also an event. `created(process)` where the entity is the
server's own is the moment the server picks up what a restart left behind, which
is why these packages have no separate start-up hook: start-up work is an
ordinary post-commit effect handler.

Output is not a component of this package. A line a process printed is
`content{body}` plus `output{source}` from [@yaks/session](../session), where
`source` names the process entity. Those are the same components a tool result
and a model's own text use, so anything that can read a transcript can read a
process log.

The per-run files live in `opts.dir`, then `$PROCESS_DIR`, then
`$TASKS_HOME/processes`, then `~/.tasks/processes`, in that order of precedence.
When running a test or a probe, set `TASKS_HOME` rather than redirecting `HOME`,
so Deno's module cache stays shared. That setting moves the supervisor's own
files; it does not change the environment a child process is given.

## Four entry points, one loop

```ts
import { adopt, launch, store, supervise, watch } from '@yaks/process'

let processes = store(graph)

// start one, detached
let run = await launch(processes, { command: 'sh', args: ['-c', 'echo hi'] })
await run.done // 0 — and 'hi' is a content entry naming run.eid

// track one nobody here started
await adopt(processes, 4242)

// at start-up: pick every process with no exit code back up
await watch(processes)

// then keep the wanted ones running, from your own timer
let pass = supervise(processes)
setInterval(pass, 2000)
```

`launch` starts the child through a launcher process that exits immediately, a
`setsid` wrapper, and `systemd-run --user --scope`. Two layers, for one reason:
the server must be restartable without killing the processes it started. A
supervisor that kills the pids it tracks finds only the dead launcher, and
restarting the server's systemd unit kills that unit's cgroup, which the wrapper
is not in. The wrapper writes `"$$ $!"` — its own pid and the child's — to a
pidfile, and writes the child's exit code to a second file when the child ends,
so a run can be adopted back with nothing held in memory. Nothing in this
package calls waitpid or reaps child processes.

That makes the launcher Linux-specific on purpose. A machine without `setsid`
and a systemd user manager needs a different launcher, not a weaker one.

## The shell, as a session's tools

`shellTools(graph)` returns three tools — `shell`, `wait` and `stop` — for a
model running in a [@yaks/session](../session) loop, all working over the
components above.

Commands run under `bash -c` and inherit the server's environment, `PATH` and
`HOME` included. That is a non-interactive, non-login shell, so set up the
environment where the server is started rather than relying on an interactive
`.bashrc`. The lower-level `launch` function does not do this: it passes only
the `env` it was given.

```ts
import { shellTools } from '@yaks/process'

let tools = [...shellTools(graph), ...mine]

// shell { command: 'deno task dev', timeout: 2000 }
//   -> 'process 7f3… still running (pid 4242) after 2000ms — wait or stop it
//       by that id'
// wait  { process: '7f3…', timeout: 60000 }  -> its exit code and last lines
// stop  { process: '7f3…' }                  -> SIGTERM, SIGKILL, its exit code
```

Every command is a tracked process from the first moment; the timeout only
decides whether the tool returns the output or the entity id. A tool call that
blocked until `deno task dev` exits would hang the session, and one that killed
the child when the timeout passed could only ever run short commands. Returning
the entity does neither: the child keeps running, its lines keep arriving as
`content` rows, and an operator reading the graph sees the same process the
session started.

These three tools write to the graph themselves rather than returning rows for
the session's tool runner to commit: `shell` calls `launch`, which inserts the
`process` row as part of starting the child.

`wait` and `stop` read the exit code from the graph rather than from a handle
held in memory, so a process started before a server restart behaves exactly
like one started a moment ago: `watch()` adopts it again and writes the exit
code to the same row these tools poll.

## Supervision

`supervise(store)` returns one reconciliation pass, to be called from whatever
timer the server already runs. For each service entity: no `process` at all,
start it; an `exit`, start it again if `restart` calls for it, after a backoff
that doubles with `attempts` and stops at `ceiling`; a `stop`, send SIGTERM to
the process group, SIGKILL after the grace period, and never start it again; the
service entity deleted, shut the process down too.

A process with no `exit` belongs to the code watching it, never to the pass:
`launch`'s own follow loop and `watch` at start-up are the only writers of
`exit`, so the pass reads an exit code and never infers one.

**Exactly one supervisor sits above this one, and it is not this one.** The pass
refuses a service whose command would start the supervisor's own program: a
supervisor that restarts itself is a fork bomb with a restart policy, and its
own exit is the one it cannot observe. The `refuse` option names anything else
the server must not run. Because every child outlives the server, a bug here
costs a restart, never a service left down.

## The store

`Store` has three methods: `apply` a list of bundles in one transaction, ask
which processes are `running`, and ask which `services` are wanted.
`store(graph)` is the adapter over a [@yaks/graph](../graph), where those two
reads are the ordinary queries `.process&.exit=` and `.service`. A server
keeping these rows in a database of its own implements the same three methods
with one statement each.
