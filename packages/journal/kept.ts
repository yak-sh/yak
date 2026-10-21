/**
 * What a day's `kept` row says (./service.ts), as the History page reads it:
 * which tables are history, what history kept, how many changes it held, and
 * what it kept per change and per day between two measurements. Pure.
 *
 * History is the journal's tables (`journal_*`) and each component's
 * versions, which the store keeps beside the component's table as
 * `<comp>$versions`.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'

/** One day's measurement. */
export type Kept = {
  day: string
  at: string
  bytes: number
  free: number
  tables: Record<string, [bytes: number, rows: number]>
}

/** The table the journal keeps a row in per change. */
export let CHANGES = 'journal_change'

let BESIDE = '$versions'

/** A bundle's `kept`, if it has one. */
export let keptOf = (b: Bundle): Kept | undefined => b.kept as Kept | undefined

/**
 * Whether a table is history's, and the component whose versions it holds.
 *
 * ```ts
 * import { historic, versioned } from './kept.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal([historic('journal_field'), historic('doc$versions'), historic('doc')], [true, true, false])
 * equal([versioned('doc$versions'), versioned('doc')], ['doc', undefined])
 * ```
 */
export let historic = (table: string): boolean =>
  table.startsWith('journal_') || !!versioned(table)

/** The component a `<comp>$versions` table keeps the versions of. */
export let versioned = (table: string): string | undefined =>
  table.endsWith(BESIDE) ? table.slice(0, -BESIDE.length) : undefined

/**
 * The bytes history kept, and the changes the journal held.
 *
 * ```ts
 * import { changes, history, type Kept } from './kept.ts'
 * import { equal } from '@yaks/testing'
 *
 * let k: Kept = { day: '2026-10-21', at: '', bytes: 100, free: 0, tables: { doc: [10, 2], journal_change: [30, 3], doc$versions: [20, 4] } }
 * equal([history(k), changes(k)], [50, 3])
 * ```
 */
export let history = (k: Kept): number =>
  Object.entries(k.tables).reduce(
    (n, [t, [bytes]]) => historic(t) ? n + bytes : n,
    0,
  )

/** The changes the journal held. */
export let changes = (k: Kept): number => k.tables[CHANGES]?.[1] ?? 0

/**
 * Between an older measurement and a newer one: the bytes history kept per
 * change written between them, and `of`'s growth a day. Undefined where
 * nothing was written between them.
 *
 * ```ts
 * import { history, type Kept, perChange, perDay } from './kept.ts'
 * import { equal } from '@yaks/testing'
 *
 * let a: Kept = { day: '2026-10-20', at: '2026-10-20T04:00:00Z', bytes: 1000, free: 0, tables: { journal_change: [100, 10] } }
 * let b: Kept = { day: '2026-10-22', at: '2026-10-22T04:00:00Z', bytes: 3000, free: 0, tables: { journal_change: [1570, 20] } }
 * equal(perChange(a, b), 147)
 * equal(perDay(a, b, history), 735)
 * equal(perChange(a, a), undefined)
 * ```
 */
export let perChange = (older: Kept, newer: Kept): number | undefined => {
  let n = changes(newer) - changes(older)
  return n > 0 ? (history(newer) - history(older)) / n : undefined
}

/** `of`'s growth a day, between an older measurement and a newer one. */
export let perDay = (
  older: Kept,
  newer: Kept,
  of: (k: Kept) => number,
): number | undefined => {
  let days = (Date.parse(newer.at) - Date.parse(older.at)) / 864e5
  return days > 0 ? (of(newer) - of(older)) / days : undefined
}

/**
 * Bytes as a reader takes them in, to three figures.
 *
 * ```ts
 * import { size } from './kept.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal([size(147), size(41_300_000), size(14_341_947_392), size(-2_000)], ['147 B', '41.3 MB', '14.3 GB', '−2 kB'])
 * ```
 */
export let size = (n = 0): string => {
  let a = Math.abs(n)
  let [d, unit] = a >= 1e9
    ? [1e9, 'GB']
    : a >= 1e6
    ? [1e6, 'MB']
    : a >= 1e3
    ? [1e3, 'kB']
    : [1, 'B']
  let figure = Number((a / d).toPrecision(3)).toString()
  return `${n < 0 ? '−' : ''}${d == 1 ? Math.round(a) : figure} ${unit}`
}
