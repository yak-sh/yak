import { assertEquals } from '@std/assert'
import { after, span } from './every.ts'

let T = Date.parse('2026-01-01T09:17:00Z')
let iso = (t: number | null) => t == null ? null : new Date(t).toISOString()
let at = (every: string, from = T, now = T) => iso(after(every, from, now))

Deno.test('a duration is read in every spelling', () => {
  for (
    let [every, ms] of [
      ['30s', 30_000],
      ['30m', 1_800_000],
      ['2h', 7_200_000],
      ['1d', 86_400_000],
      ['1w', 604_800_000],
      ['h', 3_600_000],
      ['every 2 hours', 7_200_000],
      ['EVERY  3   Days', 259_200_000],
      ['15 mins', 900_000],
    ] as [string, number][]
  ) assertEquals(span(every), ms, every)
})

Deno.test('a cron line, and nonsense, are not durations', () => {
  for (let every of ['0 9 * * 1-5', '@daily', '0m', 'sometimes', '']) {
    assertEquals(span(every), null, every)
  }
})

Deno.test('a duration keeps its phase, counting from the last instant', () => {
  // set at 09:17, so every landing is at :17 — never rounded to the hour
  assertEquals(at('2h'), '2026-01-01T11:17:00.000Z')
  assertEquals(at('1d'), '2026-01-02T09:17:00.000Z')
})

Deno.test('a missed stretch catches up in one step, not one per tick', () => {
  // away for six hours on a two-hour cadence: the next one, not four of them
  assertEquals(at('2h', T, T + 6 * 3_600_000), '2026-01-01T17:17:00.000Z')
})

Deno.test('an instant before the anchor lands on the anchor itself', () => {
  assertEquals(at('2h', T, T - 1), '2026-01-01T09:17:00.000Z')
})

Deno.test('a cron line reads the calendar, in UTC, ignoring the anchor', () => {
  // 09:17 on a Thursday; weekdays at nine means tomorrow at nine
  assertEquals(at('0 9 * * 1-5'), '2026-01-02T09:00:00.000Z')
  assertEquals(at('@daily'), '2026-01-02T00:00:00.000Z')
  // the anchor is not consulted: a year-old `from` gives the same answer
  assertEquals(at('@daily', T - 31_536_000_000), '2026-01-02T00:00:00.000Z')
})

Deno.test('five cron fields read ranges, steps, lists and named calendars', () => {
  for (
    let [every, expected] of [
      ['*/15 * * * *', '2026-01-01T09:30:00.000Z'],
      ['5-50/15 9-17 * * 1-5', '2026-01-01T09:20:00.000Z'],
      ['0,30 9,17 * * *', '2026-01-01T09:30:00.000Z'],
      ['0 9 1,15 1-6/2 *', '2026-01-15T09:00:00.000Z'],
      ['@hourly', '2026-01-01T10:00:00.000Z'],
      ['@daily', '2026-01-02T00:00:00.000Z'],
      ['@weekly', '2026-01-04T00:00:00.000Z'],
      ['@monthly', '2026-02-01T00:00:00.000Z'],
      ['0 0 * * 0', '2026-01-04T00:00:00.000Z'],
      ['0 0 * * 7', '2026-01-04T00:00:00.000Z'],
      ['0 0 1 * 1', '2026-01-05T00:00:00.000Z'],
    ]
  ) assertEquals(at(every), expected, every)
})

Deno.test('the calendar skips invalid dates and is strictly after its input', () => {
  assertEquals(at('0 0 29 2 *'), '2028-02-29T00:00:00.000Z')
  let midnight = Date.parse('2026-01-01T00:00:00Z')
  assertEquals(at('@daily', midnight, midnight), '2026-01-02T00:00:00.000Z')
  assertEquals(at('@daily', midnight, midnight - 1), '2026-01-01T00:00:00.000Z')
})

Deno.test('a cron line is read in the zone it is given', () => {
  assertEquals(
    iso(after('0 9 * * *', T, T, 'America/New_York')),
    '2026-01-01T14:00:00.000Z',
  )
  assertEquals(at('0 9 * * * America/New_York'), '2026-01-01T14:00:00.000Z')
  assertEquals(at('@daily Asia/Kathmandu'), '2026-01-01T18:15:00.000Z')
  assertEquals(at('@daily UTC'), '2026-01-02T00:00:00.000Z')
  assertEquals(
    iso(after('0 9 * * * America/New_York', T, T, 'Asia/Tokyo')),
    '2026-01-01T14:00:00.000Z',
  )
})

Deno.test('DST moves a missing local time by the gap and repeats a time once', () => {
  for (
    let [every, from, expected] of [
      ['0 9 * * *', '2026-03-07T14:00:00Z', '2026-03-08T13:00:00.000Z'],
      ['30 2 * * *', '2026-03-08T05:00:00Z', '2026-03-08T07:30:00.000Z'],
      ['30 2 * * *', '2026-03-08T07:30:00Z', '2026-03-09T06:30:00.000Z'],
      ['30 1 * * *', '2026-11-01T04:00:00Z', '2026-11-01T05:30:00.000Z'],
      ['30 1 * * *', '2026-11-01T05:30:00Z', '2026-11-02T06:30:00.000Z'],
    ]
  ) {
    let t = Date.parse(from)
    assertEquals(at(`${every} America/New_York`, t, t), expected, from)
  }
})

Deno.test('an unreadable recurrence is null, never a throw', () => {
  for (
    let every of [
      'sometimes',
      '61 * * * *',
      '0 24 * * *',
      '0 0 32 * *',
      '0 0 * 13 *',
      '0 0 * * 8',
      '*/0 * * * *',
      '10-5 * * * *',
      '1,,2 * * * *',
      '',
      '0 9 * *',
      '0 0 9 * * *',
      '0 0 9 * * * 2026',
      '@hourly nowhere',
      '@daily +02:00',
      '0 9 * * * America/Nowhere',
      '2h America/New_York',
      '2026-01-01T09:00:00Z',
    ]
  ) {
    assertEquals(at(every), null, every)
  }
  assertEquals(after('@daily', T, T, 'America/Nowhere'), null)
  for (let t of [NaN, Infinity, -Infinity, 9e15]) {
    assertEquals(after('@daily', t, t), null)
    assertEquals(after('2h', t, t), null)
  }
})
