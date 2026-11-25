import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { DOMParser, parseHTML } from 'linkedom'
import type { HistoryEntry } from './history.ts'
import {
  AGAIN,
  AHEAD,
  arrived,
  DRAW,
  type Drawing,
  FRESH,
  GOING,
  LEAVE,
  leaving,
  morph,
  NAMES,
  PAGE,
  start,
  swap,
  type Swapped,
  TITLE,
} from './navigate.ts'

let parse = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html') as unknown as Document

// A framed page: the side with an icon beside its link, and the content.
let framed = (here: string, content: string, extra = '') =>
  `<html><head><title>${here}</title>` +
  `<script src="/nav.js" data-navigate></script></head><body class="Framed">` +
  `<a class="Skip" href="#content">Skip</a>` +
  `<nav id="menu"><a href="/apps"${
    here == 'apps' ? ' aria-current="page"' : ''
  }><img src="/a/icon.png?v=1">Apps</a>` +
  `<a href="/updates"${
    here == 'updates' ? ' aria-current="page"' : ''
  }>Updates</a></nav>` +
  `<div id="content" tabindex="-1">${content}</div>${extra}</body></html>`

test('a morph keeps the nodes both pages hold and changes only the rest', () => {
  let doc = parse(framed('apps', '<h1>Apps</h1><ul><li>one</li></ul>'))
  let menu = doc.getElementById('menu')!
  let icon = doc.querySelector('img')!
  let next = parse(framed('updates', '<h1>Updates</h1><p>none</p>'))
  let tally = morph(doc.body, next.body)
  assertEquals(
    doc.getElementById('content')?.innerHTML,
    '<h1>Updates</h1><p>none</p>',
  )
  assert(doc.getElementById('menu') == menu)
  assert(doc.querySelector('img') == icon)
  assertEquals(doc.querySelector('[aria-current]')?.textContent, 'Updates')
  assertEquals(tally, { kept: 12, made: 2, dropped: 3 })
})

test('keyed nodes keep their own node when the list around them moves', () => {
  let doc = parse(
    '<ul><li id="a">A</li><li id="b">B</li><li data-key="c">C</li></ul>',
  )
  let [a, b, c] = doc.querySelectorAll('li')
  morph(
    doc.querySelector('ul')!,
    parse(
      '<ul><li data-key="c">C!</li><li>new</li><li id="a">A</li></ul>',
    ).querySelector('ul')!,
  )
  let now = [...doc.querySelectorAll('li')]
  assertEquals(now.map((li) => li.textContent), ['C!', 'new', 'A'])
  assert(now[0] == c && now[2] == a && !now.includes(b))
})

test('a form control shows the value its new page says', () => {
  let doc = parse(
    '<form><input name="q" value="a"><textarea>x</textarea></form>',
  )
  let input = doc.querySelector('input') as HTMLInputElement
  input.value = 'typed'
  morph(
    doc.querySelector('form')!,
    parse('<form><input name="q" value="b"><textarea>y</textarea></form>')
      .querySelector('form')!,
  )
  assertEquals(input.value, 'b')
  assertEquals(
    (doc.querySelector('textarea') as HTMLTextAreaElement).value,
    'y',
  )
})

test('a swap runs a script it names for the first time once, and a written one every time', () => {
  let doc = parse(framed('apps', '<p>a</p>'))
  let style = doc.createElement('style')
  doc.head.append(style)
  let ran = new Set(['https://y.test/nav.js'])
  let runs: string[] = []
  let run = (s: Element) =>
    void runs.push(s.getAttribute('src') ?? s.textContent!)
  let page = (body: string, code: string) =>
    parse(
      framed(
        'updates',
        body,
        `<script src="/b.js"></script><script>${code}</script>`,
      ),
    )
  swap(doc, page('<p>b</p>', 'go(1)'), ran, run, 'https://y.test/updates')
  swap(doc, page('<p>c</p>', 'go(2)'), ran, run, 'https://y.test/updates')
  swap(doc, parse(framed('apps', '<p>a</p>')), ran, run, 'https://y.test/apps')
  swap(doc, page('<p>c</p>', 'go(2)'), ran, run, 'https://y.test/updates')
  assertEquals(runs, ['/b.js', 'go(1)', 'go(2)', 'go(2)'])
  assertEquals(doc.title, 'updates')
  assert(style.parentNode == doc.head, 'what a script put in the head stays')
})

// Every promise already settled has run its callbacks.
let settled = () => new Promise((done) => setTimeout(done, 0))

// A window over a page at `path`, its fetches answered from `pages`.
let browsing = (pages: Record<string, string>, path = '/apps') => {
  let { document } = parseHTML(pages[new URL(path, 'https://y.test').pathname])
  let doc = document as unknown as Document
  let at = new URL(path, 'https://y.test')
  let loaded: string[] = []
  let fetched: string[] = []
  let stopped: string[] = []
  let again = new Set<string>()
  let slow = false
  let waiting: (() => void)[] = []
  let entries: HistoryEntry[] = []
  let pop: ((e: HistoryEntry) => void) | undefined
  let location = {
    get href() {
      return at.href
    },
    get origin() {
      return at.origin
    },
    get pathname() {
      return at.pathname
    },
    get search() {
      return at.search
    },
    get hash() {
      return at.hash
    },
    assign: (to: string) => void loaded.push(to),
    // A fragment alone moves only the address's fragment.
    replace: (to: string) => {
      loaded.push(to)
      if (to.startsWith('#')) at.hash = to
    },
  }
  let win = {
    document: doc,
    location,
    addEventListener: (
      type: string,
      fn: EventListener,
      o?: AddEventListenerOptions,
    ) => doc.addEventListener(type, fn, o),
    fetch: (url: string, init: RequestInit = {}) => {
      let ahead = new Headers(init.headers).get(AHEAD)
      fetched.push(ahead ? `${url} ${ahead}` : url)
      let to = new URL(url)
      let html = pages[to.pathname]
      let answer = () =>
        new Response(html ?? 'gone', {
          headers: {
            'content-type': html ? 'text/html' : 'text/plain',
            ...again.has(to.pathname) ? { [AGAIN]: '1' } : {},
          },
        })
      if (!slow) return Promise.resolve(answer())
      // Held back until `answer()`, and refused once its asker stops.
      return new Promise((done, fail) => {
        waiting.push(() => done(answer()))
        init.signal?.addEventListener('abort', () => {
          stopped.push(url)
          fail(new DOMException('stopped', 'AbortError'))
        })
      })
    },
    scrollTo: () => {},
    DOMParser,
  } as unknown as Parameters<typeof start>[0]
  let history = {
    read: () => ({ path: at.pathname, state: null }),
    write: (e: HistoryEntry) => {
      entries.push(e)
      at = new URL(e.path, at)
    },
    listen: (fn: (e: HistoryEntry) => void) => {
      pop = fn
      return () => {}
    },
    back: () => {},
    forward: () => {},
  }
  let swapped = new Promise<Swapped>((done) =>
    doc.addEventListener(PAGE, (e) => done((e as CustomEvent<Swapped>).detail))
  )
  let drawn: Swapped[] = []
  doc.addEventListener(PAGE, (e) => drawn.push((e as CustomEvent).detail))
  let left = 0
  doc.addEventListener(LEAVE, () => left++)
  let time = 0
  let go = start(win, history, () => time)
  let view = doc.defaultView as unknown as typeof globalThis
  let press = (type: string, selector: string, init: MouseEventInit = {}) => {
    let e = new view.Event(type, { bubbles: true, cancelable: true })
    Object.assign(e, init)
    doc.querySelector(selector)!.dispatchEvent(e)
    return e.defaultPrevented
  }
  let click = (selector: string, init: MouseEventInit = {}) =>
    press('click', selector, init)
  let back = (path: string) => {
    at = new URL(path, at)
    pop!({ path, state: null })
  }
  return {
    doc,
    loaded,
    fetched,
    entries,
    swapped,
    drawn,
    press,
    click,
    back,
    go,
    left: () => left,
    tick: (ms: number) => void (time += ms),
    stopped,
    again,
    // Answers wait until `answer` sends them.
    slow: () => void (slow = true),
    answer: async () => {
      for (let send of waiting.splice(0)) send()
      await settled()
    },
  }
}

let site = {
  '/apps': framed('apps', '<h1>Apps</h1>'),
  '/updates': framed('updates', '<h1>Updates</h1>'),
  '/home': '<html><body>the home page</body></html>',
}

test('a click on a link of the site swaps its page in and keeps the shell', async () => {
  let b = browsing(site)
  let menu = b.doc.getElementById('menu')
  assert(b.click('a[href="/updates"]'))
  let { tally, url } = await b.swapped
  assertEquals(url, 'https://y.test/updates')
  assertEquals(b.doc.querySelector('h1')?.textContent, 'Updates')
  assert(b.doc.getElementById('menu') == menu)
  assertEquals(b.entries.map((e) => e.path), ['/updates'])
  assertEquals(b.loaded, [])
  assertEquals(b.left(), 1)
  assertEquals(tally.made, 0, 'the heading is the same node, its words changed')
})

test('a layer the address opened closes when its page is left', async () => {
  let b = browsing(site, '/apps#menu')
  b.click('a[href="/updates"]')
  await b.swapped
  assertEquals(b.loaded, ['#'])
  assertEquals(b.entries.map((e) => e.path), ['/updates'])
})

test('a link the navigator cannot swap in is followed as a link', async () => {
  let b = browsing({
    ...site,
    '/apps': framed('apps', '<a id="x" href="/home">Home</a>'),
  })
  await b.go(new URL('https://y.test/home'))
  await b.go(new URL('https://y.test/nowhere'))
  assertEquals(b.loaded, ['https://y.test/home', 'https://y.test/nowhere'])
  assertEquals(b.left(), 0)
})

test('a swap that fails loads the page as a document', async () => {
  let b = browsing(site)
  b.doc.addEventListener(LEAVE, () => {
    throw new Error('a script could not let go')
  })
  let reported: unknown[] = []
  let was = globalThis.reportError
  globalThis.reportError = (e: unknown) => void reported.push(e)
  try {
    await b.go(new URL('https://y.test/updates'))
  } finally {
    globalThis.reportError = was
  }
  assertEquals(b.loaded, ['https://y.test/updates'])
  assertEquals(reported.length, 1)
})

test('a click the browser owns is left to it', () => {
  let b = browsing({
    ...site,
    '/apps': framed(
      'apps',
      '<a id="hash" href="#menu">Menu</a><a id="close" href="#">Close</a><a id="new" href="/updates" target="_blank">New</a>' +
        '<a id="far" href="https://elsewhere.test/">Far</a>',
    ),
  })
  assertEquals(
    ['#hash', '#close', '#new', '#far'].map((s) => b.click(s)),
    [false, false, false, false],
  )
  assertEquals(b.click('a[href="/updates"]', { metaKey: true }), false)
  assertEquals(b.fetched, [])
})

test('a page holding a script that stays is left by loading the next', () => {
  let b = browsing({
    ...site,
    '/apps': framed(
      'apps',
      '<p>chat</p>',
      '<script data-stays>talk()</script>',
    ),
  })
  b.click('a[href="/updates"]')
  assertEquals(b.loaded, ['https://y.test/updates'])
  assertEquals(b.fetched, [])
})

test('Back swaps the page it comes to without a new history entry', async () => {
  let b = browsing(site, '/updates')
  b.back('/apps')
  await b.swapped
  assertEquals(b.doc.querySelector('h1')?.textContent, 'Apps')
  assertEquals(b.entries, [])
})

test('a page touched ahead draws in the click, then, its answer asking, its opened answer lays over it where it changed', async () => {
  let pages = { ...site }
  let b = browsing(pages)
  b.again.add('/updates')
  b.press('touchstart', 'a[href="/updates"]')
  await settled()
  assertEquals(b.fetched, ['https://y.test/updates prefetch'])
  pages['/updates'] = framed('updates', '<h1>Updates</h1><p>read</p>')
  b.click('a[href="/updates"]')
  await settled()
  assertEquals(b.drawn.map((d) => [d.from, d.phases.wait]), [
    ['held', 0],
    ['fresh', 0],
  ])
  assertEquals(b.fetched.at(-1), 'https://y.test/updates')
  assertEquals(b.doc.querySelector('p')?.textContent, 'read')
  assertEquals(b.entries.map((e) => e.path), ['/updates'])
})

test('a page opened before draws at once, and is asked for again once it is old', async () => {
  let b = browsing(site)
  await b.go(new URL('https://y.test/updates'))
  await b.go(new URL('https://y.test/apps'))
  await b.go(new URL('https://y.test/updates'))
  assertEquals(
    b.fetched.length,
    2,
    'the page opened just now is not asked again',
  )
  b.tick(FRESH)
  await b.go(new URL('https://y.test/apps'))
  await settled()
  assertEquals(b.drawn.map((d) => d.from), ['fetch', 'fetch', 'held', 'held'])
  assertEquals(
    b.fetched.length,
    3,
    'asked again, and the same page laid over nothing',
  )
})

test('pressing a link to a page held long ago draws it at once, and asks for it after', async () => {
  let b = browsing(site)
  await b.go(new URL('https://y.test/updates'))
  await b.go(new URL('https://y.test/apps'))
  b.tick(FRESH)
  b.press('mousedown', 'a[href="/updates"]')
  assertEquals(b.fetched.length, 2, 'the press asks for nothing held')
  b.click('a[href="/updates"]')
  await settled()
  assertEquals(b.drawn.at(-1)!.from, 'held')
  assertEquals(b.drawn.at(-1)!.phases.wait, 0)
  assertEquals(b.fetched.length, 3)
})

test('a pointer that moves on before its page comes lets it go, and one look ahead stands at a time', async () => {
  let b = browsing(site)
  b.slow()
  b.press('mousedown', 'a[href="/updates"]')
  b.press('mousedown', 'img')
  assertEquals(b.stopped, ['https://y.test/updates'], 'another look ahead')
  let out = new (b.doc.defaultView as unknown as typeof globalThis).Event(
    'mouseout',
    { bubbles: true },
  )
  b.doc.querySelector('a[href="/updates"]')!.dispatchEvent(out)
  assertEquals(b.stopped, ['https://y.test/updates'], 'not its own')
  b.doc.querySelector('a[href="/apps"]')!.dispatchEvent(out)
  assertEquals(b.stopped, ['https://y.test/updates', 'https://y.test/apps'])
  await b.answer()
  b.click('a[href="/updates"]')
  await b.answer()
  assertEquals(b.drawn.map((d) => d.from), ['fetch'])
})

test('a page looked ahead at and opened soon after is asked for once, unless its answer asks again', async () => {
  let b = browsing(site)
  b.again.add('/apps')
  b.press('touchstart', 'a[href="/updates"]')
  await settled()
  b.click('a[href="/updates"]')
  await settled()
  b.press('touchstart', 'a[href="/apps"]')
  await settled()
  b.click('a[href="/apps"]')
  await settled()
  assertEquals(b.fetched, [
    'https://y.test/updates prefetch',
    'https://y.test/apps prefetch',
    'https://y.test/apps',
  ])
})

test('a click on a page not yet held shows itself at once: its link the current one, the content waiting', async () => {
  let b = browsing(site)
  b.slow()
  let gone = 0
  b.doc.addEventListener(GOING, () => gone++)
  b.click('a[href="/updates"]')
  assertEquals(gone, 1)
  assertEquals(
    b.doc.querySelector('[aria-current="page"]')?.getAttribute('href'),
    '/updates',
  )
  assertEquals(
    b.doc.getElementById('content')?.getAttribute('aria-busy'),
    'true',
  )
  await b.answer()
  assertEquals(
    b.doc.getElementById('content')?.hasAttribute('aria-busy'),
    false,
  )
  assertEquals(b.doc.querySelector('h1')?.textContent, 'Updates')
})

test('a click from an open menu on a page not yet held closes the menu and names the page in its first frame', async () => {
  let page = (here: string, title: string) =>
    framed(here, `<h1>${here}</h1>`).replace(
      '<nav id="menu">',
      `<b ${TITLE}>${title}</b><nav id="menu">`,
    ).replace('href="/updates"', `href="/updates" ${NAMES}="Updates"`)
  let b = browsing(
    { '/apps': page('apps', 'Apps'), '/updates': page('updates', 'Updates') },
    '/apps#menu',
  )
  b.slow()
  b.click('a[href="/updates"]')
  assertEquals(b.loaded, ['#'])
  assertEquals(b.doc.querySelector(`[${TITLE}]`)?.textContent, 'Updates')
  await b.answer()
  assertEquals(b.loaded, ['#'], 'the menu closes once')
  assertEquals(b.doc.querySelector('h1')?.textContent, 'updates')
})

test('a touch the browser takes for a scroll lets go of the page it looked ahead at', () => {
  let b = browsing(site)
  b.slow()
  b.press('touchstart', 'a[href="/updates"]')
  b.press('pointercancel', 'a[href="/updates"]')
  assertEquals(b.stopped, ['https://y.test/updates'])
})

test('sending a form makes every page held old: drawn at once, then asked for again', async () => {
  let b = browsing(site)
  b.press('mousedown', 'a[href="/updates"]')
  await settled()
  b.press('submit', 'nav')
  await b.go(new URL('https://y.test/updates'))
  await settled()
  assertEquals(b.drawn.map((d) => d.from), ['held'])
  assertEquals(b.fetched, [
    'https://y.test/updates prefetch',
    'https://y.test/updates',
  ])
})

test('a page that draws the address itself is drawn in place: nothing fetched, its scripts run again, the address moved', async () => {
  let b = browsing({
    '/apps': framed('apps', '<h1>Apps</h1><script>go()</script>'),
  })
  let written = b.doc.querySelector('script:not([src])')
  let left = b.left()
  b.doc.addEventListener(DRAW, (e) => {
    let asked = (e as CustomEvent<Drawing>).detail
    if (asked.to.pathname != '/updates') return
    asked.draw = () => b.doc.querySelector('h1')!.textContent = 'Updates'
  })
  b.click('a[href="/updates"]')
  await settled()
  assertEquals(b.fetched, [])
  assertEquals(b.doc.querySelector('h1')?.textContent, 'Updates')
  assert(!written?.isConnected, 'the written script is run again, anew')
  assertEquals(b.doc.querySelector('script:not([src])')?.textContent, 'go()')
  assertEquals(b.left(), left + 1, 'the page before heard it leave')
  assertEquals(b.entries.map((e) => e.path), ['/updates'])
  assertEquals(b.drawn.map((d) => [d.from, d.phases.wait]), [['drawn', 0]])
  b.back('/apps')
  await settled()
  assertEquals(
    b.fetched,
    ['https://y.test/apps'],
    'Back to a page it does not draw',
  )
})

test('a script binds what each page brings once, and lets go when its page leaves', () => {
  let doc = parse(framed('apps', '<b class="x">1</b>'))
  let seen: string[] = []
  arrived('.x', (e) => seen.push(e.textContent!), doc)
  let signal = leaving(doc)
  morph(
    doc.body,
    parse(framed('apps', '<b class="x">1</b><b class="x">2</b>')).body,
  )
  let view = doc.defaultView as unknown as typeof globalThis
  doc.dispatchEvent(new view.Event(LEAVE))
  doc.dispatchEvent(new view.Event(PAGE))
  assertEquals(seen, ['1', '2'])
  assert(signal.aborted)
})
