// What a published app costs (D-464): whole cents, paid once, or each month
// or each year. It is stored on the offer as `published{price_cents,
// interval}`, with no `interval` for a one-time price and neither for a free
// app. The app's page, its gallery card and the checkout that sells it all
// say it through `priceTag`, so a buyer reads one price in all three.
import { count } from './standing.ts'

/** How often a recurring price is charged, in the payment provider's words. */
export type Interval = 'month' | 'year'

export let INTERVALS: Interval[] = ['month', 'year']

/** A price: whole cents, charged once (`interval` null) or each interval. */
export type Price = { cents: number; interval: Interval | null }

/** The price an offer's `published` row states, or null for a free app.
 *
 * ```ts
 * import { priceOf } from '@yaks/platform/price'
 * import { equal } from '@yaks/testing'
 * equal(priceOf({ price_cents: 500, interval: 'month' }), { cents: 500, interval: 'month' })
 * equal(priceOf({ price_cents: 4000 }), { cents: 4000, interval: null })
 * equal(priceOf({}), null)
 * equal(priceOf(null), null)
 * ```
 */
export let priceOf = (
  row?: { price_cents?: number | null; interval?: string | null } | null,
): Price | null =>
  row?.price_cents
    ? {
      cents: row.price_cents,
      interval: (INTERVALS as string[]).includes(row.interval ?? '')
        ? row.interval as Interval
        : null,
    }
    : null

/** Cents as dollars, saying the cents only when there are some.
 *
 * ```ts
 * import { amount } from '@yaks/platform/price'
 * import { equal } from '@yaks/testing'
 * equal(amount(4000), '$40')
 * equal(amount(499), '$4.99')
 * equal(amount(4050), '$40.50')
 * equal(amount(120000), '$1,200')
 * ```
 */
export let amount = (cents: number): string =>
  `$${count(Math.floor(cents / 100))}${
    cents % 100 ? `.${String(cents % 100).padStart(2, '0')}` : ''
  }`

/** A price in words, as a buyer reads it.
 *
 * ```ts
 * import { priceTag } from '@yaks/platform/price'
 * import { equal } from '@yaks/testing'
 * equal(priceTag({ cents: 4000, interval: null }), '$40 once')
 * equal(priceTag({ cents: 500, interval: 'month' }), '$5 a month')
 * equal(priceTag({ cents: 5000, interval: 'year' }), '$50 a year')
 * ```
 */
export let priceTag = ({ cents, interval }: Price): string =>
  `${amount(cents)} ${interval ? `a ${interval}` : 'once'}`
