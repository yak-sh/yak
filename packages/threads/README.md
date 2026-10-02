# @yaks/threads

A Deno or browser Worker serving a graph's roles: the ordinary effects pool, a
leased service, or both. The graph either has storage the thread can open itself
(SQLite on the box), or stays in its owning thread and is served over a
MessagePort (a page's RAM graph). The package declares no vocabulary.

`thread(module)` creates a lazy thread. `plan({roles, data, graph?})` gives it
roles and cloneable configuration. `duties(signal)` starts it and keeps serving
until the signal aborts; an already aborted signal requests one pass. `nudge()`
wakes its effect pool. Overlapping `duties()` calls are refused; a completed
pass can be followed by live work. `close()` stops new work, waits for in-flight
effects and services, closes the graph, and terminates the Worker. `end()`
terminates it immediately and rejects outstanding calls; the owning application
records any ending and releases abandoned claims where it can.

## Opening a thread

The module URL handed to `thread` exports `open(start)`. It receives `me` (a
fresh entity ID), `roles`, the configured `data`, and a `port` if the plan named
a graph. Its return value has `duties`, `nudge`, `stop`, and `close`. Keep
composition and runtime-specific connections in this module. CLI's
[`duties.ts`](../cli/duties.ts) opens its SQLite connection this way.

For a graph that stays in the page, the opening module loads its vocabulary and
obtains authoritative graph access with `remote(port, vocab)`:

```ts ignore
import { effects } from '@yaks/effects'
import { remote, roles, type Start } from '@yaks/threads'
import { handlers, vocab } from './domain.ts'

export let open = async ({ me, roles: mine, port }: Start) => {
  if (!port) throw new Error('this thread needs the owning graph')
  let graph = remote(port, vocab)
  await graph.apply([{ entity: { eid: me } }])
  let fx = effects(vocab, {
    owner: me,
    write: (batch) => graph.apply(batch, { trusted: true }),
  })
  fx.handle(handlers)
  return roles(graph, {
    me,
    roles: mine,
    fx,
    close: () => {
      graph.close()
      port.close()
    },
  })
}
```

The owning page supplies that graph:

```ts ignore
import { thread } from '@yaks/threads'

let aside = thread(new URL('./domain-thread.js', import.meta.url))
aside.plan({ roles: ['effects'], data: {}, graph: pageGraph })
let stop = new AbortController()
let serving = aside.duties(stop.signal)
// Later:
stop.abort()
await serving
await aside.close()
```

`roles(graph, options)` works `fx` for the `effects` role and takes each named
`services` callback under the existing @yaks/effects lease. `me` must identify
an entity in the owning graph before taking a service lease. `hold`, `gone`,
`report`, and `close` customize lease ownership, failures, and graph cleanup.
All requested roles must have code. The signal stops claims and asks services to
stop; closing waits for the effects and services already started.

## Graph access over a port

`serve(port, graph)` and `remote(port, vocab)` use @yaks/sync `portLink`.
`remote` supplies @yaks/graph `Access`: `read`, `rows`, `get`, `apply`, `vocab`,
and `outside` detached handler reads, including pattern bindings. Write options
are `WriteOpts` data; graph-local trace and deferred-effect callbacks stay with
the owning graph. Reads ask the owning graph every time. Writes await its
complete `apply()` result, so its admission, preconditions, rules, stamps, and
effect accounting run there once. Local-only components are available too: this
is access to that graph, not its server sync tier. There is no optimistic
replica or raw storage write door.

Graph refusals retain their `Stale` and `Refused` types and details across the
port, so two threads claiming one run settle at the owning graph's transaction.
Both ends must load compatible vocabulary. These ports are for trusted code;
they provide no authentication or read permission filter. `serve().close()` and
`remote().close()` release link listeners; the caller owns the ports.

Requests use portLink's default 30 second deadline. A timeout does not cancel an
operation that may already have committed; do not blindly retry it. Lifecycle
requests wait without a deadline so a graceful drain can finish. Applications
bundling for browsers must make the package's `./worker` module and their
opening module available at their Worker/module URLs. Pass
`thread(openingModule, { worker: bundledWorkerUrl })` for a built Worker at a
different URL. The package uses only standard web APIs; the opening module
decides runtime compatibility.

The root exports `thread`, `serve`, `remote`, `roles`, and their types;
`./worker` is the shared Worker entry point. Vale's growth and painting move
onto this package in their own tasks.
