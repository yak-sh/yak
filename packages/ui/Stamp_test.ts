// Relative timestamps keep the existing English wording at every unit boundary.
import { equal, test } from '@yaks/testing'
import { relative } from './Stamp.ts'

let now = Date.parse('2026-10-19T12:00:00Z')
let native = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
let sizes: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]
let deltas = sizes.flatMap(([, size]) => [
  size - 1,
  size,
  size + 1,
  size * 1.5 - 1,
  size * 1.5,
  size * 2,
  size * 999,
  size * 1000,
]).flatMap((n) => [-n, n])
let expected = (seconds: number) => {
  for (let [unit, size] of sizes) {
    if (Math.abs(seconds) >= size) {
      return native.format(Math.round(seconds / size), unit)
    }
  }
  return 'just now'
}
let cases = deltas.map((seconds) => ({
  iso: new Date(now + seconds * 1000).toISOString(),
  want: expected(seconds),
}))

test('relative wording agrees with the existing formatter across unit boundaries', () => {
  for (let { iso, want } of cases) equal(relative(iso, now), want)
})

test('relative timestamps keep empty, recent and invalid inputs readable', () => {
  equal(relative(undefined, now), '')
  equal(relative('', now), '')
  equal(relative('not a date', now), 'just now')
  equal(relative(new Date(now - 59_000).toISOString(), now), 'just now')
  equal(relative(new Date(now + 59_000).toISOString(), now), 'just now')
  equal(relative(new Date(now - 86_400_000).toISOString(), now), 'yesterday')
  equal(relative(new Date(now + 86_400_000).toISOString(), now), 'tomorrow')
})
