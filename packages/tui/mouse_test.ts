import { VirtualList } from './VirtualList.ts'
import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import { TElement, TText } from './dom.ts'
import { decode, feed, type Mouse } from './input.ts'
import { hit, routeMouse } from './mouse.ts'
import { ansiBackend } from './paint.ts'
import { mount } from './harness.ts'
import { Scroll } from './Scroll.ts'

let wheel = (x = 0, y = 0): Mouse => ({
  name: 'mouse',
  type: 'wheel',
  x,
  y,
  button: 1,
  deltaX: 0,
  deltaY: 1,
  release: false,
  shift: false,
  alt: false,
  ctrl: false,
})
let el = (text = '') => {
  let node = new TElement('div')
  if (text) node.appendChild(new TText(text))
  return node
}
Deno.test('SGR coordinates, modifiers, releases and fragmented reports stay distinct', () => {
  assertEquals(decode('\x1b[<65;3;4M'), [{ ...wheel(2, 3) }])
  let report = decode('\x1b[<28;1;2m')[0] as Mouse
  assertEquals([
    report.type,
    report.release,
    report.shift,
    report.alt,
    report.ctrl,
  ], ['mouseup', true, true, true, true])
  assertEquals((decode('\x1b[<66;1;1M')[0] as Mouse).deltaX, -1)
  assertEquals((decode('\x1b[<0;1;1M')[0] as Mouse).type, 'mousedown')
  let read = feed()
  assertEquals(read('\x1b[<65;'), [])
  assertEquals(read('3;4M'), [wheel(2, 3)])
  assertEquals(decode('\x1b[A'), [{ name: 'up' }])
})
Deno.test('paint ownership scopes siblings, bubbles, consumes and clips after resize', () => {
  let root = el(), left = el('left'), right = el('right')
  root.setAttribute('row', '1')
  left.setAttribute('width', '5')
  root.appendChild(left)
  root.appendChild(right)
  let columns = 10, rows = 2
  let backend = ansiBackend({
    size: () => ({ columns, rows }),
    write: () => {},
  })
  let lines = backend.draw(root).lines!
  assertEquals(hit(lines, 1, 0), left)
  assertEquals(hit(lines, 6, 0), right)
  assertEquals(hit(lines, 10, 0), undefined)
  let seen: string[] = []
  left.addEventListener('wheel', () => {
    seen.push('left')
  })
  root.addEventListener('wheel', () => {
    seen.push('root')
  })
  routeMouse(wheel(), lines)
  assertEquals(seen, ['left', 'root'])
  left.addEventListener(
    'wheel',
    (e: { stopPropagation(): void }) => e.stopPropagation(),
  )
  seen = []
  assert(routeMouse(wheel(), lines))
  assertEquals(seen, [])
  left.addEventListener('wheel', () => true)
  assert(routeMouse(wheel(), lines))
  assertEquals(routeMouse(wheel(30), lines), false)
  columns = 3
  rows = 1
  lines = backend.draw(root).lines!
  assertEquals(hit(lines, 6, 0), undefined)
  assertEquals(hit(lines, 1, 1), undefined)
})
Deno.test('scroll clips hidden descendants and terminal reporting restores saved modes', () => {
  let root = el(), hidden = el('hidden'), visible = el('visible')
  root.setAttribute('scroll', '1')
  root.setAttribute('height', '1')
  root.appendChild(hidden)
  root.appendChild(visible)
  let output = ''
  let backend = ansiBackend({
    size: () => ({ columns: 10, rows: 1 }),
    write: (s) => {
      output += s
    },
  })
  assertEquals(hit(backend.draw(root).lines!, 0, 0), visible)
  backend.start()
  backend.stop()
  assert(output.includes('\x1b[?1000h\x1b[?1006h'))
  assert(output.includes('\x1b[?1006r\x1b[?1000r'))
  assert(output.includes('\x1b[?1007h'))
})
Deno.test('Preact onWheel scrolls only the pointed sibling, not keyboard focus', async () => {
  let ui = await mount(
    () =>
      h(
        'div',
        { row: '1' },
        ...['a', 'b'].map((id) =>
          h(
            Scroll,
            { id, width: '10', follow: false },
            ...Array.from({ length: 20 }, (_, i) => h('div', null, id + i)),
          )
        ),
      ),
    20,
    3,
  )
  try {
    await ui.send('\x1b[<65;2;1M')
    assert(ui.text().includes('a3'), ui.text())
    assert(ui.text().includes('b0'), ui.text())
    let before = ui.text()
    await ui.send('\x1b[<0;2;1M\x1b[<0;2;1m\x1b[<81;2;1M')
    assertEquals(ui.text(), before)
  } finally {
    ui.free()
  }
})

Deno.test('virtual wheel stays lazy over 10000 items and bubbles at bottom', async () => {
  let renders = 0, bubbled = 0
  let items = Array.from({ length: 10000 }, (_, i) => ({ id: String(i) }))
  let ui = await mount(
    () =>
      h(
        'div',
        {
          onWheel: () => {
            bubbled++
          },
        },
        h(VirtualList, {
          items,
          height: '5',
          follow: true,
          renderItem: (item: { id: string }) => {
            renders++
            return h('div', null, item.id)
          },
        }),
      ),
    20,
    5,
  )
  try {
    let before = renders
    await ui.send('\x1b[<65;1;1M')
    assertEquals(bubbled, 1)
    await ui.send('\x1b[<64;1;1M')
    assert(renders - before < 20)
    assert(!ui.text().includes('9999'), ui.text())
    assertEquals(bubbled, 1)
  } finally {
    ui.free()
  }
})

Deno.test('nested Preact handlers bubble from inline target and disappear on unmount', async () => {
  let events: string[] = []
  let ui = await mount(
    () =>
      h(
        'div',
        {
          onWheel: () => {
            events.push('outer')
          },
        },
        h('span', {
          onWheel: () => {
            events.push('inner')
          },
        }, 'target'),
      ),
    10,
    2,
  )
  await ui.send('\x1b[<65;1;1M')
  assertEquals(events, ['inner', 'outer'])
  ui.free()
  events = []
  let next = await mount(() => h('div', null, 'next'), 10, 2)
  try {
    await next.send('\x1b[<65;1;1M')
    assertEquals(events, [])
  } finally {
    next.free()
  }
})
