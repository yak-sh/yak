// A provider's plan limits: how much of a subscription's window is used. Who
// hears a provider say so (a model's reply, a CLI's log, a status line) says
// it as a `Limit`, and whoever records it keeps the latest as a `rate_limit`
// row.

import type { Bundle, Eid } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'

/** A provider's plan limit, as the provider reported it (`rate_limit`). */
export type Limit = {
  /** the provider whose plan it is, by name: `claude`, `codex` */
  provider: string
  /** the account whose plan it is, where the one reporting knows it */
  account?: Eid
  /** what it meters where that is not the whole plan: `model`, the requests
   * of the one model the reading came back from (Claude's cap on Fable) */
  per?: 'model'
  /** the model a limit `per` model meters, as whoever knows which model the
   * request asked says it ({@link metering}) */
  model?: Eid
  /** the limit's window in minutes */
  window: number
  /** percent of the window's limit used */
  used: number
  resets?: string
}

/** The row holding the latest reading of one plan-limit window
 * (`rate_limit`), named by its provider entity, the window in minutes and,
 * where the reading came from one, the account whose plan it is; a limit on
 * one model's requests, by the model too. */
export let limitEid = (
  provider: Eid,
  window: number,
  account?: Eid,
  model?: Eid,
): Eid =>
  identityEid('rate_limit', [
    provider,
    String(window),
    ...account ? [account] : [],
    ...model ? [model] : [],
  ])

/**
 * Readings as those of a request that asked `model`: a limit `per` model
 * meters that one.
 *
 * ```ts
 * import { metering } from './limits.ts'
 * import { equal } from '@yaks/testing'
 *
 * let week = { provider: 'claude', window: 10080, used: 43 }
 * let cap = { ...week, used: 6, per: 'model' as const }
 * equal(metering([week, cap], 'fable'), [week, { ...cap, model: 'fable' }])
 * equal(metering([week, cap]), [week, cap])
 * ```
 */
export let metering = (limits: Limit[], model?: Eid): Limit[] =>
  limits.map((l) => l.per == 'model' && model ? { ...l, model } : l)

/** The row of an account a CLI keeps on this machine (`account`), named by
 * its directory. */
export let accountEid = (home: string): Eid => identityEid('account', [home])

/** The directory of the account a CLI signs in with in an environment:
 * `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, else `~/.claude` or `~/.codex`. */
export let accountHome = (
  runner: 'claude' | 'codex',
  env: (name: string) => string | undefined,
): string | undefined => {
  let named = env(runner == 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME')
  let at = env('HOME')
  return named || (at && `${at}/.${runner}`) || undefined
}

/**
 * Readings as rows: each one's `rate_limit`, read at `at`, and its provider's
 * row. A limit on one model's requests is kept where the model is known, and
 * otherwise says nothing of any plan.
 *
 * ```ts
 * import { limitEid, limitRows } from './limits.ts'
 * import { identityEid } from '@yaks/graph/identity'
 * import { equal } from '@yaks/testing'
 *
 * let codex = identityEid('provider', ['codex'])
 * let week = { provider: 'codex', window: 10080, used: 9 }
 * equal(limitRows([week], '2026-11-11T00:00:00.000Z'), [
 *   { entity: { eid: codex }, provider: { name: 'codex' } },
 *   {
 *     entity: { eid: limitEid(codex, 10080) },
 *     rate_limit: { provider: codex, window: 10080, used: 9, at: '2026-11-11T00:00:00.000Z' },
 *   },
 * ])
 * let [, cap] = limitRows([{ ...week, per: 'model', model: 'm' }])
 * equal(cap, {
 *   entity: { eid: limitEid(codex, 10080, undefined, 'm') },
 *   rate_limit: { provider: codex, window: 10080, model: 'm', used: 9 },
 * })
 * equal(limitRows([{ ...week, per: 'model' }]), [])
 * ```
 */
export let limitRows = (read: Limit[], at?: string): Bundle[] => {
  let provider = (name: string) => identityEid('provider', [name])
  let limits = read.filter((l) => !l.per || l.model)
  return [
    ...[...new Set(limits.map((l) => l.provider))].map((name) => ({
      entity: { eid: provider(name) },
      provider: { name },
    })),
    ...limits.map((l) => ({
      entity: {
        eid: limitEid(provider(l.provider), l.window, l.account, l.model),
      },
      rate_limit: {
        provider: provider(l.provider),
        window: l.window,
        ...l.account ? { account: l.account } : {},
        ...l.model ? { model: l.model } : {},
        used: l.used,
        ...l.resets ? { resets: l.resets } : {},
        ...at ? { at } : {},
      },
    })),
  ]
}
