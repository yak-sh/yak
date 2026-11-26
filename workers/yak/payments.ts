// The payment provider the platform takes money through: the one config.ts
// `payments` names, lent under its name (lent.ts) with the options its entry
// gives it, every secret among them read from the Worker's environment at
// its use. Nothing here names a provider: billing.ts sells a space its plan
// and reward.ts moves an invite's month through the plans it lends, and
// sell.ts connects a seller and opens their checkouts through its shops.
import type { Payments, Plans, Shops } from '@yaks/host/payments'
import { payments as config, sandboxPayments as sandbox } from './config.ts'
import { sharing } from './lib/shared.ts'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'

// One lending per environment. Its options read the environment as they are
// used, so a key put after the first call is used by the next.
let held = new WeakMap<object, Promise<Payments>>()

let lend = async (env: object, settings: typeof config) => {
  let all = await (await import('./lent.ts')).lent(env, 'payments', settings)
  if (!Object.hasOwn(all, settings.via)) {
    throw new Error(`no payment provider ${settings.via} is lent`)
  }
  return all[settings.via]
}

/** The payment provider config.ts `payments` lends as its `via`. */
export let payments = (env: object): Promise<Payments> =>
  sharing(held, env, () => lend(env, config))

let heldSandbox = new WeakMap<object, Promise<Payments>>()

export let sandboxPayments = (env: object): Promise<Payments> =>
  sharing(heldSandbox, env, () => lend(env, sandbox))

/** The account and provider a fund can accept gifts through. A deployment
 * already running in test mode can use its own connected sellers. */
export let donationAccount = async (
  env: Env,
  space: Space,
  test: boolean,
) => {
  let primary = await shops(env)
  if (test && primary.mode() != 'test') {
    let sandbox = (await sandboxPayments(env)).shops
    return sandbox.mode() == 'test' && env.STRIPE_SANDBOX_ACCOUNT
      ? { shops: sandbox, account: env.STRIPE_SANDBOX_ACCOUNT }
      : null
  }
  let seller = space.seller
  return primary.on() && seller?.account && seller.ready && !seller.house
    ? { shops: primary, account: seller.account }
    : null
}

/** The plans it sells a space. */
export let plans = async (env: object): Promise<Plans> =>
  (await payments(env)).plans

/** The shops a space sells through on an account of its own. */
export let shops = async (env: object): Promise<Shops> =>
  (await payments(env)).shops

/** The name a seller's row gives its provider (`seller{via}`). */
export let via = config.via
