// A local page environment for the served release script. No network or live store.

let code = await Deno.readTextFile(
  new URL('./public/release.js', import.meta.url),
)
export let tick = async () => {
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
export let browser = (prevent = false) => {
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
