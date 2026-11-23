// A phone provider slow to answer (`Unsent`) is asked again wherever it was
// met: a job on its next tick, a person on their next try. Neither reports it
// (defects.ts `caught` passes over it). Only a provider that stays slow
// reaches the tracker: its run of slow answers is kept on one directory row
// per provider (`phone_slow`), noted by each number search a person makes
// (number-search.ts) and by each hourly upkeep (number-upkeep.ts). Once slow
// answers have gone on for SLOW with no answer between, it is reported once,
// as one bug for the provider ("voipms slow for 1h"), and an answer ends the
// run.
import { token } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { failing, type Outage } from '@yaks/effects/outage'
import type { Unsent } from '@yaks/host/senders'
import { line } from '@yaks/query'
import { defect } from './defects.ts'
import { stamp } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'

/** How long a provider answers slowly before that is reported. */
export let SLOW = 60 * 60_000

// Slow answers further apart than this are two runs, not one: the upkeep
// notes each provider hourly, so a run it saw last is at most an hour old.
let APART = 2 * SLOW

type Slow = { since?: string | null; last?: string | null; told?: boolean }

let iso = (ms: number) => new Date(ms).toISOString()

/** What a provider's answer at `now` says of its run of slow ones: `slow`,
 * the `Unsent` it answered with, continues or starts it; none ends it. */
export let noted = async (
  env: Env,
  via: string,
  slow?: Unsent,
  now = env.CLOCK?.now() ?? Date.now(),
): Promise<void> => {
  let eid = derivedEid(`phone-slow|${via}`)
  for (;;) {
    let [row] = await meta(env).query(line`.entity.eid=${eid}&?phone_slow`)
    let had = row?.phone_slow as Slow | undefined
    if (!slow && !had?.last) return
    let run: Outage | null =
      had?.last && had.since && now - Date.parse(had.last) <= APART
        ? { since: Date.parse(had.since), ...had.told ? { told: true } : {} }
        : null
    let { outage, stayed } = slow
      ? failing(run, now, { limit: SLOW })
      : { outage: null, stayed: undefined }
    try {
      await stamp(env, {
        entities: [{
          entity: { eid },
          $was: { phone_slow: { last: token(had?.last ?? null) } },
          phone_slow: outage
            ? { since: iso(outage.since), last: iso(now), told: !!outage.told }
            : { since: null, last: null, told: false },
        }],
      })
    } catch (error) {
      if (error instanceof Stale) continue
      throw error
    }
    if (stayed != null) {
      defect(
        new Error(`${via} slow for 1h`, { cause: slow }),
        { request: 'phone provider', provider: via },
        { fault: `phone slow:${via}` },
      )
    }
    return
  }
}

/** What one pass met of each provider it asked: slow, where it answered
 * none of the pass's calls in time, and the last slow answer says how; else
 * answered. `settle` notes each provider once. */
export let tally = () => {
  let met = new Map<string, Unsent | undefined>()
  return {
    answered: (via: string) => void met.set(via, undefined),
    slow: (via: string, error: Unsent) => {
      if (!met.has(via) || met.get(via)) met.set(via, error)
    },
    settle: async (env: Env, now?: number) => {
      for (let [via, slow] of met) await noted(env, via, slow, now)
    },
  }
}

export type Tally = ReturnType<typeof tally>
