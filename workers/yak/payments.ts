// The payment provider this Worker takes money through, and the one file that
// names it: @yaks/stripe, lent the Worker's own key (env.ts `STRIPE_KEY`) and
// clock. billing.ts (a space's plan), sell.ts (a seller's shop) and reward.ts
// (an invite's month) reach it through here (T-141894).
import { ask as call } from '@yaks/stripe'
import type { Clock } from '@yaks/fp'

export { StripeError } from '@yaks/stripe'

/** What the provider is reached with, off the Worker's environment. */
export type Paying = { STRIPE_KEY?: string; CLOCK?: Clock }

/** One call to the provider with the Worker's key: a GET without `fields`, a
 * POST otherwise, `on` a seller's connected account. */
export let ask = (
  env: Paying,
  path: string,
  fields?: Record<string, unknown>,
  on?: string,
) => call({ key: env.STRIPE_KEY, clock: env.CLOCK }, path, fields, on)
