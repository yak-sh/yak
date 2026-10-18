# Sandboxes

Containers and jails recorded separately from computers, with provisioning
intentions and confirmed disposal in the graph.

A **sandbox** is an actual or requested container or jail. Its
`sandbox{provider, address, from, image}` records the backend and resource
locator. Its `workspace{machine, root}` records placement and the default
absolute directory. A sandbox is not a computer; computers and workspace verbs
belong to [machine](../machine).

## Read lifecycle status

```ts
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { sandboxDoc } from '@yaks/sandbox'
import { kernelDoc } from '@yaks/kernel'

let vocab = loadVocab([kernelDoc, sandboxDoc])
equal(
  vocab.comp('sandbox')?.ladder?.rungs.find((r) => r.comp == 'pending')?.status,
  'requested',
)
equal(
  vocab.comp('sandbox')?.ladder?.rungs.find((r) => r.comp == 'released')
    ?.status,
  'released',
)
```

`pending{}` means provisioning is requested, `failed{reason}` records a failure,
and `released{at, by, via}` confirms external disposal. Without these marks,
`sandbox.status` is `ready`; readiness does not promise the resource is awake.
Providers must check availability on connection. Missing computer placement is
unknown, never an implicit local computer. Changing a session's home does not
release a sandbox.

## Exports

| Export    | Offers                              |
| --------- | ----------------------------------- |
| `.`       | `sandboxDoc`                        |
| `./vocab` | `sandboxDoc`, `docs`, `description` |

## Docker Sandboxes

A **sandbox provider** creates and disposes containers on an explicitly selected
computer. A **sandbox connection** offers workspace verbs for the existing
filesystem; connecting never recreates a missing sandbox. The provider takes a
preallocated sandbox eid, before any external action.

The `./docker` adapter runs `sbx` through a computer transport. Its local mode
uses Docker Sandboxes on that computer, not the graph server. No host directory
is bind-mounted. `sbx exec` wakes existing writable storage. A durable host
receipt and sandbox ownership marker prevent retries from creating another
resource or disposing a foreign resource. Keep the host receipt directory for as
long as sandbox ids can be retried, including after disposal.

This example needs a configured SSH computer running authenticated `sbx`:

```ts ignore
import { dockerSandboxes } from '@yaks/sandbox/docker'
import { sshConnector } from '@yaks/machine/connectors'

let transport = await sshConnector().connect('ssh://coder@container-host')
let provider = dockerSandboxes(graph, {
  transport,
  state: '/home/coder/.local/state/yak-sandboxes',
})
let ref = { id: sandboxEid }
let { workspace } = await provider.request!(ref)
await workspace.write('hello.txt', 'hello')
let reconnected = await provider.connect(ref)
console.log(await reconnected.workspace.read('hello.txt'))
await provider.dispose(ref)
```

The default root is `/workspace`; the adapter creates it and assigns its owner
to the shell template's default user. Templates need bash, base64, realpath,
setsid, flock and Linux `/proc`. Host control needs bash and flock. Commands
passed to `sbx` have stdin detached from the control script so an sbx invocation
cannot consume later lifecycle instructions. `from` requires an idempotent
`prepare` callback; without one it is refused before provisioning. Initial
provenance is not a backup. Disposal destroys writable storage and stops its
processes; it is never triggered by a session home change.

Exports accept relative names only and resolve inside the sandbox root. The
adapter does not provide idle eviction, permissions, host installation or a
local Docker fallback.
