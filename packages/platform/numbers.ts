// What yaks.app resells of a phone provider's (workers/yak/numbers.ts): what
// a number, a minute and a text cost a space over what the provider charges
// us, and what a number is approved for.

/** What we add to what a provider charges us: dollars a month on each
 * number, and a share of every minute and text. */
export let MARKUP = { monthly: 3, usage: 0.25 }

// Dollars to the cent above.
let cents = (n: number) => Math.ceil(Number((n * 100).toFixed(6))) / 100

/**
 * What a space pays for a number a provider sells us at `cost`: its price
 * up front, and its monthly price with our {@link MARKUP}, to the cent.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { numberPrice } from '@yaks/platform/numbers'
 * equal(numberPrice({ upfront: 0.4, monthly: 1.1 }), {
 *   upfront: 0.4,
 *   monthly: 4.1,
 * })
 * ```
 */
export let numberPrice = (cost: { upfront: number; monthly: number }) => ({
  upfront: cents(cost.upfront),
  monthly: cents(cost.monthly + MARKUP.monthly),
})

/**
 * What a space pays for a minute or a text a provider charges us `cost`
 * for, in dollars: the cost and our share.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { usage } from '@yaks/platform/numbers'
 * equal(usage(0.008), 0.01)
 * ```
 */
export let usage = (cost: number) =>
  Number((cost * (1 + MARKUP.usage)).toFixed(6))

/** What a number's line says it may do: texts to people who know it, calls,
 * and the 10DLC campaign its texts to many are registered under. */
export type Approval = {
  sms: boolean
  voice: boolean
  campaign: string | null
}

/**
 * Whether a number texts many people, or has asked carriers to: its 10DLC
 * campaign is registered, or its toll-free verification filed. Such a number
 * is a space's public line, where a stranger's text signs them up with the
 * Operator; any other texts only people who know it, a personal line, where
 * a stranger's text is told to the space's owners and answered by nobody
 * (workers/yak/operator-signup.ts `spaceArrived`).
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { many } from '@yaks/platform/numbers'
 * equal(many({ campaign: null, verification: null }), false)
 * equal(many({ campaign: 'CX1', verification: null }), true)
 * equal(many({ campaign: null, verification: 'tfv-1' }), true)
 * ```
 */
export let many = (
  line: { campaign: string | null; verification: string | null },
) => !!line.campaign || !!line.verification

/**
 * What a number is approved for, as its line says and, for texts to many,
 * as its 10DLC campaign or its toll-free verification (`verified`) stands:
 * calls, texts to people who texted it first or know it, and texts to many
 * people. The Operator and agents use a number for these alone; carriers
 * block the rest.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { uses } from '@yaks/platform/numbers'
 * let line = { sms: true, voice: true, campaign: null }
 * equal(uses(line), ['calls', 'texts to people who know it'])
 * equal(
 *   uses({ ...line, campaign: 'CX1' }).at(-1),
 *   'texts to many people (10DLC campaign CX1)',
 * )
 * equal(uses({ ...line, sms: false }), ['calls'])
 * ```
 */
export let uses = (line: Approval, verified = false): string[] => [
  ...line.voice ? ['calls'] : [],
  ...line.sms ? ['texts to people who know it'] : [],
  ...line.sms && line.campaign
    ? [`texts to many people (10DLC campaign ${line.campaign})`]
    : [],
  ...line.sms && verified ? ['texts to many people (toll-free verified)'] : [],
]
