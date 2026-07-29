// A peek belongs to its one opener without making every link reactive.
import { effect } from '@preact/signals'
import { parseHTML } from 'linkedom'
import { assertEquals, assertStrictEquals } from '@std/assert'
import { peek as shellPeek } from '../live.ts'
import { type Ent } from '../types.ts'
import { cardMenuAt, clickProps, menu, openAt, peek } from './nav.tsx'

let e: Ent = {
  eid: 'task',
  num: 7,
  kind: 'task',
  refs: [],
  kids: [],
}

let from = () => peek.value?.from

Deno.test('peek state lives above the hot-swap boundary', () => {
  assertStrictEquals(peek, shellPeek)
})

Deno.test('only the same opener toggles its peek closed', () => {
  let priorMedia = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
  let priorElement = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  let { document, window } = parseHTML('<a id="a"></a><a id="b"></a>')
  Object.defineProperties(globalThis, {
    matchMedia: {
      value: () => ({ matches: true }),
      configurable: true,
    },
    Element: { value: window.Element, configurable: true },
  })
  let a = document.querySelector('#a')!
  let b = document.querySelector('#b')!
  let ev = (from: Element) =>
    ({
      currentTarget: from,
      target: from,
      clientX: 12,
      clientY: 34,
    }) as unknown as MouseEvent

  try {
    peek.value = null
    openAt(e.eid, ev(a))
    assertEquals(from(), a)

    openAt(e.eid, ev(b))
    assertEquals(from(), b)

    openAt(e.eid, ev(b))
    assertEquals(peek.value, null)
  } finally {
    peek.value = null
    if (priorMedia) Object.defineProperty(globalThis, 'matchMedia', priorMedia)
    else delete (globalThis as { matchMedia?: unknown }).matchMedia
    if (priorElement) {
      Object.defineProperty(globalThis, 'Element', priorElement)
    } else delete (globalThis as { Element?: unknown }).Element
  }
})

Deno.test('the current peek id stays mounted for double-click navigation', () => {
  let priorMedia = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
  let priorElement = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  let { document, window } = parseHTML(
    '<a id="from"></a><div class="Peek"><a id="id"></a></div>',
  )
  Object.defineProperties(globalThis, {
    matchMedia: {
      value: () => ({ matches: true }),
      configurable: true,
    },
    Element: { value: window.Element, configurable: true },
  })
  let opener = document.querySelector('#from')!
  let id = document.querySelector('#id')!
  let ev = {
    currentTarget: id,
    target: id,
    clientX: 12,
    clientY: 34,
  } as unknown as MouseEvent

  try {
    peek.value = { eid: e.eid, x: 1, y: 2, from: opener }
    openAt(e.eid, ev)
    openAt(e.eid, ev)
    assertEquals(peek.value?.from, opener)
  } finally {
    peek.value = null
    if (priorMedia) Object.defineProperty(globalThis, 'matchMedia', priorMedia)
    else delete (globalThis as { matchMedia?: unknown }).matchMedia
    if (priorElement) {
      Object.defineProperty(globalThis, 'Element', priorElement)
    } else delete (globalThis as { Element?: unknown }).Element
  }
})

Deno.test('a card menu leaves nested links to the browser', () => {
  let priorElement = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  let { document, window } = parseHTML(
    '<div id="body"></div><a id="link"><span id="inside"></span></a>',
  )
  Object.defineProperty(globalThis, 'Element', {
    value: window.Element,
    configurable: true,
  })
  let event = (target: Element) => {
    let prevented = false
    let stopped = false
    return {
      target,
      clientX: 12,
      clientY: 34,
      preventDefault: () => (prevented = true),
      stopPropagation: () => (stopped = true),
      handled: () => [prevented, stopped],
    }
  }

  try {
    let body = event(document.querySelector('#body')!)
    cardMenuAt(e)(body as unknown as MouseEvent)
    assertEquals(body.handled(), [true, true])
    assertEquals(menu.value?.eid, e.eid)

    menu.value = null
    let link = event(document.querySelector('#inside')!)
    cardMenuAt(e)(link as unknown as MouseEvent)
    assertEquals(link.handled(), [false, false])
    assertEquals(menu.value, null)
  } finally {
    menu.value = null
    if (priorElement) {
      Object.defineProperty(globalThis, 'Element', priorElement)
    } else delete (globalThis as { Element?: unknown }).Element
  }
})

Deno.test('link props do not subscribe to peek state', () => {
  let runs = 0
  let stop = effect(() => {
    clickProps(e)
    runs++
  })
  peek.value = { eid: e.eid, x: 1, y: 2 }
  assertEquals(runs, 1)
  stop()
  peek.value = null
})
