// public/release.js on a page from a draft's preview link, in a linkedom page:
// no network, no browser, no live store.
import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'

let code = await Deno.readTextFile(
  new URL('./public/release.js', import.meta.url),
)
let AT = 'https://ada.yaks.app/cookbook/_preview/t/'

class Socket {
  static made: Socket[] = []
  ears: Record<string, (e?: { data?: string }) => void> = {}
  constructor(public url: URL) {
    Socket.made.push(this)
  }
  addEventListener(n: string, fn: (e?: { data?: string }) => void) {
    this.ears[n] = fn
  }
  fire(n: string, e?: { data?: string }) {
    this.ears[n]?.(e)
  }
}

// One page load at `page` under the link, holding `body`; `name` is what the
// window's name holds from the load before.
let load = (
  body: string,
  { draft = 'D', page = 'about/', name = '', cancel = false } = {},
) => {
  let { document, Event } = parseHTML(
    `<html><head><script data-yak-at="/cookbook/_preview/t/" data-yak-version="0"${
      draft ? ` data-yak-draft="${draft}"` : ''
    }></script></head><body>${body}</body></html>`,
  )
  Object.defineProperty(document, 'currentScript', {
    value: document.querySelector('script'),
  })
  Object.defineProperty(document, 'baseURI', { value: AT + page })
  Object.defineProperty(document, 'readyState', { value: 'complete' })
  Socket.made.length = 0
  let reloads = 0
  let events: { type: string; detail: unknown }[] = []
  let timers: (() => void)[] = []
  let scrolled: number[] = []
  let sandboxed = () => {
    throw new Error('The document is sandboxed')
  }
  let world: Record<string, unknown> = {
    document,
    URL,
    JSON,
    Map,
    Number,
    Proxy,
    Reflect,
    Infinity,
    Math,
    String,
    name,
    scrollX: 0,
    scrollY: 640,
    scrollTo: (x: number, y: number) => scrolled.push(x, y),
    location: { href: AT + page, reload: () => reloads++ },
    sessionStorage: {
      getItem: sandboxed,
      setItem: sandboxed,
      removeItem: sandboxed,
    },
    WebSocket: Socket,
    CustomEvent: class {
      constructor(
        public type: string,
        public init: { detail: unknown; cancelable: boolean },
      ) {}
      get detail() {
        return this.init.detail
      }
    },
    dispatchEvent: (e: { type: string; detail: unknown }) => {
      events.push(e)
      return !cancel
    },
    addEventListener: () => {},
    setTimeout: (fn: () => void) => timers.push(fn),
    fetch: () => Promise.reject(new Error('no network')),
  }
  world.globalThis = world
  new Function('world', `with (world) { ${code} }`)(world)
  let socket = Socket.made[0]
  let wrote = (
    files: { path: string; sha: string | null }[],
    to = 'D',
    draft: string | null = 'W',
  ) =>
    socket.fire('message', {
      data: JSON.stringify({
        draft: { app: 'A', link: to, draft, files, at: 'now' },
      }),
    })
  return {
    document,
    Event,
    world,
    socket,
    wrote,
    events,
    timers,
    scrolled,
    reloads: () => reloads,
    sockets: () => Socket.made.length,
  }
}

let sheets = (document: Document) =>
  [...document.querySelectorAll('link')].map((l) => l.getAttribute('href'))

test('a preview page swaps a stylesheet it links in place, removing the old one once the new has loaded', () => {
  let p = load('<link rel="stylesheet" href="../style.css"><p>Soup</p>')
  equal(String(p.socket.url), 'wss://ada.yaks.app/cookbook/_preview/t/api/ws')
  p.wrote([{ path: 'style.css', sha: 'abc' }])
  equal(p.events.map((e) => e.type), ['yak-draft'])
  equal(sheets(p.document), [
    '../style.css',
    `${AT}style.css?yak-draft=abc`,
  ])
  p.document.querySelectorAll('link')[1].dispatchEvent(new p.Event('load'))
  equal(sheets(p.document), [`${AT}style.css?yak-draft=abc`])
  p.wrote([{ path: 'style.css', sha: 'def' }])
  equal(sheets(p.document).at(-1), `${AT}style.css?yak-draft=def`)
  equal(p.reloads(), 0)
})

test('any other write reloads the page, keeping its scroll and typed fields in the window name a sandboxed page has', () => {
  let p = load(
    '<link rel="stylesheet" href="../style.css"><input id="title"><input type="checkbox" name="hot">',
  )
  let [title, hot] = p.document.querySelectorAll('input')
  title.value = 'Soup'
  hot.checked = true
  p.wrote([{ path: 'style.css', sha: 'abc' }, { path: 'main.js', sha: 'x' }])
  equal(p.reloads(), 1)
  let name = String(p.world.name)
  ok(name.startsWith('yak-draft:/cookbook/_preview/t/'), name)
  let next = load('<input id="title"><input type="checkbox" name="hot">', {
    name,
  })
  let [t, h] = next.document.querySelectorAll('input')
  equal([t.value, h.checked], ['Soup', true])
  equal(next.scrolled, [0, 640])
  equal(next.world.name, '')
  let deleted = load('<link rel="stylesheet" href="../style.css">')
  deleted.wrote([{ path: 'style.css', sha: null }])
  equal(deleted.reloads(), 1)
})

test("a page that cancels yak-draft takes the write itself, told where each file serves, and can still reload as the page would have; another link's writes and other packets are not its", () => {
  let p = load('<link rel="stylesheet" href="../style.css">', { cancel: true })
  p.wrote([{ path: 'index.html', sha: 'x' }])
  p.wrote([{ path: 'index.html', sha: 'x' }], 'other')
  p.socket.fire('message', { data: '{"release":{"version":2}}' })
  p.socket.fire('message', { data: '{"draft":' })
  equal(p.events.length, 1)
  equal(p.events[0].detail, {
    app: 'A',
    link: 'D',
    draft: 'W',
    files: [{ path: 'index.html', sha: 'x', url: `${AT}index.html` }],
    at: 'now',
  })
  equal([p.reloads(), sheets(p.document).length], [0, 1])
  let input = p.document.createElement('input')
  input.id = 'title'
  input.value = 'Soup'
  p.document.body.append(input)
  ;(p.events[0] as unknown as { reload: () => void }).reload()
  equal(p.reloads(), 1)
  let next = load('<input id="title">', { name: String(p.world.name) })
  equal(next.document.querySelector('input')!.value, 'Soup')
})

test("a release reloads the page to show what was released, and the next draft's writes are still its", () => {
  let p = load('<link rel="stylesheet" href="../style.css">')
  p.wrote([], 'D', null)
  equal(p.reloads(), 1)
  p.wrote([{ path: 'style.css', sha: 'abc' }], 'D', 'next')
  equal([p.reloads(), sheets(p.document).length], [1, 2])
})

test('a socket that drops comes back and reloads the page, since it may have missed a write', () => {
  let p = load('')
  p.socket.fire('open')
  equal(p.reloads(), 0)
  p.socket.fire('close')
  p.timers[0]()
  equal(p.sockets(), 2)
  Socket.made[1].fire('open')
  equal(p.reloads(), 1)
})

test('a released page opens no socket of its own and never follows a draft', () => {
  equal(load('', { draft: '' }).sockets(), 0)
})
