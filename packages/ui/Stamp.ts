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
// The interface has always spoken English. Keep that small fixed vocabulary
// local rather than loading ICU's locale data on the first painted timestamp.
let words = (value: number, unit: string): string => {
  if (unit == 'day' && Math.abs(value) == 1) {
    return value < 0 ? 'yesterday' : 'tomorrow'
  }
  if (['year', 'month', 'week'].includes(unit) && Math.abs(value) == 1) {
    return `${value < 0 ? 'last' : 'next'} ${unit}`
  }
  let digits = String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  let noun = unit + (Math.abs(value) == 1 ? '' : 's')
  return value < 0 ? `${digits} ${noun} ago` : `in ${digits} ${noun}`
}

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
    if (Math.abs(s) >= size) {
      return words(Math.round(-s / size), unit)
    }
  }
  return 'just now'
}

/** What it is, in a line. */
export let description = 'A moment, said the human way: 5 minutes ago.'

/** Dim, its parts a space apart, as their gap keeps them in a browser. */
export let sheet = (c: Colors): Sheet => ({
  Stamp: { fg: c.muted, spaced: true },
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
