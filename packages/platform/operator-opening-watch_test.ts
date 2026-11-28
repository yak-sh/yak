import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { LONG, openingWatchScript } from './operator-opening-watch.ts'

// A page's opening slot and its watch, run on timers the case moves by
// hand: what it reported, and how often the page reloaded.
let watched = (view = '<div data-talk-view>') => {
  let { document } = parseHTML(
    `<main>${view}<div data-operator-opening="/a/operator?conversation=1"><div role="status" data-operator-loading>Loading conversation…</div></div><script></script></div></main>`,
  )
  Object.defineProperty(document, 'readyState', { value: 'complete' })
  let timers: (() => void)[] = []
  let sent: { message: string; stack: string }[] = []
  let reloads = 0
  new Function('document', 'window', openingWatchScript('/api/report'))(
    { currentScript: document.querySelector('script') },
    {
      setTimeout: (run: () => void) => void timers.push(run),
      location: {
        href: 'https://yaks.app/a/operator',
        reload: () => void reloads++,
      },
      navigator: {
        sendBeacon: (door: string, body: string) => {
          equal(door, '/api/report')
          sent.push(JSON.parse(body))
          return true
        },
      },
    },
  )
  let slot = document.querySelector('[data-operator-opening]')!
  return {
    slot,
    view: document.querySelector('[data-talk-view]')!,
    sent,
    reloads: () => reloads,
    // `ms` of the watch's ticks, each a second
    wait: (ms: number) => {
      for (let i = 0; i < ms / 1000; i++) timers.shift()?.()
    },
    says: () => slot.textContent,
  }
}

test('a slot in sight that the conversation never replaces says so, offers to try again, and reports once', () => {
  let w = watched()
  w.slot.setAttribute('data-operator-stage', 'awaiting the streamed answer')
  w.wait(LONG - 1000)
  equal([w.sent.length, w.says()], [0, 'Loading conversation…'])
  w.wait(LONG)
  equal(w.says(), 'The conversation could not be opened. Try again')
  equal(w.sent.map((s) => [s.message, s.stack.split('\n')[1]]), [[
    'The Operator conversation stayed on Loading for 15 s',
    '    at https://yaks.app/a/operator (stage awaiting the streamed answer, document complete)',
  ]])
  w.slot.querySelector('button')!.click()
  equal(w.reloads(), 1)
})

test('a slot whose opening never ran is reported as unbound', () => {
  let w = watched()
  w.wait(LONG)
  equal(w.sent[0].stack.includes('(stage unbound,'), true)
})

test('a slot out of sight waits however long, and its time starts again once shown', () => {
  let w = watched('<div data-talk-view hidden>')
  w.wait(LONG * 2)
  equal(w.sent.length, 0)
  w.view.removeAttribute('hidden')
  w.wait(LONG - 1000)
  equal(w.sent.length, 0)
  w.wait(1000)
  equal(w.sent.length, 1)
})

test('a slot the conversation replaced is left be', () => {
  let w = watched()
  w.wait(3000)
  w.slot.remove()
  w.wait(LONG)
  equal(w.sent.length, 0)
})
