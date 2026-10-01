// `yak admin move`: a sweep of yaks.app's stores for the store mover
// (workers/yak/mover.ts, D-45640). One store at a time, each rehearses every
// rule or is woken to move what it owes, and says so as the sweep goes, with
// how long it took to answer: a store cannot time itself, since a Worker's
// clock stands still while its code runs. A
// wake is paced, a few stores a minute, so the platform is never woken all at
// once; a rehearsal holds one store at a time and needs no pace. A store that
// fails is said and the sweep goes on: the report is the point.
import type { Rehearsal, Standing } from '../../workers/yak/mover.ts'
import type { Swept } from '../../workers/yak/sweep.ts'

/** What one store answers the sweep: woken, also the alarm it then holds. */
export type Asked = {
  store: string
  rules: (Rehearsal | Standing)[]
  alarm?: string | null
}

let ms = (n: number) =>
  n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`

let rehearsed = (r: Rehearsal) =>
  r.failed
    ? `failed: ${r.failed}`
    : r.unspoken
    ? `speaks no .${r.unspoken}`
    : `${r.rows} rows, ${r.moved} moved in ${r.batches} batches`

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

// A store's lines, and how long it took to answer.
// Woken, a store says the alarm it then holds: the mover moves only from it,
// so one long past is one that never comes.
let held = (a: Asked) =>
  a.alarm === undefined ? '' : a.alarm ? `  alarm ${a.alarm}` : '  no alarm'

let lines = (at: string, a: Asked, took: number) =>
  a.rules.length
    ? a.rules.map((r, i) =>
      line(at, r) + (i ? '' : `  (${ms(took)})${held(a)}`)
    )
    : [`${at}  no rules  (${ms(took)})${held(a)}`]

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
    let start = performance.now()
    try {
      let a = await o.ask(s.store)
      let took = performance.now() - start
      for (let l of lines(s.at, a, took)) o.out(l)
      if (took > slow.ms) slow = { at: s.at, ms: took }
      if (a.rules.some((r) => r.failed)) failed.push(s.at)
      for (let r of a.rules) if ('rows' in r) rows = (rows ?? 0) + r.rows
    } catch (e) {
      failed.push(s.at)
      o.out(`${s.at}  failed: ${e instanceof Error ? e.message : e}`)
    }
  }
  return [
    `${asked} of ${o.stores.length} stores asked, ${failed.length} failed` +
    (failed.length ? `: ${failed.join(', ')}` : ''),
    ...(rows == null ? [] : [`${rows} rows found`]),
    ...(slow.at ? [`slowest answer ${ms(slow.ms)}, from ${slow.at}`] : []),
  ]
}
