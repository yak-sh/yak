# @yaks/host

The portable capabilities a host lends the plugins it composes. A **host**
composes a graph and supplies its storage, vault, blobs, artifacts, tools,
effects, caller attribution and shutdown signal. The concrete host owns
connections, directories and resource lifetime; a plugin never receives a SQL
driver or a state directory.

A plugin factory receives a `Host` and its configured options. It keeps the host
reference when its graph or tools are still being assembled:

```ts
import type { Host } from '@yaks/host'
import { equal } from '@yaks/testing'

let factory = (host: Pick<Host, 'stopping'>) => () => host.stopping.aborted
let stop = new AbortController()
let stopped = factory({ stopping: stop.signal })
equal(stopped(), false)
stop.abort()
equal(stopped(), true)
```

| Export       | Provides                                                                                |
| ------------ | --------------------------------------------------------------------------------------- |
| `@yaks/host` | `Host`, composition `Config`, `Options`, `Plug`, `Role`, `Feed`, and `MigrationMonitor` |

## Storage capabilities

`Host.storage` is [graph storage](../graph/README.md#storage), not a particular
backend. SQL-backed storage may offer a
[statement capability](../sql/README.md#statement-capability) for indexes beside
the graph. It also may offer bound storage diagnostics and a migration monitor.
A plugin needing an absent capability reports that fact rather than guessing a
connection or a file location.

Storage is bound before query extensions are asked for. The graph, request
handler, tool runner and duties become available as composition builds each one.
Factories retain the host reference and use those parts only after their factory
returns.

## Machine providers

`Host.machines` is an optional capability: configured
[machine providers](../machine/README.md#providers), keyed by the durable
`machine.provider`, and a `defaultProvider` that requests sandboxes. A plugin
can ask for commands and files without learning where its host lives. An
existing machine is explicitly attached by its provider's address; no host
filesystem belongs to plugins by right.

```ts
import { equal } from '@yaks/testing'
import type { Host } from '@yaks/host'

let releases: string[] = []
let machines: NonNullable<Host['machines']> = {
  defaultProvider: 'remote',
  providers: {
    remote: {
      wake: () => Promise.reject(new Error('not provisioned')),
      release: (ref) => {
        releases.push(ref.id)
        return Promise.resolve()
      },
      export: async function* () {},
    },
  },
}
await machines.providers.remote.release({ id: 'job' })
equal(releases, ['job'])
```

Concrete hosts may supply `resolveHome` at their compatibility door to translate
stored homes into machine homes. Plugins only consume the returned machine
reference and command directory.

## Failure reporting

`Host.report(error, context)` hands a failure to the concrete host's reporter.
Context identifies the failing work through `during.entity`, `during.kind`,
`during.session` and `during.process`; `eid` preserves an occurrence's identity
across redelivery. The host owns delivery and shutdown, so plugins use its
reporter without opening a sink.

```ts
import { equal } from '@yaks/testing'
import type { Host } from '@yaks/host'

let told: unknown[] = []
let host: Pick<Host, 'report'> = {
  report: (error) => {
    told.push(error)
  },
}
await host.report?.('missing field', { during: { entity: 'work' } })
equal(told, ['missing field'])
```

## Concrete hosts

[@yaks/cli](../cli/README.md) opens the box's database and binds this interface.
Its caller owns shutdown and closing. This package imports no CLI, native
storage implementation or filesystem API. It defines the contract, not the box's
loader, command line or resource provisioning.
