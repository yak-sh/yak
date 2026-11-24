// What yaks.app takes from a sale through a seller's own payment account: a
// rate in basis points, the platform's `fee{bps}` (workers/yak/sell.ts
// `feeOf`), and the arithmetic every page, tool and order says it with, so
// none of them can disagree with what a checkout takes.
import { charged, type Costs } from '@yaks/host/payments'

/** The fee on a total, in cents. Rounded down, so the fee is never a cent more
 * than the rate says, and never more than the sale itself.
 *
 * ```ts
 * import { fee } from '@yaks/platform/fee'
 * import { equal } from '@yaks/testing'
 * equal(fee(1000, 250), 25)
 * equal(fee(999, 250), 24) // down, not up
 * equal(fee(1000, 0), 0)
 * ```
 */
export let fee = (cents: number, bps: number) =>
  Math.min(cents, Math.max(0, Math.floor((cents * bps) / 10_000)))

/** The rate as a person reads it: `2.5%`, or `0%`.
 *
 * ```ts
 * import { rate } from '@yaks/platform/fee'
 * import { equal } from '@yaks/testing'
 * equal(rate(250), '2.5%')
 * equal(rate(100), '1%')
 * equal(rate(0), '0%')
 * ```
 */
export let rate = (bps: number) => `${Math.round(bps / 100 * 100) / 100}%`

/** Where a card payment of `cents` goes: the provider's fee, the platform's,
 * and what the seller keeps. Both fees are taken from the whole payment.
 *
 * ```ts
 * import { kept } from '@yaks/platform/fee'
 * import { equal } from '@yaks/testing'
 * equal(kept(2000, 100, { bps: 290, cents: 30 }), { provider: 88, platform: 20, seller: 1892 })
 * equal(kept(2000, 0, { bps: 290, cents: 30 }), { provider: 88, platform: 0, seller: 1912 })
 * ```
 */
export let kept = (
  cents: number,
  bps: number,
  card: Costs['card'],
): { provider: number; platform: number; seller: number } => {
  let provider = charged(card, cents)
  let platform = Math.min(cents - provider, fee(cents, bps))
  return { provider, platform, seller: cents - provider - platform }
}
