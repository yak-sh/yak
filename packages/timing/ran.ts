/** The SQL statements a span ran, for reading on its page: alike statements
 * together, those that read and wrote the most rows first. A projection lists
 * them as it stores a trace; a page merges the lists of the spans one place
 * ran.
 * @module
 */
import type { Event } from '@yaks/trace'

/** Alike statements: their text with every value masked, how many ran, and
 * the rows they read and wrote and the milliseconds they took, summed. One
 * without `sql` sums the statements past those a list keeps. */
export type Ran = {
  sql?: string
  n: number
  rows_read: number
  rows_written: number
  ms: number
}

/** How many alike statements a list keeps with their text. */
export let RAN_KEPT = 20

let rows = (r: Ran) => r.rows_read + r.rows_written
let sum = (into: Ran, r: Ran) => {
  into.n += r.n
  into.rows_read += r.rows_read
  into.rows_written += r.rows_written
  into.ms += r.ms
  return into
}
let none = (sql?: string): Ran => ({
  ...sql == null ? {} : { sql },
  n: 0,
  rows_read: 0,
  rows_written: 0,
  ms: 0,
})

/** Alike entries summed, the most rows read and written first, then the
 * slowest. Past `kept`, the rest sum into one last entry without text.
 *
 * ```ts
 * import { tally } from './ran.ts'
 * import { equal } from '@yaks/testing'
 *
 * let read = (sql: string, rows: number) =>
 *   ({ sql, n: 1, rows_read: rows, rows_written: 0, ms: 1 })
 * equal(tally([read('a', 1), read('b', 5), read('a', 9), read('c', 0)], 1), [
 *   { sql: 'a', n: 2, rows_read: 10, rows_written: 0, ms: 2 },
 *   { n: 2, rows_read: 5, rows_written: 0, ms: 2 },
 * ])
 * ```
 */
export let tally = (entries: Iterable<Ran>, kept = RAN_KEPT): Ran[] => {
  let alike = new Map<string | undefined, Ran>()
  for (let r of entries) {
    let at = alike.get(r.sql)
    if (!at) alike.set(r.sql, at = none(r.sql))
    sum(at, r)
  }
  let rest = alike.get(undefined)
  alike.delete(undefined)
  let ranked = [...alike.values()].sort((a, b) =>
    rows(b) - rows(a) || b.ms - a.ms
  )
  for (let r of ranked.slice(kept)) sum(rest ??= none(), r)
  return [...ranked.slice(0, kept), ...rest ? [rest] : []]
}

/** The statements each kept span ran: a sql span's own, and for any other
 * span those its sql spans ran, with those of descendants the trace left out,
 * so every statement is listed on a span that is stored. A statement whose
 * producer kept no text is not listed. */
export let ran = (
  spans: readonly Event[],
  kept: ReadonlySet<string>,
): Map<string, Ran[]> => {
  let events = new Map(spans.map((e) => [e.id, e]))
  // The span a statement ran in: its nearest kept ancestor that is not a
  // statement itself.
  let runner = (e: Event): string | undefined => {
    let seen = new Set<string>(), at = events.get(e.parent ?? '')
    while (at && !seen.has(at.id)) {
      if (at.kind != 'sql' && kept.has(at.id)) return at.id
      seen.add(at.id)
      at = events.get(at.parent ?? '')
    }
  }
  let lists = new Map<string, Ran[]>()
  let list = (id: string, r: Ran) => {
    let at = lists.get(id)
    if (at) at.push(r)
    else lists.set(id, [r])
  }
  for (let e of spans) {
    if (e.kind != 'sql' || e.sql == null) continue
    let r: Ran = {
      sql: e.sql,
      n: 1,
      rows_read: e.counts?.rowsRead ?? 0,
      rows_written: e.counts?.rowsWritten ?? 0,
      ms: e.duration ?? 0,
    }
    if (kept.has(e.id)) list(e.id, r)
    let by = runner(e)
    if (by) list(by, r)
  }
  return new Map([...lists].map(([id, rs]) => [id, tally(rs)]))
}
