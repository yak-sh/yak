// A host's effects, drained: it leaves the pool, claiming nothing more, and
// waits for every run it started to finish, however long each one takes
// (@yaks/effects `stop`). While it waits it says which runs it is waiting on,
// as the wait begins and every half minute after, so a stop that takes
// minutes says why in the log instead of looking hung.

import type { Effects, Run } from '@yaks/effects'
import type { Graph } from '@yaks/graph'
import { human } from '@yaks/id'

/** How often a drain says what it is still waiting on (ms). */
export let EVERY = 30_000

// A duration as a person reads it.
let took = (ms: number) => {
  let s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`
}

/**
 * What a drain says while runs are going: each run's handler, its target by
 * `name`, and how long it has run.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { waiting } from './drain.ts'
 *
 * let runs = [{ eid: 'r', handler: 'session_run', target: 's', since: 0 }]
 * assertEquals(
 *   waiting(runs, () => 'S-7', 95_000),
 *   'winding down — waiting on session_run S-7 (1m35s)',
 * )
 * ```
 */
export let waiting = (
  runs: Run[],
  name: (eid: string) => string,
  now: number,
): string =>
  'winding down — waiting on ' +
  runs.map((r) => `${r.handler} ${name(r.target)} (${took(now - r.since)})`)
    .join(', ')

/** Leave the pool and wait for what was started, telling `say` what is still
 * running while it goes. */
export let drain = async (
  fx: Pick<Effects, 'stop' | 'running'>,
  g: Pick<Graph, 'get' | 'vocab'>,
  say: (line: string) => void,
  every = EVERY,
): Promise<void> => {
  let stopped = fx.stop()
  let tell = async () => {
    let runs = fx.running()
    if (!runs.length) return
    let id = human(g.vocab)
    let rows = await g.get(runs.map((r) => r.target))
    let names = new Map(rows.map((b) => [b.entity.eid, id(b)]))
    say(waiting(runs, (eid) => names.get(eid) ?? eid, Date.now()))
  }
  let timer = setInterval(() => void tell().catch(() => {}), every)
  try {
    await tell().catch(() => {})
    await stopped
  } finally {
    clearInterval(timer)
  }
}
