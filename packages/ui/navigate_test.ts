import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { DOMParser, parseHTML } from 'linkedom'
import type { HistoryEntry } from './history.ts'
import {
  arrived,
  LEAVE,
  leaving,
  morph,
  PAGE,
  start,
  swap,
  type Swapped,
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
  let page = (body: string) =>
    parse(
      framed(
        'updates',
        body,
        '<script src="/b.js"></script><script>go()</script>',
      ),
    )
  swap(doc, page('<p>b</p>'), ran, run, 'https://y.test/updates')
  swap(doc, parse(framed('apps', '<p>a</p>')), ran, run, 'https://y.test/apps')
  swap(doc, page('<p>c</p>'), ran, run, 'https://y.test/updates')
  assertEquals(runs, ['/b.js', 'go()', 'go()'])
  assertEquals(doc.title, 'updates')
  assert(style.parentNode == doc.head, 'what a script put in the head stays')
})

// A window over a page at `path`, its fetches answered from `pages`.
let browsing = (pages: Record<string, string>, path = '/apps') => {
  let { document } = parseHTML(pages[path])
  let doc = document as unknown as Document
  let at = new URL(path, 'https://y.test')
  let loaded: string[] = []
  let fetched: string[] = []
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
    assign: (to: string) => void loaded.push(to),
    replace: (to: string) => void loaded.push(to),
  }
  let win = {
    document: doc,
    location,
    addEventListener: (type: string, fn: EventListener) =>
      doc.addEventListener(type, fn),
    fetch: (url: string) => {
      fetched.push(url)
      let to = new URL(url)
      let html = pages[to.pathname]
      return Promise.resolve(
        new Response(html ?? 'gone', {
          headers: { 'content-type': html ? 'text/html' : 'text/plain' },
        }),
      )
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
  let left = 0
  doc.addEventListener(LEAVE, () => left++)
  let go = start(win, history, () => 0)
  let view = doc.defaultView as unknown as typeof globalThis
  let click = (selector: string, init: MouseEventInit = {}) => {
    let e = new view.Event('click', { bubbles: true, cancelable: true })
    Object.assign(e, init)
    doc.querySelector(selector)!.dispatchEvent(e)
    return e.defaultPrevented
  }
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
    click,
    back,
    go,
    left: () => left,
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

test('a click the browser owns is left to it', () => {
  let b = browsing({
    ...site,
    '/apps': framed(
      'apps',
      '<a id="hash" href="#menu">Menu</a><a id="new" href="/updates" target="_blank">New</a>' +
        '<a id="far" href="https://elsewhere.test/">Far</a>',
    ),
  })
  assertEquals(
    ['#hash', '#new', '#far'].map((s) => b.click(s)),
    [false, false, false],
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
