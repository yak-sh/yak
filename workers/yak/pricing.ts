// What a published app costs, as app_publish takes it (D-464): dollars, paid
// once or each month or year, and only from a space that can sell, the same
// space that can sell goods (sell.ts): a paid plan and a payment account
// ready to take money. A price is the offer's, stored on `published`
// (@yaks/platform/price), so a new one reaches new buyers only.
import { type Interval, INTERVALS, type Price } from '@yaks/platform/price'
import { type Host, url } from '@yaks/platform/host'
import type { Space } from './directory.ts'
import { refusedSell, selling } from './sell.ts'
import { type Args, flag, refuse } from './tool.ts'

let SAY = 'a price in dollars to the cent, such as 40 or 4.99'

// Dollars to whole cents. A model sends a number as text as often as not,
// and a dollar sign with it.
let cents = (v: unknown) => {
  let n = typeof v == 'string' && v.trim() ? Number(v.replace(/^\s*\$/, '')) : v
  if (typeof n != 'number' || !Number.isFinite(n) || n <= 0) {
    throw refuse('arguments', `price: ${SAY}, above zero`)
  }
  let whole = Math.round(n * 100)
  if (Math.abs(whole - n * 100) > 1e-6) {
    throw refuse('arguments', `price: ${SAY}`)
  }
  return whole
}

let every = (v: unknown): Interval | null => {
  if (v == null || v == 'once') return null
  if ((INTERVALS as unknown[]).includes(v)) return v as Interval
  throw refuse('arguments', `interval: once, ${INTERVALS.join(' or ')}`)
}

/** The price an app_publish call leaves on the offer: the one it names,
 * none for `free: true`, and else the one it had (`was`), the way a
 * republish keeps the name and the line it had. */
export let pricing = (args: Args, was: Price | null): Price | null => {
  if (args.free != null && flag(args.free, 'free')) {
    if (args.price != null || args.interval != null) {
      throw refuse('arguments', 'free: true takes no price or interval')
    }
    return null
  }
  if (args.price == null) {
    if (args.interval == null) return was
    throw refuse(
      'arguments',
      "interval goes with the price it is for: price: 5, interval: 'month'",
    )
  }
  return { cents: cents(args.price), interval: every(args.interval) }
}

/** Why `space` cannot put a price on an app, as the refusal naming all it
 * lacks, or null when it can. `name` is the payment provider's. */
export let refusedPrice = (space: Space, name: string, env: Host = {}) => {
  let plan = refusedSell(space, env) != null
  let stands = selling(space)
  if (!plan && stands == 'ready') return null
  let lacks = [
    plan ? `the Plus plan (compare plans: ${url(env, '/pricing')})` : '',
    stands == 'none' ? `a ${name} account connected to it` : '',
    stands == 'setup'
      ? `${name} to finish setting up the account it connected`
      : '',
  ].filter(Boolean)
  let sell = `space_sell(space: '${space.slug}')`
  return refuse(
    plan ? 'limit' : 'conflict',
    `${space.slug} cannot charge for an app yet: it needs ` +
      `${lacks.join(' and ')}. ` +
      (stands == 'none'
        ? `${sell} connects one${plan ? ' once it has the plan' : ''}. `
        : stands == 'setup'
        ? `${sell} answers a fresh link to finish. `
        : '') +
      'free: true publishes it without a price.',
  )
}
