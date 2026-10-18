// PVE LXC clones on an explicitly connected PVE computer. Host receipts reserve
// one deterministic VMID; the container's description proves its ownership.
import type { Graph } from '@yaks/graph'
import type { ComputerTransport, Workspace } from '@yaks/machine'
import { executionWorkspace } from '@yaks/machine/execution'
import { quote } from '@yaks/machine/connectors'
import {
  exportPath,
  type SandboxProvider,
  type SandboxRef,
} from './provider.ts'

export type PveOptions = {
  /** Usually the transport returned by the configured PVE SSH connector. */
  transport: ComputerTransport
  /** Private, persistent directory on PVE, outside every clone. */
  state: string
  template: number
  /** Every template volume must already reside on this storage. */
  storage: string
  /** Inclusive range granted for these clones, excluding the template. */
  vmidRange: readonly [number, number]
  /** Materialize the initial commit; must tolerate retries after interruption. */
  prepare?: (from: string, workspace: Workspace, root: string) => Promise<void>
}

let absolute = (path: string) => {
  if (
    !path.startsWith('/') || path == '/' || path.includes('\0') ||
    path.split('/').some((p) => p == '.' || p == '..')
  ) throw new Error('PVE receipt directory must be absolute without . or ..')
  let normalized = path.replace(/\/+$/, '')
  if (!normalized) throw new Error('PVE receipt directory cannot be root')
  return normalized
}
let vmid = (n: number) => Number.isSafeInteger(n) && n >= 100 && n <= 999999999

/** Linked clones only, on the template storage. The template needs bash, flock, setsid, base64, python3
 * and /proc for executionWorkspace. Missing/ambiguous clones are never rebuilt.
 * A hash collision refuses the request rather than silently choosing a new id.
 * The configured state directory and VMID grant must remain stable on reconnect.
 * Host locks coordinate this adapter, not unrelated PVE administrators. */
export let pveClones = (g: Graph, options: PveOptions): SandboxProvider => {
  let state = absolute(options.state)
  let [first, last] = options.vmidRange
  if (
    !vmid(first) || !vmid(last) || last < first || !vmid(options.template) ||
    (options.template >= first && options.template <= last)
  ) {
    throw new Error(
      'PVE requires a template outside an explicit valid VMID range',
    )
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(options.storage)) {
    throw new Error('PVE requires an explicit storage id')
  }
  let root = '/workspace'
  let address = (ref: SandboxRef) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(ref.id)) throw new Error('Invalid sandbox id')
    let hash = 2166136261
    for (let c of ref.id) {
      hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0
    }
    let value = String(first + hash % (last - first + 1))
    if (ref.address != null && ref.address != value) {
      throw new Error('PVE address does not match its reserved VMID')
    }
    return value
  }
  // All pct failures propagate, including list/config permission or connection
  // failures. Only a successful list establishes that a container is absent.
  let control = (ref: SandboxRef, body: string) => {
    let target = address(ref)
    return options.transport.execute(`set -eu
umask 077
mkdir -p -- ${quote(state)}
exec 9>${quote(state + '/lock')}
flock -x 9
vmid=${quote(target)}
d=${quote(state + '/vmids/' + target)}
mkdir -p -- "$d"
id=${quote(ref.id)}
pct list </dev/null > "$d/list"
exists() { awk 'NR > 1 { print $1 }' "$d/list" | grep -Fxq -- "$vmid"; }
claimed() {
  test -f "$d/owner" && test "$(cat "$d/owner")" = "$id" || { echo 'PVE VMID is not owned by this sandbox' >&2; exit 1; }
}
owned() {
  test -s "$d/token" || { echo 'PVE ownership receipt is missing' >&2; exit 1; }
  pct config "$vmid" </dev/null > "$d/config"
  grep -Fxq -- "description: $(cat "$d/token")" "$d/config" || { echo 'PVE container ownership changed' >&2; exit 1; }
  if grep -q '^lock:' "$d/config"; then echo 'PVE container is locked' >&2; exit 1; fi
}
${body}`)
  }
  let present = `claimed
test ! -f "$d/released" || { echo 'PVE sandbox was disposed' >&2; exit 1; }
test -f "$d/created" || { echo 'PVE clone creation is incomplete; refusing reconstruction' >&2; exit 1; }
exists || { echo 'PVE clone is missing; refusing reconstruction' >&2; exit 1; }
owned`
  let ready = `${present}
test -f "$d/ready" || { echo 'PVE sandbox preparation is incomplete' >&2; exit 1; }`
  let running = `pct status "$vmid" </dev/null > "$d/status"
grep -Fxq 'status: running' "$d/status" || { echo 'PVE sandbox is not running' >&2; exit 1; }`
  let inside = (ref: SandboxRef, script: string, prepared = true) =>
    control(
      ref,
      `${prepared ? ready : present}
${running}
pct exec "$vmid" --keep-env 0 -- bash -c ${quote(script)} </dev/null`,
    )
  let connection = async (ref: SandboxRef, prepared = true) => {
    await control(ref, `${prepared ? ready : present}\n${running}`)
    let transport: ComputerTransport = {
      execute: (script) => inside(ref, script, prepared),
    }
    return {
      workspace: executionWorkspace(g, transport, {
        workspace: ref.id,
        root,
        receipts: root + '/.yak/processes',
      }),
      root,
      address: address(ref),
    }
  }
  return {
    request: async (request) => {
      if (request.image != null) {
        throw new Error(
          'PVE image is unsupported; configure an explicit template',
        )
      }
      if (request.from != null && !options.prepare) {
        throw new Error('PVE commit preparation is not configured')
      }
      let spec = JSON.stringify({
        template: options.template,
        storage: options.storage,
        vmidRange: options.vmidRange,
        from: request.from,
      })
      // Description is set by clone itself, not by a later command that could
      // accidentally adopt a foreign container after a failed clone.
      let token = 'yak-sandbox:' + request.id + ':' + crypto.randomUUID()
      await control(
        request,
        `if test -f "$d/owner"; then
  claimed
  test ! -f "$d/released" || { echo 'PVE sandbox was disposed' >&2; exit 1; }
  test "$(cat "$d/spec")" = ${
          quote(spec)
        } || { echo 'PVE request changed' >&2; exit 1; }
else
  if exists; then echo 'PVE VMID already exists without ownership' >&2; exit 1; fi
  pct config ${options.template} </dev/null > "$d/template"
  grep -Fxq 'template: 1' "$d/template" || { echo 'PVE source is not a template' >&2; exit 1; }
  awk -F ': ' -v storage=${quote(options.storage)} '
    $1 == "rootfs" || $1 ~ /^mp[0-9]+$/ {
      volume=$2; sub(/,.*/, "", volume); sub(/^volume=/, "", volume)
      if (index(volume, storage ":") != 1) bad=1
      if ($1 == "rootfs") root=1
    }
    END { exit (bad || !root) }
  ' "$d/template" || { echo 'PVE linked clone requires every template volume on configured storage' >&2; exit 1; }
  printf '%s' ${quote(spec)} > "$d/spec"
  printf '%s' ${quote(token)} > "$d/token"
  printf '%s' "$id" > "$d/owner.tmp"
  mv -- "$d/owner.tmp" "$d/owner"
  pct clone ${options.template} "$vmid" --full 0 --description "$(cat "$d/token")" </dev/null > /dev/null
  owned
  touch "$d/created"
fi
${present.replace('exists ||', 'pct list </dev/null > "$d/list"\nexists ||')}
pct status "$vmid" </dev/null > "$d/status"
if grep -Fxq 'status: stopped' "$d/status"; then pct start "$vmid" </dev/null > /dev/null; fi
${running}`,
      )
      let connected = await connection(request, false)
      await inside(
        request,
        `mkdir -p -- ${quote(root + '/.yak/processes')}`,
        false,
      )
      let prepared = await control(
        request,
        `${present}\nif test -f "$d/ready"; then printf yes; fi`,
      )
      if (prepared != 'yes') {
        if (request.from != null) {
          await options.prepare!(request.from, connected.workspace, root)
        }
        await control(request, `${present}\ntouch "$d/ready"`)
      }
      return await connection(request)
    },
    connect: (ref) => connection(ref),
    dispose: async (ref) => {
      await control(
        ref,
        `claimed
if test -f "$d/released"; then exit 0; fi
if exists; then
  owned
  pct status "$vmid" </dev/null > "$d/status"
  if grep -Fxq 'status: running' "$d/status"; then pct stop "$vmid" </dev/null > /dev/null; fi
  owned
  pct destroy "$vmid" </dev/null > /dev/null
fi
touch "$d/released"`,
      )
    },
    export: async function* (ref, paths) {
      // Validate the whole request before issuing any remote read.
      for (let path of paths) exportPath(path)
      for (let path of paths) {
        let encoded = await inside(
          ref,
          `python3 -c ${
            quote(`import os, sys, base64
parts = sys.argv[1].split('/')
fd = os.open('/workspace', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    for i, part in enumerate(parts):
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        if i < len(parts) - 1:
            flags |= os.O_DIRECTORY
        child = os.open(part, flags, dir_fd=fd)
        os.close(fd)
        fd = child
    import stat
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        raise ValueError('Export requires a regular file')
    with os.fdopen(os.dup(fd), 'rb') as file:
        sys.stdout.write(base64.b64encode(file.read()).decode('ascii'))
finally:
    os.close(fd)`)
          } ${quote(path)}`,
        )
        yield {
          path,
          bytes: Uint8Array.from(
            atob(encoded.replaceAll(/\s/g, '')),
            (c) => c.charCodeAt(0),
          ),
        }
      }
    },
  }
}
