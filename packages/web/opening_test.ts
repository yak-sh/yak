import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import {
  type Failure,
  failurePage,
  type Opening,
  openingHead,
} from './opening.ts'

let site: Opening = {
  name: 'yaks.app',
  background: '#fdf7ee',
  ink: '#523828',
  dark: { background: '#2b231f', ink: '#f1e6d8' },
  mark: '/mark.png',
  report: '/api/report',
}

// A page opening with the head's script run in it, on a clock the test moves:
// `html` is the page as far as it has come, and `head` the head that carries
// the script (the site's own, or a worker's failure page).
let opening = (
  html = `<html><head>${openingHead(site)}</head><body></body></html>`,
  o: { reporter?: boolean } = {},
) => {
  let { document, window } = parseHTML(html)
  let state = 'loading'
  Object.defineProperty(document, 'readyState', { get: () => state })
  let clock = 0
  let timers: { at: number; fn: () => void; id: number }[] = []
  let ids = 0
  let hear = new Map<string, Set<(e: unknown) => void>>()
  let painted = false
  let reports: { message: string; page: string }[] = []
  let kept = new Map([
    ['https://yaks.app/.forgot', 1],
    ['https://yaks.app/ada', 1],
  ])
  let reloaded = 0
  // A window of the page's own: linkedom's writes through to the process's.
  let w: Record<PropertyKey, unknown> = {
    PerformanceObserver: { supportedEntryTypes: ['paint'] },
  }
  if (o.reporter === false) w[Symbol.for('yaks.early-report')] = () => []
  let script = html.match(/<script data-yak-opening>([\s\S]*?)<\/script>/)![1]
  new Function(
    'window',
    'top',
    'self',
    'document',
    'navigator',
    'location',
    'performance',
    'setTimeout',
    'clearTimeout',
    'addEventListener',
    'removeEventListener',
    'caches',
    'fetch',
    script,
  )(
    w,
    w,
    w,
    document,
    {
      sendBeacon: (_at: string, body: string) => reports.push(JSON.parse(body)),
    },
    {
      href: 'https://yaks.app/ada',
      origin: 'https://yaks.app',
      search: '',
      reload: () => reloaded++,
    },
    {
      getEntriesByName: (name: string) =>
        name == 'first-contentful-paint' && painted ? [{}] : [],
    },
    (fn: () => void, ms: number) => {
      timers.push({ at: clock + ms, fn, id: ++ids })
      return ids
    },
    (id: number) => timers = timers.filter((t) => t.id != id),
    (type: string, fn: (e: unknown) => void) =>
      hear.set(type, (hear.get(type) ?? new Set()).add(fn)),
    (type: string, fn: (e: unknown) => void) => hear.get(type)?.delete(fn),
    {
      open: () =>
        Promise.resolve({
          keys: () => Promise.resolve([...kept.keys()].map((url) => ({ url }))),
          delete: (r: { url: string }) => kept.delete(r.url),
        }),
    },
    () => Promise.resolve(),
  )
  let at = (ms: number) => {
    clock = ms
    for (let t of timers.filter((t) => t.at <= ms)) {
      timers = timers.filter((x) => x != t)
      t.fn()
    }
  }
  let fire = (type: string, e: unknown = {}) => {
    for (let fn of hear.get(type) ?? []) fn(e)
  }
  return {
    window: w,
    document,
    reports,
    kept: () => [...kept.keys()],
    reloaded: () => reloaded,
    at,
    paint: () => painted = true,
    parsed: (body?: string) => {
      // As the parser does: after what is there already.
      if (body != null) document.body.insertAdjacentHTML('beforeend', body)
      state = 'interactive'
      document.dispatchEvent(new window.Event('readystatechange'))
    },
    loaded: () => {
      fire('load')
      at(clock)
    },
    fire,
    screen: () => {
      let box = document.querySelector('.YakOpening')
      return box && {
        state: box.getAttribute('data-state'),
        words: [...box.querySelectorAll('p')].map((p) => p.textContent),
        again: !!box.querySelector('button'),
        mark: !!box.querySelector('img'),
      }
    },
  }
}

let PAGE = '<h1>Ada</h1><p>' + 'A conversation with words in it. '.repeat(4) +
  '</p>'

test('a page that opens fast shows nothing of its own and reports nothing', () => {
  let p = opening()
  p.at(120)
  p.paint()
  p.parsed(PAGE)
  p.loaded()
  p.at(10_000)
  equal([p.screen(), p.reports], [null, []])
})

test('a page that has painted nothing after 300 ms shows its mark and a quiet bar, gone once it is in', () => {
  let p = opening()
  p.at(299)
  equal(p.screen(), null)
  p.at(300)
  equal(p.screen(), {
    state: 'loading',
    words: [],
    again: false,
    mark: true,
  })
  p.parsed(PAGE)
  p.at(10_000)
  equal([p.screen(), p.reports], [null, []])
})

test('a page held up 4 s says it is slow and offers Try again, then leaves the moment the page is in, keeping its stylesheet, reloading nothing and reporting nothing', () => {
  let p = opening(
    `<html><head>${openingHead(site)}<link rel="stylesheet" href="/s.css">` +
      '</head><body></body></html>',
  )
  p.at(4000)
  equal(p.screen(), {
    state: 'slow',
    words: [
      'yaks.app is taking longer than usual to open this page.',
      'It will show as soon as it arrives.',
    ],
    again: true,
    mark: true,
  })
  p.parsed(PAGE)
  equal(p.screen()?.state, 'slow')
  let sheet = p.document.querySelector('link[rel=stylesheet]')!
  Object.defineProperty(sheet, 'sheet', { value: {} })
  p.fire('load', { target: sheet })
  equal([p.screen(), p.reloaded(), p.reports], [null, 0, []])
})

test('a page in whole gets no screen, even where the browser never says it painted, as in a hidden tab', () => {
  let p = opening()
  p.at(100)
  p.parsed(PAGE)
  p.at(10_000)
  equal(p.screen(), null)
})

test('a page that has painted is never covered, however long the rest takes', () => {
  let p = opening()
  p.at(100)
  p.paint()
  p.at(20_000)
  equal([p.screen(), p.reports], [null, []])
})

test("a script of the site's own that failed says the page could not open over a page that drew nothing, else in a line at its foot", () => {
  // A script element as the browser hands one over, its address whole.
  let script = (src: string) => ({
    tagName: 'SCRIPT',
    src: new URL(src, 'https://yaks.app/ada').href,
  })
  let bare = opening()
  bare.paint()
  bare.parsed('<p>Opening…</p>')
  bare.fire('error', { target: script('https://yaks.app/_yak/chat.js') })
  bare.loaded()
  equal(bare.screen(), {
    state: 'failed',
    words: ["yaks.app couldn't open this page.", 'It has been reported.'],
    again: true,
    mark: true,
  })
  let drawn = opening()
  drawn.paint()
  drawn.parsed(PAGE)
  drawn.fire('error', { target: script('/_yak/chat.js') })
  drawn.loaded()
  equal(drawn.screen(), {
    state: 'line',
    words: ["Part of this page didn't load, so it may not work."],
    again: true,
    mark: false,
  })
  let elsewhere = opening()
  elsewhere.parsed()
  elsewhere.fire('error', { target: script('https://ads.example/a.js') })
  elsewhere.loaded()
  equal(elsewhere.screen(), null)
})

test('a failed script is reported here only where the page reporter never ran', () => {
  let failed = (reporter: boolean) => {
    let p = opening(undefined, { reporter })
    p.parsed()
    p.fire('error', {
      target: p.window,
      message: 'TypeError: x is undefined',
      filename: 'https://yaks.app/_yak/chat.js',
    })
    p.loaded()
    return p.reports.map((r) => r.message)
  }
  equal(failed(true), [])
  equal(failed(false), [
    'TypeError: x is undefined at https://yaks.app/_yak/chat.js',
  ])
})

test("a worker's page says at once why the open failed, and reports only what is the site's", () => {
  let shown = (f: Failure) => {
    let p = opening(failurePage(site, f))
    return [
      p.screen()?.state,
      p.screen()?.words,
      p.reports.map((r) => r.message),
    ]
  }
  equal(shown({ state: 'offline', said: 'TypeError: Load failed' }), [
    'offline',
    [
      "You're offline, and this page isn't saved on this device.",
      'Connect to the internet, then try again.',
    ],
    [],
  ])
  equal(shown({ state: 'unreachable', said: 'TypeError: Load failed' }), [
    'unreachable',
    ["yaks.app couldn't be reached.", 'Check your connection, then try again.'],
    [],
  ])
  equal(shown({ state: 'failed', said: 'The server answered 502 <&>' }), [
    'failed',
    ["yaks.app couldn't open this page.", 'It has been reported.'],
    ['The server answered 502 <&>'],
  ])
})

test('Try again forgets every kept page and loads the page again', async () => {
  let p = opening(failurePage(site, { state: 'offline', said: '' }))
  ;(p.document.querySelector('.YakOpening button') as unknown as {
    onclick: () => Promise<void>
  }).onclick()
  await new Promise((done) => setTimeout(done, 0))
  equal([p.kept(), p.reloaded()], [['https://yaks.app/.forgot'], 1])
})
