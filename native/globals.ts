// What @yaks/tui's in-memory DOM reaches for on the global object, which a
// browser and Deno have and React Native's Hermes may not: `Event`, and a
// window to bubble events to. Imported before anything else (index.ts).
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
