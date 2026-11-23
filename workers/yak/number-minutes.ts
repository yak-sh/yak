// The minutes a number a space bought (numbers.ts) spends: every call it
// took or made, read hourly (jobs.ts `meter`) from its provider's records,
// charged to the space's budget under its texts at what the provider
// charged us with our share (@yaks/platform/numbers `usage`). The line keeps
// when its last charged call began (`phone_line.called`), so each call is
// charged once. A provider that bills no calls (@yaks/phone `Numbers.calls`)
// is read for none.
import { line as q } from '@yaks/query'
import { monthOf } from '@yaks/platform/meter'
import { usage } from '@yaks/platform/numbers'
import { idOf, stamp } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import { phoneNamed } from './phones.ts'

type Line = {
  number: string
  via: string
  space: string
  at?: string | null
  called?: string | null
}

/** Charge every number's calls since its last charged one, at `now`; the
 * number of calls charged. */
export let minutes = async (env: Env, now: Date): Promise<number> => {
  let rows = await meta(env).query(q`.phone_line ?trashed`)
  let charged = 0
  for (let row of rows) {
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
