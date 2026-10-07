# Machines

Commands and files through a `Machine`, with providers that lend sandboxes or
attach existing machines. This package owns the `Machine` contract, the provider
interface and `machine{provider, from, image, state}`. It touches no runtime,
filesystem or graph storage.

A **machine** is something you can run commands on and keep files on. `Machine`
is its commands-and-files interface: `start`, `look`, `tail`, `kill`, `read` and
`write`. A **provider** lends or attaches machines. A **sandbox** is a machine a
provider lends on demand with its own filesystem. No machine belongs to a host
by right: even a machine beside the host must be explicitly configured.

## Use a sandbox

The [process provider](../process/README.md#machines) gives each sandbox its own
directory. This example requests one, writes and reads a file, and releases it:

```ts
import { equal } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { processDoc, processes } from '@yaks/process'
import { processProvider } from '@yaks/process/machine'

let vocab = loadVocab([processDoc])
let g = graph({ storage: ram(vocab), vocab, plugins: [processes()] })
let dir = await Deno.makeTempDir()
let provider = processProvider(g, { dir })
let ref = { id: crypto.randomUUID() }
try {
  let { machine } = await provider.request!(ref)
  await machine.write('src/example.txt', 'hello')
  equal(await machine.read('src/example.txt'), 'hello')
  equal(
    await (await provider.wake(ref)).machine.read('src/example.txt'),
    'hello',
  )
  let files = []
  for await (let file of provider.export(ref, ['src/example.txt'])) {
    files.push(new TextDecoder().decode(file.bytes))
  }
  equal(files, ['hello'])
} finally {
  await provider.release(ref)
  await Deno.remove(dir, { recursive: true })
}
```

## Exports

| Export    | Offers                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `.`       | `Machine`, `Proc`, `MachineProvider`, `ProviderConfig`, request/reference/file types, `MACHINE`, `MachineRecord`, `MachineState` |
| `./vocab` | `machineDoc`, `docs`, `description`                                                                                              |

## Machine

`start(command, cwd?, call?, session?)` starts a bash command and answers its
process id. A process exists from the start, not only when a tool's timeout
expires. `look(id)` returns its pid and optional exit code; `tail(id, n)`
returns recent output; `kill(id, signal)` sends SIGTERM or SIGKILL. An unknown
process is `null`; a running process has no `exit`; an exit code the machine
cannot learn is `null`.

`read(path)` and `write(path, content)` deal in text. `write` replaces the file
and makes its parent directories. The provider chooses the default directory. A
machine's optional `receipt(call)` recovers the process of a durable tool call
without starting it twice. Optional `poll` controls how often tools look for an
exit.

[The harness machine tools](../harness/README.md#the-machine) use this contract.
They decide how long a call waits, not how long its process lives.

## Providers

`ProviderConfig` is configuration data: `{use, with?}` names an implementation
and its options. A host gives each configured provider a key; that key is what
`machine.provider` records. This package neither loads implementations nor
selects a provider. Hosts choose a sandbox provider by default. An address is
used only when work explicitly names an existing machine.

`MachineProvider` offers:

- `request({id, from?, image?})`, for a sandbox provider. The caller supplies a
  stable id _before_ provisioning; repetition must reuse it. `from` names a
  commit in the graph, not a path to a host checkout. `image` names an image to
  boot. A provider must reject capabilities it cannot supply rather than
  silently ignore them.
- `attach({id, address})`, for an existing-machine provider. `address` is
  interpreted by that provider: a directory for the process provider, or an SSH
  address for a remote provider. An existing-machine provider need not implement
  `request`; a sandbox provider need not implement `attach`.
- `wake({id, address?})`, returning the same machine's interface and optional
  default `cwd`, without requiring a live handle from an earlier request.
- `release({id, address?})`, releasing a sandbox or detaching an existing
  machine. Detaching must not destroy an existing machine.
- `export({id, address?}, paths)`, shipping named relative files as
  `{path, bytes}`. Bytes include binary files. The caller puts them into blobs
  or a commit through the graph's doors; the provider chooses no storage.

Lifecycle operations tolerate repetition. A provider may retry preparation
interrupted before it produced its receipt; preparation must be idempotent.
Providers own external resources. The caller owns the machine's graph record and
writes the state after each external operation succeeds.

An explicitly attached machine is no more privileged than a sandbox:

```ts
import { equal } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { processDoc } from '@yaks/process'
import { processProvider } from '@yaks/process/machine'

let vocab = loadVocab([processDoc])
let g = graph({ storage: ram(vocab), vocab })
let dir = await Deno.makeTempDir()
let provider = processProvider(g, { dir: `${dir}/sandboxes` })
let ref = { id: 'explicit-machine', address: dir }
try {
  let { machine } = await provider.attach!(ref)
  await machine.write('kept.txt', 'keep')
  await provider.release(ref)
  equal(await machine.read('kept.txt'), 'keep')
} finally {
  await Deno.remove(dir, { recursive: true })
}
```

## Graph record

`machine{provider, from, image, state}` is the provider's last recorded
lifecycle state: `requested`, `running`, `asleep` or `released`. `from`
references a Git object in the graph and keeps provenance when that object is
deleted; the request must name a commit. Absent `from`, a sandbox starts empty.
Absent `image`, its provider chooses the image. The machine entity's id is also
the id supplied to its provider, so wake and release can run in another process.

```ts
import { equal } from '@yaks/testing'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { machineDoc } from '@yaks/machine/vocab'

let vocab = loadVocab([machineDoc])
let g = graph({ storage: ram(vocab), vocab })
let eid = mint()
await g.apply([{
  entity: { eid },
  machine: { provider: 'process', state: 'requested' },
}])
await g.apply([{ entity: { eid }, machine: { state: 'running' } }])
equal((await g.get([eid]))[0].machine, {
  provider: 'process',
  state: 'running',
})
```

## Limits

Providers supply isolation, CPU and memory limits; the interface does not.
Directory separation in the process provider is _not_ a security boundary.
Sessions, provisioning effects, grants and default-provider selection belong to
the host and [harness](../harness). Git objects belong to [Git](../git), and
byte storage belongs to [blobs](../blob). This package neither opens a database
nor assumes where the host, graph or machine lives.
