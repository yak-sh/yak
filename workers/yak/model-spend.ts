// A paid call reserves its quoted cost before submission. A measured answer
// settles it, a known unsubmitted call frees it, and an uncertain one settles
// at what it most likely cost: when it fails, or, for a call whose owner died
// with it, once it is past the moment it could still be running ({@link
// expired}). A measured cost arriving after an estimate replaces it.
import { line } from '@yaks/query'
import { type Bundle, type Comp, mint, token } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { ModelError } from '@yaks/model'
import { left, monthOf } from '@yaks/platform/meter'
import { tooManyCalls, unaffordable } from '@yaks/platform/standing'
import {
  directoryOf,
  type Row,
  type Space,
  spaceOf,
  stamp,
} from './directory.ts'
import type { Namespace } from '@yaks/durable-object/door'
import { meta } from './meta.ts'

type Env = { STORE: Namespace }
export type Kind = 'models' | 'realtime' | 'texts'
export type Hold = {
  space: string
  month: string
  dollars: number
  what: Kind
  /** what the dollars buy (@yaks/platform/meter `SOURCES`) */
  source?: string
  /** a visitor's call, held against their share of the budget as well */
  visitor?: boolean
}
/** Who a hold is spent for: what it buys, the source that sells it (a model
 * provider, voice, texts; @yaks/platform/meter `SOURCES`), and the visitor who
 * asked, named by who they are (their person, else their address or
 * transcript); none is a member's. */
export type Paying = {
  what?: Kind
  source?: string
  visitor?: string
  now?: Date
  /** what the call most likely costs should it end with nothing measured,
   * and the moment past which it can no longer be running: a hold still open
   * then is settled at `likely` ({@link expired}). Without `until` the hold
   * is its owner's to settle, however long that takes. */
  likely?: number
  until?: Date
}

export let receiptEid = (call: string) =>
  derivedEid('generated-media-spend|' + call)
let read = async (env: Env, eid: string) =>
  (await meta(env).query(line`.entity.eid=${eid}`))[0]
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
  row?.model_reservation as
    | Hold & { likely?: number; until?: string }
    | undefined
// A hold settled at an estimate: whom it was held for.
let guessed = (row: Bundle | undefined) =>
  row?.model_estimate as Omit<Hold, 'dollars'> | undefined
let paidBy = (
  { space, month, what, source, visitor }: Omit<Hold, 'dollars'>,
) => ({
  space,
  month,
  what,
  ...source ? { source } : {},
  ...visitor ? { visitor } : {},
})

export let reservation = async (
  env: Env,
  call: string,
): Promise<Hold | undefined> => held(await read(env, receiptEid(call)))

// A release returns the hold without writing a completed cost; an estimate
// settles it at `dollars` and keeps whom it was held for, so a measured cost
// arriving later replaces the estimate on the same month.
let finish = async (
  env: Env,
  eid: string,
  dollars: number | null,
  reported: boolean,
  estimate = false,
): Promise<boolean> => {
  if (dollars != null && (!Number.isFinite(dollars) || dollars < 0)) {
    throw new Error('Invalid model cost')
  }
  while (true) {
    let receipt = await read(env, eid)
    let hold = held(receipt)
    let guess = !hold && !estimate && dollars != null
      ? guessed(receipt)
      : undefined
    let previous = (receipt?.cost as Comp | undefined)?.dollars as
      | number
      | undefined
    if (!hold && !guess) {
      if (estimate) return previous != null
      if (dollars != null && previous != null && previous != dollars) {
        throw new Error('The settled provider cost changed for the same call')
      }
      return dollars != null && previous != null
    }
    let paying = (hold ?? guess)!
    // The provider has already spent these dollars. A low estimate must not
    // hide usage or strand delivery; the next admission sees the full debit.
    let space = await read(env, paying.space)
    let meter = space?.meter as Comp | undefined
    let delta = (dollars ?? 0) - (hold ? hold.dollars : previous ?? 0)
    let at = (receipt?.created as Comp | undefined)?.at
    // Last month's reservation stays in last month's reading. A late answer
    // must never reset this month's counters or free this month's dollars.
    let spends = meter?.month == paying.month && delta
      ? [{
        entity: { eid: paying.space },
        $was: guard(space, 'meter', ['month']),
        spend: {
          month: paying.month,
          [paying.what]: delta,
          ...paying.source ? { source: paying.source } : {},
          ...paying.visitor ? { visitors: delta } : {},
          // Corrected on the day the hold was made, not the day it settled.
          ...typeof at == 'string' ? { at } : {},
        },
      }]
      : []
    try {
      await stamp(env, {
        entities: [{
          entity: { eid },
          $was: hold
            ? guard(receipt, 'model_reservation', ['dollars'])
            : guard(receipt, 'cost', ['dollars']),
          ...hold ? { model_reservation: null } : {},
          ...estimate
            ? { model_estimate: paidBy(paying) }
            : guess
            ? { model_estimate: null }
            : {},
          ...dollars == null ? {} : { cost: { dollars, reported } },
        }, ...spends],
      })
      return true
    } catch (error) {
      if (!(error instanceof Stale)) throw error
    }
  }
}

/** Settle measured usage once, including costs above the original quote and
 * media delivered after a restart. Later admissions see the full debit. */
export let settled = (
  env: Env,
  call: string,
  dollars: number,
  reported = true,
): Promise<boolean> => finish(env, receiptEid(call), dollars, reported)

/** Settle a call nothing measured at what it most likely cost, `dollars`
 * (@yaks/model `likely`), never its worst case. A measured cost settled later
 * replaces it. */
export let estimated = (
  env: Env,
  call: string,
  dollars: number,
): Promise<boolean> => finish(env, receiptEid(call), dollars, false, true)

/** How many expired holds one sweep settles at most. */
let SWEPT = 1000

/** Every hold past the moment its call could still be running, settled at
 * what the call most likely cost (its `likely`): its owner died with it, so
 * nothing else ever will, and the worst case it holds was never spent. The
 * hourly meter runs it (jobs.ts `meter`). */
export let expired = async (env: Env, now = new Date()): Promise<number> => {
  let rows = await meta(env).query(
    line`.model_reservation.until<${now.toISOString()}&.limit=${SWEPT}`,
  )
  let n = 0
  for (let row of rows) {
    let hold = held(row)
    if (!hold) continue
    if (await finish(env, row.entity.eid, hold.likely ?? 0, false, true)) n++
  }
  return n
}

/** Hold a call's most against its space's month budget before it starts, in
 * one write: the quote is made on the caller's reading of the space, and the
 * directory refuses the hold in the write's own transaction when it does not
 * fit what is left (@yaks/platform/meter-graph `spend`), so holds made at once
 * neither spend past the budget nor wait on one another. Every model consumer
 * and voice lease shares the same remaining dollars; a visitor's is held to
 * what is left of their share too (@yaks/platform/meter `left`), and a
 * visitor's model call is counted against the calls one visitor may ask for in
 * a day (@yaks/platform/meter `visitorCalls`). Only a refusal reads the space
 * again, to quote on what is left and ask once more. */
export let reserved = async <T extends { dollars: number }>(
  env: Env,
  space: Space,
  quote: (remaining: number) => T | null,
  call = mint(),
  { what = 'models', source, visitor, now = new Date(), likely, until }:
    Paying = {},
): Promise<
  {
    value: T
    settle(dollars: number, reported?: boolean): Promise<boolean>
    estimate(dollars: number): Promise<boolean>
    release(): Promise<boolean>
  }
> => {
  let eid = receiptEid(call)
  let month = monthOf(now)
  let reading = await directoryOf(env.STORE).withBudget(space)
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
        reading = await spaceNow(env, space.eid)
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
              ...until
                ? {
                  likely: Math.min(likely ?? value!.dollars, value!.dollars),
                  until: until.toISOString(),
                }
                : {},
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
      let released: Promise<boolean> | undefined
      return {
        value: value!,
        settle: (dollars, reported) => settled(env, call, dollars, reported),
        estimate: (dollars) => estimated(env, call, dollars),
        release: () => released ??= finish(env, eid, null, false),
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
      reading = await spaceNow(env, space.eid)
    }
  }
}

/** How much a space's tab ({@link tabbed}) runs up before it is written. */
export let TAB = 0.001

// The tabs this isolate runs, by space, month, kind and source: measured
// dollars not yet in the directory.
let tabs = new Map<string, number>()

/**
 * A hold for calls whose cost is a sliver of a cent (an embedding costs about
 * a ten-millionth of a dollar), which {@link reserved} would hold, settle and
 * keep a receipt for in two directory writes that cost more than the call.
 * The quote is checked against what the space has left less what this
 * isolate's tab owes, and nothing is written: each settlement runs up the
 * space's tab, written as one `spend` once it reaches {@link TAB}. A quote
 * past what is left, or a visitor's call, takes {@link reserved}'s path,
 * which re-reads, refuses and counts. Calls made at once are not held
 * against each other, so a space at its ceiling may pass it by what they cost
 * together, and an isolate that ends before its tab is written leaves it
 * unwritten: both are less than {@link TAB} a call.
 */
export let tabbed = async <T extends { dollars: number }>(
  env: Env,
  space: Space,
  quote: (remaining: number) => T | null,
  call = mint(),
  paying: Paying = {},
): Promise<
  {
    value: T
    settle(dollars: number, reported?: boolean): Promise<boolean>
    estimate(dollars: number): Promise<boolean>
    release(): Promise<boolean>
  }
> => {
  space = await directoryOf(env.STORE).withBudget(space)
  let { what = 'models', source, visitor, now = new Date() } = paying
  let month = monthOf(now)
  let key = [space.eid, month, what, source ?? ''].join('|')
  let owed = tabs.get(key) ?? 0
  let value = visitor ? null : quote(left(space, now) - owed)
  if (
    !value || !Number.isFinite(value.dollars) || value.dollars < 0 ||
    unaffordable(space, what, value.dollars + owed, now)
  ) return await reserved(env, space, quote, call, paying)
  let settle = async (dollars: number) => {
    if (!Number.isFinite(dollars) || dollars < 0) {
      throw new Error('Invalid model cost')
    }
    let due = (tabs.get(key) ?? 0) + dollars
    if (due < TAB) {
      tabs.set(key, due)
      return true
    }
    tabs.delete(key)
    try {
      await stamp(env, {
        entities: [{
          entity: { eid: space.eid },
          spend: { month, [what]: due, ...source ? { source } : {} },
        }],
      })
    } catch (error) {
      tabs.set(key, (tabs.get(key) ?? 0) + due)
      throw error
    }
    return true
  }
  return {
    value,
    settle,
    estimate: settle,
    release: () => Promise.resolve(true),
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
export let spaceNow = async (env: Env, eid: string) => {
  let row = await read(env, eid)
  if (!row?.space) throw new Error('The paying space is missing')
  return directoryOf(env.STORE).withBudget(spaceOf(row as unknown as Row))
}

// A hold the directory refused for the budget (@yaks/platform/meter-graph
// `spend`).
let overBudget = (e: unknown) => {
  let r = e as { name?: string; comp?: string } | null
  return r?.name == 'Refused' && r.comp == 'spend'
}
