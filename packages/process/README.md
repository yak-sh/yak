# @yaks/process

A running program as an entity, so whatever needs one can point at it instead of
keeping a pid of its own.

```sh
deno add jsr:@yaks/process
```

## The rows

`service{command, cwd, restart, attempts}` is a program that SHOULD be running.
Effects are data, so this row is the whole request — there is no start route and
no stop call. It rides the same entity its process lands on: one row is one
supervised thing, and reading it tells you what is wanted, what is running, how
the last attempt ended and how often it has flapped. `restart` is systemd's
three words, `never | on-failure | always`, and absent means never.

`process{pid, command, cwd}` is a program on a host. `pid` is the only column an
adopted process has, because a pid is the only handle a process nobody launched
gives you; `command` and `cwd` are present exactly when we started it.

`exit{code}` says it is over. Absent means running — which is the query a boot
reconcile makes. It is never rewritten; on a supervised row the batch that lands
the next attempt clears it, so nothing reads a fresh pid beside a stale ending.
An unsupervised process keeps its stamp, and a new run of it is a new entity.

Down is spelled `stop`, the bare mark [@yaks/session](../session) already has
for "nothing is performed after this", written on the service row itself. No
second entity to reap, no reference to type, and the row stays — the wanting is
recorded as over rather than forgotten.

Output is not a component of this package. A line a process wrote is
`content{body, source}` from [@yaks/session](../session), `source` naming the
process — the same word a tool result and a model's own words wear, so anything
that can read a transcript can read a log.

## Four entry points, one loop

```ts
import { adopt, launch, store, supervise, watch } from '@yaks/process'

let processes = store(graph)

// start one, detached
let run = await launch(processes, { command: 'sh', args: ['-c', 'echo hi'] })
await run.done // 0 — and 'hi' is a content entry naming run.eid

// track one nobody here started
await adopt(processes, 4242)

// at boot: pick every unfinished process back up
await watch(processes)

// then keep the wanted ones up, from your own tick
let pass = supervise(processes)
setInterval(pass, 2000)
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

Commands run with `bash -c`, inheriting the harness process environment
(including `PATH` and `HOME`). This is a non-login, non-interactive shell:
configure the environment when launching the harness, rather than relying on
interactive `.bashrc` setup. The lower-level `launch` API still uses only its
explicit `env`.

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

## Supervision

`supervise(store)` returns one reconcile PASS, for whatever tick a host already
has. Per service row: no process at all → launch it; an `exit` → respawn if
`restart` says so, after a backoff that doubles with `attempts` and stops at
`ceiling`; a `stop` → SIGTERM the process group, SIGKILL after the grace, and
never respawn; the row gone → take the process down too.

A process with no `exit` belongs to the WATCHER, never to the pass: `launch`'s
own follow and `watch` at boot are the one writer of that word, so the pass
reads an ending and never guesses one.

**Exactly one supervisor sits above this one, and it is not this one.** The pass
refuses a service whose command would start its own program — a supervisor that
respawns itself is a fork bomb with a restart policy, and its own death is the
one ending it cannot witness. `refuse` names anything else the host must not
run. Because the child outlives us, a bug here costs a restart, never a downed
service.

## The store

`Store` is three verbs: `apply` a batch, ask which processes are `running`, and
ask which `services` are wanted. `store(graph)` is the adapter over a
`@yaks/graph`, where those reads are the ordinary queries `.process&.exit=` and
`.service`. A host keeping its rows in a database of its own answers the same
three verbs with one statement each.
