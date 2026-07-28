// Shared navigation runs in two hosts. The browser has a whole document; the
// TUI installs a FAKE one (tui/dom.ts) carrying only what preact reaches for
// — createElement, createTextNode, activeElement. So navigation startup
// cannot object-guard alone: `document?.querySelectorAll(…)` passes the guard
// and then throws on the missing member, which is how the TUI lost its boot.
import { assertEquals } from '@std/assert'
import { wire } from './nav.tsx'

Deno.test('nav starts against a document missing browser-only methods', () => {
  wire({}) // the TUI's shape: the object is there, the members are not
  wire(undefined) // and a host with no document at all
})

Deno.test('nav delegates ref clicks wherever the host can listen', () => {
  let heard: string[] = []
  wire({ addEventListener: (t) => heard.push(t) })
  assertEquals(heard, ['click'])
})
