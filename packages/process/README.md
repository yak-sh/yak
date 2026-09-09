# @yaks/process

A running program as an entity, so whatever needs one can point at it instead of
keeping a pid of its own.

```sh
deno add jsr:@yaks/process
```

## The rows

`process{pid, command, cwd}` is a program on a host. `pid` is the only column an
adopted process has, because a pid is the only handle a process nobody launched
gives you; `command` and `cwd` are present exactly when we started it.

`exit{code}` says it is over. Absent means running — which is the query a boot
reconcile makes. Stamping it is a one-way door: a row that has exited is
history, and a new run is a new entity.

Output is not a component of this package. A line a process wrote is
`content{body, source}` from [@yaks/session](../session), `source` naming the
process — the same word a tool result and a model's own words wear, so anything
that can read a transcript can read a log.

## Three entry points, one loop

```ts
import { adopt, launch, store, watch } from '@yaks/process'

let processes = store(graph)

// start one, detached
let run = await launch(processes, { command: 'sh', args: ['-c', 'echo hi'] })
await run.done // 0 — and 'hi' is a content entry naming run.eid

// track one nobody here started
await adopt(processes, 4242)

// at boot: pick every unfinished process back up
await watch(processes)
```

`launch` spawns through a launcher that exits at birth, a `setsid` wrapper, and
`systemd-run --user --scope`. Two escapes, for one reason: the supervisor must
be restartable without taking its processes with it. A watcher that kills
tracked pids finds only the dead launcher; a unit restart mass-kills the
supervisor's cgroup and the wrapper is not in it. The wrapper writes `"$$ $!"`
to a pidfile and the exit code to a code file when the child goes, so the run
can be adopted back with nothing held in memory. Nothing here reaps.

That makes the launcher Linux-shaped on purpose. A host without `setsid` and a
user manager wants a different launcher, not a weaker one.

## The shell, as a session's tools

`shellTools(graph)` is three tools for a [@yaks/session](../session) daemon —
`shell`, `wait`, `stop` — over these same rows.

```ts
import { shellTools } from '@yaks/process'

let tools = [...shellTools(graph), ...mine]

// shell { command: 'deno task dev', timeout: 2000 }
//   -> 'process 7f3… still running (pid 4242) after 2000ms — wait or stop it
//       by that id'
// wait  { process: '7f3…', timeout: 60000 }  -> its code and the tail of it
// stop  { process: '7f3…' }                  -> SIGTERM, SIGKILL, its exit
```

Every command is a tracked process from the first moment; the budget only
decides whether the answer is the output or the id. A call that blocked until
`deno task dev` exits would wedge the session, and one that killed the child at
the budget could only ever run short commands — handing back the entity does
neither. The child keeps running, its lines keep arriving as `content`, and the
operator reading the graph sees the same process the session started.

`wait` and `stop` read the ending off the graph rather than a handle held in
memory, so a process launched before a restart answers exactly like one launched
a moment ago: `watch()` re-adopts it and stamps the ending on the row they poll.

## The store

`Store` is two verbs: `apply` a batch, and ask which processes are `running`.
`store(graph)` is the adapter over a `@yaks/graph`, where `running` is the
ordinary query `.process&.exit=`. A host keeping its rows in a database of its
own answers the same two verbs with one statement each.
