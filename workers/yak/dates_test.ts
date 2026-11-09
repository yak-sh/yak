import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { h } from 'preact'
import { Time } from '@yaks/ui/parts'
import { markup } from './html.ts'
import { dates, stamp } from './dates.ts'

let at = '2026-11-06T15:42:00Z'
let now = Date.parse('2026-11-09T15:42:00Z')
let { document } = parseHTML(`<html><body>${
  markup([
    h(Time, { at, now: Date.parse(at), timeZone: 'UTC' }),
    h(Time, { at: '2026-11-06', written: true, timeZone: 'UTC' }),
  ])
}</body></html>`)

test('the hosted page refreshes ages and keeps written calendar dates and explicit zones', () => {
  dates(document as unknown as Document, now)
  let [ago, written] = document.querySelectorAll('time')
  equal(ago.textContent, '3 days ago')
  equal(ago.getAttribute('data-tip'), 'Nov 6th, 2026, 3:42 PM')
  equal(written.textContent, 'Nov 6th, 2026')
  equal(written.getAttribute('data-tip'), 'Nov 6th, 2026, 12:00 AM')
})

test('the data editor uses the kit date face without mounting a ticking component', () => {
  let node = stamp(document as unknown as Document, at)
  equal(node.tagName, 'TIME')
  equal(node.getAttribute('datetime'), at)
  equal(node.getAttribute('data-tip')?.startsWith('Nov 6th, 2026'), true)
  equal(node.hasAttribute('title'), false)
})
