// Every wake-up, subscription and scheduled run an Operator store kept in its
// own words before they were @yaks/wake's (T-164109), given the package's,
// in bounded alarm batches beside the store's other passes, never in boot:
//
//   operator_ask{person, say, helper}      wake{for, note, brief}
//   operator_subscription{query, mine, seen}   watch{query, local, seen}
//   operator_work{schedule, at, call, error}   occurrence{wake, at, call, error}
//
// `operator_ask.space` is the store's one space and `administrative` is not
// carried: a wake runs with its person's own reach. The old components stay
// on their rows until contraction, so a rollback still reads every schedule.
// A firing the old code owed and had not run (`operator_fired`) is owed as
// `wake_run`, so none is lost across the deploy; one whose occurrence began
// under the old code is left to the old code's records, so none runs twice.
// Until the pass is done the store fires no wake (operator-store.ts `drain`),
// so no firing is owed in words nothing runs.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Meta } from '@yaks/sqlite'
import { caught } from './defects.ts'

/** Where a store says its wakes are in @yaks/wake's words: the pass's cursor
 * while it goes on, `done` once it has. A store made new is born done. */
export let WAKES = 'operator:wakes'

/** How many rows one batch moves. */
export let BATCH = 50

/** Whether a store's wakes are in @yaks/wake's words: always for a store
 * kept nowhere, which is made in memory with the new code. */
export let wakesMoved = (marks?: Pick<Meta, 'get'>) =>
  !marks || marks.get(WAKES) == 'done'

let part = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let some = (v: unknown) => typeof v == 'string' ? v.trim() : ''

/** The patch that gives one row the package's words, or none. */
export let moved = (row: Bundle): Bundle | undefined => {
  let ask = part(row, 'operator_ask')
  let sub = part(row, 'operator_subscription')
  let work = part(row, 'operator_work')
  let wake = ask && {
    for: ask.person,
    ...some(ask.say) ? { note: ask.say } : {},
    ...some(ask.helper) ? { brief: ask.helper } : {},
  }
  let watch = sub && {
    query: sub.query,
    ...sub.mine ? { local: true } : {},
    ...sub.seen ? { seen: sub.seen } : {},
  }
  let occurrence = work?.schedule && {
    wake: work.schedule,
    at: work.at,
    ...work.call ? { call: work.call } : {},
    ...work.error ? { error: work.error } : {},
  }
  if (!wake && !watch && !occurrence) return
  return {
    entity: { eid: row.entity.eid },
    ...wake ? { wake } : {},
    ...watch ? { watch } : {},
    ...occurrence ? { occurrence } : {},
  }
}

/** One batch of the pass. Answers whether another alarm has work; the cursor
 * advances only after the batch's writes land, and a patch written twice
 * changes nothing. */
export let wakeBackfill = async (
  store: {
    g: Graph
    marks?: Pick<Meta, 'get' | 'set'>
    waiting?: () => number
  },
): Promise<boolean> => {
  let { g, marks } = store
  let at = marks?.get(WAKES)
  if (!marks || at == 'done') return false
  if (store.waiting?.()) return true
  let rows = await g.read(
    `(.operator_ask|.operator_subscription|.operator_work)${
      at ? `&.entity.eid>${at}` : ''
    }&.order=entity.eid&.limit=${BATCH}&*`,
  )
  let patches = rows.flatMap((row) => moved(row) ?? [])
  if (patches.length) await g.apply(patches, { trusted: true })
  let last = rows.at(-1)?.entity.eid
  if (rows.length == BATCH && last) {
    marks.set(WAKES, last)
    return true
  }
  await owed(g)
  marks.set(WAKES, 'done')
  return false
}

// The firings the old code owed and never ran, owed again as `wake_run` on
// the moved wake. One whose occurrence had begun (a call or a helper) is not
// run again, which could make its call twice: it is left failed, and
// reported, for a person to see.
let owed = async (g: Graph) => {
  let runs = await g.read(
    '.effect.handler=operator_fired&.effect.state=pending&.fields=entity.eid,effect.target',
  )
  for (let run of runs) {
    let target = String(part(run, 'effect')?.target ?? '')
    let [wake] = target ? await g.get([target], ['fired']) : []
    let fired = String(part(wake, 'fired')?.at ?? '')
    let began = fired
      ? await g.read(
        `.operator_work.schedule=${target}&.operator_work.at=${fired}&.fields=entity.eid`,
      )
      : []
    if (began.length) {
      caught(new Error('A scheduled run was cut off by the deploy'), {
        request: 'operator wake move',
        wake: target,
        run: began[0].entity.eid,
      })
    }
    await g.apply([{
      entity: run.entity,
      effect: began.length
        ? { state: 'failed', error: 'Its occurrence began before the deploy.' }
        : { handler: 'wake_run' },
    }], { trusted: true, stamp: false })
  }
}
