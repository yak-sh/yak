// Cloudflare containers as providers of machines. The namespace supplies the
// deployed image; the host supplies invocation environment and RPC retry policy.
// Grants, accounts and billing are not container concerns.
import type {
  Machine,
  MachineProvider,
  MachineRef,
  MachineRequest,
} from './mod.ts'

/** How a command runs in the container: where, for how long at most, and with
 * what beside the container's own environment. */
type Run = { cwd?: string; timeout?: number; env?: Record<string, string> }

/** One sandbox, as this file asks for it: what the tools do with it, plus the
 * one knob the deploy has no way to set. The SDK's process calls answer
 * objects carrying methods as well; only their data is read here. */
export type Box = {
  getState(): Promise<{ status: string }>
  listProcesses(): Promise<BoxProcess[]>
  exec(
    cmd: string,
    opts?: Run,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>
  startProcess(
    cmd: string,
    opts?: Run & { autoCleanup?: boolean },
  ): Promise<{ id: string; pid?: number }>
  getProcess(
    id: string,
  ): Promise<{ pid?: number; status: string; exitCode?: number } | null>
  killProcess(id: string): Promise<unknown>
  getProcessLogs(id: string): Promise<{ stdout: string; stderr: string }>
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<unknown>
  writeFile(
    path: string,
    content: string,
    opts?: { encoding?: string },
  ): unknown
  readFile(
    path: string,
    opts?: { encoding?: string },
  ): Promise<{ content: string }>
  destroy(): Promise<unknown>
  setSleepAfter?(after: string): unknown
  setAllowedHosts?(hosts: string[]): unknown
}

/** The `SANDBOX` binding: a Durable Object namespace handing out one by name. */
export type Sandboxes = {
  idFromName(name: string): unknown
  get(id: unknown): Box
}

/** The deployed image's writable working directory. */
export let CWD = '/workspace'
/** Commands have a four-minute ceiling, including background processes. */
export let TIMEOUT = 240_000
/** Idle containers shut down after five minutes; their files are temporary. */
export let NAP = 300
export let SLEEP = `${NAP / 60}m`

/** `hosts` replaces the namespace's default list of where a container's
 * network reaches, for the containers this provider lends. `failed` hears a
 * configuration RPC that did not land; the container keeps what it had. */
export type CloudflareOptions = {
  env?: () => Promise<Record<string, string>>
  retry?: <T>(send: () => T | Promise<T>) => Promise<T>
  hosts?: string[]
  failed?: (error: unknown, what: 'sleep' | 'hosts') => void
}

/** Cloudflare's synchronous exec is also used to expand artifact globs. */
export type CloudflareProvider = MachineProvider & {
  exec(ref: MachineRef, command: string): ReturnType<Box['exec']>
  archive(ref: MachineRef): Promise<WorkspaceArchive>
  restore(ref: MachineRef, body: ReadableStream<Uint8Array>): Promise<void>
  active(ref: MachineRef): Promise<boolean>
  processes(ref: MachineRef): Promise<BoxProcess[]>
}

/** Process data detached from the SDK's process-control methods. */
export type BoxProcess = {
  id: string
  status: string
  pid?: number
  exitCode?: number
}

/** A bounded stream of a workspace's tar archive, with its temporary file's
 * lifetime explicit for callers that stop reading before the end. */
export type WorkspaceArchive = {
  body: ReadableStream<Uint8Array>
  size: number
  dispose(): Promise<void>
}

let CHUNK = 256 * 1024
let quoted = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
let base64 = (bytes: Uint8Array): string => {
  let parts: string[] = []
  for (let i = 0; i < bytes.length; i += 8192) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
  }
  return btoa(parts.join(''))
}
let checked = async (box: Box, command: string): Promise<string> => {
  let result = await box.exec(command, { timeout: TIMEOUT })
  if (result.exitCode !== 0) {
    throw new Error(`cloudflare: workspace command failed: ${result.stderr}`)
  }
  return result.stdout
}

let archive = async (box: Box): Promise<WorkspaceArchive> => {
  let path = quoted(`/tmp/yak-workspace-${crypto.randomUUID()}.tar`)
  let disposed = false
  let dispose = async () => {
    if (!disposed) {
      await checked(box, `rm -f -- ${path}`)
      disposed = true
    }
  }
  try {
    let stdout = await checked(
      box,
      `tar -C ${quoted(CWD)} -cf ${path} . && wc -c < ${path}`,
    )
    let size = Number(stdout.trim())
    if (!Number.isSafeInteger(size) || size < 0 || !stdout.trim()) {
      throw new Error('cloudflare: invalid workspace archive size')
    }
    let offset = 0
    let body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (disposed || offset === size) {
            await dispose()
            controller.close()
            return
          }
          let content = await checked(
            box,
            `set -o pipefail; dd if=${path} bs=${CHUNK} skip=${
              offset / CHUNK
            } count=1 status=none | base64`,
          )
          let bytes = Uint8Array.from(
            atob(content.trim()),
            (c) => c.charCodeAt(0),
          )
          if (bytes.length !== Math.min(CHUNK, size - offset)) {
            throw new Error('cloudflare: incomplete workspace archive')
          }
          offset += bytes.length
          controller.enqueue(bytes)
        } catch (error) {
          let failure = error
          try {
            await dispose()
          } catch (cleanup) {
            failure = new AggregateError(
              [error, cleanup],
              'workspace archive failed',
            )
          }
          controller.error(failure)
        }
      },
      cancel: dispose,
    }, { highWaterMark: 0 })
    return { body, size, dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}

let restore = async (
  box: Box,
  body: ReadableStream<Uint8Array>,
): Promise<void> => {
  let path = `/tmp/yak-workspace-${crypto.randomUUID()}.tar`
  let part = `${path}.part`
  let reader = body.getReader()
  try {
    await checked(box, `: > ${quoted(path)}`)
    let offset = 0
    for (;;) {
      let next = await reader.read()
      if (next.done) break
      for (let i = 0; i < next.value.length; i += CHUNK) {
        let bytes = next.value.subarray(i, i + CHUNK)
        await box.writeFile(part, base64(bytes), { encoding: 'base64' })
        // An RPC retry overwrites precisely the same bytes instead of appending.
        await checked(
          box,
          `dd if=${quoted(part)} of=${
            quoted(path)
          } bs=${CHUNK} seek=${offset} oflag=seek_bytes conv=notrunc status=none`,
        )
        offset += bytes.length
      }
    }
    // Root in the source can replace its tar binary or forge an archive. The
    // clean target's data filter refuses writes through escaping paths,
    // hardlinks and devices. Symbolic links themselves are workspace data
    // (a Python venv normally points at /usr/bin/python3); allow their targets
    // while still refusing any later member that writes through such a link.
    let extract = `import os, pathlib, tarfile
def workspace(member, dest):
 if not member.issym(): return tarfile.data_filter(member, dest)
 root = os.path.realpath(dest)
 path = pathlib.Path(dest, member.name)
 if member.name.startswith('/') or os.path.commonpath([root, str(path.parent.resolve())]) != root:
  raise tarfile.OutsideDestinationError(member, str(path))
 if path.is_symlink(): path.unlink()
 filtered = tarfile.data_filter(member.replace(linkname='.'), dest)
 return filtered.replace(linkname=member.linkname)
with tarfile.open(${JSON.stringify(path)}) as archive:
 archive.extractall(${JSON.stringify(CWD)}, filter=workspace)`
    await checked(box, `python3 -I -c ${quoted(extract)}`)
  } finally {
    try {
      await reader.cancel()
    } finally {
      reader.releaseLock()
      await checked(box, `rm -f -- ${quoted(path)} ${quoted(part)}`)
    }
  }
}

/** A provider bound to one deployed container namespace. Stable request ids
 * are the namespace names, so wake, export and release need no live handle.
 * `from`, `image` and addresses are refused: this namespace boots its deployed
 * image, not a graph commit or an existing machine. */
export let cloudflareProvider = (
  ns: Sandboxes,
  options: CloudflareOptions = {},
): CloudflareProvider => {
  let retry = options.retry ??
    (async <T>(send: () => T | Promise<T>) => await send())
  let boxOf = (ref: MachineRef, invocation = true): Box => {
    if (ref.address != null) {
      throw new Error('cloudflare: cannot attach an existing machine')
    }
    let call = <T>(send: (box: Box) => T | Promise<T>) =>
      retry(() => send(ns.get(ns.idFromName(ref.id))))
    let dressed = async <T extends Run>(opts?: T) => ({
      ...opts,
      ...(invocation
        ? { env: { ...await options.env?.(), ...opts?.env } }
        : {}),
    })
    return {
      exec: (cmd, opts) =>
        call(async (box) => box.exec(cmd, await dressed(opts))),
      getState: () => call((box) => box.getState()),
      listProcesses: () => call((box) => box.listProcesses()),
      startProcess: (cmd, opts) =>
        call(async (box) => box.startProcess(cmd, await dressed(opts))),
      getProcess: (id) => call((box) => box.getProcess(id)),
      killProcess: (id) => call((box) => box.killProcess(id)),
      getProcessLogs: (id) => call((box) => box.getProcessLogs(id)),
      mkdir: (path, opts) => call((box) => box.mkdir(path, opts)),
      writeFile: (path, content, opts) =>
        call((box) => box.writeFile(path, content, opts)),
      readFile: (path, opts) => call((box) => box.readFile(path, opts)),
      destroy: () => call((box) => box.destroy()),
      setSleepAfter: (after) => call((box) => box.setSleepAfter?.(after)),
      setAllowedHosts: (hosts) => call((box) => box.setAllowedHosts?.(hosts)),
    }
  }
  let wake = (ref: MachineRef) =>
    Promise.resolve({
      machine: machineOf(boxOf(ref)),
      cwd: CWD,
    })
  return {
    request: async (request: MachineRequest) => {
      if (request.from != null || request.image != null) {
        throw new Error(
          "cloudflare: uses the namespace's deployed image; from and image are unsupported",
        )
      }
      let box = boxOf(request)
      // Configuration is a best-effort backstop. The SDK default still sleeps
      // a container if this RPC fails; the host reports the failure.
      Promise.resolve(box.setSleepAfter?.(SLEEP)).catch((e) =>
        options.failed?.(e, 'sleep')
      )
      // Awaited, so the first command already reaches them. The SDK keeps
      // the list in the container's storage and applies it before each start.
      if (options.hosts) {
        await Promise.resolve(box.setAllowedHosts?.(options.hosts)).catch((
          e,
        ) => options.failed?.(e, 'hosts'))
      }
      return { machine: machineOf(box), cwd: CWD }
    },
    wake,
    release: async (ref) => {
      await boxOf(ref).destroy()
    },
    exec: (ref, command) => boxOf(ref).exec(command, { cwd: CWD }),
    archive: (ref) => archive(boxOf(ref, false)),
    restore: (ref, body) => restore(boxOf(ref, false), body),
    active: async (ref) => {
      let { status } = await boxOf(ref).getState()
      return status === 'running' || status === 'healthy'
    },
    processes: async (ref) =>
      (await boxOf(ref).listProcesses()).map((
        { id, status, pid, exitCode },
      ) => ({
        id,
        status,
        ...pid === undefined ? {} : { pid },
        ...exitCode === undefined ? {} : { exitCode },
      })),
    export: async function* (ref, paths) {
      // Absolute paths are kept for sandbox_ship's published contract. Relative
      // paths resolve from the deployed image's workspace.
      let box = boxOf(ref)
      for (let path of paths) {
        if (!path || path.split('/').includes('..')) {
          throw new Error(`cloudflare: invalid export path: ${path}`)
        }
        let { content } = await box.readFile(
          path.startsWith('/') ? path : `${CWD}/${path}`,
          { encoding: 'base64' },
        )
        yield {
          path,
          bytes: Uint8Array.from(atob(content.trim()), (c) => c.charCodeAt(0)),
        }
      }
    },
  }
}

// What the container calls a process that has not ended yet.
let RUNNING = new Set(['starting', 'running'])

let lines = (said: string) => said ? said.replace(/\n$/, '').split('\n') : []

/**
 * A container as the machine @yaks/harness's machine tools run on
 * (`machineTools`). Every command is a background process of the container's
 * own, bounded by {@link TIMEOUT} and kept after it exits so a later `wait`
 * still finds its code; the container's destruction clears them all.
 *
 * Its output is two streams where a box has one, so an answer's tail is what
 * it printed to stdout followed by what it printed to stderr, where a
 * compiler's errors are. A kill is the container's one kill: it takes no
 * signal, so SIGTERM and SIGKILL are the same call.
 */
let machineOf = (box: Box): Machine => ({
  // Every look is a call into the container, so it looks twice a second.
  poll: 500,
  start: async (command, cwd) =>
    (await box.startProcess(command, {
      cwd: cwd ?? CWD,
      timeout: TIMEOUT,
      autoCleanup: false,
    })).id,
  look: async (id) => {
    let p = await box.getProcess(id)
    return p && {
      ...p.pid ? { pid: p.pid } : {},
      ...RUNNING.has(p.status) ? {} : { exit: { code: p.exitCode ?? null } },
    }
  },
  tail: async (id, n) => {
    let { stdout, stderr } = await box.getProcessLogs(id)
    return [...lines(stdout), ...lines(stderr)].slice(-n)
  },
  kill: async (id) => {
    await box.killProcess(id)
  },
  read: async (path) => (await box.readFile(path)).content,
  write: async (path, content) => {
    let dir = path.slice(0, path.lastIndexOf('/'))
    if (dir) await box.mkdir(dir, { recursive: true })
    await box.writeFile(path, content)
  },
})
