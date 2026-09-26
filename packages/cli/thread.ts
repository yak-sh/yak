// The thread a `yak` process runs its duties in: the effect pool and the
// plugins' services, where no process that stays up is running them, kept off
// the thread that runs the command and draws its answer.
//
// It is the same process, not a second one: the thread opens the same graph
// through its own connection for the roles it is handed (./worker.ts), writes
// as the process that started it (@yaks/process `become`), and writes no row of
// its own on the way in or out (host.ts `joins`). What the command writes is
// written down for the pool as it commits, the thread is told to look, and
// before the process ends it runs one last pass over what is left, then
// closes.
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

/** What the thread is started with: the config to compose, the duty roles it
 * composes, the process it is part of, and the roles nobody else serves, which
 * its first pass takes (every one of them where absent). */
export type Start = { config: string; roles: Role[]; me: Eid; idle?: Role[] }

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
  /** what it would take: the config, the duty roles, the process */
  plan: (start: Start) => void
  /** start it now, for one pass of each idle role on the way in */
  start: (idle?: Role[]) => void
  /** end it where it stands, for a process that waited long enough: the
   * worker is terminated, and whoever waits on it goes on */
  end: () => void
}

/** A thread for this process's duties, not started yet. */
export let thread = (): Aside => {
  let worker: Worker | undefined
  let planned = Promise.withResolvers<Start | undefined>()
  let plan: Start | undefined
  let passed = Promise.withResolvers<void>()
  let stopped = Promise.withResolvers<void>()
  let closed = Promise.withResolvers<void>()
  let all = [passed, stopped, closed]
  // Awaited by whoever asks; nobody asking is not an unhandled rejection.
  for (let p of all) p.promise.catch(() => {})
  let fail = (error: Error) => all.forEach((p) => p.reject(error))
  // Once ended, never started again: the process is on its way out.
  let over = false
  let end = () => {
    over = true
    worker?.terminate()
    worker = undefined
    fail(new Error('the duty thread was ended before it closed'))
  }
  let tell = (said: Said) => worker?.postMessage(said)
  let spawn = (idle?: Role[]) => {
    if (over || worker || !plan?.roles.length) return
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
        : fail(new Error(data.failed))
    worker.onerror = (e) => {
      e.preventDefault()
      fail(e.error instanceof Error ? e.error : new Error(e.message))
    }
    tell({ start: { ...plan, ...idle ? { idle } : {} } })
  }
  return {
    plan: (start) => planned.resolve(plan = start),
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
    end,
    close: async () => {
      // A thread nobody planned by now never will be.
      planned.resolve(undefined)
      if (!worker) return
      tell({ close: true })
      try {
        await closed.promise
      } finally {
        end()
      }
    },
  }
}
