/**
 * A moment, said the human way: `5 minutes ago`. The words are the
 * caller's, or `relative`'s; the full time rides a `data-tip` when there is
 * one.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A moment. */
export let Stamp: Part = el('span', 'Stamp')

let SIZES: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]
let rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/**
 * How long ago (or ahead) `iso` is from `now`, in words.
 *
 * ```ts
 * import { relative } from './Stamp.ts'
 * let now = Date.parse('2026-09-29T12:00:00Z')
 * relative('2026-09-29T11:55:00Z', now) // '5 minutes ago'
 * relative('2026-10-01T12:00:00Z', now) // 'in 2 days'
 * relative('2026-09-29T11:59:30Z', now) // 'just now'
 * ```
 */
export let relative = (
  iso?: string | null,
  now: number = Date.now(),
): string => {
  if (!iso) return ''
  let s = (now - Date.parse(iso)) / 1000
  for (let [unit, size] of SIZES) {
    if (Math.abs(s) >= size) return rtf.format(Math.round(-s / size), unit)
  }
  return 'just now'
}

/** Dim. */
export let sheet = (c: Colors): Sheet => ({
  Stamp: { fg: c.dim, dim: true },
})

/** One moment, and one with a second part. */
export let specimens = (): Specimen[] => [
  ['Stamp', h(Stamp, {}, '5 minutes ago')],
  [
    'Stamp, two parts',
    h(
      Stamp,
      {},
      h('span', null, '3 days ago'),
      h('span', null, '· edited 1 hour ago'),
    ),
  ],
]
