// What a chart draws, and what it hands the page's listener.
import { equal, test } from '@yaks/testing'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { columns, kept, points, said, sparkline } from './chart-marks.ts'

let draw = (node: unknown) => renderToString(node as never)
let week = { from: '2026-10-01', values: [0, 2, 4], noun: 'visit' }

test('a sparkline holds its series and says it in words', () => {
  let page = draw(sparkline(h as never, week))
  for (
    let part of [
      'data-chart="line"',
      'data-from="2026-10-01"',
      'data-values="0,2,4"',
      'data-noun="visit"',
      'aria-label="6 visits over 3 days, 4 on the last day"',
    ]
  ) equal(page.includes(part), true, part)
})

test('a series with nothing in it draws nothing', () => {
  equal(sparkline(h as never, { from: '2026-10-01', values: [0, 0] }), null)
})

test('nothing sits on the floor and the largest at the top', () => {
  equal(points([0, 4]), [[2, 14], [62, 2]])
})

test('columns draw a bar a day, a quiet day with no height', () => {
  let page = draw(columns(h as never, week))
  equal(page.match(/class="Chart_Bar"/g)?.length, 3)
  equal(page.includes('height="0.00"'), true)
})

test('money is said as dollars, with a tiny sum still showing', () => {
  equal(
    said({ from: '2026-10-01', values: [0.001, 0.5], money: true }),
    '$0.50 over 2 days, $0.50 on the last day',
  )
  equal(
    said({ from: '2026-10-01', values: [0, 0.001], money: true }),
    '$0.001 over 2 days, $0.001 on the last day',
  )
})

test('what a row keeps forgets anything past its days', () => {
  let now = Date.parse('2026-10-31T12:00:00Z')
  equal(kept({ '2026-10-02': 1, '2026-10-01': 1 }, 1, now), {
    '2026-10-02': 1,
    '2026-10-31': 1,
  })
})
