/**
 * A moment in words, `5 minutes ago`, or how long since it, `3m 12s`: what
 * a `Stamp` and a `Time` say, and what a printout says of a time. No
 * interface comes with it, so a plain printout reads a time without loading
 * the kit.
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

/** How long something has lasted, in its two largest units: what a `Time`
 * says of the moment it counts from. */
/// lasted(4_400) -> '4s'
/// lasted(192_000) -> '3m 12s'
/// lasted(3_870_000) -> '1h 4m'
/// lasted(50 * 3_600_000) -> '2d 2h'
/// lasted(-1) -> '0s'
export let lasted = (ms: number): string => {
  let s = Math.max(0, Math.floor(ms / 1000))
  let d = Math.floor(s / 86_400), h = Math.floor(s / 3600) % 24
  let m = Math.floor(s / 60) % 60
  return d
    ? `${d}d ${h}h`
    : h
    ? `${h}h ${m}m`
    : m
    ? `${m}m ${s % 60}s`
    : `${s}s`
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

/** How a time is said: read at when, as its day or how long since it, in
 * which zone. */
export type Face = {
  now?: number
  written?: boolean
  lasting?: boolean
  timeZone?: string
}

/** What a time says at `now`: its age, its day when written, or how long
 * since it when lasting. */
/// said('2026-11-06T15:42:00Z', { now: 1794238920000 }) -> '3 days ago'
/// said('2026-11-06T15:42:00Z', { now: 1794238920000, lasting: true }) -> '3d 0h'
export let said = (
  at: string,
  { now = Date.now(), written, lasting, timeZone }: Face,
): string =>
  written
    ? day(at, timeZone)
    : lasting
    ? lasted(now - Date.parse(at))
    : relative(at, now)

/** A time's tooltip: the moment in full, and for a duration, that it is since
 * then; nothing for what is not a moment. */
/// tip('2026-11-06T15:42:00Z', { timeZone: 'UTC' }) -> 'Nov 6th, 2026, 3:42 PM'
/// tip('2026-11-06T15:42:00Z', { lasting: true, timeZone: 'UTC' }) -> 'Since Nov 6th, 2026, 3:42 PM'
/// tip('soon', {}) -> ''
export let tip = (at: string, { lasting, timeZone }: Face): string => {
  let full = pretty(at, timeZone)
  return full && lasting ? `Since ${full}` : full
}
