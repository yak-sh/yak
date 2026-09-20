// Shared navigation runs in two hosts. The browser has a whole document; the
// TUI installs a FAKE one (tui/dom.ts) carrying only what preact reaches for
// — createElement, createTextNode, activeElement. So navigation startup
// cannot object-guard alone: `document?.querySelectorAll(…)` passes the guard
// and then throws on the missing member, which is how the TUI lost its boot.
import { parseHTML } from 'linkedom'
import { assertEquals } from '@std/assert'
import { cache, census } from '../live.ts'
import { menu, wire } from './nav.tsx'

Deno.test('nav starts against a document missing browser-only methods', () => {
  wire({}) // the TUI's shape: the object is there, the members are not
  wire(undefined) // and a host with no document at all
})

Deno.test('nav delegates entity-link gestures wherever the host can listen', () => {
  let heard: string[] = []
  wire({ addEventListener: (t) => heard.push(t) })
  assertEquals(heard, ['click', 'contextmenu'])
})

Deno.test('a native entity anchor opens its target menu', () => {
  let handlers: Record<string, (ev: MouseEvent) => void> = {}
  wire({ addEventListener: (t, fn) => (handlers[t] = fn) })
  let { document } = parseHTML('<a href="/T-7"><span id="target"></span></a>')
  let prevented = false
  let stopped = false
  cache.value = {
    task: { entity: { eid: 'task', num: 7 } },
  }
  census.value = ['task']

  try {
    handlers.contextmenu({
      target: document.querySelector('#target'),
      clientX: 12,
      clientY: 34,
      preventDefault: () => (prevented = true),
      stopPropagation: () => (stopped = true),
    } as unknown as MouseEvent)
    assertEquals([prevented, stopped], [true, true])
    assertEquals(menu.value?.eid, 'task')
  } finally {
    menu.value = null
    cache.value = {}
    census.value = []
  }
})
