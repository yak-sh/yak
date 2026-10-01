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
  let covered = new Set<string>()
  for (let row of await processes.running()) {
    let process = row[PROCESS]
    if (
      !process || typeof process != 'object' || !('roles' in process) ||
      !Array.isArray(process.roles) || await over(row.entity.eid)
    ) continue
    for (let role of process.roles) {
      if (typeof role == 'string') covered.add(role)
    }
  }
  return roles.filter((role) => !covered.has(role))
}

/** The only seam needed to check fallback without starting real workers. */
export let fallback = async (
  roles: readonly string[],
  uncovered: () => Promise<string[]>,
  start: (roles: string[]) => Promise<void>,
): Promise<void> => {
  if (!roles.length) return
  let needed = await uncovered()
  if (needed.length) await start(needed)
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
  timeout = 15000,
  pause: () => Promise<void> = () =>
    new Promise((done) => setTimeout(done, 50)),
  now: () => number = Date.now,
): Promise<void> => {
  let ended: number | undefined
  child.unref()
  child.status.then((status) => ended = status.code, () => ended = -1)
  let deadline = now() + timeout
  try {
    while (true) {
      let said = await read()
      if (ended != null) {
        throw new Error(`Duty worker exited before readiness (code ${ended})`)
      }
      if (said?.trim() == String(child.pid)) return
      if (now() >= deadline) {
        throw new Error(`Duty worker did not become ready within ${timeout}ms`)
      }
      await pause()
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
  }
}

let start = async (path: string, roles: string[]): Promise<void> => {
  let dir = await Deno.makeTempDir({ prefix: 'yak-work-' })
  let file = `${dir}/ready`
  try {
    // Null stdio and a new session keep the worker outside web shutdown's
    // process group. Never call `yak` from PATH: it may name another checkout.
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
    await ready(child, async () => {
      try {
        return await Deno.readTextFile(file)
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return undefined
        throw error
      }
    })
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

/** Ensure duties outside this web host, without importing their facets here. */
export let external = (
  graph: Pick<Graph, 'read' | 'apply' | 'get'>,
  path: string,
  roles: readonly string[],
): Promise<void> => {
  let processes = machine(graph)
  return fallback(
    roles,
    () => missing(processes, roles),
    (roles) => start(path, roles),
  )
}
