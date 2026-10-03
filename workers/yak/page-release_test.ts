import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'

let code = await Deno.readTextFile(
  new URL('./public/release.js', import.meta.url),
)
let tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
type Release = { version: number; reload?: string }
type Frame = { data?: string; persisted?: boolean }
type Element = {
  children: Element[]
  style: Record<string, string>
  textContent: string
  setAttribute(): void
  addEventListener(n: string, fn: () => void): void
  append(...kids: Element[]): void
  remove(): void
  click(): void
}
class ReleaseEvent {
  constructor(
    public type: string,
    public options: { detail: Release; cancelable: boolean },
  ) {}
}
let browser = (prevent = false) => {
  let listeners: Record<string, ((e: Frame) => void)[]> = {}
  let ears = (kind: string, fn: (e: Frame) => void) =>
    (listeners[kind] ??= []).push(fn)
  let nodes: Element[] = []
  let events: ReleaseEvent[] = []
  let asks: string[] = []
  let reloads = 0
  let time = 100000
  let result: Release = { version: 2, reload: 'optional' }
  let storage = new Map<string, string>()
  let node = (): Element => {
    let clicks: Record<string, () => void> = {}
    return {
      children: [],
      style: {},
      textContent: '',
      setAttribute() {},
      addEventListener: (n: string, fn: () => void) => clicks[n] = fn,
      append(...kids: Element[]) {
        this.children.push(...kids)
      },
      remove() {
        nodes.splice(nodes.indexOf(this), 1)
      },
      click: () => clicks.click?.(),
    }
  }
  class Socket {
    static OPEN = 1
    callbacks: Record<string, (e?: Frame) => void> = {}
    constructor(public url: string) {}
    addEventListener(n: string, fn: (e?: Frame) => void) {
      this.callbacks[n] = fn
    }
    fire(n: string, e?: Frame) {
      this.callbacks[n]?.(e)
    }
  }
  let document = {
    currentScript: {
      src: 'https://ada.yaks.app/cookbook/api/release.js',
      dataset: { version: '1' },
    },
    visibilityState: 'visible',
    body: { prepend: (n: Element) => nodes.unshift(n) },
    createElement: node,
    addEventListener: ears,
  }
  let world = {
    document,
    URL,
    Number,
    Proxy,
    Reflect,
    JSON,
    Infinity,
    Date: { now: () => time },
    location: {
      href: 'https://ada.yaks.app/cookbook/',
      reload: () => reloads++,
    },
    sessionStorage: {
      getItem: (k: string) => storage.get(k),
      setItem: (k: string, v: string) => storage.set(k, v),
    },
    WebSocket: Socket,
    fetch: (url: URL) => {
      asks.push(String(url))
      return Promise.resolve({ ok: true, json: () => Promise.resolve(result) })
    },
    CustomEvent: ReleaseEvent,
    dispatchEvent: (e: ReleaseEvent) => {
      events.push(e)
      return !prevent
    },
    addEventListener: ears,
  }
  Object.assign(world, { globalThis: world })
  new Function('world', `with (world) { ${code} }`)(world)
  return {
    world,
    document,
    asks,
    nodes,
    events,
    result: (r: Release) => result = r,
    time: (n: number) => time = n,
    fire: (n: string, e = {}) => listeners[n]?.forEach((fn) => fn(e)),
    reloads: () => reloads,
  }
}

test('page release watches only own sockets, forwards frames untouched, and never reloads without a click', async () => {
  let b = browser()
  let other = new b.world.WebSocket('wss://ada.yaks.app/other/api/ws')
  other.fire('message', { data: '{"release":{"version":2}}' })
  await tick()
  assertEquals(b.asks.length, 0)
  let socket = new b.world.WebSocket('wss://ada.yaks.app/cookbook/api/ws')
  assertEquals(b.world.WebSocket.OPEN, 1)
  let frame = { data: '{"pos":{"x":1}}' }
  socket.fire('message', frame)
  assertEquals(frame.data, '{"pos":{"x":1}}')
  assertEquals(b.asks.length, 0)
  socket.fire('message', { data: '{"release":{"version":2}}' })
  await tick()
  assertEquals(b.asks, ['https://ada.yaks.app/cookbook/api/release?version=1'])
  assertEquals(b.events[0].options, {
    detail: { version: 2, reload: 'optional' },
    cancelable: true,
  })
  assertEquals(
    b.nodes[0].children[0].textContent,
    'A new version of this app is out',
  )
  assertEquals(b.reloads(), 0)
  b.nodes[0].children[2].click()
  assertEquals(b.nodes.length, 0)
  socket.fire('open')
  await tick()
  assertEquals(b.events.length, 1)
  b.result({ version: 3, reload: 'required' })
  socket.fire('message', { data: '{"release":{"version":3}}' })
  await tick()
  assertEquals(b.nodes[0].children.length, 2)
  assertEquals(
    b.nodes[0].children[0].textContent,
    'This app has changed. Reload to keep using it',
  )
  assertEquals(b.reloads(), 0)
  b.nodes[0].children[1].click()
  assertEquals(b.reloads(), 1)
})

test('canceling yak-release replaces the default; returning to view is throttled with no background polling', async () => {
  let b = browser(true)
  b.fire('visibilitychange')
  await tick()
  assertEquals(b.events.length, 1)
  assertEquals(b.nodes.length, 0)
  b.fire('pageshow', { persisted: true })
  b.fire('visibilitychange')
  await tick()
  assertEquals(b.asks.length, 1)
  b.time(160000)
  b.document.visibilityState = 'hidden'
  b.fire('visibilitychange')
  await tick()
  assertEquals(b.asks.length, 1)
  b.document.visibilityState = 'visible'
  b.result({ version: 3 })
  b.fire('pageshow', { persisted: true })
  await tick()
  assertEquals(b.asks.length, 2)
  assertEquals(b.events.length, 1)
  b.time(220000)
  b.result({ version: 4, reload: 'required' })
  b.fire('visibilitychange')
  await tick()
  assertEquals(b.events.length, 2)
  assertEquals(b.nodes.length, 0)
  assertEquals(b.reloads(), 0)
})
