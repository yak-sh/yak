import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { keep, type Window } from './keep.ts'
import { KEPT, OWN, picture, SCROLL } from './picture.ts'
import { LEAVE, PAGE } from '@yaks/ui/navigate'

// A page in a browser with a worker, and what it sent the worker.
let tab = (html: string, controlled = true, pending?: string) => {
  let { document, window } = parseHTML(html)
  let sent: { keep: string; html: string; shell?: string }[] = []
  let registered: string[] = []
  let shown = 'visible'
  let workers = {
    register: (at: string) => (registered.push(at), Promise.resolve()),
    controller: controlled
      ? { postMessage: (said: never) => sent.push(said) }
      : null,
    addEventListener: window.addEventListener.bind(window),
  }
  Object.defineProperty(document, 'visibilityState', { get: () => shown })
  let win = {
    document,
    location: { href: 'https://yaks.app/checks' },
    navigator: { serviceWorker: workers },
    performance: { timeOrigin: 0 },
    addEventListener: window.addEventListener.bind(window),
  } as unknown as Window
  keep(win, '/worker.js', pending)
  let hide = () => {
    shown = 'hidden'
    document.dispatchEvent(new window.Event('visibilitychange'))
  }
  let leave = () => document.dispatchEvent(new window.Event(LEAVE))
  let load = () => window.dispatchEvent(new window.Event('load'))
  let arrive = () => document.dispatchEvent(new window.Event(PAGE))
  let claim = () => {
    workers.controller = { postMessage: (said: never) => sent.push(said) }
    window.dispatchEvent(new window.Event('controllerchange'))
  }
  return { document, sent, registered, hide, leave, load, claim, arrive }
}

test('a page registers its worker once loaded, and sends it what it shows as it is hidden or left in place, without what it does not', () => {
  let t = tab(
    '<html><body><p>Seen last</p><section hidden><p>Not shown</p></section><script>go()</script></body></html>',
  )
  assertEquals(t.registered, [])
  t.load()
  assertEquals(t.registered, ['/worker.js'])
  assertEquals(t.sent.map((s) => s.keep), ['https://yaks.app/checks'])
  t.hide()
  t.leave()
  assertEquals(t.sent.map((s) => s.keep), [
    'https://yaks.app/checks',
    'https://yaks.app/checks',
    'https://yaks.app/checks',
  ])
  assertEquals(
    t.sent[0].html,
    '<!doctype html><html><body><p>Seen last</p></body></html>',
  )
})

test('a first visit is kept as soon as its worker takes control, before the page is hidden', () => {
  let t = tab(
    `<html><body><nav>Side</nav><main ${OWN}>Updates</main></body></html>`,
    false,
  )
  t.load()
  assertEquals(t.sent, [])
  t.claim()
  assertEquals(t.sent.length, 1)
  assertEquals(t.sent[0].html.includes('Updates'), true)
  assertEquals(t.sent[0].shell?.includes('Updates'), false)
})

test('a temporary opening frame never replaces the kept picture of its page', () => {
  let t = tab(
    '<html><body><main data-opening>Waiting</main></body></html>',
    true,
    '[data-opening]',
  )
  t.load()
  t.hide()
  t.leave()
  assertEquals(t.sent, [])

  t.document.querySelector('main')!.outerHTML = '<main>Conversation</main>'
  t.arrive()
  assertEquals(t.sent.length, 1)
  assertEquals(t.sent[0].html.includes('Conversation'), true)
})

test('a page with parts of its own sends its shell beside it, those parts empty', () => {
  let t = tab(
    `<html><body><nav>Side</nav><h1 ${OWN}>Chat</h1><main ${OWN}><p>Hi</p></main></body></html>`,
  )
  t.hide()
  assertEquals(
    t.sent[0].shell,
    `<!doctype html><html><body><nav>Side</nav><h1 ${OWN}=""></h1><main ${OWN}=""></main></body></html>`,
  )
})

test('a kept picture registers nothing and sends nothing', () => {
  let t = tab(`<html ${KEPT}="1"><body><p>Seen before</p></body></html>`)
  t.load()
  t.hide()
  assertEquals([t.registered, t.sent], [[], []])
})

let transcript =
  `<html><head></head><body><main ${SCROLL}="end"><p id="row-a">First</p><p>Newest</p></main></body></html>`

let scrolls = (html: string, hash = '') => {
  let { document } = parseHTML(picture(html, 1))
  let pane = document.querySelector('main')!
  let row = document.getElementById('row-a')!
  Object.assign(pane, { scrollHeight: 900, scrollTop: 0, clientHeight: 400 })
  row.scrollIntoView = (opts) => {
    assertEquals(opts, { block: 'center' })
    pane.scrollTop = 80
  }
  let scroller = [...document.querySelectorAll('script')].at(-1)!.textContent
  new Function('document', 'location', scroller)(document, { hash })
  return pane.scrollTop
}

test('the kept picture of a scrolled conversation restores the saved pane position', () => {
  let t = tab(transcript)
  let pane = t.document.querySelector('main')!
  Object.assign(pane, { scrollTop: 150, scrollHeight: 900, clientHeight: 400 })
  t.hide()
  assertEquals(scrolls(t.sent[0].html), 150)
})

test('a fresh picture starts at the newest line or centers the line its link opens', () => {
  assertEquals(scrolls(transcript), 900)
  assertEquals(scrolls(transcript, '#row-a'), 80)
})
