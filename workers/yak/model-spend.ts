// A paid call reserves its quoted cost before submission. Uncertain submissions
// keep that debit; only a measured answer or a known unsubmitted call frees it.
import { type Bundle, type Comp, mint, token } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { ModelError } from '@yaks/model'
import { left, monthOf, tooManyCalls, unaffordable } from './meter.ts'
import { type Row, type Space, spaceOf, stamp } from './directory.ts'
import type { Namespace } from './door.ts'
import { meta } from './meta.ts'

type Env = { STORE: Namespace }
export type Kind = 'models' | 'realtime' | 'texts'
export type Hold = {
  space: string
  month: string
  dollars: number
  what: Kind
  /** what the dollars buy (meter.ts `SOURCES`) */
  source?: string
  /** a visitor's call, held against their share of the budget as well */
  visitor?: boolean
}
/** Who a hold is spent for: what it buys, the source that sells it (a model
 * provider, voice, texts; meter.ts `SOURCES`), and the visitor who asked,
 * named by who they are (their person, else their address or transcript);
 * none is a member's. */
export type Paying = {
  what?: Kind
  source?: string
  visitor?: string
  now?: Date
}

export let receiptEid = (call: string) =>
  derivedEid('generated-media-spend|' + call)
let read = async (env: Env, eid: string) =>
  (await meta(env).query(`.entity.eid=${eid}`))[0]
let guard = (row: Bundle | undefined, comp: string, props: string[]) => ({
  [comp]: Object.fromEntries(
    props.map((p) => [p, token((row?.[comp] as Comp)?.[p] ?? null)]),
  ),
})
// The row counting one visitor's model calls in a space by the day.
let tallyEid = (space: string, visitor: string) =>
  derivedEid('visitor-calls|' + space + '|' + visitor)
let dayOf = (now: Date) => now.toISOString().slice(0, 10)
// The calls a visitor has asked for today, and the write that counts one more,
// guarded on that reading so two at once never count as one.
let tallied = async (env: Env, space: string, visitor: string, now: Date) => {
  let eid = tallyEid(space, visitor)
  let row = await read(env, eid)
  let had = row?.visitor_calls as Comp | undefined
  let day = dayOf(now)
  let calls = had?.day == day ? Number(had.calls ?? 0) : 0
  return {
    eid,
    calls,
    more: {
      entity: { eid },
      $was: guard(row, 'visitor_calls', ['day', 'calls']),
      visitor_calls: { space, day, calls: calls + 1 },
    },
  }
}
let held = (row: Bundle | undefined) =>
  row?.model_reservation as Hold | undefined

export let reservation = async (
  env: Env,
  call: string,
): Promise<Hold | undefined> => held(await read(env, receiptEid(call)))

/** Settle measured usage once, including costs above the original quote and
 * media delivered after a restart. Later admissions see the full debit. */
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
    // The provider has already spent these dollars. A low estimate must not
    // hide usage or strand delivery; the next admission sees the full debit.
    let space = await read(env, hold.space)
    let meter = space?.meter as Comp | undefined
    let delta = dollars - hold.dollars
    // Last month's reservation stays in last month's reading. A late answer
    // must never reset this month's counters or free this month's dollars.
    let spends = meter?.month == hold.month && delta
      ? [{
        entity: { eid: hold.space },
        $was: guard(space, 'meter', ['month']),
        spend: {
          month: hold.month,
          [hold.what]: delta,
          ...hold.source ? { source: hold.source } : {},
          ...hold.visitor ? { visitors: delta } : {},
        },
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

/** Hold a call's most against its space's month budget before it starts, in
 * one write: the quote is made on the caller's reading of the space, and the
 * directory refuses the hold in the write's own transaction when it does not
 * fit what is left (meter-graph.ts `spend`), so holds made at once neither
 * spend past the budget nor wait on one another. Every model consumer and
 * voice lease shares the same remaining dollars; a visitor's is held to
 * what is left of their share too (meter.ts `left`), and a visitor's model
 * call is counted against the calls one visitor may ask for in a day
 * (meter.ts `visitorCalls`). Only a refusal reads the space again, to quote
 * on what is left and ask once more. */
export let reserved = async <T extends { dollars: number }>(
  env: Env,
  space: Space,
  quote: (remaining: number) => T | null,
  call = mint(),
  { what = 'models', source, visitor, now = new Date() }: Paying = {},
): Promise<
  { value: T; settle(dollars: number, reported?: boolean): Promise<boolean> }
> => {
  let eid = receiptEid(call)
  let month = monthOf(now)
  let reading = space
  for (let attempt = 0;; attempt++) {
    let tally = visitor && what == 'models'
      ? await tallied(env, space.eid, visitor, now)
      : null
    let many = tally && tooManyCalls(reading, tally.calls)
    if (many) throw new ModelError('limit', many)
    let value = quote(left(reading, now, !!visitor))
    let fits = !!value && Number.isFinite(value.dollars) && value.dollars >= 0
    let no = unaffordable(
      reading,
      what,
      fits ? value!.dollars : Infinity,
      now,
      !!visitor,
    )
    if (no) {
      // The caller's reading may be older than a settlement that freed
      // dollars; a fresh one decides.
      if (attempt == 0) {
        reading = await again(env, space.eid)
        continue
      }
      throw new ModelError('limit', no)
    }
    try {
      await stamp(env, {
        entities: [
          {
            entity: { eid },
            $was: {
              ...guard(undefined, 'model_reservation', ['dollars']),
              ...guard(undefined, 'cost', ['dollars']),
            },
            model_reservation: {
              space: space.eid,
              month,
              dollars: value!.dollars,
              what,
              ...source ? { source } : {},
              ...visitor ? { visitor: true } : {},
            },
          },
          ...tally ? [tally.more] : [],
          {
            entity: { eid: space.eid },
            spend: {
              month,
              [what]: value!.dollars,
              ...source ? { source } : {},
              ...visitor ? { visitors: value!.dollars } : {},
              held: true,
            },
          },
        ],
      })
      return {
        value: value!,
        settle: (dollars, reported) => settled(env, call, dollars, reported),
      }
    } catch (error) {
      if (error instanceof Stale && error.eid == eid) {
        throw new ModelError(
          'submitted',
          'This model call already holds its budget',
        )
      }
      // The visitor asked for another call meanwhile: count again.
      if (error instanceof Stale && error.eid == tally?.eid) continue
      if (!overBudget(error)) throw error
      // Others spent meanwhile: quote again on what is left, a few times.
      if (attempt >= HOLDS) {
        throw new ModelError('limit', (error as Error).message)
      }
      reading = await again(env, space.eid)
    }
  }
}

/** `work`, run on a hold of the most it can cost, and charged what it says it
 * spent (`spent`), failing or not: whether it may go ahead at all is decided
 * in the directory's own transaction (`reserved`), never on a reading of the
 * space. What it spent past the hold was spent all the same, and is counted. */
export let onHold = async <T>(
  env: Env,
  space: Space,
  most: number,
  what: Kind,
  work: (spent: (dollars: number) => void) => Promise<T>,
  source?: string,
): Promise<T> => {
  let hold = await reserved(
    env,
    space,
    (left) => most <= left ? { dollars: most } : null,
    mint(),
    { what, source },
  )
  let cost = 0
  try {
    return await work((dollars) => void (cost += dollars))
  } finally {
    await hold.settle(Math.min(cost, most))
    if (cost > most) {
      await stamp(env, {
        entities: [{
          entity: { eid: space.eid },
          spend: {
            month: monthOf(new Date()),
            [what]: cost - most,
            ...source ? { source } : {},
          },
        }],
      })
    }
  }
}

// How many times a hold refused for the budget is quoted again on a fresh
// reading before the call is refused.
let HOLDS = 3

// The paying space as the directory holds it now.
let again = async (env: Env, eid: string) => {
  let row = await read(env, eid)
  if (!row?.space) throw new Error('The paying space is missing')
  return spaceOf(row as unknown as Row)
}

// A hold the directory refused for the budget (meter-graph.ts `spend`).
let overBudget = (e: unknown) => {
  let r = e as { name?: string; comp?: string } | null
  return r?.name == 'Refused' && r.comp == 'spend'
}
