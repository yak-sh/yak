// What the packages reach for that a browser and Deno have and React Native's
// Hermes may not: a URL that resolves an address against another as the WHATWG
// says (React Native's own mangles `?query` against a page), @yaks/tui's
// in-memory DOM's `Event` and a window to bubble events to, and ES2023's array
// methods (@yaks/vocab sorts with `toSorted`).
// Imported before anything else (index.ts), so a kit-built app's view, loaded
// later, finds them too.
import 'react-native-url-polyfill/auto'

let g = globalThis as Record<string, unknown>

// A global `dispatchEvent` takes only its own kind of event, so where the
// event is ours, so is the window it bubbles to.
let ours = typeof g.Event != 'function'

if (ours) {
  g.Event = class Event {
    type: string
    bubbles: boolean
    cancelable: boolean
    defaultPrevented = false
    cancelBubble = false
    constructor(type: string, o: EventInit = {}) {
      this.type = type
      this.bubbles = !!o.bubbles
      this.cancelable = !!o.cancelable
    }
    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true
    }
    stopPropagation() {
      this.cancelBubble = true
    }
  }
}

if (ours || typeof g.addEventListener != 'function') {
  let heard = new Map<string, Set<(e: Event) => void>>()
  g.addEventListener = (type: string, fn: (e: Event) => void) =>
    heard.set(type, (heard.get(type) ?? new Set()).add(fn))
  g.removeEventListener = (type: string, fn: (e: Event) => void) =>
    heard.get(type)?.delete(fn)
  g.dispatchEvent = (e: Event) => {
    for (let fn of heard.get(e.type) ?? []) fn(e)
    return !e.defaultPrevented
  }
}

// ES2023's arrays: the copying methods, and finding from the end. Each is
// defined only where the runtime lacks it, as the language defines it.
let arrays = Array.prototype as unknown as Record<string, unknown>
let lacking = {
  toSorted(this: unknown[], by?: (a: unknown, b: unknown) => number) {
    return [...this].sort(by)
  },
  toReversed(this: unknown[]) {
    return [...this].reverse()
  },
  toSpliced(
    this: unknown[],
    start: number,
    count?: number,
    ...items: unknown[]
  ) {
    let copy = [...this]
    arguments.length < 2
      ? copy.splice(start)
      : copy.splice(start, count ?? 0, ...items)
    return copy
  },
  with(this: unknown[], index: number, value: unknown) {
    let at = index < 0 ? this.length + index : index
    if (at < 0 || at >= this.length) throw new RangeError('Invalid index')
    let copy = [...this]
    copy[at] = value
    return copy
  },
  findLast(
    this: unknown[],
    fn: (v: unknown, i: number, a: unknown[]) => unknown,
  ) {
    for (let i = this.length - 1; i >= 0; i--) {
      if (fn(this[i], i, this)) return this[i]
    }
  },
  findLastIndex(
    this: unknown[],
    fn: (v: unknown, i: number, a: unknown[]) => unknown,
  ) {
    for (let i = this.length - 1; i >= 0; i--) {
      if (fn(this[i], i, this)) return i
    }
    return -1
  },
}
for (let [name, fn] of Object.entries(lacking)) {
  if (typeof arrays[name] != 'function') {
    Object.defineProperty(arrays, name, {
      value: fn,
      writable: true,
      configurable: true,
    })
  }
}
