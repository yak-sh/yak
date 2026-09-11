import { assert, assertEquals } from '@std/assert'
import { VirtualList, VirtualWindow } from './VirtualList.ts'
import { h } from 'preact'
import { mount } from './harness.ts'

let items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: String(i), text: String(i) }))
let window = (follow = true) =>
  new VirtualWindow<{ id: string; text: string }>(
    (item, width) =>
      Array.from(
        { length: Math.ceil(item.text.length / width) },
        (
          _,
          i,
        ) => [{ text: item.text.slice(i * width, (i + 1) * width), style: {} }],
      ),
    (item) => item.text,
    follow,
  )
let text = (lines: ReturnType<ReturnType<typeof window>['layout']>) =>
  lines.map((l) => l.map((s) => s.text).join(''))

Deno.test('cold bottom open and resize only measure the viewport; warm paint measures nothing', () => {
  let v = window(), data = items(10000)
  v.update(data)
  assertEquals(text(v.layout(80, 10))[0], '9990')
  assertEquals(v.stats.measured, 10)
  v.layout(80, 10)
  assertEquals(v.stats.measured, 10)
  v.layout(40, 10)
  assertEquals(v.stats.measured, 20)
  v.layout(40, 6)
  assertEquals(text(v.layout(40, 6))[0], '9994')
  assertEquals(v.stats.measured, 20)
})

Deno.test('detached anchor survives append, reorder, resize and removal', () => {
  let v = window(), data = items(100)
  v.update(data)
  v.layout(80, 5)
  v.key({ name: 'pageup' })
  v.layout(80, 5)
  assertEquals(v.anchor, { id: '91', offset: 0 })
  v.update([...data, { id: 'new', text: 'new' }])
  v.layout(80, 3)
  assertEquals(v.anchor, { id: '91', offset: 0 })
  v.update([data[90], ...data.filter((x) => x.id != '90')])
  v.layout(1, 3)
  assertEquals(v.anchor, { id: '91', offset: 0 })
  v.update(data.filter((x) => x.id != '91'))
  v.layout(80, 5)
  assertEquals(v.anchor?.id, '92')
})

Deno.test('top start, local offset, growing tail and explicit end follow', () => {
  let v = window(false),
    data = [{ id: 'a', text: 'abcdef' }, { id: 'b', text: 'tail' }]
  v.update(data)
  assertEquals(text(v.layout(2, 2)), ['ab', 'cd'])
  v.key({ name: 'down' })
  v.layout(2, 2)
  assertEquals(v.anchor, { id: 'a', offset: 1 })
  v.layout(1, 2)
  assertEquals(v.anchor, { id: 'a', offset: 1 })
  v.key({ name: 'end', ctrl: true })
  assertEquals(text(v.layout(2, 2)), ['ta', 'il'])
  v.update([{ ...data[0] }, { id: 'b', text: 'tailgrow' }])
  assertEquals(text(v.layout(2, 2)), ['gr', 'ow'])
  v.key({ name: 'home', ctrl: true })
  assertEquals(text(v.layout(2, 2)), ['ab', 'cd'])
})

Deno.test('mounted virtual list renders only visible history and stays warm on key repaint', async () => {
  let count = 0
  let ui = await mount(
    () =>
      h(VirtualList<{ id: string; text: string }>, {
        items: items(10000),
        follow: true,
        renderItem: (item: { id: string; text: string }) => {
          count++
          return h('div', null, item.text)
        },
      }),
    40,
    8,
  )
  try {
    assert(ui.text().includes('9999'))
    assertEquals(count, 8)
    await ui.send('\x1b[5~')
    assert(ui.text().includes('9985'))
    assert(count <= 16)
    let parsed = count
    await ui.resize(30, 6)
    assertEquals(count, parsed)
  } finally {
    ui.free()
  }
})

Deno.test('exact end snap follows append, detached growing entries do not move anchor', () => {
  let v = window(false), data = items(10)
  v.update(data)
  v.layout(20, 3)
  for (let i = 0; i < 7; i++) v.key({ name: 'down' })
  v.layout(20, 3)
  assertEquals(v.follow, true)
  v.update(items(11))
  assertEquals(text(v.layout(20, 3)), ['8', '9', '10'])
  v.key({ name: 'pageup' })
  v.layout(20, 3)
  let anchor = v.anchor
  v.update(
    items(11).map((x) => x.id == '0' ? { ...x, text: 'x'.repeat(1000) } : x),
  )
  v.layout(1, 2)
  assertEquals(v.anchor, anchor)
})

Deno.test('visible edits and theme invalidate layout; bounded cache evicts old history', () => {
  let v = window(), data = items(10000)
  v.update(data)
  v.layout(80, 5, 'one')
  assertEquals(v.stats.measured, 5)
  v.layout(80, 5, 'two')
  assertEquals(v.stats.measured, 10)
  v.update(data.map((x) => x.id == '9999' ? { ...x, text: 'changed' } : x))
  assertEquals(text(v.layout(80, 5, 'two')).at(-1), 'changed')
  assertEquals(v.stats.measured, 11)
  v.key({ name: 'home', ctrl: true })
  v.layout(80, 5, 'two')
  assertEquals(v.stats.measured, 16)
})

Deno.test('cache eviction is bounded and empty/zero-sized lists keep a valid anchor', () => {
  let count = 0
  let v = new VirtualWindow<{ id: string; text: string }>(
    (item) => {
      count++
      return [[{ text: item.text, style: {} }]]
    },
    (x) => x.text,
    false,
    2,
  )
  v.update(items(20))
  v.layout(1, 1)
  v.key({ name: 'down' })
  v.layout(1, 1)
  v.key({ name: 'down' })
  v.layout(1, 1)
  assertEquals(count, 3)
  v.key({ name: 'home', ctrl: true })
  v.layout(1, 1)
  assertEquals(count, 4)
  let anchor = v.anchor
  assertEquals(v.layout(0, 0), [])
  assertEquals(v.anchor, anchor)
  v.update([])
  assertEquals(v.layout(1, 1), [])
  v.update(items(1))
  assertEquals(text(v.layout(1, 1)), ['0'])
})

Deno.test('input-only paints do not parse history; switching viewport resets follow without stealing editor keys', async () => {
  let rendered = 0
  let { Textarea } = await import('./Textarea.ts')
  let { useState } = await import('preact/hooks')
  let { useKeys } = await import('./screen.ts')
  let data = items(10000)
  let ui = await mount(
    () => {
      let [id, setId] = useState('one')
      useKeys((key) => {
        if (key.ctrl && key.text == 'n') {
          setId('two')
          return true
        }
        return false
      })
      return h(
        'div',
        { col: '1' },
        h(VirtualList<{ id: string; text: string }>, {
          id,
          grow: '1',
          items: data,
          follow: true,
          renderItem: (item) => {
            rendered++
            return h('div', null, item.text)
          },
        }),
        h(Textarea, { onSubmit: () => {} }),
      )
    },
    40,
    10,
  )
  try {
    let before = rendered
    await ui.send('hello')
    assertEquals(rendered, before)
    await ui.send('\x1b[5~')
    assert(!ui.text().includes('9999'))
    await ui.send('\x0e')
    assert(ui.text().includes('9999'))
    await ui.send('\x1b[A!')
    assert(ui.text().includes('!hello'), ui.text())
  } finally {
    ui.free()
  }
})

Deno.test('controlled viewport publishes anchors and restores externally owned position', async () => {
  let position = { follow: false, anchor: { id: '12', offset: 0 } }
  let seen: string[] = []
  let ui = await mount(
    () =>
      h(VirtualList<{ id: string; text: string }>, {
        items: items(40),
        value: position,
        renderItem: (item: { id: string; text: string }) =>
          h('div', null, item.text),
        onViewportChange: (
          next: { follow: boolean; anchor?: { id: string; offset: number } },
        ) => {
          position = { follow: next.follow, anchor: next.anchor! }
          seen.push(position.anchor.id)
        },
      }),
    20,
    5,
  )
  try {
    assert(ui.text().startsWith('12\n'))
    await ui.send('\x1b[6~')
    assert(seen.includes('16'))
    assertEquals(position.follow, false)
    assert(ui.text().startsWith('16\n'))
    await ui.send('\x1b[1;5F')
  } finally {
    ui.free()
  }
})

Deno.test('controlled selection jumps lazily and reveals the complete entry', () => {
  let v = window(false)
  let data = items(10000)
  data[9000].text = 'selected '.repeat(20)
  v.update(data)
  v.layout(80, 8)
  v.selected = '9000'
  let lines = text(v.layout(80, 8)).join('')
  assert(lines.includes(data[9000].text))
  assert(v.stats.measured < 30)
  assertEquals(v.follow, false)
  v.selected = '2'
  assertEquals(text(v.layout(80, 8))[0], '2')
  assert(v.stats.measured < 40)
})

Deno.test('item keys use estimated page heights and preserve scrolling API', () => {
  let v = window(false)
  v.update(items(100))
  v.layout(80, 10)
  assertEquals(v.selectionKey({ name: 'down' }, '20'), '21')
  assertEquals(v.selectionKey({ name: 'up' }, '0'), '0')
  assertEquals(v.selectionKey({ name: 'pageup' }, '20'), '10')
  assertEquals(v.selectionKey({ name: 'pagedown' }, '20'), '30')
  assertEquals(
    v.selectionKey({ name: 'char', text: 'u', ctrl: true }, '20'),
    '15',
  )
  assertEquals(
    v.selectionKey({ name: 'char', text: 'd', ctrl: true }, '20'),
    '25',
  )
  assertEquals(v.selectionKey({ name: 'home' }, '20'), '0')
  assertEquals(v.selectionKey({ name: 'end' }, '20'), '99')
  assertEquals(v.selectionKey({ name: 'wheelup' }, '20'), undefined)
  assert(v.follow) // End selection resumes following.
  v.key({ name: 'home', ctrl: true })
  v.layout(80, 10)
  assert(v.key({ name: 'down' }))
  assertEquals(text(v.layout(80, 10))[0], '1')
})

Deno.test('selection at exact viewport boundary is revealed', () => {
  let v = window(false)
  v.update(items(100))
  v.layout(80, 5)
  v.selected = '5'
  assertEquals(text(v.layout(80, 5)), ['1', '2', '3', '4', '5'])
  let anchor = v.anchor
  v.layout(80, 5)
  assertEquals(v.anchor, anchor)
  v.selected = '99'
  assertEquals(text(v.layout(80, 5)).at(-1), '99')
})

Deno.test('mounted generic controlled list reveals offscreen selection lazily', async () => {
  let { signal } = await import('@preact/signals')
  let selected = signal('9000'), count = 0
  let data = items(10000)
  let ui = await mount(
    () =>
      h(VirtualList, {
        items: data,
        selected: selected.value,
        onSelect: (id: string) => {
          selected.value = id
        },
        renderItem: (item) => {
          count++
          return h('div', null, item.id)
        },
      }),
    40,
    8,
  )
  try {
    assert(ui.text().includes('9000'))
    assert(count < 30)
    selected.value = '2'
    await ui.resize(41, 8)
    assert(ui.text().includes('2'))
    assert(count < 50)
  } finally {
    ui.free()
  }
})

Deno.test('selected oversized entry shows its beginning after resize', () => {
  let v = window(false)
  v.update([{ id: 'a', text: 'before' }, { id: 'b', text: 'abcdefghij' }])
  v.selected = 'b'
  assertEquals(text(v.layout(2, 3)), ['ab', 'cd', 'ef'])
  assertEquals(text(v.layout(1, 2)), ['a', 'b'])
  assertEquals(v.anchor, { id: 'b', offset: 0 })
})

Deno.test('wheel scrolling remains possible after selected item is revealed', () => {
  const v = window(false)
  v.update(items(100))
  v.selected = '20'
  v.layout(80, 10)
  const before = v.anchor!.id
  v.key({ name: 'wheeldown' })
  v.layout(80, 10)
  assert(v.anchor!.id !== before)
})

Deno.test('wheel scrolling clamps at the end even with a selected entry', () => {
  let v = window(false)
  v.update(items(100))
  v.selected = '20'
  v.layout(20, 5)
  for (let n = 0; n < 40; n++) {
    v.key({ name: 'wheeldown' })
    v.layout(20, 5)
  }
  assertEquals(text(v.layout(20, 5)), ['95', '96', '97', '98', '99'])
  assertEquals(v.follow, true)
  assertEquals(v.anchor, { id: '95', offset: 0 })
  assertEquals(v.selected, '20')
  v.update(items(101))
  assertEquals(text(v.layout(20, 5)), ['96', '97', '98', '99', '100'])
  v.key({ name: 'wheelup' })
  assertEquals(text(v.layout(20, 5)), ['93', '94', '95', '96', '97'])
  assertEquals(v.follow, false)
})
