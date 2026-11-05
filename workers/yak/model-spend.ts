// A paid call reserves its maximum before submission. Uncertain submissions
// keep that debit; only a measured answer or a known unsubmitted call frees it.
import { type Bundle, type Comp, mint, token } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { ModelError } from '@yaks/model'
import { atCeiling, budget, monthOf, plans } from './meter.ts'
import { type Row, type Space, spaceOf, stamp } from './directory.ts'
import type { Namespace } from './door.ts'
import { meta } from './meta.ts'

type Env = { STORE: Namespace }
type Kind = 'models' | 'realtime'
export type Hold = { space: string; month: string; dollars: number; what: Kind }

export let receiptEid = (call: string) =>
  derivedEid('generated-media-spend|' + call)
let read = async (env: Env, eid: string) =>
  (await meta(env).query(`.entity.eid=${eid}`))[0]
let guard = (row: Bundle | undefined, comp: string, props: string[]) => ({
  [comp]: Object.fromEntries(
    props.map((p) => [p, token((row?.[comp] as Comp)?.[p] ?? null)]),
  ),
})
let held = (row: Bundle | undefined) =>
  row?.model_reservation as Hold | undefined

export let reservation = async (
  env: Env,
  call: string,
): Promise<Hold | undefined> => held(await read(env, receiptEid(call)))

/** Settle the original call once, including media delivered after a restart. */
export let settled = async (
  env: Env,
  call: string,
  dollars: number,
  reported = true,
): Promise<boolean> => {
  if (!Number.isFinite(dollars) || dollars < 0) {
    throw new Error('Invalid model cost')
  }
  let eid = receiptEid(call)
  while (true) {
    let receipt = await read(env, eid)
    let hold = held(receipt)
    if (!hold) {
      let previous = (receipt?.cost as Comp | undefined)?.dollars
      if (previous != null && previous != dollars) {
        throw new Error('The settled provider cost changed for the same call')
      }
      return previous != null
    }
    if (dollars > hold.dollars) {
      throw new Error(
        `Provider exceeded its reserved maximum: $${dollars} > $${hold.dollars}`,
      )
    }
    let space = await read(env, hold.space)
    let meter = space?.meter as Comp | undefined
    let delta = dollars - hold.dollars
    // Last month's reservation stays in last month's reading. A late answer
    // must never reset this month's counters or free this month's dollars.
    let spends = meter?.month == hold.month && delta
      ? [{
        entity: { eid: hold.space },
        $was: guard(space, 'meter', ['month']),
        spend: { month: hold.month, [hold.what]: delta },
      }]
      : []
    try {
      await stamp(env, {
        entities: [{
          entity: { eid },
          $was: guard(receipt, 'model_reservation', ['dollars']),
          model_reservation: null,
          cost: { dollars, reported },
        }, ...spends],
      })
      return true
    } catch (error) {
      if (!(error instanceof Stale)) throw error
    }
  }
}

/** Reserve against an authoritative reading with compare-and-set. Every model
 * consumer and voice lease shares the same remaining dollars. */
export let reserved = async <T extends { dollars: number }>(
  env: Env,
  space: Space,
  quote: (remaining: number) => T | null,
  call = mint(),
  what: Kind = 'models',
  now = new Date(),
): Promise<
  { value: T; settle(dollars: number, reported?: boolean): Promise<boolean> }
> => {
  let eid = receiptEid(call)
  while (true) {
    let row = await read(env, space.eid)
    if (!row?.space) throw new Error('The paying space is missing')
    let fresh = spaceOf(row as unknown as Row)
    let month = monthOf(now)
    let { spent, limit } = budget(fresh, now)
    let remaining = Math.max(0, limit - spent)
    let value = quote(remaining)
    if (
      !value || !Number.isFinite(value.dollars) || value.dollars < 0 ||
      value.dollars > remaining
    ) {
      throw new ModelError(
        'limit',
        spent >= limit
          ? atCeiling(fresh, what)
          : `What is left of ${fresh.slug}'s model and voice budget this ` +
            `month is too little for this call. ${plans(fresh, {})}`,
      )
    }
    try {
      await stamp(env, {
        entities: [{
          entity: { eid },
          $was: {
            ...guard(undefined, 'model_reservation', ['dollars']),
            ...guard(undefined, 'cost', ['dollars']),
          },
          model_reservation: {
            space: space.eid,
            month,
            dollars: value.dollars,
            what,
          },
        }, {
          entity: { eid: space.eid },
          $was: guard(row, 'meter', [
            'month',
            'models',
            'realtime',
            'texts',
            'drawn',
          ]),
          spend: { month, [what]: value.dollars },
        }],
      })
      return {
        value,
        settle: (dollars, reported) => settled(env, call, dollars, reported),
      }
    } catch (error) {
      if (!(error instanceof Stale)) throw error
      if (error.eid == eid) {
        throw new ModelError(
          'submitted',
          'This model call already holds its budget',
        )
      }
    }
  }
}
