// Pure, bounded occurrence expansion. Graph rows remain one per series.
import { day, type Event, iso, rule, span } from './time.ts'
import { zone, zoned } from './zone.ts'

export type { Event } from './time.ts'
export { calendar, type Entry } from './calendar.ts'

/** An occurrence's inclusive start and exclusive end, in the event's form. */
export type Occurrence = { starts: string; ends: string }

/** Occurrences overlapping [from, until), in epoch milliseconds. Timed
 * recurrences follow event.zone; all-day recurrences retain calendar dates. */
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
  let name = zone(event.zone)
  // IANA offsets fit within a day. Overscan floating dates, then apply the
  // exact instant bounds; this also handles a window within a repeated hour.
  let pad = day(event.starts) || name == 'UTC' ? 0 : 86400000
  let dates = series
    ? series.rule.between(
      new Date(from - duration - pad),
      new Date(until + pad),
      true,
    )
      .map((date) =>
        day(event.starts) ? date.getTime() : zoned(date.getTime(), name)
      )
      .filter((start) => series.until == null || start <= series.until)
    : [starts]
  return dates.filter((start) =>
    start < until && (duration ? start + duration > from : start >= from)
  ).map((start) => ({
    starts: iso(start, day(event.starts)),
    ends: iso(start + duration, day(event.starts)),
  }))
}
