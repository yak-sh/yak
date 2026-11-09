import { cleanup, clock, equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { h, render } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { day, pretty } from './relative.ts'
import { Time } from './Time.ts'
import { tips } from './float.ts'

let at = '2026-11-06T15:42:00Z'
let now = Date.parse('2026-11-09T15:42:00Z')
let page = () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let width = Object.getOwnPropertyDescriptor(globalThis, 'innerWidth')
  let height = Object.getOwnPropertyDescriptor(globalThis, 'innerHeight')
  Object.defineProperties(globalThis, {
    innerWidth: { value: 1000, configurable: true },
    innerHeight: { value: 800, configurable: true },
  })
  let { document, Event } = parseHTML('<html><body><main></main></body></html>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  cleanup(() => {
    render(null, root)
    if (width) Object.defineProperty(globalThis, 'innerWidth', width)
    else delete (globalThis as { innerWidth?: unknown }).innerWidth
    if (height) Object.defineProperty(globalThis, 'innerHeight', height)
    else delete (globalThis as { innerHeight?: unknown }).innerHeight
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  })
  return { document, Event, root }
}

test('written dates use ordinal days, and timestamps use a twelve-hour clock', () => {
  for (
    let [n, suffix] of [
      [1, 'st'],
      [2, 'nd'],
      [3, 'rd'],
      [11, 'th'],
      [12, 'th'],
      [13, 'th'],
      [21, 'st'],
      [22, 'nd'],
      [23, 'rd'],
      [31, 'st'],
    ]
  ) {
    equal(
      day(`2026-10-${String(n).padStart(2, '0')}`, 'UTC'),
      `Oct ${n}${suffix}, 2026`,
    )
  }
  equal(pretty(at, 'UTC'), 'Nov 6th, 2026, 3:42 PM')
  equal(pretty('2026-11-06T00:00:00Z', 'UTC'), 'Nov 6th, 2026, 12:00 AM')
  equal(pretty('2026-11-06T12:00:00Z', 'UTC'), 'Nov 6th, 2026, 12:00 PM')
  equal(day('2026-11-06', 'UTC'), 'Nov 6th, 2026')
  equal(day('soon'), '')
})

test('a rendered date says its age and reveals the full timestamp in a kit tooltip', () => {
  let { document, Event, root } = page()
  root.innerHTML = renderToString(
    h(Time, { at, now, timeZone: 'UTC', title: at }),
  )
  let face = root.querySelector('time')!
  equal(face.textContent, '3 days ago')
  equal(face.getAttribute('datetime'), at)
  equal(face.hasAttribute('title'), false)
  equal(face.getAttribute('tabindex'), '0')
  tips(document as unknown as Document)
  face.dispatchEvent(new Event('focusin', { bubbles: true }))
  equal(
    document.querySelector('.Tip[role=tooltip]')?.textContent,
    'Nov 6th, 2026, 3:42 PM',
  )
  equal(renderToString(h(Time, { at: 'soon' })), '')
})

test('mounted dates share a ticking clock and stop it when the last date leaves', async () => {
  let { root } = page()
  let time = clock(Date.parse(at) + 60_000)
  render(
    h('div', null, h(Time, { at, clock: time }), h(Time, { at, clock: time })),
    root,
  )
  equal([...root.querySelectorAll('time')].map((x) => x.textContent), [
    '1 minute ago',
    '1 minute ago',
  ])
  equal(time.pending(), 1)
  await time.advance(60_000)
  await Promise.resolve()
  equal([...root.querySelectorAll('time')].map((x) => x.textContent), [
    '2 minutes ago',
    '2 minutes ago',
  ])
  render(null, root)
  equal(time.pending(), 0)
})
