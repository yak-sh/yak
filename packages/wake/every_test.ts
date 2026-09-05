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

Deno.test('a cron line is read in the zone it is given', () => {
  assertEquals(
    iso(after('0 9 * * *', T, T, 'America/New_York')),
    '2026-01-01T14:00:00.000Z',
  )
})

Deno.test('an unreadable recurrence is null, never a throw', () => {
  for (let every of ['sometimes', '61 * * * *', '', '0 9 * *']) {
    assertEquals(at(every), null, every)
  }
})
