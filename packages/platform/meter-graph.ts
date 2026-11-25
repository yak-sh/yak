// The yak/meter graph facet: a space's spends added to its month in the
// write's own transaction, and the platform's hourly meter and each held
// number's month asked of the host (./lent.ts `job`).
import { after, each } from '@yaks/fp'
import { type Bound, hook, type Plugin, type Tx } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { line } from '@yaks/query'
import { FREE_BUDGET_QUERY, freeBudgetOf } from './budget.ts'
import type { Options } from './lent.ts'
import {
  added,
  credited,
  meteredOf,
  type MeteredRow,
  meterOf,
  trended,
  used,
  usesFreeBudget,
} from './meter.ts'
import { paid } from './plans.ts'
import { dollars, unaffordable } from './standing.ts'

let props = (c: unknown): Record<string, unknown> =>
  c && typeof c == 'object' ? Object.fromEntries(Object.entries(c)) : {}

// A hold can be released and an estimate can be replaced by a lower cost.
// Read both in the refund's transaction so neither is refunded as usage.
let refundable = (tx: Tx, eid: string, month: string) =>
  after(tx.get([eid], ['meter']), ([row]) => {
    let meter = row && meterOf(row as unknown as MeteredRow)
    if (!meter || meter.month != month) return 0
    return after(
      tx.read(
        line`(.model_reservation.space=${eid}&.model_reservation.month=${month})|(.model_estimate.space=${eid}&.model_estimate.month=${month}&.cost.dollars>0)`,
        {},
        ['model_reservation', 'cost'],
      ),
      (rows) =>
        Math.max(
          0,
          rows.reduce(
            (left, r) =>
              left - Number(
                props(r.model_reservation ?? r.cost).dollars ?? 0,
              ),
            used(meter, 'models'),
          ),
        ),
    )
  })

let refunds = hook(
  ['spend'],
  (bundles, tx) =>
    each(bundles, bundles, (same, { entity: { eid }, spend }) => {
      let { month, refunded } = props(spend)
      if (typeof refunded != 'number' || refunded <= 0) return same
      return after(refundable(tx, eid, String(month)), (available) => {
        if (refunded > available + 1e-9) {
          throw new Refused(
            `Only ${
              dollars(available)
            } of settled usage is available to refund this month.`,
            { eid, comp: 'spend', prop: 'refunded' },
          )
        }
        return same
      })
    }),
)

// A spend added to its month, refused first where it is held and does not
// fit what is left (./standing.ts `unaffordable`). A block bought is credit,
// not a month's spend (./meter.ts `credited`), and a space holding credit
// draws on it for what the month spends past its budget.
let spending = (row: Bound) => {
  let space = row.space
    ? meteredOf(row as unknown as MeteredRow, Date.parse(row.Now.at))
    : null
  if (
    !space || !usesFreeBudget(space) || !props(row.spend).held && !row.credit
  ) {
    return spend(row, space)
  }
  let read = row.FreeBudget as () => number | null | Promise<number | null>
  return after(read(), (freeMonthly) => spend(row, { ...space, freeMonthly }))
}

let spend = (row: Bound, space: ReturnType<typeof meteredOf> | null) => {
  let { meter, trend, spend, Now } = row
  let said = props(spend)
  let now = new Date(Now.at)
  let r = row as unknown as MeteredRow
  if (said.held) {
    if (!space) throw new Refused('The paying space is missing')
    let what: 'models' | 'realtime' | 'texts' =
      (['realtime', 'texts'] as const).find((k) => said[k]) ?? 'models'
    let no = unaffordable(
      space,
      what,
      Number(said[what] ?? 0),
      now,
      !!said.visitors,
    )
    if (no) {
      throw new Refused(no, {
        eid: (row.entity as { eid?: string } | undefined)?.eid,
        comp: 'spend',
        prop: what,
      })
    }
  }
  let { held: _, bought, at, ...spent } = said
  let next = added(props(meter), spent)
  let drew = row.credit && space &&
    credited(space, next, Number(bought ?? 0), now)
  return {
    meter: drew ? { ...next, credit: drew.drawn } : next,
    // A space paying for its plan covers its dollars; every other's are the
    // platform's to give (a comp, the free plan, a starter, a newcomer's).
    trend: trended(
      props(trend),
      spent,
      Date.parse(Now.at),
      paid(space && r.plan?.tier),
      at ? Date.parse(String(at)) : undefined,
    ),
    ...drew ? { credit: drew.credit } : {},
    spend: null,
  }
}

export let plugins = (_host: unknown, { store }: Options): Plugin[] => [{
  name: 'yak/meter',
  admission: () => true,
  resources: {
    FreeBudget: ({ tx }) => {
      let reading: number | null | Promise<number | null> | undefined
      return () =>
        reading === undefined
          ? reading = after(
            tx.read(FREE_BUDGET_QUERY),
            ([row]) => freeBudgetOf(row),
          )
          : reading
    },
  },
  hooks: { precondition: refunds },
  rules: [{
    // The hourly meter, fired by its wake row: the platform's job `meter`
    // (@yaks/platform/lent `job`).
    name: 'meter',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=meter, #Now',
    run: (row) => store.job?.('meter', row),
  }, {
    name: 'phone-release',
    phase: 'effect',
    match: '.wake, *fired, .phone_release, #Now',
    run: (row) => store.job?.('phone_release', row),
  }, {
    // A held number's month, spent from its space's budget: the platform's
    // job `lines`.
    name: 'lines',
    phase: 'effect',
    match: '.wake, *fired, .phone_line, #Now',
    run: (row) => store.job?.('lines', row),
  }, {
    // A spend, added to the month's meter inside the write's own transaction
    // and taken off again (./directory-vocab.ts `spend`): the sum is the
    // directory's, never a caller's, so two spends at once both count. A held
    // one is checked against what is left of the month in that same
    // transaction, so holds made at once never spend past the budget
    // together, and none waits on another (workers/yak model-spend.ts
    // `reserved`).
    name: 'spend',
    phase: 'rules',
    // The space's plan and budget are read from its view, never named in the
    // match: a `+` there would give a space that has none an empty one. A
    // space with credit is the rule below's, which writes it too.
    match: '+meter, +trend, *spend, !credit, #Now, #FreeBudget',
    run: spending,
  }, {
    // The same spend on a space holding credit (D-134567): what the month now
    // spends past its budget is drawn from its credit in this same
    // transaction, and a block bought added to it (./meter.ts `credited`).
    name: 'spend-credit',
    phase: 'rules',
    match: '+meter, +trend, *credit, *spend, #Now, #FreeBudget',
    run: spending,
  }],
}]
