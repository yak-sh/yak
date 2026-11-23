// A person's number search, and what a phone provider slow to answer it says
// to them: plainly that it is slow, never a fault reported. Each search notes
// the provider's answer, so one that stays slow is reported (phone-slow.ts).
import type { Offer } from '@yaks/phone'
import { Unsent } from '@yaks/host/senders'
import { caught } from './defects.ts'
import type { Env } from './env.ts'
import { noted } from './phone-slow.ts'

/** What a person's call is answered when the phone company is slow: an
 * `Unsent`, which the tool answers as `unavailable` in these words. */
export let slowPhone = () =>
  new Unsent('The phone company is slow to answer. Try again in a minute.')

export let searched = async (
  env: Env,
  via: string,
  find: () => Promise<Offer[]>,
) => {
  let note = (slow?: Unsent) =>
    noted(env, via, slow).catch((e) =>
      caught(e, { request: 'note phone provider', provider: via })
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
