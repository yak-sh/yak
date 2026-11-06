// The `@yaks/stripe/graph` facet: Stripe as the payment provider it lends its
// host, named `stripe` (@yaks/host/payments). The config passes it its key,
// its clock and the prices it sells (./plans.ts `Options`), each read at its
// use, so a key set after start-up is used by the next call.
import type { Payments } from '@yaks/host/payments'
import { type Options, plans } from './plans.ts'

export let payments = (
  _host: unknown,
  options: Options,
): Record<string, Payments> => ({
  stripe: { name: 'Stripe', plans: plans(options) },
})
