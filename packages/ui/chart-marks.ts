/**
 * What a chart draws, through whichever `h` the page renders with: a
 * sparkline, a few characters wide beside the number it explains, and day
 * columns, as wide as the page. Both are SVG with no library. Each carries its
 * series in `data-` attributes, so a page's one listener (yaks.app's
 * public/chart.js) answers a pointer, a finger or an arrow key with the point
 * there, and a chart costs nothing until somebody asks it.
 *
 * ```ts
 * import { series, summed } from '@yaks/ui/chart'
 * import { equal } from '@yaks/testing'
 *
 * let now = Date.parse('2026-10-03T12:00:00Z')
 * equal(series({ '2026-10-03': 4, '2026-10-01': 2 }, 3, now), {
 *   from: '2026-10-01',
 *   values: [2, 0, 4],
 * })
 * equal(summed([{ a: 1 }, { a: 2, b: 3 }, undefined]), { a: 3, b: 3 })
 * ```
 *
 * @module
 */

import type { H } from '@yaks/render'

/** Counts by day, `YYYY-MM-DD`; a day nothing happened is absent. */
export type ByDay = Record<string, number>

/** A dense run of days, and the day it starts on. */
export type Days = { from: string; values: number[] }

/** A chart's series and what its numbers count: a `noun` said one at a time
 * ("request"), or `money` for dollars. */
export type Series = Days & { noun?: string; money?: boolean }

let DAY = 86_400_000
let ymd = (t: number) => new Date(t).toISOString().slice(0, 10)
// A sum of dollars drifts in its last places, and a chart prints the digits.
let tidy = (n: number) => Math.round(n * 1e6) / 1e6

/** The last `days` days up to `now`, oldest first, a quiet day a zero. */
export let series = (
  byDay: ByDay | null | undefined,
  days: number,
  now: number = Date.now(),
): Days => {
  let values = []
  for (let i = days - 1; i >= 0; i--) {
    values.push(tidy(byDay?.[ymd(now - i * DAY)] ?? 0))
  }
  return { from: ymd(now - (days - 1) * DAY), values }
}

/** Several rows' days added up: a person's spend over the spaces they own. */
export let summed = (all: (ByDay | null | undefined)[]): ByDay => {
  let out: ByDay = {}
  for (let byDay of all) {
    for (let [day, n] of Object.entries(byDay ?? {})) {
      out[day] = tidy((out[day] ?? 0) + n)
    }
  }
  return out
}

/** These days and today's `n` more of what they count, past `days` days
 * forgotten, so what a row keeps stays small.
 *
 * ```ts
 * import { kept } from '@yaks/ui/chart'
 * import { equal } from '@yaks/testing'
 *
 * let now = Date.parse('2026-10-31T12:00:00Z')
 * equal(kept({ '2026-10-31': 1, '2026-09-01': 9 }, 2, now), { '2026-10-31': 3 })
 * ```
 */
export let kept = (
  byDay: ByDay | null | undefined,
  n: number,
  now: number = Date.now(),
  days = 30,
): ByDay => {
  let oldest = ymd(now - (days - 1) * DAY)
  let today = ymd(now)
  let out = Object.fromEntries(
    Object.entries(byDay ?? {}).filter(([day]) => day >= oldest),
  )
  out[today] = tidy((out[today] ?? 0) + n)
  return out
}

let number = (s: Series, n: number) =>
  s.money
    ? `$${n >= 0.01 || n <= 0 ? n.toFixed(2) : n.toPrecision(1)}`
    : n.toLocaleString('en-US')

/** The whole series in a sentence, for anyone who cannot see the marks. */
export let said = (s: Series): string => {
  let total = tidy(s.values.reduce((a, b) => a + b, 0))
  let noun = s.noun ? ` ${s.noun}${total == 1 ? '' : 's'}` : ''
  return `${number(s, total)}${noun} over ${s.values.length} days, ${
    number(s, s.values.at(-1) ?? 0)
  } on the last day`
}

let chart = (kind: 'line' | 'bars', s: Series) => ({
  class: `Chart Chart-${kind}`,
  role: 'img',
  tabindex: 0,
  'aria-label': said(s),
  'data-chart': kind,
  'data-from': s.from,
  'data-values': s.values.join(','),
  ...s.noun ? { 'data-noun': s.noun } : {},
  ...s.money ? { 'data-money': '' } : {},
})

let WIDTH = 64
let HEIGHT = 16
let ROOM = 2

/** Where each value sits in the sparkline's box: a value of nothing on the
 * floor, the largest at the top, with room for the line's own width. */
export let points = (values: number[]): [number, number][] => {
  let top = Math.max(...values, 1)
  let across = WIDTH - 2 * ROOM
  let up = HEIGHT - 2 * ROOM
  return values.map((v, i) => [
    Math.round((ROOM + i / Math.max(1, values.length - 1) * across) * 10) / 10,
    Math.round((HEIGHT - ROOM - v / top * up) * 10) / 10,
  ])
}

/**
 * A line, small enough to sit beside a number, ending in a dot on today. A
 * series with nothing in it draws nothing: a list of mostly quiet rows reads
 * as the few that are not.
 */
export let sparkline = <Node>(h: H<Node>, s: Series): Node | null => {
  if (!s.values.some((v) => v > 0)) return null
  let at = points(s.values)
  let [x, y] = at.at(-1)!
  return h(
    'span',
    chart('line', s),
    h(
      'svg',
      {
        class: 'Chart_Plot',
        viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
        width: WIDTH,
        height: HEIGHT,
        'aria-hidden': 'true',
      },
      h('path', {
        class: 'Chart_Line',
        d: `M${at.map(([x, y]) => `${x} ${y}`).join('L')}`,
      }),
      h('circle', { class: 'Chart_End', cx: x, cy: y, r: 1.75 }),
    ),
  )
}

/**
 * A column a day, stretched to the width there is: the viewBox is one unit a
 * day, and a rectangle stretched is still a rectangle.
 */
export let columns = <Node>(h: H<Node>, s: Series): Node => {
  let top = Math.max(...s.values, 1)
  return h(
    'div',
    chart('bars', s),
    h(
      'svg',
      {
        class: 'Chart_Plot',
        viewBox: `0 0 ${s.values.length} 40`,
        preserveAspectRatio: 'none',
        'aria-hidden': 'true',
      },
      s.values.map((v, i) =>
        h('rect', {
          class: 'Chart_Bar',
          x: (i + 0.15).toFixed(2),
          y: (40 - v / top * 40).toFixed(2),
          width: 0.7,
          height: (v / top * 40).toFixed(2),
        })
      ),
    ),
  )
}
