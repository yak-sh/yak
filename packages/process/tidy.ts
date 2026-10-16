// Machines share the process-file directory, even when each lend creates a new
// machine. Keep both the hourly throttle and in-flight sweep at that boundary.

import { resolve } from '@std/path/posix/resolve'
import { type Opts, paths, sweep } from './run.ts'
import type { Store } from './store.ts'

let HOUR = 60 * 60 * 1000
let DAY = 24 * HOUR

export let tidier = (run = sweep, now = Date.now) => {
  let directories = new Map<string, { at: number; pending: boolean }>()
  return (processes: Store, opts: Opts): void => {
    let dir = resolve(paths('', opts).code, '..')
    let prior = directories.get(dir)
    if (prior && (prior.pending || now() - prior.at < HOUR)) return
    let state = { at: now(), pending: true }
    directories.set(dir, state)
    run(DAY, { ...opts, dir }, processes)
      .catch((e) => console.error('process sweep failed:', e))
      .finally(() => {
        state.at = now()
        state.pending = false
      })
  }
}

export let tidy = tidier()
