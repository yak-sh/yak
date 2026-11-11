// RFC 5545 text output, independent of HTTP and graph reads.
import { day, type Event, instant, iso, repeats, rule, span } from './time.ts'
import { floating, zone } from './zone.ts'
import { vtimezone } from './vtimezone.ts'

/** An event's graph identity, calendar aspect, cover and modification stamps. */
export type Entry = {
  entity: { eid: string }
  event: Event
  doc?: { title?: string; body?: string }
  created?: { at?: string }
  updated?: { at?: string }
}

let escape = (text: string) =>
  text.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;').replace(/,/g, '\\,')

let encoder = new TextEncoder()
let fold = (line: string) => {
  let lines = [''], bytes = 0
  for (let char of line) {
    let size = encoder.encode(char).length
    if (bytes + size > 75) {
      lines.push(' ')
      bytes = 1
    }
    lines[lines.length - 1] += char
    bytes += size
  }
  return lines.join('\r\n')
}

let utc = (ms: number) =>
  iso(ms, false).replace(/[-:]/g, '').replace(/\.\d+/, '')
let date = (name: string, text: string, timeZone?: string) =>
  day(text)
    ? `${name};VALUE=DATE:${text.replace(/-/g, '')}`
    : timeZone
    ? `${name};TZID=${zone(timeZone)}:${
      utc(floating(instant(text, timeZone), timeZone)).slice(0, -1)
    }`
    : `${name}:${utc(instant(text))}`

let entry = (row: Entry) => {
  let [starts, ends] = span(row.event)
  // Parsing here keeps a malformed rule from injecting calendar properties.
  rule(row.event)
  let changed = row.updated?.at ?? row.created?.at ?? iso(starts, false)
  return [
    'BEGIN:VEVENT',
    `UID:${escape(row.entity.eid)}@yaks.app`,
    `DTSTAMP:${utc(instant(changed))}`,
    `LAST-MODIFIED:${utc(instant(changed))}`,
    date('DTSTART', row.event.starts, row.event.zone),
    ...(row.event.ends != null || day(row.event.starts)
      ? [date('DTEND', iso(ends, day(row.event.starts)), row.event.zone)]
      : []),
    `SUMMARY:${escape(row.doc?.title ?? '')}`,
    ...(row.doc?.body ? [`DESCRIPTION:${escape(row.doc.body)}`] : []),
    ...(row.event.place ? [`LOCATION:${escape(row.event.place)}`] : []),
    ...(row.event.repeats != null
      ? [`RRULE:${repeats(row.event.repeats)}`]
      : []),
    'END:VEVENT',
  ]
}

// The definition of each zone a timed event names, by the latest year it starts in.
let zones = (rows: readonly Entry[]) => {
  let years = new Map<string, number>()
  for (let { event } of rows) {
    if (day(event.starts) || !event.zone) continue
    let year = new Date(span(event)[0]).getUTCFullYear()
    years.set(zone(event.zone), Math.max(year, years.get(event.zone) ?? 0))
  }
  return [...years].sort().flatMap(([name, year]) => vtimezone(name, year))
}

/** A subscribable calendar: stable UIDs, native recurrence, VTIMEZONEs, CRLF, escaped
 * text and UTF-8 lines folded at 75 octets. Caller supplies visible rows. */
export let calendar = (rows: readonly Entry[]): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//yaks.app//Calendar//EN',
    'CALSCALE:GREGORIAN',
    ...zones(rows),
    ...[...rows].sort((a, b) =>
      a.entity.eid < b.entity.eid ? -1 : a.entity.eid > b.entity.eid ? 1 : 0
    )
      .flatMap(entry),
    'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n'
