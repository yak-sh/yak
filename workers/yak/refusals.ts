// Every refusal a hosted tool gives reaches TaskMaster, grouped, once an hour
// (D-152906). A refusal is no bug (defects.ts `refused`): the caller asked
// for something the tool would not do. But a tool refused often, or for a
// cause its description never warned of, is an interface failing its callers:
// a schema, a description or a guide page worth fixing. So each one is kept
// in the platform store as an occurrence, and the store's hourly wake groups
// what has not yet been counted into one letter.
//
// An occurrence is `tool_refusal{tool, source, space, session, release, at}`,
// worn with `refusal{code}` and `content{body}`, its cause: the refusal's own
// words with the values in them taken out (`cause`), so a group gathers every
// call refused the same way and the record holds no argument, address or key
// a caller sent. Its eid derives from the call it refused (`source`), so a
// call seen at two boundaries, the Operator's session and a connector tool
// inside it, is one occurrence.
//
// The report is a `refusal_report{}` that is its own letter to TaskMaster
// (mail-config.ts `toPlatform`: `doc{title, body}`, `mail`, `deliver`),
// written in one transaction with `counted{report}` on each occurrence it
// counts: a restart in between leaves either neither or both, and an
// occurrence that arrives late, or past a report's `MOST`, is simply not yet
// counted and goes in the next one. An hour with nothing to count writes
// nothing and sends nothing. The store's pool sends the letter as it sends
// every platform letter (@yaks/mail `mail_post`), waiting out a mail outage,
// and `delivered{at}` says it left.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { argsOf, derivedEid, who } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import type { Refused } from '@yaks/tools'
import { background, caught } from './defects.ts'
import type { Env } from './env.ts'
import type { Host } from './host.ts'
import { toPlatform } from './mail-config.ts'
import { KERNEL, meta } from './meta.ts'
import { VERSION } from './running.ts'
import type { Ctx } from './tool.ts'

/** The most occurrences one report counts; the rest wait for the next. */
export let MOST = 500

/** The most groups a letter spells out; the rest are counted in one line. */
let GROUPS = 40

/** The most calls a group names as its evidence. */
let CALLS = 3

// What a value in a refusal's words looks like, each said as what it is: an
// address, a link, an id or key, a number, or something quoted at length.
let VALUES: [RegExp, string][] = [
  [/\bhttps?:\/\/\S+/g, '<url>'],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>'],
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    '<id>',
  ],
  [/\b(?=[\w+/=-]*\d)[\w+/=-]{16,}/g, '<token>'],
  [/(["'`])(?:(?!\1).){25,}?\1/g, '$1…$1'],
  [/\b\d+(\.\d+)?\b/g, '<n>'],
]

/**
 * A refusal's cause: its words with the values a caller sent taken out, so
 * every call refused the same way reads alike, and none of what one sent is
 * kept.
 *
 * ```ts
 * import { cause } from './refusals.ts'
 * cause('note: 342 characters, and a note is at most 200')
 * // 'note: <n> characters, and a note is at most <n>'
 * cause('no app ada@example.com/0b0f6b4e-6a8e-4f44-9c1c-3a1c3a1c3a1c')
 * // 'no app <email>/<id>'
 * ```
 */
export let cause = (said: string): string =>
  VALUES.reduce((s, [value, as]) => s.replace(value, as), said)
    .replace(/\s+/g, ' ').trim().slice(0, 300)

/** Where a refusal happened, as far as its boundary knows. */
export type Where = { space?: string | null; session?: string | null }

/** Where a connector call was refused: the space it was admitted to, or
 * else the one its arguments name, where there is one. Only the space's eid
 * is kept, never what was sent. */
export let admitted = (ctx: Pick<Ctx, 'dir' | 'entered'>) =>
async (
  call: Bundle,
): Promise<Where> => {
  let entered = ctx.entered?.space.eid
  if (entered) return { space: entered }
  let slug = argsOf(call).space
  if (typeof slug != 'string' || !slug) return {}
  let space = await ctx.dir.space(slug).catch((e) => {
    caught(e, { request: 'tool refusal space' })
    return null
  })
  return { space: space?.eid ?? null }
}

/** One occurrence as the platform store keeps it. */
export let occurrence = (
  refusal: { code: string; said: string },
  call: Bundle,
  tool: string | undefined,
  where: Where,
  at: string,
): Bundle => ({
  entity: { eid: identityEid('tool_refusal', [call.entity.eid]) },
  tool_refusal: {
    tool: tool ?? '',
    source: call.entity.eid,
    space: where.space ?? null,
    session: where.session ?? who(call)?.via ?? null,
    release: VERSION,
    at,
  },
  refusal: { code: refusal.code },
  content: { body: cause(refusal.said) },
})

/** What hears a boundary's refusals: each one written to the platform
 * store behind the answer, never holding it up or failing it. `where` is
 * asked of each call as it is heard, since a call admits its space as it
 * runs. */
export let hearing = (
  env: Pick<Env, 'STORE' | 'META' | 'CLOCK'>,
  where: (call: Bundle) => Where | Promise<Where> = () => ({}),
): Refused =>
(refusal, call, tool) => {
  let now = new Date(env.CLOCK?.now() ?? Date.now()).toISOString()
  background(
    (async () => {
      let row = occurrence(refusal, call, tool, await where(call), now)
      await meta(env).apply([row], KERNEL)
    })().catch((e) => caught(e, { request: 'tool refusal', tool: tool ?? '' })),
  )
}

type Row = Bundle & {
  tool_refusal: Comp
  refusal?: Comp
  content?: Comp
}

let text = (c: Comp | undefined, k: string) =>
  c?.[k] == null ? '' : String(c[k])

/** The report a firing at `at` makes: one eid per firing, so a firing run
 * twice writes the same report. */
export let reportOf = (at: string) => derivedEid(`refusal_report ${at}`)

/** The query reading every occurrence a report counted. It names
 * `refusal`, since a read of every component leaves out a refusal it was
 * not asked for. */
export let countedIn = (report: string) =>
  `.refusal&.counted.report=${report} *`

/** The letter for a report's occurrences, grouped by tool, code and cause,
 * the most refused first. */
export let letter = (report: string, rows: Row[]) => {
  let groups = new Map<string, Row[]>()
  for (let row of rows) {
    let key = [
      text(row.tool_refusal, 'tool'),
      text(row.refusal, 'code'),
      text(row.content, 'body'),
    ].join('\n')
    groups.set(key, [...groups.get(key) ?? [], row])
  }
  let ranked = [...groups.values()].sort((a, b) => b.length - a.length)
  let distinct = (rows: Row[], k: string) =>
    new Set(rows.map((r) => text(r.tool_refusal, k)).filter(Boolean)).size
  let said = ranked.slice(0, GROUPS).map((rows) => {
    let times = rows.map((r) => text(r.tool_refusal, 'at')).sort()
    let [first] = rows
    let spaces = distinct(rows, 'space'), sessions = distinct(rows, 'session')
    let calls = rows.slice(0, CALLS).map((r) => text(r.tool_refusal, 'source'))
    return [
      `${rows.length} × ${text(first.tool_refusal, 'tool') || 'no tool'} · ${
        text(first.refusal, 'code')
      }`,
      text(first.content, 'body'),
      `first ${times[0]} · last ${
        times.at(-1)
      } · ${spaces} spaces · ${sessions} sessions · release ${
        [...new Set(rows.map((r) => text(r.tool_refusal, 'release')))].join(
          ', ',
        )
      }`,
      `calls ${calls.join(', ')}${
        rows.length > calls.length
          ? ` and ${rows.length - calls.length} more`
          : ''
      }`,
    ].join('\n')
  })
  let rest = ranked.length - said.length
  return {
    title: `yaks.app tool refusals: ${rows.length} in ${ranked.length} ${
      ranked.length == 1 ? 'group' : 'groups'
    }`,
    body: [
      `${rows.length} tool refusals since the last report, grouped by tool, ` +
      'code and cause, the most first. None of them is a bug; each is a ' +
      'place a tool, its schema or its description failed its caller.',
      ...said,
      ...rest > 0 ? [`and ${rest} more groups`] : [],
      `Every occurrence: yak admin query yak/platform '${
        countedIn(report)
      }' --as admin@bot.yak.sh`,
    ].join('\n\n'),
  }
}

/** Count what no report has counted yet into one, written as its letter
 * with the marks that say each occurrence is counted, in one transaction.
 * Nothing to count writes nothing. */
export let reported = async (
  g: Pick<Graph, 'read' | 'get' | 'apply'>,
  env: Host,
  at: string,
  most = MOST,
): Promise<string | null> => {
  let report = reportOf(at)
  let [held] = await g.get([report])
  if (held && !held.tombstone) return report
  let rows = await g.read(
    `.tool_refusal !counted * .order=tool_refusal.at .limit=${most}`,
  ) as Row[]
  if (!rows.length) return null
  let { title, body } = letter(report, rows)
  let [address, mailed] = toPlatform(env, report, { subject: title, body })
  await g.apply([
    address,
    { ...mailed, refusal_report: {} },
    ...rows.map((row) => ({ entity: row.entity, counted: { report } })),
  ], { trusted: true })
  return report
}
