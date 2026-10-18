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

| Export         | Offers                                                       |
| -------------- | ------------------------------------------------------------ |
| `.`            | `sandboxDoc`, sandbox provider types, export path validation |
| `./vocab`      | `sandboxDoc`, `docs`, `description`                          |
| `./docker`     | `dockerSandboxes`                                            |
| `./pve`        | `pveClones`                                                  |
| `./bubblewrap` | `sandboxProvider`, limits and options                        |
| `./cloudflare` | `cloudflareProvider`, archive and SDK types                  |

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
setsid, flock, Python 3 and Linux `/proc`. Host control needs bash and flock.
Commands passed to `sbx` have stdin detached from the control script so an sbx
invocation cannot consume later lifecycle instructions. `from` requires an
idempotent `prepare` callback; without one it is refused before provisioning.
Initial provenance is not a backup. Disposal destroys writable storage and stops
its processes; it is never triggered by a session home change.

Exports accept relative names only. They open each path component by directory
descriptor inside the sandbox root and reject symlinks and special files. The
adapter does not provide idle eviction, permissions, host installation or a
local Docker fallback.

## Cloudflare containers

`cloudflareProvider(namespace, options?)` lends the containers in a deployed
Cloudflare Sandbox namespace. The request id is the container's name. Request
sets its idle sleep backstop; connect reaches the same files and processes;
dispose destroys the container. The namespace chooses its deployed image, so
`from`, `image` and existing-sandbox addresses are refused rather than ignored.

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
import { type Box, cloudflareProvider } from '@yaks/sandbox/cloudflare'

let destroyed = 0
let provider = cloudflareProvider({
  idFromName: (name) => name,
  get: () =>
    ({
      destroy: async () => {
        destroyed++
      },
    }) as unknown as Box,
}, {
  // In production this callback runs under a distributed lock and save commits
  // to durable storage outside the container. This example only disposes once.
  lifecycle: {
    locked: async (_id, act) => await act({ save: async () => {} }),
  },
})
await provider.dispose({ id: 'build-example' })
equal(destroyed, 1)
```

Cloudflare placement is unknown: the connection supplies a `Workspace` and
`root`, never an invented computer id. Durable use requires
`CloudflareOptions.lifecycle.locked`, backed by storage outside the container
and distributed serialization. The callback's `save` must commit before it
returns. `connect` refuses stopped/missing storage instead of recreating it;
`dispose` keeps a durable tombstone. Hosted archive migration explicitly uses
`legacyRecreation` until that caller's resource history is migrated.

Unlike the common relative-only export contract, Cloudflare also accepts
absolute export paths for the hosted `sandbox_ship` published API. SDK process
ids remain scoped to this container; durable graph process-handle migration is
not supplied by this adapter. Archive/restore streaming preserves the hosted
worker's existing copy protocol.

## Bubblewrap sandboxes

`sandboxProvider` lends a persistent `/workspace`, backed by one directory per
sandbox under its configured `dir`. Commands see that workspace, read-only
`/usr`, `/bin`, `/lib` and `/lib64`, a private `/tmp`, minimal `/dev`, and their
own PID, IPC, UTS, user, network and cgroup namespaces. They do not see the
host's home, `/etc`, other workspaces, the control socket or the user manager.
Files read and written through Workspace use the same restricted filesystem;
absolute paths are guest paths, not host paths. Export resolves symlinks in that
filesystem, so a symlink cannot expose a host file.

The provider requires Linux, `/usr/bin/bwrap`, `/usr/bin/python3`, bash, a
`flock`, a systemd user manager, usable unprivileged namespaces and delegated
cgroup v2 CPU, memory and pids controllers. It refuses to lend a sandbox if
bubblewrap cannot execute or the scope's limits are absent. It never falls back
to the unrestricted process provider. No Docker daemon, image, or installation
by this package is involved.

The host supplies these **sandbox limits** for the whole sandbox:

| Provider option    | Meaning                                                         |
| ------------------ | --------------------------------------------------------------- |
| `limits.cpuQuota`  | Percentage of one CPU, mapped to `CPUQuota`; 50 is half one CPU |
| `limits.memoryMax` | Maximum resident bytes, mapped to `MemoryMax`; swap is disabled |
| `limits.tasksMax`  | Maximum processes and threads, mapped to `TasksMax`             |

All commands and the detached supervisor share one systemd scope. Starting
another command does not grant another quota. CPU quota must be finite and at
least 1; memory must be an integer of at least 16 MiB; tasks must be an integer
of at least 16. The host chooses workable limits for its workload. An OOM kills
the scope; `connect` replaces its supervisor, keeps the workspace and marks
unfinished receipts with an unknown exit code. Connecting with different limits
or network policy is refused rather than silently changing a running sandbox.

This example requires the Linux namespace and systemd configuration above:

```ts ignore
import { equal } from '@yaks/testing'
import { sandboxProvider } from '@yaks/sandbox/bubblewrap'

let dir = await Deno.makeTempDir({ prefix: 'sb-' })
let options = {
  dir,
  limits: { cpuQuota: 50, memoryMax: 256 * 1024 * 1024, tasksMax: 64 },
}
let provider = sandboxProvider(options)
let ref = { id: 'example' }
try {
  let { workspace: machine } = await provider.request!(ref)
  await machine.write('hello.txt', 'hello')
  equal(await machine.read('/workspace/hello.txt'), 'hello')
  let command = await machine.start('sleep 30', undefined, 'durable-call')
  let reopened = await sandboxProvider(options).connect(ref)
  equal(await reopened.workspace.receipt!('durable-call'), command)
  await reopened.workspace.kill(command, 'SIGKILL')
} finally {
  await provider.dispose(ref)
  await Deno.remove(dir, { recursive: true })
}
```

The example runs against the actual namespaces and user manager, not a fake
launcher. The provider's root must be short enough for its Unix socket path (107
bytes including the sandbox id and `/control/control.sock`). Control files are
private to the host and separate from the workspace. Their receipts are local
backend state, not graph rows or shell-visible files. A filesystem lock
serializes lifecycle operations across hosts; command receipt creation is
serialized by the supervisor. A durable call is never launched again, even when
its launch was interrupted and its outcome is unknown. Output and exit status
survive the requesting host's exit; `look`, `tail` and `kill` reach the same
supervisor from a replacement host. Termination targets the command's process
group and PID namespace; dispose stops the entire scope before removing the
workspace and receipts. Export files before disposal.

`request` optionally calls idempotent `prepare(from, machine, '/workspace')` to
populate a graph commit. A failed preparation is retried by `request`; `connect`
refuses incomplete preparation. Preparation is recorded outside the guest
workspace and reused on retry. `image` and existing-machine attachment are
unsupported: use the process provider to explicitly attach local disk.

Network is isolated by default. `network: true` explicitly shares the host's
network namespace, including access to loopback services, and therefore weakens
isolation. DNS configuration and extra tools are not inherited; a host can
provision what its workload needs through the workspace. `env(session?)`
supplies only explicit command environment and short-lived graph grants; nothing
in the launching host's environment is inherited by commands. This provider
constructs a namespace sandbox, not a microVM: it shares the host kernel and
does not claim protection against kernel exploits.

## PVE LXC clones

The `./pve` adapter clones an explicitly configured template on the computer
reached by its transport.
`pveClones(graph, { transport, state, template,
storage, vmidRange })` requires
a storage id and reserved VMID range; a stable hash of the sandbox eid chooses
one VMID. A collision refuses the request, rather than adopting another
container or trying an unreserved VMID. A random clone description token and
host receipts establish ownership. Keep `state` after disposal, as with Docker.
A stopped clone can be started by `request`; `connect` refuses stopped, missing
or incomplete clones.

This example requires a PVE computer, a prepared template, a reserved pool and
permission to clone into the specified storage:

```ts ignore
import { pveClones } from '@yaks/sandbox/pve'

let provider = pveClones(graph, {
  transport: pveTransport,
  state: '/var/lib/yak-sandboxes',
  template: 9000,
  storage: 'guests',
  vmidRange: [9200, 9299],
})
let box = await provider.request!({ id: sandboxEid })
await box.workspace.write('result.txt', 'ready')
await provider.dispose({ id: sandboxEid })
```

The template needs bash, setsid, flock, base64, Python 3 and Linux `/proc`.
Commands use `pct exec` through the PVE computer; no QEMU guest-agent API is
assumed for LXC. `image` is refused; `from` requires an idempotent `prepare`
callback. Disposal stops and destroys only the token-matching clone. No PVE
account, API token, template or storage allocation is created by the adapter.

## Bubblewrap and Cloudflare

The `./bubblewrap` adapter provides an explicitly local Linux jail, with CPU,
memory and task limits. It requires user namespaces, bubblewrap and delegated
cgroup controls. See its `SandboxProviderOpts` for filesystem and network
choices. It retains a disposal tombstone outside the removed jail directory. It
is not a fallback for an unreachable remote computer.

The `./cloudflare` adapter binds a deployed sandbox namespace. Its image comes
from the deployment: `from`, `image` and foreign addresses are refused. Computer
placement remains unknown when the backend cannot disclose it. Cloudflare
requires a durable, serialized lifecycle seam to distinguish a requested
resource from missing or disposed writable storage. Connecting does not silently
rebuild that storage. Its archive/restore helpers support a host that explicitly
preserves files before eviction; the host owns billing, grants and archive
storage. Cloudflare SDK process ids are recovered through that namespace, and
commands retain the SDK timeout. Unlike the other adapters, absolute export
names are accepted for the published sandbox ship interface. The Workers archive
coordinator selects its explicit historical recreation behavior at its own
consumer boundary.

## Configure graph provisioning

The plugin's `with.providers` binds provider names to implementation modules and
computer eids. Docker and PVE have built-in JSON bindings; other modules export
`sandboxProvider(host, options, placement)`. Module factories can supply
Cloudflare SDK bindings or bubblewrap's local jail setup. `placement` carries
the explicit computer eid and its transport, when known. Programmatic hosts may
pass `{ provider, machine }` directly. No default provider or computer is
guessed.

```json
{
  "use": "@yaks/sandbox",
  "with": {
    "providers": {
      "coder": {
        "use": "@yaks/sandbox/docker",
        "machine": "775c579e-fdaa-4548-838a-89838ef83879",
        "with": {
          "state": "/home/coder/.local/state/yak-sandboxes",
          "identity": "/home/graph/.ssh/coder"
        }
      }
    }
  }
}
```

The computer row's `machine.address` selects `local://` or `ssh://user@host`.
`identity` and `knownHosts` are optional SSH file paths, not credentials stored
in graph rows. The binding's `state` path is interpreted on that computer. PVE
additionally requires `template`, `storage` and a two-number `vmidRange`; linked
clones require every template volume to use that storage. Built-in JSON bindings
do not invent Git preparation; a module factory supplies an idempotent `prepare`
callback when creating from a graph commit.

`sandbox_new` records an intention and returns its sandbox/workspace row. The
`sandbox_provision` effect creates the resource later; read `sandbox.status`
until it is ready or failed. `sandbox_dispose` is an explicit durable tool call,
not a home-switch action. Adapter exports and these tools do not change which
plugins the host enables or grant access to another computer.
