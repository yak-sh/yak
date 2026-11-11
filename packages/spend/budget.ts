import { env } from '@yaks/process/env'
import * as io from '@yaks/file/io'
/**
 * The Claude plan's limits, as `rate_limit` rows (@yaks/model). Claude Code
 * hands its status line the account's limits, and claude-status keeps the
 * last reading in a cache file per project (`usage.<label>` in
 * `~/.cache/claude-usage`): `SEVEN_DAY_PCT`, `SEVEN_DAY_RESET`,
 * `FIVE_HOUR_PCT`, `FIVE_HOUR_RESET` and `UPDATED_AT`, times in epoch
 * seconds. The limits are the account's, so the newest file is the reading,
 * of the account `yak serve`'s environment signs in with, or of the one a
 * `CLAUDE_CONFIG_DIR` line in it names. Only an interactive session has a
 * status line: a `claude -p` run reports its limits in its stream, read with
 * the run (@yaks/session's `claude` reader), and the newer of the two
 * readings is the one kept. Codex's arrive with its sessions, each account's
 * in its own (@yaks/session's importer). A native session's requests carry
 * theirs on each reply (@yaks/model `Reply.limits`), kept as it is recorded.
 *
 * @module
 */
import type { Bundle, Eid, Graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { accountEid, limitEid } from '@yaks/model'
import { home } from '@yaks/session/files'

let iso = (s?: string) =>
  s && Number(s) ? new Date(Number(s) * 1000).toISOString() : undefined

/**
 * A cache file's reading, as rows: of the account it names, else of the
 * account in `dir`.
 *
 * ```ts
 * import { limits } from './budget.ts'
 * import { accountEid } from '@yaks/model'
 * import { identityEid } from '@yaks/graph/identity'
 * import { equal } from '@yaks/testing'
 *
 * let [, , week] = limits('SEVEN_DAY_PCT=25\nSEVEN_DAY_RESET=1793098800\nUPDATED_AT=1792531227\n', '/u/.claude')
 * equal(week.rate_limit, {
 *   provider: identityEid('provider', ['claude']),
 *   account: accountEid('/u/.claude'),
 *   window: 10080,
 *   used: 25,
 *   resets: '2026-10-27T11:00:00.000Z',
 *   at: '2026-10-20T21:20:27.000Z',
 * })
 * ```
 */
export let limits = (text: string, dir?: string): Bundle[] => {
  let v = Object.fromEntries(
    text.split('\n').map((l) => l.split('=')).filter((p) => p.length == 2),
  ) as Record<string, string>
  let provider: Eid = identityEid('provider', ['claude'])
  let of = v.CLAUDE_CONFIG_DIR || dir
  let account = of ? accountEid(of) : undefined
  let at = iso(v.UPDATED_AT)
  let row = (window: number, used?: string, resets?: string): Bundle[] =>
    used == null || used === '' ? [] : [{
      entity: { eid: limitEid(provider, window, account) },
      rate_limit: {
        provider,
        ...account ? { account } : {},
        window,
        used: Number(used),
        ...iso(resets) ? { resets: iso(resets) } : {},
        ...at ? { at } : {},
      },
    }]
  let rows = [
    ...row(10080, v.SEVEN_DAY_PCT, v.SEVEN_DAY_RESET),
    ...row(300, v.FIVE_HOUR_PCT, v.FIVE_HOUR_RESET),
  ]
  return rows.length
    ? [
      { entity: { eid: provider }, provider: { name: 'claude' } },
      ...account
        ? [{ entity: { eid: account }, account: { home: of, provider } }]
        : [],
      ...rows,
    ]
    : []
}

/** Where claude-status keeps its readings. */
export let usageDir = (): string | undefined => {
  return env.get('CLAUDE_USAGE_DIR') ??
    (env.get('HOME') ? `${env.get('HOME')}/.cache/claude-usage` : undefined)
}

// The newest reading in a directory, or nothing.
let newest = (dir: string): string | undefined => {
  let best: [number, string] | undefined
  try {
    for (let f of io.readDirSync(dir)) {
      if (!f.isFile || !f.name.startsWith('usage.')) continue
      let at = io.statSync(`${dir}/${f.name}`).mtime?.getTime() ?? 0
      if (!best || at > best[0]) best = [at, `${dir}/${f.name}`]
    }
  } catch {
    return undefined // no cache: Claude Code has no status line here
  }
  return best && io.readTextFileSync(best[1])
}

/** Keep the newest reading as rows, where it is newer than the one kept. */
export let read = async (g: Graph, dir = usageDir()): Promise<void> => {
  let text = dir && newest(dir)
  let rows = text ? limits(text, home('claude')) : []
  let readings = rows.filter((b) => b.rate_limit)
  if (!readings.length) return
  let kept = new Map(
    (await g.get(readings.map((b) => b.entity.eid), ['rate_limit']))
      .filter((r) => r).map((r) => [r!.entity.eid, r!]),
  )
  let at = (b?: Bundle) =>
    String((b?.rate_limit as { at?: string } | undefined)?.at ?? '')
  let newer = readings.filter((b) => at(b) > at(kept.get(b.entity.eid)))
  if (newer.length) {
    await g.apply([...rows.filter((b) => !b.rate_limit), ...newer], {
      trusted: true,
    })
  }
}
