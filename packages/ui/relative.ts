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
  if (!iso || !Number.isFinite(Date.parse(iso))) return ''
  let s = (now - Date.parse(iso)) / 1000
  for (let [unit, size] of SIZES) {
    if (Math.abs(s) >= size) {
      return words(Math.round(-s / size), unit)
    }
  }
  return 'just now'
}

// ICU formatters are lazy: loading the kit never loads locale data.
let formats = new Map<string, Intl.DateTimeFormat>()
let formatted = (iso: string, clock: boolean, timeZone?: string): string => {
  let at = new Date(iso)
  if (!Number.isFinite(+at)) return ''
  let key = `${clock}:${timeZone ?? ''}`
  let format = formats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone,
      ...(clock
        ? { hour: 'numeric', minute: '2-digit', hour12: true } as const
        : {}),
    })
    formats.set(key, format)
  }
  return format.formatToParts(at).map(({ type, value }) =>
    type == 'day' ? ordinal(+value) : value
  ).join('').replaceAll('\u202f', ' ')
}

let ordinal = (n: number) =>
  `${n}${
    n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ??
        'th'
  }`

/** A written date, with its month first and an ordinal day. */
/// day('2026-11-06T15:42:00Z', 'UTC') -> 'Nov 6th, 2026'
export let day = (iso: string, timeZone?: string): string =>
  formatted(iso, false, timeZone)

/** A timestamp in full, for the kit tooltip. */
/// pretty('2026-11-06T15:42:00Z', 'UTC') -> 'Nov 6th, 2026, 3:42 PM'
export let pretty = (iso?: string | null, timeZone?: string): string =>
  iso ? formatted(iso, true, timeZone) : ''
