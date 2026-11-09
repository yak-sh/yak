// Dates and recurrence rules interpreted identically by expansion and feeds.
import * as rrule from 'rrule'
import type { RRule } from 'rrule'
import { floating, zone, zoned } from './zone.ts'

// The package's Node entry is CommonJS; bundlers select its ESM entry.
let library: { RRule: typeof RRule; default?: { RRule: typeof RRule } } = rrule
let { RRule: Rule } = library.default ?? library

/** The stored calendar aspect of an event or recurring series. */
export type Event = {
  starts: string
  ends?: string
  repeats?: string
  place?: string
  zone?: string
}

export let day = (date: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date)

export let instant = (date: string, name?: string): number => {
  let local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(date)
  let ms = Date.parse(local && name ? `${date}Z` : date)
  let calendar = date.slice(0, 10), midnight = Date.parse(calendar)
  if (
    !Number.isFinite(ms) ||
    !Number.isFinite(midnight) ||
    new Date(midnight).toISOString().slice(0, 10) != calendar ||
    (day(date)
      ? new Date(ms).toISOString().slice(0, 10) != date
      : !(local && name) &&
        !/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(date))
  ) throw new RangeError(`Invalid event date: ${date}`)
  return local && name ? zoned(ms, name) : ms
}

export let span = (event: Event): [number, number] => {
  zone(event.zone)
  let starts = instant(event.starts, event.zone)
  let ends = event.ends == null
    ? starts + (day(event.starts) ? 86400000 : 0)
    : instant(event.ends, event.zone)
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

export type Series = { rule: RRule; until?: number }

export let rule = (event: Event): Series | undefined => {
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
  let { until, ...parts } = options
  let starts = instant(event.starts, event.zone)
  return {
    rule: new Rule({
      ...parts,
      dtstart: new Date(
        day(event.starts) ? starts : floating(starts, zone(event.zone)),
      ),
      tzid: 'UTC',
    }, true),
    until: until?.getTime(),
  }
}

export let iso = (ms: number, date: boolean): string =>
  new Date(ms).toISOString().slice(0, date ? 10 : 24)
