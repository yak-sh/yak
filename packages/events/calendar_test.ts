// Feed values and wire formatting through the pure calendar interface.
import { equal, ok, test } from '@yaks/testing'
import { calendar, type Entry } from './mod.ts'

let row: Entry = {
  entity: { eid: '2ca91b59-df7e-4ce5-bd48-837ef45531fd' },
  event: {
    starts: '2026-11-08T10:00:00-05:00',
    ends: '2026-11-08T11:00:00-05:00',
    repeats: 'RRULE:FREQ=WEEKLY;COUNT=3',
    place: 'Church; hall, east\\west',
  },
  doc: { title: 'Sunday, service; welcome', body: 'First\r\nSecond\nThird' },
  updated: { at: '2026-11-01T10:00:00Z' },
}

test('a feed retains one series, stable identity, UTC times and escaped text', () => {
  let text = calendar([row])
  for (
    let line of [
      `UID:${row.entity.eid}@yaks.app`,
      'DTSTAMP:20261101T100000Z',
      'LAST-MODIFIED:20261101T100000Z',
      'DTSTART:20261108T150000Z',
      'DTEND:20261108T160000Z',
      'RRULE:FREQ=WEEKLY;COUNT=3',
      'SUMMARY:Sunday\\, service\\; welcome',
      'DESCRIPTION:First\\nSecond\\nThird',
      'LOCATION:Church\\; hall\\, east\\\\west',
    ]
  ) ok(text.includes(`${line}\r\n`), line)
  equal(text.match(/BEGIN:VEVENT/g)?.length, 1)
  equal(text.replace(/\r\n/g, '').includes('\n'), false)
  ok(text.endsWith('END:VCALENDAR\r\n'))
})

test('all-day dates stay dates and absent ends have calendar defaults', () => {
  let text = calendar([{ ...row, event: { starts: '2026-11-08' } }])
  ok(text.includes('DTSTART;VALUE=DATE:20261108\r\n'))
  ok(text.includes('DTEND;VALUE=DATE:20261109\r\n'))
  equal(
    calendar([{ ...row, event: { starts: row.event.starts } }])
      .includes('DTEND'),
    false,
  )
})

test('Unicode lines fold at 75 octets and unfold without changing text', () => {
  let title = `Welcome ${'é😀'.repeat(40)}\nEND:VEVENT`
  let text = calendar([{ ...row, doc: { title } }])
  for (let line of text.split('\r\n')) {
    ok(new TextEncoder().encode(line).length <= 75)
    ok(!line.includes('\ufffd'))
  }
  ok(
    text.replace(/\r\n /g, '').includes(
      `SUMMARY:${title.replace('\n', '\\n')}\r\n`,
    ),
  )
})

test('empty feeds are valid calendars and row order does not change the feed', () => {
  ok(calendar([]).includes('VERSION:2.0\r\n'))
  let other = { ...row, entity: { eid: '1' } }
  equal(calendar([row, other]), calendar([other, row]))
})

test('calendar recurrence carries each event time zone and local start and end', () => {
  let text = calendar(['America/Detroit', 'America/Chicago'].map((zone) => ({
    ...row,
    entity: { eid: zone },
    event: {
      starts: '2026-10-25T10:00:00',
      ends: '2026-10-25T11:00:00',
      repeats: 'FREQ=WEEKLY;COUNT=3',
      zone,
    },
  })))
  for (let zone of ['America/Detroit', 'America/Chicago']) {
    ok(text.includes(`DTSTART;TZID=${zone}:20261025T100000\r\n`))
    ok(text.includes(`DTEND;TZID=${zone}:20261025T110000\r\n`))
  }
  equal(text.match(/RRULE:FREQ=WEEKLY;COUNT=3/g)?.length, 2)
  let allDay = calendar([{
    ...row,
    event: { starts: '2026-11-08', zone: 'America/Detroit' },
  }])
  ok(allDay.includes('DTSTART;VALUE=DATE:20261108\r\n'))
  ok(allDay.includes('DTEND;VALUE=DATE:20261109\r\n'))
  equal(allDay.includes('TZID'), false)
})

let zoned = (zone: string, starts: string) =>
  calendar([{ ...row, event: { starts, zone, repeats: 'FREQ=WEEKLY' } }])

test('a feed defines each time zone it names, once, with the rule its changes follow', () => {
  let text = zoned('America/Detroit', '2026-10-25T10:00:00')
  equal(text.match(/BEGIN:VTIMEZONE/g)?.length, 1)
  for (
    let line of [
      'TZID:America/Detroit',
      'TZOFFSETFROM:-0500',
      'TZOFFSETTO:-0400',
      'DTSTART:19700308T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
      'DTSTART:19701101T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    ]
  ) ok(text.includes(`${line}\r\n`), line)
  ok(text.indexOf('END:VTIMEZONE') < text.indexOf('BEGIN:VEVENT'))
  equal(calendar([row]).includes('VTIMEZONE'), false)
})

test('time zones that end on the last Sunday or never change are defined too', () => {
  ok(zoned('Europe/London', '2026-10-25T10:00:00').includes('BYDAY=-1SU'))
  let fixed = zoned('America/Phoenix', '2026-10-25T10:00:00')
  ok(fixed.includes('TZOFFSETTO:-0700\r\n'))
  equal(fixed.includes('RRULE:FREQ=YEARLY'), false)
})
