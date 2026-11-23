// Claude Code's status line, answered by the hook door (./routes.ts): what
// room each plan has left, read from the `rate_limit` rows (@yaks/model) of
// every provider and account this graph knows, so a person on one plan sees
// where the conversation can go next (`/yak:continue`).
//
// Claude Code hands its status line the limits of the account the session
// signs in with, which no transcript holds; each render's reading is kept as
// that account's rows, as a `claude -p` run's are (./readers.ts).

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { accountEid, type Limit, limitRows } from '@yaks/model'
import { identityEid } from '@yaks/graph/identity'
import { and, every, present } from '@yaks/query'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** What Claude Code hands its status line, as far as it is read here. */
export type Status = {
  transcript_path?: string
  model?: { display_name?: string }
  context_window?: { used_percentage?: number }
  rate_limits?: Record<
    string,
    { used_percentage?: number; resets_at?: number } | undefined
  >
}

// The windows Claude Code names, in minutes.
let WINDOWS: Record<string, number> = { five_hour: 300, seven_day: 10080 }

/** The Claude Code account a transcript is kept in: the directory holding
 * its `projects`. */
export let accountOf = (transcript?: string): string | undefined => {
  let at = transcript?.lastIndexOf('/projects/') ?? -1
  return at > 0 ? transcript!.slice(0, at) : undefined
}

/**
 * The plan limits a status line was handed, as readings of the account whose
 * transcript it names.
 *
 * ```ts
 * import { statusLimits } from './statusline.ts'
 * import { accountEid } from '@yaks/model'
 * import { equal } from '@yaks/testing'
 *
 * equal(statusLimits({
 *   transcript_path: '/u/.claude-work/projects/-w/s.jsonl',
 *   rate_limits: { five_hour: { used_percentage: 12, resets_at: 1793098800 } },
 * }), [{
 *   provider: 'claude', account: accountEid('/u/.claude-work'), window: 300,
 *   used: 12, resets: '2026-10-27T11:00:00.000Z',
 * }])
 * equal(statusLimits({}), [])
 * ```
 */
export let statusLimits = (s: Status): Limit[] => {
  let home = accountOf(s.transcript_path)
  return Object.entries(s.rate_limits ?? {}).flatMap(([name, r]) => {
    let window = WINDOWS[name]
    if (!window || typeof r?.used_percentage != 'number') return []
    return [{
      provider: 'claude',
      ...home ? { account: accountEid(home) } : {},
      window,
      used: r.used_percentage,
      ...r.resets_at
        ? { resets: new Date(r.resets_at * 1000).toISOString() }
        : {},
    }]
  })
}

/** A plan's room in one window, as {@link room} draws it. */
export type Room = {
  /** the plan: its account's directory, else its provider */
  plan: string
  window: number
  /** the one model a window meters, where it is not the whole plan */
  model?: string
  used: number
  resets?: string
}

let span = (minutes: number) =>
  minutes % 10080 == 0
    ? minutes == 10080 ? 'wk' : `${minutes / 10080}wk`
    : minutes % 1440 == 0
    ? `${minutes / 1440}d`
    : minutes % 60 == 0
    ? `${minutes / 60}h`
    : `${minutes}m`

let until = (at: string, now: number) => {
  let m = Math.max(0, Math.round((Date.parse(at) - now) / 60000))
  return m >= 2880
    ? `${Math.round(m / 1440)}d`
    : m >= 120
    ? `${Math.round(m / 60)}h`
    : `${m}m`
}

/**
 * Each plan's room, the plan this session runs on first: for each window,
 * the percent left, and when it resets where little is. A reading from a
 * window that has since reset says nothing of the one running now.
 *
 * ```ts
 * import { room } from './statusline.ts'
 * import { equal } from '@yaks/testing'
 *
 * let now = Date.parse('2026-11-23T12:00:00Z')
 * equal(room([
 *   { plan: 'codex', window: 10080, used: 30 },
 *   { plan: 'claude', window: 300, used: 95, resets: '2026-11-23T14:00:00Z' },
 *   { plan: 'claude', window: 10080, used: 40 },
 *   { plan: 'claude', window: 10080, model: 'fable', used: 50 },
 *   { plan: 'grok', window: 300, used: 80, resets: '2026-11-23T11:00:00Z' },
 * ], now, 'claude'), 'claude 5h 5% (2h) · wk 60% · fable 50% │ codex wk 70%')
 * ```
 */
export let room = (rooms: Room[], now: number, first?: string): string => {
  let current = rooms.filter((r) =>
    r.window > 0 && !(r.resets && Date.parse(r.resets) <= now)
  )
  let plans = [...new Set(current.map((r) => r.plan))].sort((a, b) =>
    Number(b == first) - Number(a == first) || a.localeCompare(b)
  )
  return plans.map((plan) =>
    `${plan} ` + current.filter((r) => r.plan == plan)
      .sort((a, b) =>
        Number(!!a.model) - Number(!!b.model) || a.window - b.window
      )
      .map((r) => {
        let left = Math.max(0, Math.round(100 - r.used))
        let soon = left < 10 && r.resets ? ` (${until(r.resets, now)})` : ''
        return `${r.model ?? span(r.window)} ${left}%${soon}`
      }).join(' · ')
  ).join(' │ ')
}

// A plan's name: its account's directory, without the dot (`claude-work`),
// else its provider's name.
let planOf = (home: unknown, provider: unknown): string =>
  typeof home == 'string'
    ? home.slice(home.lastIndexOf('/') + 1).replace(/^\./, '')
    : String(provider ?? '?')

/**
 * Keep what a status line was handed, then answer it: the session's model
 * and how full its context is, and each plan's room ({@link room}). A reading
 * is written only where it moved, since the line is asked for on every
 * render.
 */
export let statusLine = async (
  g: Graph,
  s: Status,
  now = Date.now(),
): Promise<string> => {
  await keep(g, statusLimits(s), accountOf(s.transcript_path), now)
  let limits = await g.read(and(present('rate_limit'), every()))
  let named = [
    ...new Set(
      limits.flatMap((b) => {
        let r = comp(b, 'rate_limit')!
        return [r.provider, r.account, r.model].filter(Boolean).map(String)
      }),
    ),
  ]
  let rows = new Map(
    (named.length ? await g.get(named) : []).filter(Boolean)
      .map((b) => [b!.entity.eid, b!]),
  )
  let name = (eid: unknown, c: string) =>
    comp(rows.get(String(eid)), c)?.name as string | undefined
  let rooms = limits.map((b): Room => {
    let r = comp(b, 'rate_limit')!
    return {
      plan: planOf(
        comp(rows.get(String(r.account)), 'account')?.home,
        name(r.provider, 'provider'),
      ),
      window: Number(r.window),
      ...r.model ? { model: name(r.model, 'model') ?? 'model' } : {},
      used: Number(r.used),
      ...r.resets ? { resets: String(r.resets) } : {},
    }
  })
  let home = accountOf(s.transcript_path)
  let context = s.context_window?.used_percentage
  return [
    [
      s.model?.display_name,
      typeof context == 'number' ? `ctx ${Math.round(context)}%` : undefined,
    ].filter(Boolean).join(' '),
    room(rooms, now, home ? planOf(home, undefined) : 'claude'),
  ].filter(Boolean).join(' │ ')
}

// Write readings where they differ from the rows kept, and the account and
// provider they name where those are missing.
let keep = async (
  g: Graph,
  limits: Limit[],
  home: string | undefined,
  now: number,
) => {
  if (!limits.length || !g.vocab.comp('rate_limit')) return
  let rows = limitRows(limits, new Date(now).toISOString())
  let provider: Eid = identityEid('provider', ['claude'])
  let account = home ? accountEid(home) : undefined
  let kept = new Map(
    (await g.get([
      ...rows.map((b) => b.entity.eid),
      ...account ? [account] : [],
    ])).filter(Boolean).map((b) => [b!.entity.eid, b!]),
  )
  let moved = rows.filter((b) => {
    let was = comp(kept.get(b.entity.eid), 'rate_limit')
    let r = comp(b, 'rate_limit')
    if (!r) return !kept.has(b.entity.eid)
    return !was || was.used != r.used || was.resets != r.resets
  })
  if (!moved.some((b) => b.rate_limit)) return
  await g.apply([
    ...account && !comp(kept.get(account), 'account')
      ? [{ entity: { eid: account }, account: { home, provider } }]
      : [],
    ...moved,
  ], { trusted: true })
}
