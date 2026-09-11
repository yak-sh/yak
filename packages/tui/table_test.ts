import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import { Markdown } from '@yaks/markdown'
import { TElement, TText } from './dom.ts'
import { VirtualWindow } from './VirtualList.ts'
import { mount } from './harness.ts'
import { ansi, type Line, screenful } from './paint.ts'

let el = (tag: string, ...children: (TElement | string)[]): TElement => {
  let n = new TElement(tag)
  for (let child of children) {
    n.appendChild(typeof child == 'string' ? new TText(child) : child)
  }
  return n
}
let words = (lines: Line[]) => lines.map((l) => l.map((s) => s.text).join(''))
let read = (node: TElement, width = 30, height = 30) =>
  words(screenful(node, width, height).lines).filter(Boolean)
let cell = (text: string, align = 'left') => {
  let node = el('td', text)
  node.setAttribute('align', align)
  return node
}

Deno.test('semantic tables align columns and distinguish header and subtle rules', () => {
  let node = el(
    'table',
    el('thead', el('tr', el('th', 'Name'), el('th', 'Count'))),
    el(
      'tbody',
      el('tr', cell('a'), cell('2', 'right')),
      el('tr', cell('é'), cell('9', 'center')),
    ),
  )
  assertEquals(read(node), [
    '┌─────────────┬──────────────┐',
    '│ Name        │ Count        │',
    '├─────────────┼──────────────┤',
    '│ a           │            2 │',
    '├─────────────┼──────────────┤',
    '│ é           │      9       │',
    '└─────────────┴──────────────┘',
  ])
  let lines = screenful(node, 30, 20).lines
  assert(lines[0][0].style.dim)
  assert(lines[1].some((s) => s.text == 'Name' && s.style.bold))
})

Deno.test('cells wrap words and long tokens, preserve inline styles and explicit breaks', () => {
  let link = el('a', 'link')
  link.setAttribute('href', 'https://example.com')
  let node = el(
    'table',
    el(
      'tr',
      el('td', el('strong', 'one two'), el('br'), link),
      el('td', 'abcdefghijk'),
    ),
  )
  let lines = screenful(node, 19, 20).lines.filter((l) => l.length)
  assert(words(lines).every((s) => s.length <= 19))
  assert(words(lines).some((s) => s.includes('one')))
  assert(words(lines).some((s) => s.includes('link')))
  assert(lines.flat().some((s) => s.text.includes('one') && s.style.bold))
  assert(
    lines.flat().some((s) =>
      s.text == 'link' && s.style.href == 'https://example.com'
    ),
  )
  assert(ansi(lines[0]).includes('\x1b['))
})

Deno.test('narrow tables stack labeled values, handle empty and irregular rows', () => {
  let node = el(
    'table',
    el('tr', el('th', 'A'), el('th', 'B')),
    el('tr', cell('one'), cell('two')),
    el('tr', cell('x')),
  )
  assertEquals(read(node, 8), ['A', 'one', 'B', 'two', '────────', 'A', 'x'])
  assert(read(node, 1).every((line) => line.length <= 1))
  assertEquals(read(node, 0), [])
  assertEquals(read(el('table')), [])
  assertEquals(read(el('table', el('tr', cell(''))), 12), [
    '┌──────────┐',
    '│          │',
    '└──────────┘',
  ])
})

Deno.test('nested table respects quote and outer box width', () => {
  let node = el(
    'div',
    el(
      'blockquote',
      el('table', el('tr', cell('first column'), cell('second column'))),
    ),
  )
  node.setAttribute('border', 'Composer_Border')
  node.setAttribute('wrap', '1')
  let lines = read(node, 26)
  assert(lines.every((line) => line.length <= 26))
  assert(lines.some((line) => line.startsWith('│  ┌')))
  let top = lines.find((line) => line.includes('┌'))!
  assertEquals(top.indexOf('┐'), 24)
})

Deno.test('Markdown tables keep alignment, escaped pipes and streamed incomplete source', async () => {
  let source = '| Name | Count |\n| :--- | ---: |\n| a\\|b | 2 |'
  let ui = await mount(() => h(Markdown, { source }), 30, 10)
  try {
    assert(ui.text().includes('│ a|b         │            2 │'), ui.text())
    assert(ui.text().includes('├─────────────┼──────────────┤'))
    assertEquals(await ui.send('x'), 0) // unchanged tree paints no rows
  } finally {
    ui.free()
  }
  ui = await mount(
    () => h(Markdown, { source: '| A | B |\n| --- | --- |\n| one' }),
    30,
    10,
  )
  try {
    assert(ui.text().includes('one'))
  } finally {
    ui.free()
  }
})

Deno.test('large table item stays cached across warm virtual paints', () => {
  let measured = 0
  let data = Array.from({ length: 10000 }, (_, id) => ({ id: String(id) }))
  let node = el(
    'table',
    ...Array.from({ length: 100 }, (_, row) =>
      el(
        'tr',
        ...Array.from({ length: 8 }, (_, col) => cell('r' + row + 'c' + col)),
      )),
  )
  let view = new VirtualWindow<{ id: string }>(
    (_item, w) => {
      measured++
      return screenful(node, w, 1000).lines.filter((l) => l.length)
    },
    (item) => item.id,
    true,
  )
  view.update(data)
  view.layout(120, 12)
  assertEquals(measured, 1)
  for (let i = 0; i < 20; i++) view.layout(120, 12)
  assertEquals(measured, 1)
})

Deno.test('Markdown table inside a list reflows on resize without losing code pipes', async () => {
  let ui = await mount(
    () =>
      h(Markdown, {
        source:
          '- table:\n\n  | Value | Note |\n  | --- | --- |\n  | `a\\|b` | words wrap here |',
      }),
    42,
    20,
  )
  try {
    assert(ui.text().includes('a|b'), ui.text())
    assert(ui.out.join('').includes('48;2;52;63;68'))
    await ui.resize(12, 20)
    assert(ui.text().includes('Value'), ui.text())
    assert(ui.text().includes('a|b'), ui.text())
    await ui.resize(42, 20)
    assert(ui.text().includes('┌'), ui.text())
  } finally {
    ui.free()
  }
})

Deno.test('full-width tables separate logical rows, not wrapped cell lines', () => {
  let node = el(
    'table',
    el('tr', el('td', 'one', el('br'), 'two'), cell('right')),
    el('tr', cell(''), cell('last')),
  )
  let lines = read(node, 25)
  assert(lines.every((line) => line.length == 25))
  assertEquals(lines.filter((line) => line.startsWith('├')).length, 1)
  assert(lines[1].includes('one'))
  assert(lines[2].includes('two'))
  assert(lines[3].startsWith('├'))
  assert(lines[4].includes('last'))
})
