// Docker Sandboxes runs on an explicitly connected computer. Its resource and
// lifecycle receipts remain there across reconnects; no local Docker is used.
import type { Graph } from '@yaks/graph'
import type { ComputerTransport, Workspace } from '@yaks/machine'
import { executionWorkspace } from '@yaks/machine/execution'
import { quote } from '@yaks/machine/connectors'
import {
  exportPath,
  type SandboxProvider,
  type SandboxRef,
  type SandboxRequest,
} from './provider.ts'

/** Host state is outside the sandbox so confirmed disposal cannot erase the
 * tombstone that prevents accidental reconstruction under an old id. */
export type DockerOptions = {
  transport: ComputerTransport
  state: string
  root?: string
  image?: string
  prepare?: (from: string, workspace: Workspace, root: string) => Promise<void>
}
let absolute = (path: string) => {
  if (
    !path.startsWith('/') || path.includes('\0') ||
    path.split('/').includes('..')
  ) throw new Error('Docker paths must be absolute without ..')
  return path
}
let nameOf = (ref: SandboxRef) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(ref.id)) throw new Error('Invalid sandbox id')
  let name = 'yak-' + ref.id.toLowerCase().replaceAll('_', '-')
  if (ref.address && ref.address != name) {
    throw new Error('Sandbox address does not match its durable id')
  }
  return name
}
let encoded = (text: string) => {
  let binary = ''
  for (let byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}
// Keep the script itself out of sbx argument reconstruction: the decoded
// script has no nested command-line quoting for sbx to interpret.
let inside = (name: string, script: string, root = false) =>
  `sbx exec ${root ? '-u root ' : ''}${quote(name)} bash -c ${
    quote('echo ' + encoded(script + '\n') + ' | base64 -d | bash')
  } </dev/null`

/** A local sbx adapter, reached through a computer transport (usually SSH).
 * No --cloud, bind mount or agent launch is implicit. sbx exec wakes existing
 * storage; a missing resource is an error rather than permission to recreate. */
export let dockerSandboxes = (
  g: Graph,
  options: DockerOptions,
): SandboxProvider => {
  let root = absolute(options.root ?? '/workspace')
  let state = absolute(options.state)
  let control = (ref: SandboxRef, body: string) =>
    options.transport.execute(`set -eu
umask 077
mkdir -p -- ${quote(state)}
d=${quote(state + '/' + nameOf(ref))}
mkdir -p -- "$d"
exec 9>"$d/lock"
flock -x 9
name=${quote(nameOf(ref))}
sbx ls -q </dev/null > "$d/list"
exists() { grep -Fxq -- "$name" "$d/list"; }
owned() { test "$(sbx exec "$name" printenv YAK_SANDBOX_ID </dev/null)" = ${
      quote(ref.id)
    }; }
${body}`)
  let present =
    `test -f "$d/claimed" || { echo 'Sandbox is not owned by this provider' >&2; exit 1; }
test ! -f "$d/released" || { echo 'Sandbox was disposed' >&2; exit 1; }
exists || { echo 'Sandbox is missing; refusing reconstruction' >&2; exit 1; }
owned || { echo 'Sandbox ownership changed' >&2; exit 1; }`
  let connection = async (ref: SandboxRef, ready = true) => {
    await control(
      ref,
      present +
        (ready
          ? `\ntest -f "$d/ready" || { echo 'Sandbox preparation is incomplete' >&2; exit 1; }`
          : ''),
    )
    let transport: ComputerTransport = {
      execute: (script) =>
        options.transport.execute(inside(nameOf(ref), script)),
    }
    let workspace = executionWorkspace(g, transport, {
      workspace: ref.id,
      root,
      receipts: root + '/.yak/processes',
    })
    return { workspace, root, address: nameOf(ref) }
  }
  return {
    request: async (request: SandboxRequest) => {
      if (request.from && !options.prepare) {
        throw new Error('Docker commit preparation is not configured')
      }
      let image = request.image ?? options.image
      let spec = JSON.stringify({ from: request.from, image, root })
      await control(
        request,
        `test ! -f "$d/released" || { echo 'Sandbox was disposed' >&2; exit 1; }
if test -f "$d/claimed"; then
  test "$(cat "$d/spec")" = ${
          quote(spec)
        } || { echo 'Sandbox request changed' >&2; exit 1; }
  exists || { echo 'Interrupted or missing sandbox; refusing reconstruction' >&2; exit 1; }
else
  if exists; then echo 'Sandbox name already exists without ownership' >&2; exit 1; fi
  printf '%s' ${quote(spec)} > "$d/spec"
  touch "$d/claimed"
  sbx create --name "$name" --no-progress --env ${
          quote('YAK_SANDBOX_ID=' + request.id)
        }${image ? ' --template ' + quote(image) : ''} shell </dev/null
fi`,
      )
      // The shell template's default user need not own /. Create only the
      // configured root as root, then give that directory to the sandbox user.
      await control(
        request,
        `${present}
owner=$(sbx exec "$name" id -u </dev/null):$(sbx exec "$name" id -g </dev/null)
case "$owner" in *[!0-9:]*|:*) echo 'Invalid sandbox uid/gid' >&2; exit 1;; esac
${inside(nameOf(request), `mkdir -p -- ${quote(root)}`, true)}
sbx exec -u root "$name" chown "$owner" ${quote(root)} </dev/null`,
      )
      let connected = await connection(request, false)
      await connected.workspace.write(root + '/.yak/ready', '')
      // A completion marker is separate from creation: interrupted preparation
      // may be retried, so the supplied preparation must itself be idempotent.
      if (request.from) {
        let prepared = await control(
          request,
          `if test -f "$d/prepared"; then printf yes; fi`,
        )
        if (prepared != 'yes') {
          await options.prepare!(request.from, connected.workspace, root)
          await control(request, `${present}\ntouch "$d/prepared"`)
        }
      }
      await control(request, `${present}\ntouch "$d/ready"`)
      return connected
    },
    connect: (ref) => connection(ref),
    dispose: async (ref) => {
      await control(
        ref,
        `if test -f "$d/released"; then exit 0; fi
test -f "$d/claimed" || { echo 'Sandbox is not owned by this provider' >&2; exit 1; }
if exists; then owned || { echo 'Sandbox ownership changed' >&2; exit 1; }; sbx rm --force "$name" </dev/null; fi
touch "$d/released"`,
      )
    },
    export: async function* (ref, paths) {
      await control(ref, present)
      for (let path of paths) {
        exportPath(path)
        // realpath is evaluated inside the sandbox, and symlinks outside root
        // are refused even though the computer itself is never read here.
        let data = await options.transport.execute(inside(
          nameOf(ref),
          `set -eu
root=$(realpath -- ${quote(root)})
file=$(realpath -- ${quote(root + '/' + path)})
case "$file" in "$root"/*) base64 < "$file";; *) echo 'Export escapes sandbox root' >&2; exit 1;; esac`,
        ))
        yield {
          path,
          bytes: Uint8Array.from(
            atob(data.replaceAll(/\s/g, '')),
            (c) => c.charCodeAt(0),
          ),
        }
      }
    },
  }
}
