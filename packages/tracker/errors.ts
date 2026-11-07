// yaks.app's errors as its trackers hold them, the platform's and every
// space's: their unresolved bugs, newest first, and how long the bugs
// resolved in a window took to fix. One report for every door that reads it:
// admin_errors on the box, and the platform admin's Operator on yaks.app.
import type { Bundle } from '@yaks/graph'
import { CallError } from '@yaks/tools/errors'
import { whom } from './brief.ts'
import { fixes, fixtime, opened, span } from './fixtime.ts'
import { explained } from './resolution.ts'
import { type Options, read } from './routes.ts'
import { everywhere } from './everywhere.ts'

type Row = Record<string, unknown>
let object = (v: unknown): Row =>
  v && typeof v == 'object' && !Array.isArray(v) ? v as Row : {}
let text = (v: unknown): string =>
  typeof v == 'string' ? v : v == null ? '' : JSON.stringify(v)
let line = (v: unknown) => text(v).replace(/\s+/g, ' ').trim()
let time = (v: unknown): number => {
  let n = typeof v == 'number' ? v : Date.parse(text(v))
  return Number.isFinite(n) ? n : 0
}
let iso = (n: number) => n ? new Date(n).toISOString() : '?'

let UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 }

/** Seconds in a window said as 10m, 6h or 2d. */
export let duration = (since: string): number => {
  let match = /^(\d+)(s|m|h|d)?$/.exec(since)
  let seconds = match ? Number(match[1]) * UNITS[match[2] || 's'] : 0
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new CallError(
      'since',
      '--since needs a positive duration (for example 10m)',
    )
  }
  return seconds
}

/** A report's window: its length in seconds, its start, and how it was asked. */
export type Window = { seconds: number; from: string; last: string }

/** The window a report covers, ending at `end`: `since` back, or a week. */
export let windowOf = (since: string | undefined, end: number): Window => {
  let seconds = since == undefined ? 7 * 86_400 : duration(since)
  let from = new Date(end - seconds * 1000).toISOString()
  return { seconds, from, last: since ?? '7d' }
}

// Every bug a query matches in the tracker `scope` names, a page of 100 at a
// time.
let pages = async (
  options: Options,
  go: typeof fetch,
  query: string,
  scope: string,
): Promise<Bundle[]> => {
  let rows: Bundle[] = [], after = ''
  for (;;) {
    let params = new URLSearchParams({
      scope,
      query: query + (after ? ` .after=${after}` : ''),
      limit: '100',
    })
    let got = await read(options, 'bugs', params, undefined, go)
    if (!got.ok) throw new CallError('tracker', got.error)
    if (!Array.isArray(got.value)) throw Error('tracker answered no bug rows')
    let body = got.value as Bundle[]
    rows.push(...body)
    if (body.length < 100) return rows
    let cursor = body.at(-1)?.entity?.eid
    if (!cursor || cursor == after) throw Error('tracker repeated a bug page')
    after = cursor
  }
}

// The tracker a bug is in: the platform's, or the space's it names.
let space = (row: Bundle) => text(row.$scope) || 'platform'
let named = (row: Bundle) =>
  `${row.entity.eid}${row.$scope ? ` in space ${row.$scope}` : ''} ${
    line(object(row.doc).title).slice(0, 80)
  }`

/** The report's lines. The optional window matches unresolved bugs by their
 * latest occurrence and times the fixes resolved within it; without one,
 * fixes over the last week. Hits and first seen cover the whole group,
 * including older samples. `resolved` adds each fix beside the bug it closed,
 * as its resolver explained it. */
export let errors = async (
  since: string | undefined,
  options: Options,
  { fetch: go = fetch, resolved = false, end = Date.now() }: {
    fetch?: typeof fetch
    resolved?: boolean
    end?: number
  } = {},
): Promise<string[]> => {
  let window = '', seen = ''
  let { seconds, from, last } = windowOf(since, end)
  if (since != undefined) {
    window = ` .bug.last>=${from} .bug.last<=${new Date(end).toISOString()}`
    seen = ` last seen in preceding ${seconds}s`
  }
  let [open, closed] = await Promise.all(
    [
      `!resolved !archived${window} .order=-bug.last`,
      `.resolved .resolved.at>=${from}`,
    ]
      .map((query) =>
        everywhere(options, (scope) => pages(options, go, query, scope), go)
      ),
  )
  let rows = open.rows.toSorted((a, b) =>
    time(object(b.bug).last) - time(object(a.bug).last)
  )
  let fixed = closed.rows
  let { count, median, worst } = fixes(fixed)
  let report = [
    `Tracker: ${rows.length} unresolved bugs from yaks.app, its spaces and the box (not resolved or archived)${seen}, newest first; counts and first seen cover each bug's lifetime. SPACE is the tracker that holds it, the scope bug_show and bug_resolve take`,
    'COUNT  FIRST SEEN  LAST SEEN  BUG  SPACE  REACHED  PLACE  MESSAGE',
    ...rows.map((row) => {
      let bug = object(row.bug)
      return [
        bug.hits,
        iso(time(bug.first)),
        iso(time(bug.last)),
        row.entity.eid,
        space(row),
        whom(
          Number(bug.people ?? 0),
          typeof bug.account == 'string' ? bug.account : null,
        ),
        bug.spot || '-',
        text(object(row.doc).title),
      ].map(line).join('  ')
    }),
    `${
      rows.reduce((n, row) => n + Number(object(row.bug).hits || 0), 0)
    } occurrences, ${rows.length} bugs`,
    worst
      ? `Time to fix, resolved in the last ${last}: ${count} bug${
        count == 1 ? '' : 's'
      }, median ${span(median!)}, worst ${span(worst.ms)} (${named(worst.of)})`
      : `Time to fix: no bug resolved in the last ${last}`,
  ]
  // Each fix beside the bug it closed, newest first, as its resolver
  // explained it; those resolved before explanations were kept are counted.
  let resolvedAt = (b: Bundle) => text(object(b.resolved).at)
  let bare = 0
  for (
    let row of resolved
      ? fixed.toSorted((a, b) => resolvedAt(b).localeCompare(resolvedAt(a)))
      : []
  ) {
    let ms = fixtime(row), lines = explained(row)
    if (!lines.length) {
      bare++
      continue
    }
    report.push(
      `Resolved${ms == undefined ? '' : ` in ${span(ms)}`}: ${named(row)}`,
      ...lines.map(([label, said]) => `  ${label}: ${line(said)}`),
    )
  }
  if (bare) {
    report.push(
      `${bare} bug${
        bare == 1 ? '' : 's'
      } resolved with no explanation recorded`,
    )
  }
  for (let why of new Set([...open.unread, ...closed.unread])) {
    report.push(`Not read: ${why}`)
  }
  let oldest = rows.reduce<Bundle | undefined>(
    (a, b) => !a || opened(b) < opened(a) ? b : a,
    undefined,
  )
  if (oldest) {
    report.push(
      `Open longest: ${span(end - opened(oldest))} (${named(oldest)})`,
    )
  }
  return report
}
