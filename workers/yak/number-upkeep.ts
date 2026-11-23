// The hourly upkeep of the numbers spaces bought (numbers.ts), run by the
// directory's meter (jobs.ts `meter`):
//
// - `minutes`: every call a number took or made, read from its provider's
//   records, charged to the space's budget under its texts at what the
//   provider charged us with our share (@yaks/platform/numbers `usage`). The
//   line keeps when its last charged call began (`phone_line.called`), so
//   each call is charged once. A provider that bills no calls
//   (@yaks/phone `Numbers.calls`) is read for none.
// - `allowed`: every number's calls let go only the ways its space allows
//   (`waysOf`), after `minutes` has charged the hour's calls. A number in the
//   trash, or of a space in the trash, takes and makes no call; one whose
//   space has nothing left of its budget this month (@yaks/platform/meter
//   `left`) places none, and still takes them, as a text that arrives is
//   never refused (text-spend.ts). Its calls go out again the hour its budget
//   has room. Nothing here sees a call while it happens, so a space can still
//   run past its budget by what it calls in the hour before its budget is
//   noticed spent, and by calls still going when their way out is shut.
// - `pointed`: every number of a provider that sends each number's texts to
//   a URL is pointed at its door here (number-door.ts) again, which asks the
//   provider nothing where it already is, and finishes an assignment the
//   provider was too slow to set.
//
// A provider slow to answer any of them (Unsent) is asked again the next hour,
// from where each stood, and nothing reports it: each step tallies what its
// provider answered (phone-slow.ts `tally`), and the meter notes each
// provider's hour once, so only one that stays slow is reported.
import { line as q } from '@yaks/query'
import { Unsent } from '@yaks/host/senders'
import { monthOf } from '@yaks/platform/meter'
import { usage } from '@yaks/platform/numbers'
import { idOf, stamp } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import { phoneNamed } from './phones.ts'
import { callbackOf } from './number-door.ts'
import { spaceNow } from './model-spend.ts'
import { purchaseConfirmed } from './numbers.ts'
import { syncVoice, voiceOf } from './number-voice.ts'
import { caught } from './defects.ts'
import { type Tally, tally } from './phone-slow.ts'

type Line = {
  number: string
  via: string
  space: string
  at?: string | null
  called?: string | null
  ordering?: string | null
  order_reported?: string | null
}

// Every number spaces hold, and those in the trash.
let lines = async (env: Env) =>
  await meta(env).query(q`.phone_line&!phone_line.ordering&?trashed`)

/** Confirm the carrier's result for a submitted order. The existing budget
 * hold and line stay in place while the carrier has yet to show the DID. */
export let orders = async (env: Env, now: Date, met: Tally = tally()) => {
  for (let row of await meta(env).query(q`.phone_line.ordering`)) {
    let l = row.phone_line as Line & { upfront: number; monthly: number }
    let ordered = (await phoneNamed(env, l.via))?.numbers?.().ordered
    if (!ordered) continue
    try {
      let confirmed = await ordered(l.number)
      met.answered(l.via)
      if (confirmed) {
        await purchaseConfirmed(env, { ...l, eid: row.entity.eid }, true)
        continue
      }
      if (
        now.getTime() - Date.parse(l.ordering!) < 3_600_000 || l.order_reported
      ) continue
      caught(
        new Error(
          'The phone company has not confirmed the submitted order for an hour',
        ),
        { request: 'confirm phone number order', provider: l.via },
      )
      await stamp(env, {
        entities: [{
          entity: row.entity,
          phone_line: { order_reported: now.toISOString() },
        }],
      })
    } catch (error) {
      if (!(error instanceof Unsent)) {
        caught(error, {
          request: 'confirm phone number order',
          provider: l.via,
        })
      } else met.slow(l.via, error)
    }
  }
}

/** Point every number's texts here again, where its provider takes a URL
 * for them; how many it pointed. A number in the trash takes no texts. */
export let pointed = async (
  env: Env,
  met: Tally = tally(),
): Promise<number> => {
  let n = 0
  for (let row of await lines(env)) {
    if (row.trashed) continue
    let line = row.phone_line as Line
    let phone = await phoneNamed(env, line.via)
    let point = phone?.numbers?.().point
    if (!phone?.own || !point) continue
    let slow = await point(
      line.number,
      await callbackOf(env, line.via, phone.own, line.number),
    ).then(() => false, (error) => {
      if (!(error instanceof Unsent)) throw error
      met.slow(line.via, error)
      return true
    })
    if (slow) continue
    met.answered(line.via)
    n++
  }
  return n
}

/** Charge every number's calls since its last charged one, at `now`; the
 * number of calls charged. */
export let minutes = async (
  env: Env,
  now: Date,
  met: Tally = tally(),
): Promise<number> => {
  let charged = 0
  for (let row of await lines(env)) {
    let line = row.phone_line as Line
    let calls = (await phoneNamed(env, line.via))?.numbers?.().calls
    if (!calls) continue
    let since = line.called ?? line.at ?? now.toISOString()
    let took = await calls(line.number, since).then((took) => {
      met.answered(line.via)
      return took
    }, (error) => {
      if (!(error instanceof Unsent)) throw error
      met.slow(line.via, error)
      return []
    })
    if (!took.length) continue
    await stamp(env, {
      entities: [
        {
          entity: { eid: idOf(line.space) },
          spend: {
            month: monthOf(now),
            texts: took.reduce((sum, c) => sum + usage(c.cost), 0),
          },
        },
        {
          entity: { eid: row.entity.eid },
          phone_line: { called: took.at(-1)!.at },
        },
      ],
    })
    charged += took.length
  }
  return charged
}

/** Let every number's calls go only the ways its space allows at `now`. */
export let allowed = async (
  env: Env,
  now: Date,
  met: Tally = tally(),
): Promise<void> => {
  let pending = new Set(
    (await meta(env).query(q`.phone_release`)).map((r) =>
      idOf((r.phone_release as { line: string }).line)
    ),
  )
  for (let row of await lines(env)) {
    if (pending.has(row.entity.eid)) continue
    let line = row.phone_line as Line
    let space = await spaceNow(env, idOf(line.space))
    await syncVoice(
      env,
      { ...line, eid: row.entity.eid, space: space.eid },
      voiceOf(!!row.trashed, space, now),
    ).then(() => met.answered(line.via), (e) => {
      if (e instanceof Unsent) met.slow(line.via, e)
      else caught(e, { request: 'apply phone call policy', space: space.eid })
    })
  }
}
