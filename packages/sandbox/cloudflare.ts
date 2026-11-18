// Cloudflare containers as sandbox providers. The namespace supplies the
// deployed image; the host supplies invocation environment and RPC retry policy.
// Grants, accounts and billing are not container concerns.
import { type Bundle, type Comp, identityEid } from '@yaks/graph'
import { shellStat, type Workspace } from '@yaks/machine'
import type {
  SandboxFile,
  SandboxProvider,
  SandboxRef,
  SandboxRequest,
} from './provider.ts'

/** How a command runs in the container: where, for how long at most, and with
 * what beside the container's own environment. */
type Run = { cwd?: string; timeout?: number; env?: Record<string, string> }

/** One sandbox, as this file asks for it: what the tools do with it, plus the
 * one knob the deploy has no way to set. The SDK's process calls answer
 * objects carrying methods as well; only their data is read here. */
export type Box = {
  getState(): Promise<{ status: string }>
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

/** The sandboxes binding: a Durable Object namespace handing out one by name. */
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
/** How long one call keeps a container awake, in seconds: the longest
 * command, then the nap before it sleeps on its own. */
export let HELD = TIMEOUT / 1000 + NAP

/** The container a group lends one person, by name: one each, so the
 * person's every way in reaches one workbench. The group's id rather than a
 * name of it, since a renamed group keeps its containers. */
export let named = (within: string, to: string) => `build-${within}-${to}`

/** Where a group's lent sandboxes are kept: a graph store's reads and
 * writes, `lent` among its words. */
export type Lending = {
  read(line: string): Bundle[] | Promise<Bundle[]>
  apply(bundles: Bundle[]): unknown
}

/** One lent sandbox: whom it is lent to, and the second it sleeps by (0 once
 * it is known to be asleep). */
export type Lent = { to: string; until: number }

let lentRow = (within: string, to: string, until: number | null): Bundle => ({
  entity: { eid: identityEid('lent', [within, to]) },
  lent: {
    to,
    within,
    until: until == null ? null : new Date(until * 1000).toISOString(),
  },
})

/** Every sandbox the group has lent, awake or asleep: whose editable files
 * must survive group trash, members who have since left included. */
export let lending = async (
  store: Lending,
  within: string,
): Promise<Lent[]> =>
  (await store.read(`.lent.within=${within}`)).map((row) => {
    let { to, until } = row.lent as Comp
    return {
      to: String(to),
      until: until ? Math.floor(Date.parse(String(until)) / 1000) : 0,
    }
  })

/** How many of the group's sandboxes are awake at second `now` beside `to`'s. */
export let awakeBeside = (lent: Lent[], to: string, now: number): number =>
  lent.filter((l) => l.to != to && l.until > now).length

/**
 * `to`'s sandbox in the group, held awake for {@link HELD} more seconds —
 * unless `allowed` others already are, when nothing is written and the answer
 * is how many. The row is written only once its hold is half spent: a build
 * calls faster than its store need hear about it.
 */
export let hold = async (
  store: Lending,
  within: string,
  to: string,
  allowed: number,
  now: number = Date.now(),
): Promise<{ held: true } | { held: false; awake: number }> => {
  let t = Math.floor(now / 1000)
  let lent = await lending(store, within)
  let awake = awakeBeside(lent, to, t)
  if (awake >= allowed) return { held: false, awake }
  let mine = lent.find((l) => l.to == to)
  if (!mine || mine.until - t <= HELD / 2) {
    await store.apply([lentRow(within, to, t + HELD)])
  }
  return { held: true }
}

/** `to`'s sandbox in the group, asleep: a stopped container gives its place
 * back at once rather than when its nap would. */
export let slept = async (
  store: Lending,
  within: string,
  to: string,
): Promise<void> => {
  await store.apply([lentRow(within, to, null)])
}

/** Stored outside the container. locked serializes lifecycle calls across
 * hosts; save is durable before it resolves. Disposal receipts must be kept. */
export type CloudflareLifecycle = {
  locked<T>(
    id: string,
    act: (receipt: {
      state?: 'provisioning' | 'ready' | 'disposing' | 'released'
      save(
        state: 'provisioning' | 'ready' | 'disposing' | 'released',
      ): Promise<void>
    }) => Promise<T>,
  ): Promise<T>
}

export type CloudflareOptions = {
  /** Mandatory for durable sandbox lifecycle, unless `ephemeral`. */
  lifecycle?: CloudflareLifecycle
  /** The container's disk does not outlive its {@link NAP}: connect wakes a
   * fresh one from the deployed image and keeps no lifecycle receipts, as a
   * deployed Cloudflare Container does. */
  ephemeral?: boolean
  /** Prepare existing writable storage before each public workspace RPC,
   * including restoration after an ephemeral container wakes. */
  prepare?: (ref: SandboxRef, box: Box) => Promise<void>
  /** Preserve recoverable writable storage, then stop the container. This
   * boundary owns teardown; disposal never calls destroy on its own. */
  trash?: (ref: SandboxRef, box: Box) => Promise<void>
  /** Explicitly restore a durable resource retained by trash. */
  restore?: (ref: SandboxRef, box: Box) => Promise<void>
  env?: () => Promise<Record<string, string>>
  retry?: <T>(send: () => T | Promise<T>) => Promise<T>
  sleepError?: (error: unknown) => void
}

/** Cloudflare's synchronous exec is also used to expand artifact globs. */
export type CloudflareProvider = SandboxProvider & {
  exec(ref: SandboxRef, command: string): ReturnType<Box['exec']>
  /** writes one file's bytes, as `export` reads them: an absolute path is
   * kept, a relative one is under {@link CWD}, and its directory is made */
  put(ref: SandboxRef, file: SandboxFile): Promise<void>
}

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

/** A provider bound to one deployed container namespace. Stable request ids
 * are the namespace names, so connect, export and dispose need no live handle.
 * `from`, `image` and addresses are refused: this namespace boots its deployed
 * image, not a graph commit or an existing sandbox. */
export let cloudflareProvider = (
  ns: Sandboxes,
  options: CloudflareOptions = {},
): CloudflareProvider => {
  let retry = options.retry ??
    (async <T>(send: () => T | Promise<T>) => await send())
  let boxOf = (ref: SandboxRef, invocation = true, internal = false): Box => {
    if (ref.address != null) {
      throw new Error('cloudflare: cannot attach an existing sandbox')
    }
    let call = <T>(send: (box: Box) => T | Promise<T>) =>
      retry(async () => {
        if (options.ephemeral || internal) {
          let box = ns.get(ns.idFromName(ref.id))
          if (!internal) await options.prepare?.(ref, box)
          return await send(box)
        }
        if (!options.lifecycle) {
          throw new Error('cloudflare: durable lifecycle storage is required')
        }
        return await options.lifecycle.locked(ref.id, async ({ state }) => {
          if (state != 'ready') {
            throw new Error('cloudflare: sandbox is not ready or was disposed')
          }
          let box = ns.get(ns.idFromName(ref.id))
          let { status } = await box.getState()
          if (status != 'running' && status != 'healthy') {
            throw new Error(
              'cloudflare: sandbox storage is unavailable; refusing recreation',
            )
          }
          // Hold the lifecycle lock through RPC completion: disposal cannot
          // race a stale workspace handle into recreating destroyed storage.
          await options.prepare?.(ref, box)
          return await send(box)
        })
      })
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
  let lifecycle = <T>(
    ref: SandboxRef,
    act: (
      receipt: Parameters<Parameters<CloudflareLifecycle['locked']>[1]>[0],
    ) => Promise<T>,
  ) => {
    // Validate addresses even when no lifecycle store is configured.
    boxOf(ref)
    if (!options.lifecycle) {
      throw new Error('cloudflare: durable lifecycle storage is required')
    }
    return options.lifecycle.locked(ref.id, act)
  }
  let connection = (ref: SandboxRef) => ({
    workspace: workspaceOf(boxOf(ref)),
    root: CWD,
  })
  return {
    request: async (request: SandboxRequest) => {
      if (request.from != null || request.image != null) {
        throw new Error(
          "cloudflare: uses the namespace's deployed image; from and image are unsupported",
        )
      }
      let prepare = async () => {
        let box = boxOf(request, true, true)
        // mkdir is idempotent and starts the namespace's deployed image.
        if (!options.ephemeral) await box.mkdir(CWD, { recursive: true })
        await Promise.resolve(box.setSleepAfter?.(SLEEP)).catch((e) =>
          options.sleepError?.(e)
        )
        return connection(request)
      }
      if (options.ephemeral) return await prepare()
      return await lifecycle(request, async (receipt) => {
        if (receipt.state == 'released' || receipt.state == 'disposing') {
          throw new Error('cloudflare: sandbox was disposed; request a new id')
        }
        if (receipt.state == 'ready') {
          let { status } = await boxOf(request, true, true).getState()
          if (status != 'running' && status != 'healthy') {
            throw new Error(
              'cloudflare: sandbox storage is unavailable; refusing recreation',
            )
          }
          return connection(request)
        }
        if (receipt.state == 'provisioning') {
          // An interrupted first request may have created writable storage.
          // A stopped/missing instance cannot prove that storage survived.
          let { status } = await boxOf(request, true, true).getState()
          if (status != 'running' && status != 'healthy') {
            throw new Error(
              'cloudflare: interrupted provisioning; refusing recreation',
            )
          }
        }
        await receipt.save('provisioning')
        let lent = await prepare()
        await receipt.save('ready')
        return lent
      })
    },
    connect: async (ref) => {
      if (options.ephemeral) return connection(ref)
      return await lifecycle(ref, async ({ state }) => {
        if (state != 'ready') {
          throw new Error('cloudflare: sandbox is not ready or was disposed')
        }
        let { status } = await boxOf(ref, true, true).getState()
        if (status != 'running' && status != 'healthy') {
          throw new Error(
            'cloudflare: sandbox storage is unavailable; refusing recreation',
          )
        }
        return connection(ref)
      })
    },
    dispose: async (ref) => {
      if (!options.trash) {
        throw new Error('cloudflare: recoverable trash storage is required')
      }
      let trash = () => options.trash!(ref, boxOf(ref, true, true))
      if (options.ephemeral) {
        await trash()
        return
      }
      await lifecycle(ref, async (receipt) => {
        if (receipt.state == 'released') return
        await receipt.save('disposing')
        await trash()
        await receipt.save('released')
      })
    },
    restore: async (ref) => {
      if (!options.restore) {
        throw new Error('cloudflare: restore is not configured')
      }
      await lifecycle(ref, async (receipt) => {
        if (receipt.state == 'ready') return
        await options.restore!(ref, boxOf(ref, true, true))
        await receipt.save('ready')
      })
    },
    exec: (ref, command) => boxOf(ref).exec(command, { cwd: CWD }),
    put: async (ref, { path, bytes }) => {
      let box = boxOf(ref)
      let at = path.startsWith('/') ? path : `${CWD}/${path}`
      let dir = at.slice(0, at.lastIndexOf('/'))
      if (dir) await box.mkdir(dir, { recursive: true })
      await box.writeFile(at, base64(bytes), { encoding: 'base64' })
    },
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
 * A container as the workspace @yaks/harness's machine tools run on
 * (`machineTools`). Every command is a background process of the container's
 * own, bounded by {@link TIMEOUT} and kept after it exits so a later `wait`
 * still finds its code; the container's destruction clears them all.
 *
 * Its output is two streams where a box has one, so an answer's tail is what
 * it printed to stdout followed by what it printed to stderr, where a
 * compiler's errors are. A kill is the container's one kill: it takes no
 * signal, so SIGTERM and SIGKILL are the same call.
 */
let workspaceOf = (box: Box): Workspace => ({
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
  stat: shellStat((script) => checked(box, `cd ${CWD} || exit 1\n${script}`)),
  write: async (path, content) => {
    let dir = path.slice(0, path.lastIndexOf('/'))
    if (dir) await box.mkdir(dir, { recursive: true })
    await box.writeFile(path, content)
  },
})
