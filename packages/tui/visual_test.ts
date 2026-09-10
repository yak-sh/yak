import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import { mount } from './harness.ts'
import { Textarea } from './Textarea.ts'
import { VirtualList } from './VirtualList.ts'
import { osc52 } from './paint.ts'
import {
  emptyVisual,
  selectedText,
  setClipboard,
  useTextSurface,
  useVisualController,
  visualLines,
} from './visual.ts'

Deno.test('visual surfaces cycle, select exact source, yank explicitly, cancel without editing', async () => {
  let state = emptyVisual(), copied = '', edits = 0
  setClipboard((s) => copied = s)
  let ui = await mount(
    () => {
      useVisualController(() => state, (s) => state = s)
      useTextSurface({
        id: 'other',
        snapshot: () => ({ text: 'abc def\nghi' }),
        width: () => 4,
      })
      return h(
        'div',
        null,
        h('div', { id: 'other' }, 'abc def'),
        h(Textarea, {
          value: { text: 'hello world', at: 0 },
          onEdit: () => edits++,
        }),
      )
    },
    16,
    10,
  )
  try {
    await ui.send('vy')
    assertEquals(edits, 1)
    await ui.send('\x1bv')
    assert(state.surface)
    // Visit the explicit generic surface independent of registration order.
    if (state.surface != 'other') await ui.send('\t')
    await ui.send('lll')
    assertEquals(selectedText(state), 'abc ')
    assert(visualLines('other', 4, 4)!.flat().some((s) => s.style.inverse))
    await ui.send('y')
    assertEquals(copied, 'abc ')
    assertEquals(state.yank, 'abc ')
    assertEquals(state.surface, '')
    assertEquals(edits, 1)
    await ui.send('\x1bv')
    if (state.surface != 'input') await ui.send('\t')
    await ui.send('llllll')
    assertEquals(selectedText(state), 'hello w')
    await ui.send('\x1b')
    assertEquals(state.surface, '')
    assertEquals(copied, 'abc ')
  } finally {
    ui.free()
    setClipboard(() => {})
  }
})

Deno.test('virtual source selection visits one item and never renders history', async () => {
  let state = emptyVisual(), renders = 0, reads = 0
  let items = Array.from({ length: 10000 }, (_, i) => ({ id: String(i) }))
  let ui = await mount(
    () => {
      useVisualController(() => state, (s) => state = s)
      return h(VirtualList, {
        id: 'history',
        items,
        follow: true,
        textOf: (item: { id: string }) => {
          reads++
          return 'source ' + item.id
        },
        renderItem: (item: { id: string }) => {
          renders++
          return h('div', null, item.id)
        },
      })
    },
    20,
    5,
  )
  try {
    let before = renders
    await ui.send('\x1bv')
    assertEquals(reads, 1)
    await ui.send('[lll')
    assertEquals(reads, 2)
    assertEquals(renders, before)
    await ui.send('y')
    assertEquals(state.yank, state.text.slice(0, 4))
  } finally {
    ui.free()
  }
})

Deno.test('OSC52 encodes UTF8 and controls only as base64; visual output strips controls', () => {
  let text = 'a\x1b]52;c;evil\x07é'
  let seq = osc52(text)
  assertEquals(
    seq,
    '\x1b]52;c;' +
      btoa(String.fromCharCode(...new TextEncoder().encode(text))) + '\x07',
  )
  assertEquals(seq.split('\x1b').length - 1, 1)
})

Deno.test('wrapped selection keeps hard newlines and redraw never emits source control bytes', async () => {
  let state = emptyVisual()
  let ui = await mount(
    () => {
      useVisualController(() => state, (s) => state = s)
      useTextSurface({
        id: 'safe',
        snapshot: () => ({ text: 'ab cd\nef\x1b[31m' }),
        width: () => 4,
      })
      return h('div', { id: 'safe' }, 'safe')
    },
    4,
    5,
  )
  try {
    await ui.send('\x1bvllllll')
    assertEquals(selectedText(state), 'ab cd\ne')
    await ui.send('hhh')
    assertEquals(selectedText(state), 'ab c')
    let painted = visualLines('safe', 4, 5)!.flat().map((s) => s.text).join('')
    assert(!painted.includes('\x1b'))
    await ui.resize(3, 2)
    assertEquals(state.anchor, 0)
    assertEquals(state.at, 3)
    assertEquals(visualLines('safe', 3, 2)!.length <= 2, true)
  } finally {
    ui.free()
  }
})
