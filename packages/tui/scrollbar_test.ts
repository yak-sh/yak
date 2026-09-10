import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import { scrollbar } from './scrollbar.ts'
import { VirtualList, VirtualWindow } from './VirtualList.ts'
import { Scroll } from './Scroll.ts'
import { mount } from './harness.ts'
import { theme as sheet } from './theme.ts'

Deno.test('scrollbar has one column, three thumb rows and dims only when snapped', () => {
  for (let bottom of [false, true]) {
    let lines = scrollbar(
      [],
      8,
      { total: 100, top: 0, height: 7, bottom },
      sheet,
    )
    assertEquals(
      lines.map((l) => l.at(-1)!.text).join(''),
      bottom ? '││││███' : '███││││',
    )
    assertEquals(
      lines.map((l) => l.reduce((n, s) => n + s.text.length, 0)),
      Array(7).fill(8),
    )
    assertEquals(lines[0].at(-1)!.style.dim === true, bottom)
  }
  let middle = scrollbar([], 8, {
    total: 100,
    top: 47,
    height: 7,
    bottom: false,
  }, sheet)
  assertEquals(middle.map((l) => l.at(-1)!.text).join(''), '││███││')
  for (let height of [0, 1, 2]) {
    assertEquals(
      scrollbar([], 2, { total: 100, top: 50, height, bottom: false }, sheet)
        .length,
      height,
    )
  }
  assertEquals(
    scrollbar([], 1, { total: 100, top: 50, height: 3, bottom: false }, sheet),
    [],
  )
})

Deno.test('scrollbar estimates never measure unseen history or move the anchor', () => {
  let count = 0
  let state = new VirtualWindow<{ id: string }>(
    (_item, width) => {
      count++
      assertEquals(width, 9)
      return [[{ text: 'hello', style: {} }]]
    },
    (item) => item.id,
    true,
  )
  state.update(Array.from({ length: 10000 }, (_, i) => ({ id: String(i) })))
  let lines = state.layout(9, 10)
  let anchor = { ...state.anchor }
  let before = count
  for (let i = 0; i < 10; i++) scrollbar(lines, 10, state.position(9), sheet)
  assertEquals(count, before)
  assert(before <= 11)
  assertEquals(state.anchor, anchor)
  assertEquals(state.position(9).total, 10000)
  state.key({ name: 'pageup' })
  state.layout(9, 10)
  assertEquals(state.position(9).bottom, false)
})

Deno.test('VirtualList and Scroll reserve a scrollbar column and paint a thumb', async () => {
  for (let virtual of [false, true]) {
    let ui = await mount(
      () =>
        virtual
          ? h(VirtualList, {
            items: [{ id: 'a' }],
            renderItem: () => h('div', { wrap: '1' }, 'abcdefghij'),
            scrollbar: true,
            follow: true,
          })
          : h(
            Scroll,
            { id: 'bar', scrollbar: true },
            h('div', { wrap: '1' }, 'abcdefghij'),
          ),
      6,
      4,
    )
    try {
      assert(ui.text().includes('abcde'), ui.text())
      assert(ui.text().includes('fghij'), ui.text())
      assert(ui.text().includes('█'), ui.text())
      await ui.resize(1, 2)
      assert(!ui.text().includes('█'), ui.text())
    } finally {
      ui.free()
    }
  }
})

Deno.test('empty and short scroll ranges have a clamped thumb', () => {
  for (let total of [0, 1, 2]) {
    let bar = scrollbar(
      [],
      5,
      { total, height: 2, top: 0, bottom: true },
      sheet,
    )
    assertEquals(bar.map((line) => line.at(-1)!.text), ['█', '█'])
  }
})
