// `serve` owns HTTP, not duties. Fill uncovered duty roles with an independent
// invocation of this checkout's CLI; singleton services still take the host's
// leases, and effects remain a pool. A successful worker outlives the web host.

import type { Graph } from '@yaks/graph'
import { gone, PROCESS, type Store, store as machine } from '@yaks/process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Roles advertised by running processes whose pids have not vanished. */
export let missing = async (
  processes: Store,
  roles: readonly string[],
  over: (eid: string) => Promise<boolean> = (eid) => gone(processes, eid),
): Promise<string[]> => {
  let needed = new Set(roles)
  if (!needed.size) return []
  for (let row of await processes.running()) {
    let process = row[PROCESS]
    if (
      !process || typeof process != 'object' || !('roles' in process) ||
      !Array.isArray(process.roles) ||
      !process.roles.some((role) => needed.has(role)) ||
      await over(row.entity.eid)
    ) continue
    for (let role of process.roles) needed.delete(role)
    if (!needed.size) return []
  }
  return roles.filter((role) => needed.has(role))
}

export type Monitor = {
  /** The initial inspection and recovery attempt, not the monitor's lifetime. */
  checked: Promise<void>
  /** Stop observations and unfinished launches; successful workers stay up. */
  close: () => Promise<void>
}

type Report = (error: unknown, role?: string) => void | Promise<void>
type After = (ms: number, run: () => void | Promise<void>) => () => void

/** Continuous coverage, with one inspection/launch at a time. Notifications
 * inspect immediately; polling also catches vanished pids without exit rows.
 * Launch failures retry at most once per interval, even during a change storm. */
export let monitor = (options: {
  uncovered: () => Promise<string[]>
  start: (roles: string[], signal: AbortSignal) => Promise<void>
  report: Report
  subscribe?: (changed: () => void) => () => void
  signal?: AbortSignal
  interval?: number
  after?: After
  now?: () => number
}): Monitor => {
  let interval = options.interval ?? 1000
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new RangeError('Duty coverage interval must be positive and finite')
  }
  let after: After = options.after ?? ((ms, run) => {
    let timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  })
  let now = options.now ?? Date.now
  let stop = new AbortController()
  let off = () => {}
  let cancel = () => {}
  let busy: Promise<void> | undefined
  let dirty = false
  let absent = new Set<string>()
  let retry = 0
  // A telemetry outage must not prevent restoring coverage or retrying it.
  let report = (error: unknown, role?: string) => {
    try {
      // Invoke before launch, but never wait for tracker delivery: the tracker
      // may itself need the duty we are restoring. The host owns its flush.
      void Promise.resolve(options.report(error, role)).catch(() => {})
    } catch { /* the host owns telemetry delivery */ }
  }
  let check = async () => {
    try {
      let needed = await options.uncovered()
      if (stop.signal.aborted) return
      let previous = absent
      absent = new Set(needed)
      for (let role of needed) {
        if (!previous.has(role)) {
          report(
            new Error(`No live process serves duty role "${role}"`),
            role,
          )
        }
      }
      if (!needed.length || stop.signal.aborted || now() < retry) return
      // Set before launching: its own process writes can notify us too.
      retry = now() + interval
      try {
        await options.start(needed, stop.signal)
      } catch (error) {
        retry = now() + interval
        if (!stop.signal.aborted) {
          for (let role of needed) report(error, role)
        }
      }
    } catch (error) {
      if (!stop.signal.aborted) report(error)
    }
  }
  let request = (): Promise<void> => {
    if (stop.signal.aborted) return Promise.resolve()
    dirty = true
    if (busy) return busy
    cancel()
    busy = (async () => {
      // Yield before inspecting so `busy` is assigned even for sync seams.
      await Promise.resolve()
      while (dirty && !stop.signal.aborted) {
        dirty = false
        await check()
      }
    })().finally(() => {
      busy = undefined
      if (!stop.signal.aborted) cancel = after(interval, request)
    })
    return busy
  }
  let close = async () => {
    if (!stop.signal.aborted) {
      stop.abort()
      cancel()
      off()
      options.signal?.removeEventListener('abort', abort)
    }
    await busy
  }
  let abort = () => void close()
  if (options.signal?.aborted) stop.abort()
  else {
    options.signal?.addEventListener('abort', abort, { once: true })
    off = options.subscribe?.(() => void request()) ?? off
  }
  return { checked: request(), close }
}

type Child = {
  pid: number
  status: Promise<{ code: number }>
  unref: () => void
  kill: (signal: 'SIGTERM') => void
}

/** Readiness is written only after the worker has assembled its duty host.
 * Death and timeout are errors, not a web server silently leaving work owed.
 * Only failed launches are stopped; this is not the managed process launcher. */
export let ready = async (
  child: Child,
  read: () => Promise<string | undefined>,
  timeout = 120000,
  pause: () => Promise<void> = () =>
    new Promise((done) => setTimeout(done, 50)),
  now: () => number = Date.now,
  signal?: AbortSignal,
): Promise<void> => {
  let ended: number | undefined
  child.unref()
  child.status.then((status) => ended = status.code, () => ended = -1)
  let deadline = now() + timeout
  let abort = () => {}
  let cancelled = new Promise<never>((_done, reject) => {
    abort = () => reject(signal?.reason ?? new Error('Duty launch cancelled'))
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
  try {
    while (true) {
      let said = await Promise.race([read(), cancelled])
      signal?.throwIfAborted()
      if (ended != null) {
        throw new Error(`Duty worker exited before readiness (code ${ended})`)
      }
      if (said?.trim() == String(child.pid)) return
      if (now() >= deadline) {
        throw new Error(`Duty worker did not become ready within ${timeout}ms`)
      }
      await Promise.race([pause(), cancelled])
    }
  } catch (error) {
    if (ended == null) {
      try {
        child.kill('SIGTERM')
      } catch (failure) {
        if (!(failure instanceof Deno.errors.NotFound)) throw failure
      }
    }
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

let start = async (
  path: string,
  roles: string[],
  signal: AbortSignal,
): Promise<void> => {
  let dir = await Deno.makeTempDir({ prefix: 'yak-work-' })
  let file = `${dir}/ready`
  try {
    // Null stdio and a new session keep the worker outside web shutdown's
    // process group. Never call `yak` from PATH: it may name another checkout.
    signal.throwIfAborted()
    let child = new Deno.Command('setsid', {
      args: [
        Deno.execPath(),
        'run',
        '-A',
        '--config',
        fileURLToPath(new URL('../../deno.json', import.meta.url)),
        Deno.mainModule,
        '--config',
        resolve(path),
        'work',
        '--roles',
        roles.join(','),
        '--ready',
        file,
      ],
      stdin: 'null',
      stdout: 'null',
      stderr: 'null',
    }).spawn()
    await ready(
      child,
      async () => {
        try {
          return await Deno.readTextFile(file)
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) return undefined
          throw error
        }
      },
      undefined,
      undefined,
      undefined,
      signal,
    )
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

/** Ensure duties outside this web host, without importing their facets here.
 * The host's feed observes independent workers; polling covers dead pids and
 * stores without a feed. A web with no inline duties still owns this monitor. */
export let external = (
  graph: Pick<Graph, 'read' | 'apply' | 'get'>,
  path: string,
  roles: readonly string[],
  options: {
    report: Report
    signal: AbortSignal
    subscribe?: (changed: () => void) => () => void
  },
): Monitor => {
  if (!roles.length) {
    return { checked: Promise.resolve(), close: () => Promise.resolve() }
  }
  let processes = machine(graph)
  return monitor({
    ...options,
    uncovered: () => missing(processes, roles),
    start: (roles, signal) => start(path, roles, signal),
  })
}
