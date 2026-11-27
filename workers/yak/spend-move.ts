// What a space's Operator spent before spends named a person (T-4174), kept
// in the space's indexed work-spend rows as its spends now are
// (@yaks/platform/meter `trended`): each model request's dollars under the
// person its conversation works for. Once, from the Builder's alarm beside
// the store's other passes, over the days the trend still holds and that no
// spend has named a person on yet, so no day is counted twice.
import { line } from '@yaks/query'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Meta } from '@yaks/sqlite'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import type { ByDay } from '@yaks/ui/chart'
import type { WorkSpend } from '@yaks/platform/meter'
import { workRow } from '@yaks/platform/meter-graph'
import { investigatorOf } from './operator-escalate.ts'
import { spaceOf } from './operator-root.ts'
import { KERNEL, meta } from './meta.ts'
import type { Env } from './env.ts'

/** The store's mark once the pass is done. */
export let SPENT_PEOPLE = 'spend-people'

let DAY = 86_400_000
let DAYS = 30
let ymd = (t: number) => new Date(t).toISOString().slice(0, 10)
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** A model request as the pass counts it: its day's dollars, and who it was
 * for, if anybody. */
export type Spent = { day: string; dollars: number; person?: string }

/**
 * The requests' dollars by person and day, the days from `since` up to
 * `before` (YYYY-MM-DD): the window the trend holds, up to the first day a
 * spend named a person.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { attributed } from './spend-move.ts'
 *
 * equal(
 *   attributed([
 *     { day: '2026-11-20', dollars: 1, person: 'jeff' },
 *     { day: '2026-11-20', dollars: 0.5, person: 'jeff' },
 *     { day: '2026-11-21', dollars: 2, person: 'tog' },
 *     { day: '2026-11-21', dollars: 4 },
 *     { day: '2026-11-27', dollars: 8, person: 'tog' },
 *     { day: '2026-10-01', dollars: 8, person: 'tog' },
 *   ], '2026-10-29', '2026-11-27'),
 *   { jeff: { '2026-11-20': 1.5 }, tog: { '2026-11-21': 2 } },
 * )
 * ```
 */
export let attributed = (
  spent: Spent[],
  since: string,
  before: string,
): Record<string, ByDay> => {
  let out: Record<string, ByDay> = {}
  for (let { day, dollars, person } of spent) {
    if (!person || day < since || day >= before || !dollars) continue
    let days = out[person] ??= {}
    days[day] = (days[day] ?? 0) + dollars
  }
  return out
}

// The person each session works for: its own `operator_session`, else, for an
// exchange a session has on its own behalf (a compaction's summary, sourced
// by a call from an entry of the one it compacts), that session's (operator.ts
// `payerOf`). An investigation is no person's.
let personOf = async (g: Graph, space: string, session: string) => {
  for (
    let eid: string | undefined = session, hops = 0;
    eid && hops < 4;
    hops++
  ) {
    let [held] = await g.read(
      line`.entity.eid=${eid}&.fields=operator_session.person,session.source`,
    )
    let person = comp(held, 'operator_session')?.person
    if (typeof person == 'string') {
      return person == investigatorOf(space) ? undefined : person
    }
    let source = comp(held, 'session')?.source
    let [call] = source ? await g.get([String(source)], ['call']) : []
    let entry = comp(call, 'call')?.source as string | undefined
    let [from] = entry ? await g.get([entry], ['entry']) : []
    eid = comp(from, 'entry')?.session as string | undefined
  }
}

/** The pass: answers whether another alarm has work. */
export let spendBackfill = async (
  store: {
    g: Graph
    marks?: Pick<Meta, 'get' | 'set'>
    waiting?: () => number
  },
  env: Pick<Env, 'STORE'>,
  now = Date.now(),
): Promise<boolean> => {
  let { g, marks } = store
  if (!marks || marks.get(SPENT_PEOPLE) == 'done') return false
  if (store.waiting?.()) return true
  let space = await spaceOf(store)
  if (!space) {
    marks.set(SPENT_PEOPLE, 'done')
    return false
  }
  let since = ymd(now - (DAYS - 1) * DAY)
  let asks = await g.read(
    line`.ask .cost.dollars>0 .created.at>=${since} .fields=entry.session,cost.dollars,created.at`,
  )
  let people = new Map<string, Promise<string | undefined>>()
  let spent: Spent[] = await Promise.all(asks.map(async (ask) => {
    let session = String(comp(ask, 'entry')?.session ?? '')
    if (session && !people.has(session)) {
      people.set(session, personOf(g, space, session))
    }
    return {
      day: String(comp(ask, 'created')?.at ?? '').slice(0, 10),
      dollars: Number(comp(ask, 'cost')?.dollars ?? 0),
      person: session ? await people.get(session) : undefined,
    }
  }))
  let directory = meta(env as Env)
  while (true) {
    let [[row], work] = await Promise.all([
      directory.query(
        line`.entity.eid=${space}&.fields=space,trend.spend,trend.people`,
        { live: true },
      ),
      directory.query(line`.work_spend.space=${space}&.fields=work_spend`, {
        live: true,
      }),
    ])
    if (!row?.space) break
    let trend = comp(row, 'trend')
    let legacy = (trend?.people ?? {}) as Record<string, ByDay>
    let held = Object.fromEntries(work.map((row) => {
      let { person, days } = row.work_spend as WorkSpend
      return [person, days]
    }))
    // The first day a spend named a person: from it on, the meter says.
    let first = [...Object.values(legacy), ...Object.values(held)]
      .flatMap(Object.keys).sort()[0]
    let found = attributed(spent, since, first ?? ymd(now + DAY))
    if (!Object.keys(found).length) break
    try {
      await directory.apply([
        {
          entity: { eid: space },
          $was: {
            trend: { spend: token(trend?.spend), people: token(trend?.people) },
          },
        },
        ...Object.entries(found).map(([person, days]) => ({
          ...workRow(space, person, { ...days, ...held[person] }),
          $was: { work_spend: { days: token(held[person]) } },
        })),
      ], KERNEL)
      break
    } catch (error) {
      // A spend landed meanwhile: read again.
      if (!(error instanceof Stale)) throw error
    }
  }
  marks.set(SPENT_PEOPLE, 'done')
  return false
}
