// Dates and recurrence rules interpreted identically by expansion and feeds.
import * as rrule from 'rrule'
import type { RRule } from 'rrule'

// The package's Node entry is CommonJS; bundlers select its ESM entry.
let library: { RRule: typeof RRule; default?: { RRule: typeof RRule } } = rrule
let { RRule: Rule } = library.default ?? library

/** The stored calendar aspect of an event or recurring series. */
export type Event = {
  starts: string
  ends?: string
  repeats?: string
  place?: string
}

export let day = (date: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date)

export let instant = (date: string): number => {
  let ms = Date.parse(date)
  let calendar = date.slice(0, 10), midnight = Date.parse(calendar)
  if (
    !Number.isFinite(ms) ||
    !Number.isFinite(midnight) ||
    new Date(midnight).toISOString().slice(0, 10) != calendar ||
    (day(date)
      ? new Date(ms).toISOString().slice(0, 10) != date
      : !/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(date))
  ) throw new RangeError(`Invalid event date: ${date}`)
  return ms
}

export let span = (event: Event): [number, number] => {
  let starts = instant(event.starts)
  let ends = event.ends == null
    ? starts + (day(event.starts) ? 86400000 : 0)
    : instant(event.ends)
  if (
    (event.ends != null && ends <= starts) ||
    (event.ends != null && day(event.starts) != day(event.ends))
  ) throw new RangeError('Event ends must follow starts in the same date form')
  return [starts, ends]
}

export let repeats = (text: string): string => {
  let rule = text.replace(/^RRULE:/, '').trim()
  if (/[\r\n]/.test(rule) || !/(^|;)FREQ=/.test(rule)) {
    throw new RangeError('Event repeats must be one RFC 5545 RRULE')
  }
  return rule
}

export let rule = (event: Event): RRule | undefined => {
  if (event.repeats == null) return undefined
  let options = Rule.parseString(repeats(event.repeats))
  if (
    !Number.isInteger(options.interval ?? 1) || (options.interval ?? 1) < 1 ||
    !Number.isInteger(options.count ?? 1) || (options.count ?? 1) < 1
  ) {
    throw new RangeError(
      'Recurrence interval and count must be positive integers',
    )
  }
  return new Rule(
    { ...options, dtstart: new Date(instant(event.starts)) },
    true,
  )
}

export let iso = (ms: number, date: boolean): string =>
  new Date(ms).toISOString().slice(0, date ? 10 : 24)
