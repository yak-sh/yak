// Pure, bounded occurrence expansion. Graph rows remain one per series.
import { day, type Event, iso, rule, span } from './time.ts'

export type { Event } from './time.ts'
export { calendar, type Entry } from './calendar.ts'

/** An occurrence's inclusive start and exclusive end, in the event's form. */
export type Occurrence = { starts: string; ends: string }

/** Occurrences overlapping [from, until), in epoch milliseconds. Timed
 * recurrences repeat in UTC; all-day recurrences retain their calendar dates. */
export let occurrences = (
  event: Event,
  from: number,
  until: number,
): Occurrence[] => {
  if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until) {
    return []
  }
  let [starts, ends] = span(event), duration = ends - starts
  let series = rule(event)
  let dates = series
    ? series.between(new Date(from - duration), new Date(until), true)
      .map((date) => date.getTime())
    : [starts]
  return dates.filter((start) =>
    start < until && (duration ? start + duration > from : start >= from)
  ).map((start) => ({
    starts: iso(start, day(event.starts)),
    ends: iso(start + duration, day(event.starts)),
  }))
}
