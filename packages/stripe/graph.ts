// The `@yaks/stripe/graph` facet: Stripe as the payment provider it lends its
// host, named `stripe` (@yaks/host/payments). The config passes it its key,
// its clock, the prices it sells (./plans.ts `Options`) and its doors'
// signing secrets (./doors.ts `Options`), each read at its use, so a key set
// after start-up is used by the next call.
import type { Payments } from '@yaks/host/payments'
import { doors, type Options } from './doors.ts'
import { plans } from './plans.ts'
import { shops } from './shops.ts'

export let payments = (
  _host: unknown,
  options: Options,
): Record<string, Payments> => ({
  stripe: {
    name: 'Stripe',
    plans: plans(options),
    shops: shops(options),
    doors: doors(options),
  },
})
