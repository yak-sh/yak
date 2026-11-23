// The hourly upkeep of the numbers spaces bought (numbers.ts), run by the
// directory's meter (jobs.ts `meter`):
//
// - `minutes`: every call a number took or made, read from its provider's
//   records, charged to the space's budget under its texts at what the
//   provider charged us with our share (@yaks/platform/numbers `usage`). The
//   line keeps when its last charged call began (`phone_line.called`), so
//   each call is charged once. A provider that bills no calls
//   (@yaks/phone `Numbers.calls`) is read for none.
// - `pointed`: every number of a provider that sends each number's texts to
//   a URL is pointed at its door here (number-door.ts) again, which asks the
//   provider nothing where it already is, and finishes an assignment the
//   provider was too slow to set.
import { line as q } from '@yaks/query'
import { Unsent } from '@yaks/host/senders'
import { monthOf } from '@yaks/platform/meter'
import { usage } from '@yaks/platform/numbers'
import { idOf, stamp } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import { phoneNamed } from './phones.ts'
import { callbackOf } from './number-door.ts'

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
    let took = await calls(line.number, since)
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
