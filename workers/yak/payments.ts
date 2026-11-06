// The payment provider the platform takes money through: the one config.ts
// `payments` names, lent under its name (lent.ts) with the options its entry
// gives it, every secret among them read from the Worker's environment at
// its use. Nothing here names a provider: billing.ts sells a space its plan
// and reward.ts moves an invite's month through the plans it lends, and
// sell.ts connects a seller and opens their checkouts through its shops.
import type { Payments, Plans, Shops } from '@yaks/host/payments'
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

/** The shops a space sells through on an account of its own. */
export let shops = async (env: object): Promise<Shops> =>
  (await payments(env)).shops

/** The name a seller's row gives its provider (`seller{via}`). */
export let via = config.via
