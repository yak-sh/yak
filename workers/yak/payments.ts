// The payment provider the platform takes money through: the one config.ts
// `payments` names, lent under its name (lent.ts) with the options its entry
// gives it, every secret among them read from the Worker's environment at
// its use. Nothing here names a provider: billing.ts sells a space its plan
// and reward.ts moves an invite's month through the plans it lends.
import type { Payments, Plans } from '@yaks/host/payments'
import { ask as call } from '@yaks/stripe'
import type { Clock } from '@yaks/fp'
import { payments as config } from './config.ts'
import { lent } from './lent.ts'

// One lending per environment. Its options read the environment as they are
// used, so a key put after the first call is used by the next.
let held = new WeakMap<object, Promise<Payments>>()

let lend = async (env: object) => {
  let all = await lent(env, 'payments', config)
  if (!Object.hasOwn(all, config.via)) {
    throw new Error(`no payment provider ${config.via} is lent`)
  }
  return all[config.via]
}

/** The payment provider config.ts `payments` lends as its `via`. */
export let payments = (env: object): Promise<Payments> => {
  let got = held.get(env)
  if (!got) {
    held.set(env, got = lend(env))
    got.catch(() => held.delete(env))
  }
  return got
}

/** The plans it sells a space. */
export let plans = async (env: object): Promise<Plans> =>
  (await payments(env)).plans

// TODO(T-142132): selling still calls Stripe here with the Worker's own key,
// until a seller's shop is lent beside the plans and sell.ts speaks it.

/** One call to Stripe with the Worker's key, for sell.ts alone: a GET
 * without `fields`, a POST otherwise, `on` a seller's connected account. */
export let ask = (
  env: { STRIPE_KEY?: string; CLOCK?: Clock },
  path: string,
  fields?: Record<string, unknown>,
  on?: string,
) => call({ key: env.STRIPE_KEY, clock: env.CLOCK }, path, fields, on)
