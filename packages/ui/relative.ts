/**
 * A moment in words, `5 minutes ago`: what a `Stamp` says, and what a
 * printout says of a time. No interface comes with it, so a plain printout
 * reads a time without loading the kit.
 *
 * @module
 */

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
 * import { relative } from '@yaks/ui/relative'
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
