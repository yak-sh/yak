import { assertEquals } from '@std/assert'
import { h } from 'preact'
import type { Key } from './input.ts'
import { Scroll, scrolled } from './Scroll.ts'
import { mount } from './harness.ts'

let v = { total: 100, height: 10 }

// key at offset → the offset it moves to (null: not a scroll key at all)
let table: [Key, number, number | null][] = [
  [{ name: 'down' }, 0, 1],
  [{ name: 'up' }, 5, 4],
  [{ name: 'up' }, 0, 0], // the top is the top
  [{ name: 'wheeldown' }, 0, 3],
  [{ name: 'wheelup' }, 10, 7],
  [{ name: 'pagedown' }, 0, 9], // a page keeps one line of context
  [{ name: 'pageup' }, 50, 41],
  [{ name: 'pagedown' }, 88, 90], // clamped to the last screenful
  [{ name: 'end', ctrl: true }, 0, 90],
  [{ name: 'home', ctrl: true }, 50, 0],
  [{ name: 'end' }, 50, null], // a plain end belongs to whatever is editing
  [{ name: 'char', text: 'j' }, 0, null],
]

Deno.test('every scroll key is one row of a table', () => {
  for (let [key, top, want] of table) {
    assertEquals(scrolled(top, key, v), want, `${key.name}@${top}`)
  }
})

Deno.test('a short region never scrolls', () => {
  assertEquals(scrolled(0, { name: 'pagedown' }, { total: 3, height: 10 }), 0)
})

Deno.test('the window follows new content, and holds still once scrolled', async () => {
  let lines = Array.from({ length: 30 }, (_, i) => `line ${i}`)
  let App = () =>
    h(
      Scroll,
      { id: 'log', grow: '1' },
      ...lines.map((l, i) => h('div', { key: i }, l)),
    )
  let ui = await mount(App, 20, 4)
  assertEquals(ui.text().split('\n')[3], 'line 29') // pinned to the bottom
  await ui.send('\x1b[5~') // page up: stop following
  assertEquals(ui.text().split('\n')[0], 'line 23')
  await ui.send('\x1b[6~') // and back down again, following once more
  assertEquals(ui.text().split('\n')[3], 'line 29')
  ui.free()
})
