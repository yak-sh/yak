// The hourly upkeep of the numbers spaces bought (numbers.ts), run by the
// directory's meter (jobs.ts `meter`):
//
// - `minutes`: every call a number took or made, read from its provider's
//   records, charged to the space's budget under its texts at what the
//   provider charged us with our share (@yaks/platform/numbers `usage`). The
//   line keeps when its last charged call began (`phone_line.called`), so
//   each call is charged once. A provider that bills no calls
//   (@yaks/phone `Numbers.calls`) is read for none, and one slow to answer
//   (Unsent) is read the next hour from where it stood.
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
import { line as q } from '@yaks/query'
import { Unsent } from '@yaks/host/senders'
import { left, monthOf } from '@yaks/platform/meter'
import { usage } from '@yaks/platform/numbers'
import type { Ways } from '@yaks/phone'
import { idOf, type Space, stamp } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import { phoneNamed } from './phones.ts'
import { callbackOf } from './number-door.ts'
import { spaceNow } from './model-spend.ts'

type Line = {
  number: string
  via: string
  space: string
  at?: string | null
  called?: string | null
}

// Every number spaces hold, and those in the trash.
let lines = async (env: Env) => await meta(env).query(q`.phone_line ?trashed`)

/** Point every number's texts here again, where its provider takes a URL
 * for them; how many it pointed. A number in the trash takes no texts. */
export let pointed = async (env: Env): Promise<number> => {
  let n = 0
  for (let row of await meta(env).query(q`.phone_line`)) {
    let line = row.phone_line as Line
    let phone = await phoneNamed(env, line.via)
    let point = phone?.numbers?.().point
    if (!phone?.own || !point) continue
    // A provider slow this hour is asked again the next.
    let slow = await point(
      line.number,
      await callbackOf(env, line.via, phone.own, line.number),
    ).then(() => false, (error) => {
      if (error instanceof Unsent) return true
      throw error
    })
    if (!slow) n++
  }
  return n
}

/** Charge every number's calls since its last charged one, at `now`; the
 * number of calls charged. */
export let minutes = async (env: Env, now: Date): Promise<number> => {
  let charged = 0
  for (let row of await lines(env)) {
    let line = row.phone_line as Line
    let calls = (await phoneNamed(env, line.via))?.numbers?.().calls
    if (!calls) continue
    let since = line.called ?? line.at ?? now.toISOString()
    // A provider slow this hour is read again the next, from the same call.
    let took = await calls(line.number, since).catch((error) => {
      if (error instanceof Unsent) return []
      throw error
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

/** The ways a number's calls go: none in the trash, its own (`trashed`) or
 * its space's; none out once its space's budget is spent this month. */
export let waysOf = (trashed: boolean, space: Space, now: Date): Ways => {
  let open = !trashed && !space.trashed
  return { in: open, out: open && left(space, now) > 0 }
}

/** Let `line`'s calls go only `ways`, at the provider it came through
 * (`via`). A provider whose numbers ring no softphone has nothing to allow,
 * and one too slow to answer is asked again by the next hour's `allowed`. */
export let allow = async (
  env: Env,
  line: { number: string; via: string },
  ways: Ways,
): Promise<void> => {
  let set = (await phoneNamed(env, line.via))?.numbers?.().allow
  await set?.(line.number, ways).catch((error) => {
    if (!(error instanceof Unsent)) throw error
  })
}

/** Let every number's calls go only the ways its space allows at `now`. */
export let allowed = async (env: Env, now: Date): Promise<void> => {
  for (let row of await lines(env)) {
    let line = row.phone_line as Line
    let space = await spaceNow(env, idOf(line.space))
    await allow(env, line, waysOf(!!row.trashed, space, now))
  }
}
