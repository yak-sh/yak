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
/** Idle containers sleep after five minutes, keeping their files. */
export let NAP = 300
export let SLEEP = `${NAP / 60}m`

export type CloudflareOptions = {
  env?: () => Promise<Record<string, string>>
  retry?: <T>(send: () => T | Promise<T>) => Promise<T>
  sleepError?: (error: unknown) => void
}

/** Cloudflare's synchronous exec is also used to expand artifact globs. */
export type CloudflareProvider = MachineProvider & {
  exec(ref: MachineRef, command: string): ReturnType<Box['exec']>
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
  let boxOf = (ref: MachineRef): Box => {
    if (ref.address != null) {
      throw new Error('cloudflare: cannot attach an existing machine')
    }
    let call = <T>(send: (box: Box) => T | Promise<T>) =>
      retry(() => send(ns.get(ns.idFromName(ref.id))))
    let dressed = async <T extends Run>(opts?: T) => ({
      ...opts,
      env: { ...await options.env?.(), ...opts?.env },
    })
    return {
      exec: (cmd, opts) =>
        call(async (box) => box.exec(cmd, await dressed(opts))),
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
    }
  }
  let wake = (ref: MachineRef) =>
    Promise.resolve({
      machine: machineOf(boxOf(ref)),
      cwd: CWD,
    })
  return {
    request: (request: MachineRequest) => {
      if (request.from != null || request.image != null) {
        throw new Error(
          "cloudflare: uses the namespace's deployed image; from and image are unsupported",
        )
      }
      let box = boxOf(request)
      // Configuration is a best-effort backstop. The SDK default still sleeps
      // a container if this RPC fails; the host reports the failure.
      Promise.resolve(box.setSleepAfter?.(SLEEP)).catch((e) =>
        options.sleepError?.(e)
      )
      return Promise.resolve({ machine: machineOf(box), cwd: CWD })
    },
    wake,
    release: async (ref) => {
      await boxOf(ref).destroy()
    },
    exec: (ref, command) => boxOf(ref).exec(command, { cwd: CWD }),
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
