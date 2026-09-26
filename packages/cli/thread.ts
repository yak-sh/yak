// The thread a `yak` process runs its duties in: the effect pool and the
// plugins' services, where no process that stays up is running them, kept off
// the thread that runs the command and draws its answer.
//
// It is a thread of the same process, and a host of its own: it opens the same
// graph through its own connection for the roles it is handed (./worker.ts),
// under the name the process gives it here (@yaks/process `become`), and
// writes its own `process` row, which its leases and claims name. What the
// command writes is written down for the pool as it commits, the thread is
// told to look, and before the process ends it runs one last pass over what is
// left, then closes. A thread ended where it stands, or one that fails, writes
// no ending, and its pid is the process's, which goes on: so the process
// writes its ending for it (host.ts `Host.end`), under the name it gave it.
//
// It is planned once the command's own host is open, because only then can the
// process say which duty roles its graph has and ask which of them nobody is
// serving (local.ts). A command passing through starts it only where one of
// them is idle, for one pass of those alone: a role another process serves is
// that process's, and a second worker on it is only a second writer waiting on
// the same lock. A process that stays up starts it whenever it asks for its
// duties to go on, since a holder that dies later is one it has to take over
// from, and it goes on with every duty role, leaving each lease, and the pool,
// to settle who does what.

import type { Eid } from '@yaks/graph'
import type { Role, Thread } from './host.ts'

/** What the thread would take: the config to compose, and the duty roles it
 * composes. */
export type Plan = { config: string; roles: Role[] }

/** What the thread is started with: its plan, the name it runs as, and the
 * roles nobody else serves, which its first pass takes (every one of them
 * where absent). */
export type Start = Plan & { me: Eid; idle?: Role[] }

/** What the process says to its thread. */
export type Said =
  | { start: Start }
  | { live: true }
  | { stop: true }
  | { nudge: true }
  | { close: true }

/** What the thread says back: its first pass done, its live duties stopped,
 * closed, or the error it failed with. */
export type Heard =
  | { passed: true }
  | { stopped: true }
  | { closed: true }
  | { failed: string }

/** A thread for this process's duties ({@link Thread}), planned once the
 * roles it would take are known, and started when there is something for it
 * to do. */
export type Aside = Thread & {
  /** what it would take: the config, and the duty roles */
  plan: (plan: Plan) => void
  /** start it now, for one pass of each idle role on the way in */
  start: (idle?: Role[]) => void
  /** end it where it stands, for a process that waited long enough: the
   * worker is terminated, and whoever waits on it goes on, told it is gone */
  end: () => void
}

/** A thread for this process's duties, not started yet. */
export let thread = (): Aside => {
  let me = crypto.randomUUID() as Eid
  let worker: Worker | undefined
  let planned = Promise.withResolvers<Plan | undefined>()
  let plan: Plan | undefined
  let passed = Promise.withResolvers<void>()
  let stopped = Promise.withResolvers<void>()
  let closed = Promise.withResolvers<void>()
  let all = [passed, stopped, closed]
  // Awaited by whoever asks; nobody asking is not an unhandled rejection.
  for (let p of all) p.promise.catch(() => {})
  // Once started, it closes or it is ended: a thread that failed is ended
  // too, so nothing runs on under a name its host has written the ending of.
  // Once ended, never started again: the process is on its way out.
  let born = false
  let over = false
  let end = (
    error = new Error('the duty thread was ended before it closed'),
  ) => {
    over = true
    worker?.terminate()
    worker = undefined
    all.forEach((p) => p.reject(error))
  }
  let tell = (said: Said) => worker?.postMessage(said)
  let spawn = (idle?: Role[]) => {
    if (over || worker || !plan?.roles.length) return
    born = true
    worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = ({ data }: MessageEvent<Heard>) =>
      'passed' in data
        ? passed.resolve()
        : 'stopped' in data
        ? stopped.resolve()
        : 'closed' in data
        ? closed.resolve()
        : end(new Error(data.failed))
    worker.onerror = (e) => {
      e.preventDefault()
      end(e.error instanceof Error ? e.error : new Error(e.message))
    }
    tell({ start: { ...plan, me, ...idle ? { idle } : {} } })
  }
  return {
    me,
    plan: (given) => planned.resolve(plan = given),
    start: spawn,
    duties: async (signal) => {
      if (!await planned.promise) return
      if (signal.aborted) return worker ? passed.promise : undefined
      spawn()
      if (!worker) return
      tell({ live: true })
      signal.addEventListener('abort', () => tell({ stop: true }), {
        once: true,
      })
      await stopped.promise
    },
    nudge: () => tell({ nudge: true }),
    end: () => end(),
    close: async () => {
      // A thread nobody planned by now never will be; one ended before this
      // says so.
      planned.resolve(undefined)
      if (!born) return
      tell({ close: true })
      try {
        await closed.promise
      } finally {
        end()
      }
    },
  }
}
