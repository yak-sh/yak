# @yaks/events

Calendar event rows, pure occurrence expansion and iCalendar feeds. The caller
supplies the event data and time window; the core reads no storage or clock.

An **event** is `event{starts, ends, repeats, place, zone}` on an entity, with
`doc{title, body}` for its title and description. A recurring series stays on
one entity. An **occurrence** is one start and end expanded from that series.

```ts
import { calendar, type Entry, occurrences } from '@yaks/events'
import { equal } from '@yaks/testing'

let row: Entry = {
  entity: { eid: '7e77b89a-706e-4eaa-8797-e9bc6fba5605' },
  doc: { title: 'Sunday service' },
  event: {
    starts: '2026-11-08T10:00:00',
    ends: '2026-11-08T11:00:00',
    zone: 'America/Detroit',
    repeats: 'FREQ=WEEKLY;COUNT=3',
    place: 'Church',
  },
}
equal(
  occurrences(
    row.event,
    Date.parse('2026-11-15T00:00:00Z'),
    Date.parse('2026-11-22T00:00:00Z'),
  ),
  [{ starts: '2026-11-15T15:00:00.000Z', ends: '2026-11-15T16:00:00.000Z' }],
)
equal(calendar([row]).includes('RRULE:FREQ=WEEKLY;COUNT=3\r\n'), true)
```

| Export                                        | Purpose                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `occurrences(event, from, until)`             | Occurrences overlapping the half-open epoch-millisecond time window                    |
| `calendar(rows)`                              | RFC 5545 calendar text for the supplied visible event bundles                          |
| `Event`, `Occurrence`, `Entry`                | Event properties, expanded times and calendar bundle types                             |
| `eventsDoc`, `docs` from `@yaks/events/vocab` | The `event{starts, ends, repeats, place, zone}` and `feed{person, token}` declarations |

`starts` is required. Set `zone` to the event's IANA time zone, such as
`America/Detroit`. Each event has its own zone. Local date-times such as
`2026-11-08T10:00:00` are interpreted in that zone. A date-time with `Z` or a
numeric offset names an instant, which is converted to the event's zone before
recurrence expands. A weekly 10:00 event stays at 10:00 through daylight saving
changes. Occurrence output uses UTC instants. An absent zone means UTC and
requires an offset on timed inputs.

Use a `YYYY-MM-DD` date for an all-day event, and the same form for `ends`.
All-day dates stay dates, independently of zone. Ends are exclusive. An absent
end means one day for an all-day event, or a point in time for a timed event.
Invalid dates, zones, reversed ends and mixed date/date-time forms throw. An
empty or invalid window yields no occurrences.

`repeats` is one RFC 5545 recurrence rule, with an optional `RRULE:` prefix,
such as `FREQ=WEEKLY;BYDAY=SU`, `FREQ=MONTHLY;BYDAY=1MO;COUNT=12` or
`FREQ=DAILY;UNTIL=20261225T235959Z`. Use a date-only `UNTIL` for all-day events.
Expansion uses [rrule](https://github.com/jkbrzt/rrule) over local wall times,
with [@date-fns/tz](https://github.com/date-fns/tz) converting them to instants.
It preserves the event's elapsed duration and includes occurrences already in
progress at `from`. `UNTIL` is inclusive and evaluated as a UTC instant for
timed events. Window bounds are required even for an unending series. Expansion
never writes occurrence rows.

`calendar` retains the series' RRULE instead of expanding it into a limited
window. Timed events with a zone use IANA `TZID` on both `DTSTART` and `DTEND`,
so calendar subscribers preserve the series' local wall time. Events without a
zone retain UTC output; all-day dates retain `VALUE=DATE`. Each entity's eid
supplies its stable UID. `updated.at`, then `created.at`, then the event start
supplies the modification stamp. Text is escaped, lines fold at 75 UTF-8 octets,
and line endings are CRLF. The caller filters visible events and cancellation
marks before serializing.

On yaks.app, `<app>/calendar.ics` serves this feed for public and open apps; add
its URL to Google Calendar using “From URL”. It reads through the app's
anonymous graph query door and excludes person-owned rows and entities carrying
`cancelled{at, by, via, reason}`. A private app has no public feed. Calendar
subscriptions receive updates when their calendar provider next refreshes the
URL.

A **feed** is `feed{person, token}`, a private subscription for one person. On
yaks.app, `<app>/calendar/<token>.ics` serves only events with that person's
accepted registrations (`completed`, without `cancelled` or `waitlisted`). It
works on private apps too. Cancelled events are excluded, duplicate sign-ups
produce one entry, and every series keeps its own time zone. The token opens
only this calendar; it supplies no app, graph or API access. Feed rows require
an app editor to read and to write, so tokens stay out of anonymous graph reads
even in open apps, and one viewer never reads another person's.

The Operator returns the link with the person's own registration progress.
`signup_calendar` retrieves or replaces it for the vouched submitter, or for
website registrations matched through the platform person's verified phone or
address. The registration id is optional. Replacing the token revokes the
previous URL immediately. `registration.person` also supports feeds issued for
directory people; it does not authorize a stranger to discover or replace
another person's link. This package declares the feed shape; the platform
supplies HTTP and storage.
