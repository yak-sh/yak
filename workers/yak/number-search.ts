import type { Offer } from '@yaks/phone'
import { token } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { Unsent } from '@yaks/host/senders'
import { line } from '@yaks/query'
import { caught } from './defects.ts'
import { stamp } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import { refuse } from './tool.ts'

let HOUR = 60 * 60_000
type Search = { since: string; last: string; count: number; reported: boolean }

export let slowPhone = () =>
  refuse(
    'unavailable',
    'The phone company is slow to answer. Try again in a minute.',
  )

let track = async (env: Env, via: string, slow?: Unsent) => {
  let eid = derivedEid(`phone-search|${via}`)
  for (;;) {
    let [row] = await meta(env).query(line`.entity.eid=${eid}&?phone_search`)
    let had = row?.phone_search as Search | undefined
    if (!slow && !had?.count) return
    let now = new Date(env.CLOCK?.now() ?? Date.now())
    let at = now.toISOString()
    let prior = had && now.getTime() - Date.parse(had.last) <= HOUR
      ? had
      : undefined
    let since = prior?.count ? prior.since : at
    let count = slow ? (prior?.count ?? 0) + 1 : 0
    let reported = !!(prior?.reported && count > 1)
    let tell = !reported && count >= 3 &&
      now.getTime() - Date.parse(since) >= HOUR
    try {
      await stamp(env, {
        entities: [{
          entity: { eid },
          $was: { phone_search: { count: token(had?.count ?? null) } },
          phone_search: { since, last: at, count, reported: reported || tell },
        }],
      })
    } catch (error) {
      if (error instanceof Stale) continue
      throw error
    }
    if (tell) {
      caught(
        new Error('Phone number searches have timed out for an hour', {
          cause: slow,
        }),
        { request: 'search phone numbers', provider: via },
      )
    }
    return
  }
}

export let searched = async (
  env: Env,
  via: string,
  find: () => Promise<Offer[]>,
) => {
  let note = (slow?: Unsent) =>
    track(env, via, slow).catch((e) =>
      caught(e, { request: 'track phone searches', provider: via })
    )
  try {
    let offers = await find()
    await note()
    return offers
  } catch (error) {
    if (!(error instanceof Unsent)) throw error
    await note(error)
    throw slowPhone()
  }
}
