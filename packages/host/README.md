# @yaks/host

The portable assembly and capabilities a host lends the plugins it composes. A
**host** composes a graph and supplies its storage, vault, blobs, artifacts,
tools, effects, caller attribution and shutdown signal. The concrete host owns
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

| Export                                        | Provides                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@yaks/host`                                  | `assembly`, facet contracts, `Host`, `Config`, `Options`, `Plug`, `Role`, `Feed`, `MigrationMonitor`, `ROLES`, `every` |
| `@yaks/host/assembly`                         | `assembly`, `Assembly`, `AssemblyOpts`, `Binding`, `Meaning`                                                           |
| `@yaks/host/roles`                            | Role and facet selection data without loading the assembly runtime                                                     |
| `@yaks/host/words`                            | Vocabulary assembly, `wordsOf`, `taking`, `Words`, `Declared`, `Taken`                                                 |
| `@yaks/host/config`                           | Configuration types, `used`, `given`, `chosen`                                                                         |
| `@yaks/host/documents`, `@yaks/host/keywords` | Shared intrinsic declarations and vocabulary keywords                                                                  |
| `@yaks/host/anatomy`                          | Composition evidence, projected when read                                                                              |

## Assembly

A **facet** is a plugin's subpath, such as `./vocab` or `./graph`. A **role**
selects the facets its process serves: `graph` loads vocabulary and graph hooks,
`web` loads routes and UI contributions, `effects` loads effect handlers, and a
plugin's own role loads its service. Tool implementations load on their first
call. `Load` supplies modules or `null` for a subpath a plugin does not export;
an import failure is an error.

`assembly(config, roles, load, opts)` loads those facets and builds their
vocabulary. Its `words` lets the concrete host prepare storage before
`bind(binding)` builds the graph, effect bindings, tools, runner and routes. The
returned services are handed to the host's scheduler. No assembly starts a
service or owns shutdown.

A config entry's `words` selects names from its plugin's vocabulary `$defs`,
including components, tools, rules and effects:
`{ use: '@yaks/task', words:
['task', 'cancelled'] }`. Omitted `words` takes
every definition; `[]` takes none. An unknown name is an error. Selection
retains the plugin's keywords and computed-property factories. The host's
intrinsic machine, git and invocation definitions remain available where no
plugin supplies them.

`opts.docs` supplies the graph's own vocabulary documents. Its component
declarations replace plugin declarations and extensions of the same name;
extensions in `opts.docs` still add to plugin components. Duplicate plugin
declarations are errors even when the graph shadows that name.

```ts
import { assembly, type Load } from '@yaks/host'
import { effects } from '@yaks/effects'
import { memoryBlobs } from '@yaks/blob'
import { ram } from '@yaks/ram'
import { ramVault } from '@yaks/secrets'
import { equal } from '@yaks/testing'

let load: Load = () => Promise.resolve(null)
let plan = await assembly({ plugins: [] }, ['graph'], load, {
  docs: [{
    $defs: {
      book: { component: true, properties: { title: { type: 'string' } } },
    },
  }],
})
let blobs = memoryBlobs()
let { host } = plan.bind({
  host: {
    me: 'example',
    vault: ramVault(),
    blobs,
    artifacts: blobs,
    stopping: new AbortController().signal,
    duties: () => Promise.resolve(),
    end: () => Promise.resolve(),
    bury: () => Promise.resolve([]),
    gone: () => Promise.resolve(false),
  },
  storage: (host) => ram(host.vocab),
  effects: (host, disabled) =>
    effects(host.vocab, {
      disabled,
      owes: 'declared',
      write: (bundles) => host.graph.apply(bundles),
    }),
})
await host.graph.apply([{ entity: { eid: 'b' }, book: { title: 'Dune' } }])
equal((await host.graph.get(['b']))[0].book, { title: 'Dune' })
```

`Binding.storage` receives the host and a shared query-extension list. After
storage binds, the assembly adds plugin extensions, then `Binding.extend` adds
the host's own compilers. `Binding.install` prepares schema before graph-facet
installers run. `Binding.graph` can add the host's own hooks and graph options
around the contributed plugins. `Binding.ready` lends graph-dependent
capabilities before effect factories run. `Binding.search` combines the host's
text search with the optional plugin meaning index.

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
`machine.provider`, and a `defaultProvider` that requests sandboxes.
`provider(name)` loads one configured provider on first acquisition and shares
it across later calls; unknown names return `undefined`. A plugin can ask for
commands and files without learning where its host lives. An existing machine is
explicitly attached by its provider's address; no host filesystem belongs to
plugins by right.

```ts
import { equal } from '@yaks/testing'
import type { Host } from '@yaks/host'

let releases: string[] = []
let machines: NonNullable<Host['machines']> = {
  defaultProvider: 'remote',
  provider: (name) =>
    Promise.resolve(
      name == 'remote'
        ? {
          wake: () => Promise.reject(new Error('not provisioned')),
          release: (ref) => {
            releases.push(ref.id)
            return Promise.resolve()
          },
          export: async function* () {},
        }
        : undefined,
    ),
}
await (await machines.provider('remote'))!.release({ id: 'job' })
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
storage implementation or filesystem API. It owns the shared assembly and
contract; the box owns its loader, command line and resource provisioning.
