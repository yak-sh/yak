// A peek belongs to its one opener without making every link reactive.
import { effect } from '@preact/signals'
import { parseHTML } from 'linkedom'
import { assertEquals, assertStrictEquals } from '@std/assert'
import { peek as shellPeek } from '../live.ts'
import { type Ent } from '../types.ts'
import { clickProps, openAt, peek } from './nav.tsx'

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
