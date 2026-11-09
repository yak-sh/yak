// Recurrence behavior at the pure interface, with time supplied as data.
import { equal, test, throws } from '@yaks/testing'
import { type Event, occurrences } from './mod.ts'

let ms = Date.parse
let event: Event = {
  starts: '2026-11-08T10:00:00-05:00',
  ends: '2026-11-08T11:00:00-05:00',
}
let inWindow = (e: Event, from: string, until: string) =>
  occurrences(e, ms(from), ms(until))
let times = (e: Event, from: string, until: string) =>
  inWindow(e, from, until).map((o) => o.starts)

test('a one-off overlaps the window, including an occurrence in progress', () => {
  equal(inWindow(event, '2026-11-08T15:30Z', '2026-11-09'), [{
    starts: '2026-11-08T15:00:00.000Z',
    ends: '2026-11-08T16:00:00.000Z',
  }])
  equal(inWindow(event, '2026-11-08T16:00Z', '2026-11-09'), [])
  equal(inWindow(event, '2026-11-08', '2026-11-08T15:00Z'), [])
})

test('weekly count applies to the whole series and duration is preserved', () => {
  equal(
    inWindow(
      { ...event, repeats: 'FREQ=WEEKLY;COUNT=3' },
      '2026-11-15T15:30Z',
      '2026-12-01',
    ),
    [
      { starts: '2026-11-15T15:00:00.000Z', ends: '2026-11-15T16:00:00.000Z' },
      { starts: '2026-11-22T15:00:00.000Z', ends: '2026-11-22T16:00:00.000Z' },
    ],
  )
})

test('until is inclusive, window end exclusive and unending rules are bounded', () => {
  for (
    let repeats of ['FREQ=DAILY', 'RRULE:FREQ=DAILY;UNTIL=20261109T150000Z']
  ) {
    equal(times({ ...event, repeats }, '2026-11-08', '2026-11-10T15:00Z'), [
      '2026-11-08T15:00:00.000Z',
      '2026-11-09T15:00:00.000Z',
    ])
  }
})

test('monthly ordinal weekdays and missing month days follow calendar dates', () => {
  equal(
    times(
      { starts: '2026-01-05', repeats: 'FREQ=MONTHLY;BYDAY=1MO;COUNT=3' },
      '2026-01-01',
      '2026-04-01',
    ),
    ['2026-01-05', '2026-02-02', '2026-03-02'],
  )
  equal(
    times(
      { starts: '2026-01-31', repeats: 'FREQ=MONTHLY;COUNT=3' },
      '2026-01-01',
      '2026-06-01',
    ),
    ['2026-01-31', '2026-03-31', '2026-05-31'],
  )
})

test('all-day events default to one day and preserve multi-day durations', () => {
  equal(inWindow({ starts: '2026-11-08' }, '2026-11-08', '2026-11-09'), [{
    starts: '2026-11-08',
    ends: '2026-11-09',
  }])
  equal(
    inWindow(
      {
        starts: '2026-11-08',
        ends: '2026-11-10',
        repeats: 'FREQ=WEEKLY;UNTIL=20261115',
      },
      '2026-11-09',
      '2026-12-01',
    ),
    [
      { starts: '2026-11-08', ends: '2026-11-10' },
      { starts: '2026-11-15', ends: '2026-11-17' },
    ],
  )
})

test('point events include the start boundary and invalid windows are empty', () => {
  let point = { starts: event.starts }
  equal(times(point, '2026-11-08T15:00Z', '2026-11-08T15:01Z'), [
    '2026-11-08T15:00:00.000Z',
  ])
  equal(occurrences(point, NaN, Infinity), [])
  equal(occurrences(point, 2, 1), [])
})

for (
  let [starts, ends, from, until, expected] of [
    [
      '2026-10-25T10:00:00-04:00',
      '2026-10-25T11:00:00-04:00',
      '2026-10-25',
      '2026-11-09',
      [
        '2026-10-25T14:00:00.000Z',
        '2026-11-01T15:00:00.000Z',
        '2026-11-08T15:00:00.000Z',
      ],
    ],
    [
      '2027-03-07T10:00:00-05:00',
      '2027-03-07T11:00:00-05:00',
      '2027-03-07',
      '2027-03-22',
      [
        '2027-03-07T15:00:00.000Z',
        '2027-03-14T14:00:00.000Z',
        '2027-03-21T14:00:00.000Z',
      ],
    ],
  ] as const
) {
  test(`a weekly Detroit service stays at 10:00 through ${from} DST`, () => {
    let weekly = {
      starts,
      ends,
      zone: 'America/Detroit',
      repeats: 'FREQ=WEEKLY;COUNT=3',
    }
    equal(times(weekly, from, until), [...expected])
    equal(inWindow(weekly, from, until).map((o) => ms(o.ends) - ms(o.starts)), [
      3600000,
      3600000,
      3600000,
    ])
  })
}

test('malformed event dates, ends and recurrence rules throw', async () => {
  for (
    let e of [
      { starts: '2026-02-30' },
      { starts: '2026-02-30T10:00:00Z' },
      { starts: '2026-11-08T10:00:00' },
      { starts: event.starts, zone: 'Not/AZone' },
      { starts: event.starts, zone: 'America/Detroit\r\nSUMMARY:Injected' },
      { ...event, ends: '2026-11-08' },
      { ...event, ends: '2026-11-08T14:00Z' },
      { ...event, ends: event.starts },
      { ...event, repeats: 'COUNT=2' },
      { ...event, repeats: 'FREQ=BOGUS' },
      { ...event, repeats: 'FREQ=DAILY;INTERVAL=0' },
      { ...event, repeats: 'FREQ=DAILY;COUNT=-1' },
      { ...event, repeats: 'FREQ=DAILY\r\nSUMMARY:Injected' },
    ]
  ) await throws(() => inWindow(e, '2026-01-01', '2027-01-01'))
})

test('zoned local inputs honor UTC UNTIL and exact instant window boundaries', () => {
  let weekly = {
    starts: '2026-10-25T10:00:00',
    ends: '2026-10-25T11:00:00',
    zone: 'America/Detroit',
    repeats: 'FREQ=WEEKLY;UNTIL=20261101T150000Z',
  }
  equal(inWindow(weekly, '2026-11-01T15:30Z', '2026-11-09'), [{
    starts: '2026-11-01T15:00:00.000Z',
    ends: '2026-11-01T16:00:00.000Z',
  }])
  equal(inWindow(weekly, '2026-11-01T16:00Z', '2026-11-09'), [])
  equal(inWindow(weekly, '2026-11-01', '2026-11-01T15:00Z'), [])
  equal(
    times(
      { ...weekly, repeats: 'FREQ=WEEKLY;UNTIL=20261101T145959Z' },
      '2026-11-01',
      '2026-11-09',
    ),
    [],
  )
})

test('each event can choose its own time zone and all-day dates stay dates', () => {
  let local = { starts: '2026-11-08T10:00:00', repeats: 'FREQ=WEEKLY;COUNT=1' }
  equal(
    times({ ...local, zone: 'America/Detroit' }, '2026-11-08', '2026-11-09'),
    ['2026-11-08T15:00:00.000Z'],
  )
  equal(
    times({ ...local, zone: 'America/Chicago' }, '2026-11-08', '2026-11-09'),
    ['2026-11-08T16:00:00.000Z'],
  )
  equal(
    times(
      { starts: '2026-11-08', zone: 'America/Detroit' },
      '2026-11-08',
      '2026-11-09',
    ),
    ['2026-11-08'],
  )
})
