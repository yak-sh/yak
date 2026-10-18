# Machines

Computers, explicit connection transports and durable file-and-command
workspaces, separate from sandbox provisioning.

A **machine** is an actual computer, with a stable graph identity and optional
`machine.address` selecting a configured connector. A **connector** reaches an
existing computer; it does not create, destroy or allocate one. A **workspace**
is the filesystem target of file and command operations, not the location of an
agent. Its root is a default directory, not an access boundary.

## Connect a computer

The `./connectors` export supplies `localConnector`, `sshConnector`,
`pveConnector` and `computer` for explicit scheme selection. Unconfigured or
unreachable addresses fail rather than falling back to local execution.
Connection addresses contain no directory or credential. A machine keeps its
minted identity when its address changes; `computerIdentity` reads the target's
OS identity for reconciliation, without deriving graph identity from it.

```ts
import { equal } from '@yaks/testing'
import { localConnector } from '@yaks/machine/connectors'

// A configured control runner is replaceable, without changing selection.
let transport = await localConnector(() => Promise.resolve('connected'))
  .connect('local://')
equal(await transport.execute('printf connected'), 'connected')
```

SSH accepts `ssh://[user@]host[:port]`. It uses batch mode, a connection timeout
and strict host-key verification. Optional `identity` pins a key and bypasses
the agent; `knownHosts` selects an explicitly trusted known-host file. It does
not provision trust or change the remote host's SSH configuration.

PVE addresses are `pve://node/qemu/VMID`, reaching a Linux QEMU guest with its
guest agent enabled. The Proxmox host and LXC guests require SSH, not the guest
agent API. `pveRequest({endpoint, token})` makes HTTPS API calls; `token()`
resolves a vault-backed `user@realm!tokenid=secret` value per call, never from
the address. Supply a scoped token with the guest-agent execution permission.
The API executes short control scripts, observes their returned PID, and refuses
failures or truncated output. The long-running command has a separate durable
receipt inside the guest. It needs neither an API call nor a live caller for its
lifetime.

This API example needs a configured HTTPS endpoint and credential resolver:

```ts ignore
import { pveConnector, pveRequest } from '@yaks/machine/connectors'
let transport = await pveConnector({
  request: pveRequest({
    endpoint: 'https://pve.example:8006',
    token: async () => await resolveConfiguredCredential(),
  }),
}).connect('pve://node/qemu/201')
```

## Durable execution

`executionWorkspace(graph, transport, {workspace, root, receipts})`, exported at
`./execution`, binds file and command operations to a concrete target. `root`
and `receipts` are absolute target paths, and `workspace` is the graph entity
id. No implicit placement or host-relative directory is accepted.

A call-derived process entity records `process{workspace, command, cwd, pid}`;
its eid is the handle returned by `start`, `receipt`, `look`, `tail` and `kill`.
The launch filesystem retains a private receipt, output and exit observation.
Recreating the connector and workspace recovers them without relaunching the
command. Concurrent starts of one call serialize at the target; conflicting
command or cwd arguments are refused. A crash in the ambiguous interval between
claim and launch leaves a receipt to inspect, not permission to run again. Local
@yaks/process recovery leaves these workspace-qualified runs alone.

The target needs Linux `/proc`, bash, setsid, flock, base64 and ordinary file
utilities. The detached supervisor has its own process group. Stop checks both
its boot id and process birth token before signalling that group, never an
unrelated reused PID. If the supervisor dies without writing an exit code,
`look` records an unknown exit, not an invented success. No connector reaps or
sweeps user receipts; deletion belongs to explicit resource disposal.

```ts
import { equal } from '@yaks/testing'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { processDoc } from '@yaks/process'
import { executionWorkspace } from '@yaks/machine/execution'

let vocab = loadVocab([processDoc])
let g = graph({ storage: ram(vocab), vocab })
let workspace = executionWorkspace(g, {
  execute: () => Promise.resolve(''),
}, { workspace: mint(), root: '/repo', receipts: '/receipts' })
// A receipt lookup does not execute anything on the computer.
equal(await workspace.receipt!(mint()), undefined)
```

## Compatibility providers

`Machine`, `MachineProvider` and the Cloudflare subpath support callers still
using provider-managed lifecycle. [Sandbox](../sandbox) declares containers and
jails separately from computers. Provider lifecycle is not part of a computer
connector.

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

| Export         | Offers                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`            | `Workspace`, `WorkspaceTarget`, `ComputerConnector`, `ComputerTransport`, `Machine`, `Proc`, `MachineProvider`, `ProviderConfig`, request/reference/file types, `MACHINE`, `MachineRecord`, `MachineState` |
| `./cloudflare` | `cloudflareProvider`, `CloudflareProvider`, namespace and RPC types, image cwd and time limits                                                                                                             |
| `./connectors` | `computer`, `localConnector`, `sshConnector`, `pveConnector`, `pveRequest`, `computerIdentity`, control types                                                                                              |
| `./execution`  | `executionWorkspace`                                                                                                                                                                                       |
| `./vocab`      | `machineDoc`, `docs`, `description`                                                                                                                                                                        |

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

## Cloudflare containers

`cloudflareProvider(namespace, options?)` lends the containers in a deployed
Cloudflare Sandbox namespace. The request id is the container's name. Request
sets its idle sleep backstop; wake reaches the same files and processes; release
destroys the container. The namespace chooses its deployed image, so `from`,
`image` and existing-machine addresses are refused rather than ignored.

Commands keep completed processes for `look` and `tail`; their ceiling is four
minutes. SIGTERM and SIGKILL both use the SDK's single kill operation. Export
reads binary files through the SDK's base64 encoding; relative paths start in
`/workspace`, and absolute paths are supported for the platform's artifact
tools.

The host supplies `options.env` at command invocation (for example, a scoped
grant), `options.retry` for transient RPC failures, and `options.sleepError` to
report a failed idle configuration. This provider knows no account or meter.

`archive(ref)` streams a tar snapshot of `/workspace`, with its byte length and
an explicit `dispose()` for callers that stop reading early.
`restore(ref, body)` restores that stream into a clean destination and refuses
writes outside `/workspace`. Transfers use bounded chunks and carry no
invocation environment. `active(ref)` reads the container's state without
starting it; `processes(ref)` returns process data without the SDK's control
methods.

The namespace in this example is a stand-in for the deployed binding:

```ts
import { equal } from '@yaks/testing'
import { type Box, cloudflareProvider } from '@yaks/machine/cloudflare'

let destroyed = 0
let provider = cloudflareProvider({
  idFromName: (name) => name,
  get: () =>
    ({
      destroy: async () => {
        destroyed++
      },
    }) as unknown as Box,
})
await provider.release({ id: 'build-example' })
equal(destroyed, 1)
```

## Workspace records

A workspace is recorded as `workspace{machine, root, sandbox}`. `machine` names
the actual computer; `root` is its default absolute directory, not an access
boundary. Optional `sandbox` names an enclosing [sandbox](../sandbox). A sandbox
entity itself wears `workspace{machine, root}` without a self reference. Missing
placement means unknown, never the graph server's disk. Resource placement stays
fixed so old calls remain recoverable after a session changes its default
target.

Session defaults use `home{workspace, cwd}`; a process can retain its original
`process.workspace`, and a Git repository can name its filesystem context with
`repository.workspace`. The lifecycle properties on `machine`, `home.machine`
and `worktree.path` remain available during coordinated conversion of callers
and stored data. Workspace execution and provisioning are separate contracts.

## Graph record

`machine{provider, address, from, image, state}` is the provider's last recorded
lifecycle state: `requested`, `running`, `asleep` or `released`. Optional
`address` records an existing-machine address for its provider's `attach`,
`wake`, `release` and `export` operations. Without it, the entity names a
sandbox owned by the provider. An address stays in the record so another host
process can attach the same machine. `from` references a Git object in the graph
and keeps provenance when that object is deleted; the request must name a
commit. Absent `from`, a sandbox starts empty. Absent `image`, its provider
chooses the image. The machine entity's id is also the id supplied to its
provider, so wake and release can run in another process.

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
