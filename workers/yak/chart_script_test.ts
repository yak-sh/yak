// The one listener behind a page's charts (public/chart.js), acted on as a
// person would: a pointer, a finger, an arrow key.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'

import { charts } from './chart.js'

let page = (kind: string, attrs = 'data-noun="visit"') => {
  let { document, window } = parseHTML(
    `<!doctype html><html><body><span id="c" tabindex="0" data-chart="${kind}" data-from="2026-10-01" data-values="1,0,1200" ${attrs}></span><p id="away"></p></body></html>`,
  )
  let listeners: Record<string, (e: unknown) => void> = {}
  charts(
    document,
    (type: string, fn: (e: unknown) => void) => listeners[type] = fn,
  )
  let chart = document.getElementById('c')!
  chart.getBoundingClientRect = () =>
    ({ left: 100, width: 100, top: 50 }) as DOMRect
  let tip = () => document.querySelector<HTMLElement>('.Chart_Tip')
  void window
  return {
    tip,
    chart,
    at: (x: number) => listeners.pointermove({ target: chart, clientX: x }),
    away: () =>
      listeners.pointermove({ target: document.getElementById('away') }),
    key: (key: string) =>
      listeners.keydown({ target: chart, key, preventDefault() {} }),
    focus: () => listeners.focusin({ target: chart }),
  }
}

test('a pointer on a line is told the nearest day and its value', () => {
  let p = page('line')
  p.at(100)
  assertEquals(p.tip()?.textContent, 'Oct 1st, 2026: 1 visit')
  p.at(199)
  assertEquals(p.tip()?.textContent, 'Oct 3rd, 2026: 1,200 visits')
  assertEquals(p.chart.style.getPropertyValue('--at'), '100%')
})

test('a pointer on a column is told that column', () => {
  let p = page('bars')
  p.at(150)
  assertEquals(p.tip()?.textContent, 'Oct 2nd, 2026: 0 visits')
  assertEquals(p.chart.style.getPropertyValue('--at'), '50%')
})

test('dollars are said as dollars', () => {
  let p = page('line', 'data-money')
  p.at(199)
  assertEquals(p.tip()?.textContent, 'Oct 3rd, 2026: $1200.00')
})

test('leaving the chart takes the tip away', () => {
  let p = page('line')
  p.at(100)
  p.away()
  assertEquals(p.tip()?.hidden, true)
  assertEquals(p.chart.dataset.on, undefined)
})

test('the keyboard starts on today and walks, and stops at the ends', () => {
  let p = page('line')
  p.focus()
  assertEquals(p.tip()?.textContent, 'Oct 3rd, 2026: 1,200 visits')
  p.key('ArrowRight')
  assertEquals(p.tip()?.textContent, 'Oct 3rd, 2026: 1,200 visits')
  p.key('ArrowLeft')
  assertEquals(p.tip()?.textContent, 'Oct 2nd, 2026: 0 visits')
  p.key('Escape')
  assertEquals(p.tip()?.hidden, true)
})
