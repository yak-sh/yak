// TUI-only renderers keep the shared scalar language in their visible labels.
import '../testing.ts' // learns the vocabulary
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { type Ent } from '../types.ts'
import { config as liveConfig, mode } from '../live.ts'
import { extend, resolve } from '../components/registry.ts'
import {
  fit,
  help,
  key,
  overrides,
  quit,
  spot,
  spots,
  TKeys,
  trail,
  TStatus,
} from './App.tsx'
import { TElement } from '@yaks/tui'
import { pane } from './paint.ts'

extend(overrides)

let eid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
let task = (body?: string): Ent => ({
  eid,
  num: 1,
  kind: 'task',
  doc: { eid, title: 'One', ...(body === undefined ? {} : { body }) },
  task: { eid },
  filed: { eid, priority: 1.5 },
  refs: [],
  kids: [],
})
// Mount the TUI's Full override through Preact — a renderer is a component,
// never a bare call — and read the painted terminal text back. The footer
// stands in for the app's pinned statusbar, which pane() pops off the bottom.
let paint = (e: Ent) => {
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  let r = resolve(e, 'Full')
  render(
    h('div', null, h(r.Render, { e }), h('footer', null, 'status')),
    target,
  )
  let out = pane(root).lines.flat().map((p) => p.text).join('\n')
  render(null, target)
  return out
}

Deno.test('the TUI task heading formats priority through its type', () => {
  assertEquals(paint(task('')).includes('P1.5'), true)
})

// A body this client was never shipped is not an empty one: the terminal
// paints the wait too, rather than a task that looks like it has no body.
Deno.test('the TUI paints the wait for a body it does not have', () => {
  let prior = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error('no server')) // pending() asks
  liveConfig.host = '127.0.0.1:0' // and nothing it queues may reach a real one
  try {
    assertEquals(paint(task('')).includes('…'), false)
    assertEquals(paint(task(undefined)).includes('…'), true)
  } finally {
    globalThis.fetch = prior
  }
})

Deno.test('j/k move the pane cursor, keyed by the entity we are in', () => {
  trail.value = []
  assertEquals(spot(), -1) // the board's cursor is over the query, not lines
  key('j')
  assertEquals(spots.value, {})

  trail.value = ['one']
  key('j')
  key('j')
  assertEquals(spot(), 2)
  key('k')
  assertEquals(spot(), 1)

  trail.value = ['one', 'two'] // a pane deeper starts at its own top
  assertEquals(spot(), 0)
  key('k')
  assertEquals(spot(), 0) // and k at the top stays there
  trail.value = ['one']
  assertEquals(spot(), 1) // stepping back returns to the line we left
})

Deno.test('a cursor the content shrank past comes back to the last line', () => {
  trail.value = ['one']
  spots.value = { one: 40 }
  fit(12)
  assertEquals(spot(), 11)
  fit(0)
  assertEquals(spot(), 0)
  trail.value = []
  fit(3) // nothing to fit at the board
  assertEquals(spot(), -1)
})

Deno.test('⇧⏎ builds a multi-line command shown on one row; ⏎ runs it', () => {
  trail.value = []
  mode.value = 'normal'
  key(':')
  assertEquals(mode.value, 'command')
  for (let c of 'task One') key(c)
  key('\n') // ⇧⏎ (input.decode maps the terminal's report to this): a newline
  for (let c of 'the body') key(c)
  assertEquals(mode.value, 'command') // a newline keeps typing, it doesn't submit

  // One painted row: the embedded newline shows as a glyph rather than
  // splitting the pane, and the buffer kept it (a command reads first line as
  // args, the rest as body). The dummy footer stands in for the pinned bar
  // pane() pops off the bottom, so TStatus's own line lands in `lines`.
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  render(h('div', null, h(TStatus, null), h('footer', null, 'x')), target)
  let lines = pane(root).lines.map((l) => l.map((s) => s.text).join(''))
    .filter(Boolean)
  render(null, target)
  assertEquals(lines, [':task One⏎the body█'])

  key('\x1b') // discard it here — the test writes nothing to a server
  assertEquals(mode.value, 'normal')
  key(':')
  key('\r') // ⏎ leaves command mode (submits)
  assertEquals(mode.value, 'normal')
})

Deno.test('question mark shows keybindings until they are dismissed', () => {
  help.value = false
  quit.value = false

  key('?')
  assertEquals(help.value, true)
  key('q')
  assertEquals({ help: help.value, quit: quit.value }, {
    help: false,
    quit: false,
  })

  key('?')
  key('\x1b')
  assertEquals(help.value, false)
})

Deno.test('the TUI keybinding card teaches its navigation keys', () => {
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  render(h('div', null, h(TKeys, null), h('footer', null, 'status')), target)
  let lines = pane(root).lines.map((line) => line.map((s) => s.text).join(''))
    .filter(Boolean)
  assertEquals(lines.slice(0, 4), [
    'Keybindings',
    '? show or close keybindings',
    'n open or close navigation',
    'j / k browse',
  ])
  render(null, target)
})
