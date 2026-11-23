// A number a space buys (workers/yak/numbers.ts): what it costs the space,
// and what it is approved for.

/** What we add to a provider's price for a number, as a share of it. */
export let MARGIN = 1

/**
 * What a space pays for something a provider charges us `cost` for: the
 * cost and our margin, to the cent above.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { ours } from '@yaks/platform/numbers'
 * equal(ours(1.1), 2.2)
 * equal(ours(0.4), 0.8)
 * equal(ours(0.004), 0.01)
 * ```
 */
export let ours = (cost: number) =>
  Math.ceil(Number((cost * (1 + MARGIN) * 100).toFixed(6))) / 100

/** What a number's line says it may do: texts to people who know it, calls,
 * and the 10DLC campaign its texts to many are registered under. */
export type Approval = {
  sms: boolean
  voice: boolean
  campaign: string | null
}

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
