// `yak admin move`: a sweep of yaks.app's stores for the store mover
// (workers/yak/mover.ts, D-45640). One store at a time, each rehearses every
// rule or is woken to move what it owes, and says so as the sweep goes. A
// wake is paced, a few stores a minute, so the platform is never woken all at
// once; a rehearsal holds one store at a time and needs no pace. A store that
// fails is said and the sweep goes on: the report is the point.
import type { Rehearsal, Standing } from '../../workers/yak/mover.ts'
import type { Swept } from '../../workers/yak/sweep.ts'

/** What one store answers the sweep. */
export type Asked = { store: string; rules: (Rehearsal | Standing)[] }

let ms = (n: number) =>
  n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`

let rehearsed = (r: Rehearsal) =>
  r.failed
    ? `failed: ${r.failed}`
    : r.unspoken
    ? `speaks no .${r.unspoken}`
    : `${r.rows} rows, ${r.moved} moved in ${ms(r.ms)}, ` +
      `slowest batch ${ms(r.slowest)}`

let standing = (s: Standing) =>
  !s.live
    ? 'rehearsal only'
    : s.failed
    ? `failed after ${s.moved ?? 0}: ${s.failed}`
    : s.done
    ? `done, ${s.moved} moved`
    : `${s.moved ?? 0} moved so far`

/** One rule's line in one store. */
export let line = (at: string, r: Rehearsal | Standing) =>
  `${at}  ${r.mark.replace(/^yak\/store\//, '')}  ${
    'rows' in r ? rehearsed(r) : standing(r)
  }`

let wait = (ms: number, stopping: AbortSignal) =>
  new Promise<void>((go) => {
    let t = setTimeout(go, ms)
    stopping.addEventListener('abort', () => (clearTimeout(t), go()), {
      once: true,
    })
  })

/** Every store asked in turn, each line said as it comes; answers the
 * summary. `pace` is stores a minute, 0 for each as soon as the last one
 * answers. */
export let sweep = async (o: {
  stores: Swept[]
  ask: (store: string) => Promise<Asked>
  pace: number
  out: (line: string) => void
  stopping: AbortSignal
}): Promise<string[]> => {
  let asked = 0
  let failed: string[] = []
  let rows: number | null = null
  let slow = { at: '', ms: 0 }
  for (let s of o.stores) {
    if (asked && o.pace) await wait(60_000 / o.pace, o.stopping)
    if (o.stopping.aborted) break
    asked++
    try {
      let a = await o.ask(s.store)
      if (!a.rules.length) o.out(`${s.at}  no rules`)
      for (let r of a.rules) {
        o.out(line(s.at, r))
        if (r.failed && !failed.includes(s.at)) failed.push(s.at)
        if (!('rows' in r)) continue
        rows = (rows ?? 0) + r.rows
        if (r.slowest > slow.ms) slow = { at: s.at, ms: r.slowest }
      }
    } catch (e) {
      failed.push(s.at)
      o.out(`${s.at}  failed: ${e instanceof Error ? e.message : e}`)
    }
  }
  return [
    `${asked} of ${o.stores.length} stores asked, ${failed.length} failed` +
    (failed.length ? `: ${failed.join(', ')}` : ''),
    ...(rows == null ? [] : [
      `${rows} rows found` +
      (slow.at ? `; slowest batch ${ms(slow.ms)} in ${slow.at}` : ''),
    ]),
  ]
}
