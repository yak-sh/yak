// TUI-only renderers keep the shared scalar language in their visible labels.
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { type Ent } from '../types.ts'
import { config } from '../live.ts'
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
} from './App.tsx'
import { TElement } from './dom.ts'
import { pane } from './paint.ts'

// deno-lint-ignore no-explicit-any
let find = (node: any, cls: string): any => {
  if (Array.isArray(node)) {
    for (let child of node) {
      let hit = find(child, cls)
      if (hit) return hit
    }
  }
  if (!node?.props) return
  if (node.props.class == cls) return node
  return find(node.props.children, cls)
}

let eid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
let task = (body?: string): Ent => ({
  eid,
  num: 1,
  kind: 'task',
  doc: { eid, title: 'One', ...(body === undefined ? {} : { body }) },
  task: { eid, status: 'open', priority: 1.5 },
  refs: [],
  kids: [],
})
let full = (e: Ent) =>
  overrides.find((r) => r.view == 'Full' && r.match(e))!.Render({ e })

Deno.test('the TUI task heading formats priority through its type', () => {
  assertEquals(find(full(task('')), 'Task_Prio').props.children, 'P1.5')
})

// A body this client was never shipped is not an empty one: the terminal
// paints the wait too, rather than a task that looks like it has no body.
Deno.test('the TUI paints the wait for a body it does not have', () => {
  let prior = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error('no server')) // pending() asks
  config.host = '127.0.0.1:0' // and nothing it queues may reach a real one
  try {
    assertEquals(find(full(task('')), 'Task_Body'), undefined)
    assertEquals(find(full(task(undefined)), 'Task_Body').props.children, '…')
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
    'j / k browse',
    'l / Enter enter',
  ])
  render(null, target)
})
