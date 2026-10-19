// Durable command receipts live on the launch filesystem, not in a connector
// object's memory. Reconnecting observes that receipt and never relaunches it.
import { scope } from '@yaks/process/isolate'
import { CallError } from '@yaks/tools/errors'
import type { Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { Proc } from './mod.ts'
import {
  type ComputerTransport,
  quote,
  type Workspace,
  type WorkspaceTarget,
} from './workspace.ts'

let absolute = (path: string) => {
  if (
    !path.startsWith('/') || path.includes('\0') ||
    path.split('/').includes('..')
  ) throw new Error('Workspace paths must be absolute and contain no ..')
  return path.replace(/\/+$/, '') || '/'
}
let fileAt = (root: string, path: string) =>
  absolute(path.startsWith('/') ? path : root + '/' + path)
let safeId = (id: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('Invalid durable process handle')
  }
  return id
}
let encode = (text: string) => {
  let bytes = new TextEncoder().encode(text), out = ''
  for (let byte of bytes) out += String.fromCharCode(byte)
  return btoa(out)
}
let decode = (text: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(text.replaceAll(/\s/g, '')), (c) => c.charCodeAt(0)),
  )

// A PID is safe to signal only while its original Linux birth token matches.
// The supervisor creates its own session; no unrelated/adopted process is killed.
let identity =
  `token() { test -r /proc/"$1"/stat || return 1; cat /proc/sys/kernel/random/boot_id; sed 's/.*) //' /proc/"$1"/stat 2>/dev/null | awk '{print $20}'; }
owned() { test -f "$d/pid" && test -f "$d/birth" || return 1; pid=$(cat "$d/pid"); case "$pid" in ''|*[!0-9]*) return 1;; esac; test "$(token "$pid")" = "$(cat "$d/birth")" && test -n "$(cat "$d/birth")"; }`

/** Bind a concrete workspace to an explicitly connected Linux computer.
 * bash, setsid, flock, base64 and /proc are required at the target. No default
 * computer or caller-relative receipt directory is inferred. */
export let executionWorkspace = (
  g: Graph,
  transport: ComputerTransport,
  target: WorkspaceTarget,
): Workspace => {
  let root = absolute(target.root), receipts = absolute(target.receipts)
  let location = (id: string) =>
    `${receipts}/${safeId(target.workspace)}/${safeId(id)}`
  let processFor = (call: string) =>
    derivedEid(`workspace process|${target.workspace}|${call}`)
  let row = async (id: string) => {
    let [record] = await g.get([id])
    if (!record?.process) return
    let process = record.process as Comp
    if (process.workspace != target.workspace) {
      throw new Error('Process belongs to another workspace')
    }
    return { process, exit: record.exit }
  }
  let observed = async (id: string): Promise<Proc | null> => {
    let record = await row(id)
    if (!record) return null
    let data = await transport.execute(
      `set -eu\nd=${quote(location(id))}\n${identity}
if test -f "$d/exit"; then printf 'exit '; cat "$d/exit"
elif owned; then printf 'running %s' "$pid"
elif test -f "$d/exit"; then printf 'exit '; cat "$d/exit"
elif test -f "$d/launched"; then printf 'lost'
else printf 'pending'; fi`,
    )
    let [state, value] = data.trim().split(/\s+/)
    if (state == 'exit' || state == 'lost') {
      let code = state == 'exit' ? Number(value) : null
      if (code != null && !Number.isSafeInteger(code)) {
        throw new Error('Invalid process exit receipt')
      }
      if (!record.exit) {
        await g.apply([{
          entity: { eid: id },
          exit: code == null ? {} : { code },
        }])
      }
      return {
        ...record.process.pid != null
          ? { pid: Number(record.process.pid) }
          : {},
        exit: { code },
      }
    }
    if (state == 'running') {
      let pid = Number(value)
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        throw new Error('Invalid process pid receipt')
      }
      if (record.process.pid != pid) {
        await g.apply([{ entity: { eid: id }, process: { pid } }])
      }
      return { pid }
    }
    if (state != 'pending') throw new Error('Invalid process receipt')
    return {}
  }
  return {
    start: async (command, cwd, call) => {
      let directory = cwd == null ? root : fileAt(root, cwd)
      let id = call ? processFor(call) : crypto.randomUUID()
      let prior = await row(id)
      if (
        prior &&
        (prior.process?.command != command || prior.process?.cwd != directory)
      ) {
        throw new Error(
          'Call receipt already names another command or directory',
        )
      }
      if (!prior) {
        try {
          await g.apply([{
            entity: { eid: id },
            process: { workspace: target.workspace, command, cwd: directory },
            $was: { process: { workspace: null } },
          }])
        } catch (error) {
          let winner = await row(id)
          if (
            !winner || winner.process?.command != command ||
            winner.process?.cwd != directory
          ) throw error
        }
      }
      let d = location(id)
      let supervisor = `d=${quote(d)}
${identity}
printf '%s' "$$" > "$d/pid"
token "$$" > "$d/birth"
touch "$d/launched"
set +e
(cd -- ${quote(directory)} && bash -c ${quote(command)})
code=$?
printf '%s' "$code" > "$d/exit.tmp"
mv -- "$d/exit.tmp" "$d/exit"`
      // flock serializes competing workers at the original target. A claim is
      // never removed: interruption between claim and launch is ambiguous, not
      // permission to execute a non-idempotent command again.
      await transport.execute(`set -eu
umask 077
d=${quote(d)}
mkdir -p -- "$d"
exec 9>"$d/lock"
flock -x 9
if test ! -f "$d/claimed"; then
  touch "$d/claimed"
  printf '%s' ${quote(supervisor)} > "$d/run"
  if test -d /run/systemd/system; then
    uid=$(id -u)
    export XDG_RUNTIME_DIR="/run/user/$uid"
    export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus"
    ${
        scope('yak-process-' + id).map(quote).join(' ')
      } setsid bash "$d/run" 9>&- </dev/null >"$d/output" 2>&1 &
  else
    setsid bash "$d/run" 9>&- </dev/null >"$d/output" 2>&1 &
  fi
  launcher=$!
  while test ! -f "$d/launched"; do
    if ! kill -0 "$launcher" 2>/dev/null; then wait "$launcher"; exit 1; fi
    sleep 0.01
  done
fi`)
      await observed(id)
      return id
    },
    receipt: async (call) => {
      let id = processFor(call)
      return await row(id) ? id : undefined
    },
    look: observed,
    tail: async (id, n) => {
      if (!Number.isSafeInteger(n) || n < 0) {
        throw new Error('Tail count must be a nonnegative integer')
      }
      if (!await row(id) || n == 0) return []
      let output = await transport.execute(
        `d=${
          quote(location(id))
        }; if test -f "$d/output"; then tail -n ${n} -- "$d/output"; fi`,
      )
      return output ? output.replace(/\n$/, '').split('\n') : []
    },
    kill: async (id, signal) => {
      if (!['SIGTERM', 'SIGKILL'].includes(signal)) {
        throw new Error('Unsupported process signal')
      }
      if (!await row(id)) return
      await transport.execute(
        `set -eu\nd=${
          quote(location(id))
        }\n${identity}\nif test ! -f "$d/exit" && owned; then kill -${
          signal.slice(3)
        } -- -"$pid"; fi`,
      )
    },
    read: async (path) => {
      // Missing/unreadable user paths are an invocation result, not a broken
      // computer connector. Keep the control script successful in that case.
      let answer = await transport.execute(
        `file=${
          quote(fileAt(root, path))
        }; if test -f "$file" && test -r "$file"; then printf 'ok\n'; base64 < "$file"; else printf 'path\n'; fi`,
      )
      if (answer.startsWith('path\n')) {
        throw new CallError(
          'path',
          'File is not a readable regular file: ' + path,
        )
      }
      if (!answer.startsWith('ok\n')) {
        throw new Error('Invalid workspace file response')
      }
      return decode(answer.slice(3))
    },
    write: async (path, content) => {
      let file = fileAt(root, path),
        parent = file.slice(0, file.lastIndexOf('/')) || '/'
      await transport.execute(
        `set -eu; mkdir -p -- ${quote(parent)}; printf '%s' ${
          quote(encode(content))
        } | base64 -d > ${quote(file)}`,
      )
    },
  }
}
