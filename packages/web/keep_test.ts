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
  // Laid out as each element says: data-at="top height" in the window, and
  // data-css its computed style, a block in the flow unless it says else.
  for (let e of document.querySelectorAll('[data-at]')) {
    let [top, height] = e.getAttribute('data-at')!.split(' ').map(Number)
    e.getBoundingClientRect = () =>
      ({ top, height, bottom: top + height }) as DOMRect
  }
  let getComputedStyle = (e: Element) => ({
    display: /^(HEAD|SCRIPT|STYLE)$/.test(e.tagName) ? 'none' : 'block',
    position: 'static',
    float: 'none',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gridAutoFlow: 'row',
    gridTemplateColumns: 'none',
    gridRowStart: 'auto',
    gridColumnStart: 'auto',
    ...Object.fromEntries(
      (e.getAttribute('data-css') ?? '').split(';').filter(Boolean).map((p) =>
        p.split(':').map((s) =>
          s.trim().replace(/-(.)/g, (_, c) => c.toUpperCase())
        )
      ),
    ),
  })
  let location = { href: 'https://yaks.app/checks' }
  let win = {
    document,
    location,
    navigator: { serviceWorker: workers },
    performance: { timeOrigin: 0 },
    innerHeight: 800,
    getComputedStyle,
    MutationObserver: window.MutationObserver,
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
  return {
    document,
    sent,
    registered,
    hide,
    leave,
    load,
    claim,
    arrive,
    set href(at: string) {
      location.href = at
    },
  }
}

test('a page registers its worker once loaded, and sends it what it shows as it is hidden or left in place, without what it does not, and only once unchanged', () => {
  let t = tab(
    '<html><body><p>Seen last</p><section hidden><p>Not shown</p></section><script>go()</script></body></html>',
  )
  assertEquals(t.registered, [])
  t.load()
  assertEquals(t.registered, ['/worker.js'])
  assertEquals(t.sent.map((s) => s.keep), ['https://yaks.app/checks'])
  t.hide()
  t.leave()
  assertEquals(t.sent.length, 1)
  t.document.querySelector('p')!.textContent = 'Seen last, changed'
  t.leave()
  t.hide()
  assertEquals(t.sent.map((s) => s.keep), [
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

// A conversation's pane, 700 high at 100, scrolled to `at`, and the ids of
// the rows its picture keeps. Each row is 500 high, the newest last.
let trimmed = (at: string, rows: string, extra = '') => {
  let t = tab(
    `<html><body><main ${SCROLL} data-at="100 700"${extra}>${rows}</main></body></html>`,
  )
  let pane = t.document.querySelector('main')!
  Object.assign(pane, {
    scrollHeight: 9000,
    clientHeight: 700,
    scrollTop: at == 'end' ? 8300 : Number(at),
  })
  t.hide()
  let { document } = parseHTML(t.sent[0].html)
  return [
    document.querySelector('main')!.getAttribute(SCROLL),
    [...document.querySelectorAll('[id]')].map((e) => e.id).join(' '),
  ]
}
let row = (id: string, top: number, css = '') =>
  `<p id="${id}" data-at="${top} 500"${
    css ? ` data-css="${css}"` : ''
  }>${id}</p>`

test('a picture of a long conversation keeps only the rows within a screen of what shows', () => {
  let rows = [-2400, -1900, -1400, -900, -400, 100, 600]
    .map((top, i) => row(`r${i}`, top)).join('')
  assertEquals(trimmed('end', rows), ['end', 'r3 r4 r5 r6'])
})

test('a pane scrolled to a place is scrolled less by the rows left out above it', () => {
  let rows = [-1900, -1400, -400, 100, 1400, 2400]
    .map((top, i) => row(`r${i}`, top)).join('')
  assertEquals(trimmed('3000', rows), ['1500', 'r2 r3 r4'])
})

test('rows far off stay where taking them out would move what shows, and the linked row always stays', () => {
  let rows = row('far', -3000) + row('near', 100)
  let grid = (columns: string) =>
    trimmed(
      'end',
      rows,
      ` data-css="display:grid;grid-template-columns:${columns}"`,
    )
  assertEquals(grid('100px 100px'), ['end', 'far near'])
  assertEquals(grid('[start] 343px [end]'), ['end', 'near'])
  let floating = row('far', -3000, 'float:left') +
    row('loose', 4000, 'position:fixed') + row('near', 100)
  assertEquals(trimmed('end', floating), ['end', 'far near'])
  let t = tab(
    `<html><body><main ${SCROLL}="end" data-at="100 700">${
      row('row-a', -3000)
    }${row('near', 100)}</main></body></html>`,
  )
  t.href = 'https://yaks.app/checks#row-a'
  t.hide()
  assertEquals(t.sent[0].html.includes('id="row-a"'), true)
})

// A style rule, a group of rules and a rule no selector picks, as a sheet's
// CSSOM lists them.
let rule = (selectorText: string) => ({
  selectorText,
  cssText: `${selectorText} { color: red; }`,
})
let group = (prelude: string, rules: object[], named = false) => ({
  cssRules: rules,
  cssText: `${prelude} {${rules.map((r) => (r as CSSRule).cssText).join('')}}`,
  ...named ? { name: prelude } : {},
})
let whole = (cssText: string) => ({ cssText })

test('a picture carries only the rules of its sheets that may match something in it', () => {
  let t = tab(
    '<html><head><link rel="stylesheet" href="/_yak/pages.css"><link rel="stylesheet" href="https://elsewhere.example/a.css"></head>' +
      '<body><p class="row md:wide">Hi</p></body></html>',
  )
  let [ours, theirs] = t.document.querySelectorAll('link')
  Object.defineProperty(ours, 'sheet', {
    value: {
      href: 'https://yaks.app/_yak/pages.css',
      cssRules: [
        rule(':root'),
        rule('.row'),
        rule('.gone'),
        rule('.row:not(.gone)'),
        rule('.md\\:wide'),
        rule('.row:hover'),
        rule('.row::before'),
        rule('.menu:target'),
        group('@media (width < 700px)', [rule('.row'), rule('.gone')]),
        group('@supports (display: grid)', [rule('.gone')]),
        group('@layer base', [rule('.gone')], true),
        whole('@font-face { src: url(face.woff2); }'),
      ],
    },
  })
  Object.defineProperty(theirs, 'sheet', {
    value: {
      href: 'https://elsewhere.example/a.css',
      get cssRules() {
        throw new DOMException('Cross-origin', 'SecurityError')
      },
    },
  })
  t.hide()
  let red = (s: string) => `${s} { color: red; }`
  assertEquals(
    t.sent[0].html,
    '<!doctype html><html><head><style>' +
      red(':root') + red('.row') + red('.row:not(.gone)') +
      red('.md\\:wide') + red('.row:hover') + red('.row::before') +
      `@media (width < 700px) {${red('.row')}}` +
      '@layer base {}' +
      '@font-face { src: url("https://yaks.app/_yak/face.woff2"); }</style>' +
      '<link rel="stylesheet" href="https://elsewhere.example/a.css"></head>' +
      '<body><p class="row md:wide">Hi</p></body></html>',
  )
})
