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

// The codes a provider answers a spent allowance with: the Codex backend's
// plan window, the API's billing quota, and @yaks/openai's native door's.
let SPENT = new Set(['usage_limit_reached', 'insufficient_quota', 'limit'])

/**
 * Whether a failed request says the plan it spends is used up: a code a
 * provider answers a spent allowance with, or a window it read full that has
 * not reset by `now`. A provider merely busy is not spent.
 *
 * ```ts
 * import { spent } from './limits.ts'
 * import { equal } from '@yaks/testing'
 *
 * let now = Date.parse('2026-11-23T12:00:00Z')
 * let full = { provider: 'claude', window: 300, used: 100, resets: '2026-11-23T14:00:00Z' }
 * equal(spent({ code: 'busy', limits: [full] }, now), true)
 * equal(spent({ code: 'busy', limits: [{ ...full, resets: '2026-11-23T11:00:00Z' }] }, now), false)
 * equal(spent({ code: 'usage_limit_reached' }, now), true)
 * equal(spent({ code: 'busy' }, now), false)
 * ```
 */
export let spent = (
  e: { code?: string; limits?: Limit[] },
  now: number = Date.now(),
): boolean =>
  SPENT.has(e.code ?? '') ||
  !!e.limits?.some((l) =>
    l.used >= 100 && !(l.resets && Date.parse(l.resets) <= now)
  )

/** The row of an account a CLI keeps on this machine (`account`), named by
 * its directory. */
export let accountEid = (home: string): Eid => identityEid('account', [home])

/** Where each CLI on this machine keeps the account it signs in with, and
 * its transcripts: the variable that names the directory, and the one it
 * keeps under the home directory without it. Antigravity's CLI reads no such
 * variable. */
export let ACCOUNTS = {
  claude: { env: 'CLAUDE_CONFIG_DIR', dir: '.claude' },
  codex: { env: 'CODEX_HOME', dir: '.codex' },
  grok: { env: 'GROK_HOME', dir: '.grok' },
  antigravity: { env: undefined, dir: '.gemini/antigravity-cli' },
} as const

/** A CLI that keeps an account on this machine (`ACCOUNTS`). */
export type Runner = keyof typeof ACCOUNTS

/** The directory of the account a CLI signs in with in an environment: the
 * one its variable names (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GROK_HOME`),
 * else its own under the home directory (`~/.claude`, `~/.codex`, ...). */
export let accountHome = (
  runner: Runner,
  env: (name: string) => string | undefined,
): string | undefined => {
  let { env: name, dir } = ACCOUNTS[runner]
  let at = env('HOME')
  return (name && env(name)) || (at && `${at}/${dir}`) || undefined
}

/**
 * An environment that signs a CLI in with the account in `home`, the
 * inverse of {@link accountHome}: the variable names it, except for the
 * account the CLI keeps by default, which it is run without. Claude Code
 * keeps its default account's config beside `~/.claude`, in `~/.claude.json`,
 * and reads `$CLAUDE_CONFIG_DIR/.claude.json` once the variable is set.
 *
 * ```ts
 * import { signingIn } from './limits.ts'
 * import { equal } from '@yaks/testing'
 *
 * let env = { HOME: '/u', CLAUDE_CONFIG_DIR: '/u/.claude-work' }
 * equal(signingIn('claude', '/u/.claude-teams', env).CLAUDE_CONFIG_DIR, '/u/.claude-teams')
 * equal(signingIn('claude', '/u/.claude', env), { HOME: '/u' })
 * equal(signingIn('codex', '/u/.codex-2', { HOME: '/u' }).CODEX_HOME, '/u/.codex-2')
 * ```
 */
export let signingIn = (
  runner: Runner,
  home: string,
  env: Record<string, string>,
): Record<string, string> => {
  let { env: name, dir } = ACCOUNTS[runner]
  if (!name) return env
  let { [name]: _, ...rest } = env
  return home == `${env.HOME}/${dir}` ? rest : { ...rest, [name]: home }
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
