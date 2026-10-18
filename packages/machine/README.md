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

## Exports

| Export                     | What it owns                                     |
| -------------------------- | ------------------------------------------------ |
| `@yaks/machine`            | Workspace and computer transport contracts       |
| `@yaks/machine/connectors` | Explicit local and SSH computer connections      |
| `@yaks/machine/execution`  | Durable command receipts and file operations     |
| `@yaks/machine/targets`    | Workspace target resolution and session defaults |
| `@yaks/machine/workspaces` | Recorded placement to configured connection      |
| `@yaks/machine/tools`      | File-and-command tools over workspaces           |
| `@yaks/machine/graph`      | Workspace placement and home validation          |
| `@yaks/machine/vocab`      | Computer and workspace vocabulary                |

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
`repository.workspace`. Sandbox provisioning belongs to
[@yaks/sandbox](../sandbox/README.md). A computer is recorded as
`machine{address}`; a directory is a workspace, not a computer. Session defaults
and resource disposal are independent: changing `home.workspace` does not move
files, stop commands or dispose a sandbox.

## Workspace tools and session defaults

`@yaks/machine/tools` supplies `workspaceTools(graph, workspaces)`: `shell`,
`read` and `write` accept an explicit `workspace` and absolute `cwd`, or use
`home{workspace, cwd}`. An explicit workspace uses its own root unless the call
also supplies cwd. Relative file paths use that directory; absolute paths remain
absolute. A default is not a permission boundary.

Each invocation records its resolved workspace and cwd in `call.args` before
executing. Shell recovery uses that record. `wait` and `stop` follow the process
entity's `process.workspace`, even after its session selects another home.
Missing or unreachable targets refuse rather than execute on the graph server.

`@yaks/machine/targets` exports `sessionHome(graph, session, workspace, cwd?)`.
It validates the target and performs a guarded home write; omitting cwd clears
the old cwd. The harness offers this as `session_home`. A direct graph write can
set the same home. The machine graph facet validates home targets and absolute
directories for both doors, and refuses changes to workspace placement.

`@yaks/machine/workspaces` supplies `workspaces(graph, bindings)`, connecting
workspace records through explicitly configured connectors. A sandbox connector
is supplied by its host; this package neither provisions nor disposes resources.

```ts
import { equal } from '@yaks/testing'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { machineDoc } from '@yaks/machine/vocab'
import { workspaces } from '@yaks/machine/workspaces'

let vocab = loadVocab([machineDoc])
let g = graph({ storage: ram(vocab), vocab })
let id = mint()
await g.apply([{ entity: { eid: id }, workspace: { root: '/repo' } }])
// Unknown computer placement is not a request to execute locally.
let refused = false
try {
  await workspaces(g, { connectors: {}, receipts: '/receipts' }).connect(id)
} catch {
  refused = true
}
equal(refused, true)
```

A CLI host enables connectors explicitly in its config:

```json
{
  "workspaces": {
    "connectors": {
      "local": { "use": "@yaks/machine/local" },
      "ssh": { "use": "@yaks/machine/ssh" }
    },
    "receipts": "/var/lib/yak/receipts"
  }
}
```

The receipts directory is interpreted on the target computer. Other connector
modules export `connector(options)`. The host supplies credentials through its
configured bindings, not through resource addresses.
