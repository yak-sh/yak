import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { keep, type Window } from './keep.ts'
import { KEPT } from './picture.ts'
import { LEAVE } from '@yaks/ui/navigate'

// A page in a browser with a worker, and what it sent the worker.
let tab = (html: string) => {
  let { document, window } = parseHTML(html)
  let sent: { keep: string; html: string }[] = []
  let registered: string[] = []
  let shown = 'visible'
  Object.defineProperty(document, 'visibilityState', { get: () => shown })
  let win = {
    document,
    location: { href: 'https://yaks.app/checks' },
    navigator: {
      serviceWorker: {
        register: (at: string) => (registered.push(at), Promise.resolve()),
        controller: { postMessage: (said: never) => sent.push(said) },
      },
    },
    performance: { timeOrigin: 0 },
    addEventListener: window.addEventListener.bind(window),
  } as unknown as Window
  keep(win, '/worker.js')
  let hide = () => {
    shown = 'hidden'
    document.dispatchEvent(new window.Event('visibilitychange'))
  }
  let leave = () => document.dispatchEvent(new window.Event(LEAVE))
  return { sent, registered, hide, leave }
}

test('a page sends the worker what it shows as it is hidden or left in place', () => {
  let t = tab('<html><body><p>Seen last</p></body></html>')
  assertEquals(t.registered, ['/worker.js'])
  t.hide()
  t.leave()
  assertEquals(t.sent.map((s) => s.keep), [
    'https://yaks.app/checks',
    'https://yaks.app/checks',
  ])
  assertEquals(t.sent[0].html.includes('<p>Seen last</p>'), true)
})

test('a kept picture registers nothing and sends nothing', () => {
  let t = tab(`<html ${KEPT}="1"><body><p>Seen before</p></body></html>`)
  t.hide()
  assertEquals([t.registered, t.sent], [[], []])
})
