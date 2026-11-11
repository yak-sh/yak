// The ChatGPT plan's limits, as the Codex backend's response headers report
// them: a primary window and perhaps a secondary one, each a percentage used
// and when it resets. The plan is the one Codex reports (`codex`), whoever
// asked.

import type { Limit } from '@yaks/model'

/**
 * The readings in a response's limit headers, of `account`'s plan where the
 * caller knows whose it is. A window of no minutes is no window.
 *
 * ```ts
 * import { planLimits } from './limits.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal(
 *   planLimits({
 *     'x-codex-primary-window-minutes': '10080',
 *     'x-codex-primary-used-percent': '9',
 *     'x-codex-primary-reset-at': '1792967691',
 *     'x-codex-secondary-window-minutes': '0',
 *     'x-codex-secondary-used-percent': '0',
 *     'x-codex-secondary-reset-at': '',
 *   }),
 *   [{ provider: 'codex', window: 10080, used: 9, resets: '2026-10-25T22:34:51.000Z' }],
 * )
 * equal(planLimits({ 'x-ratelimit-remaining-requests': '99' }), [])
 * ```
 */
export let planLimits = (
  headers: Record<string, string>,
  account?: string,
): Limit[] =>
  ['primary', 'secondary'].flatMap((name) => {
    let at = (part: string) => headers[`x-codex-${name}-${part}`] ?? ''
    let window = Number(at('window-minutes')), used = Number(at('used-percent'))
    if (!(window > 0) || at('used-percent') == '' || !Number.isFinite(used)) {
      return []
    }
    let resets = Number(at('reset-at'))
    return [{
      provider: 'codex',
      ...account ? { account } : {},
      window,
      used,
      ...resets > 0 ? { resets: new Date(resets * 1000).toISOString() } : {},
    }]
  })
