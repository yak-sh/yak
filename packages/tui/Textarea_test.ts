import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { decode } from './input.ts'
import {
  edit,
  spot,
  Textarea,
  visualEdit,
  visualRows,
  visualSpot,
} from './Textarea.ts'
import { Scroll } from './Scroll.ts'
import { mount } from './harness.ts'

// Bytes typed at the box → the text and cursor they leave behind. `|` marks
// where the cursor lands, so a row reads like the screen does.
let typed = (bytes: string, from = { text: '', at: 0 }) => {
  let s = from
  for (let k of decode(bytes)) if (k.name != 'mouse') s = edit(s, k) ?? s
  return `${s.text.slice(0, s.at)}|${s.text.slice(s.at)}`
}

let table: [string, string][] = [
  ['abc', 'abc|'],
  ['abc\x7f', 'ab|'], // backspace at the end
  ['ab\x1b[Dc', 'ac|b'],
  ['ab\x1b[D\x1b[3~', 'a|'], // delete forward
  ['ab\x1b[13;2ucd', 'ab\ncd|'], // ⇧⏎ opens a line
  ['ab\rcd', 'abcd|'], // plain ⏎ is not an edit: it submits
  ['one two\x1b[200~ three\x1b[201~', 'one two three|'],
  ['one two\x17', 'one |'], // ^W kills a word
  ['one two\x1bb', 'one |two'], // ⌥b jumps back a word
  ['one two\x1bb\x1bf', 'one two|'],
  ['one two\x01', '|one two'], // ^A
  ['one\x01\x05', 'one|'], // ^E
  ['one two\x01\x0b', '|'], // ^K kills to the end
  ['one two\x15', '|'], // ^U kills to the start
  ['ab\x1b[13;2ucd\x1b[A', 'ab|\ncd'], // up keeps the column
  ['ab\x1b[13;2ucd\x1b[A\x1b[B', 'ab\ncd|'],
  ['ab\x1b[13;2ucd\x1b[H', 'ab\n|cd'], // home is this line's start
  ['ab\x1b[13;2ucd\x1b[H\x1b[1;5H', '|ab\ncd'], // ^Home is the whole text
  ['ab\x1b[13;2ucd\x1b[1;5F', 'ab\ncd|'],
  ['a\x1bb\x7f', '|a'],
]

Deno.test('every editing key is one row of a table', () => {
  for (let [bytes, want] of table) assertEquals(typed(bytes), want, bytes)
})

Deno.test('the cursor knows its row and column', () => {
  assertEquals(spot({ text: 'ab\ncde', at: 5 }), { row: 1, col: 2 })
  assertEquals(spot({ text: '', at: 0 }), { row: 0, col: 0 })
})

Deno.test('typing shows on screen, and Enter submits and clears', async () => {
  let sent: string[] = []
  let App = () =>
    h(
      'div',
      { col: '1' },
      h(Textarea, { onSubmit: (t: string) => sent.push(t) }),
    )
  let ui = await mount(App, 30, 4)
  await ui.send('hi')
  assertEquals(ui.text().split('\n')[0], '> hi')
  await ui.send('\x1b[13;2uthere')
  assertEquals(ui.text().split('\n').slice(0, 2), ['> hi', '  there'])
  await ui.send('\r')
  assertEquals(sent, ['hi\nthere'])
  assertEquals(ui.text().split('\n')[0], '>')
  ui.free()
})

Deno.test('a keystroke repaints the line it changed, not the screen', async () => {
  let App = () =>
    h(
      'div',
      { col: '1' },
      h(
        Scroll,
        { id: 'log', grow: '1' },
        ...Array.from({ length: 200 }, (_, i) =>
          h('div', { key: i }, `line ${i}`)),
      ),
      h(Textarea, { max: 4 }),
    )
  let ui = await mount(App, 40, 12)
  assertEquals(await ui.send('a'), 1)
  assertEquals(await ui.send('bcdef'), 1)
  assertEquals(await ui.send('\x7f'), 1)
  ui.free()
})

Deno.test('soft rows preserve whitespace, hard breaks, long tokens and cursor offsets', () => {
  let text = 'one two three\n\nabcdefghij'
  let rows = visualRows(text, 6)
  assertEquals(rows.map((r) => text.slice(r.start, r.end)), [
    'one ',
    'two ',
    'three',
    '',
    'abcdef',
    'ghij',
  ])
  assertEquals(visualSpot(rows, 4), { row: 1, col: 0 })
  assertEquals(visualRows('abcdef', 6), [{ start: 0, end: 6 }, {
    start: 6,
    end: 6,
  }])
  assertEquals(visualRows('ab', 0), [
    { start: 0, end: 1 },
    { start: 1, end: 2 },
    { start: 2, end: 2 },
  ])
  assertEquals(visualRows('ab cd', 5), [{ start: 0, end: 5 }, {
    start: 5,
    end: 5,
  }])
  let s = { text: 'abcdefghij', at: 8 }
  assertEquals(visualEdit(s, { name: 'up' }, 6)?.at, 2)
  assertEquals(visualEdit({ ...s, at: 2 }, { name: 'down' }, 6)?.at, 8)
  assertEquals(visualEdit(s, { name: 'home' }, 6)?.at, 6)
  assertEquals(visualEdit(s, { name: 'end' }, 6)?.at, 10)
  assertEquals(visualEdit({ ...s, at: 2 }, { name: 'end' }, 6)?.at, 5)
  assertEquals(visualEdit(s, { name: 'home', ctrl: true }, 6)?.at, 0)
})

Deno.test('soft input wraps and resizes without changing submitted text', async () => {
  let sent: string[] = []
  let changed: string[] = []
  let ui = await mount(
    () =>
      h(Textarea, {
        onSubmit: (t: string) => sent.push(t),
        onChange: (t: string) => changed.push(t),
      }),
    8,
    6,
  )
  try {
    await ui.send('hello world')
    assertEquals(ui.text().split('\n').slice(0, 2), ['> hello', '  world'])
    await ui.resize(20, 6)
    assertEquals(ui.text().split('\n')[0], '> hello world')
    await ui.resize(5, 6)
    assertEquals(ui.text().split('\n').slice(0, 4), [
      '> hel',
      '  lo',
      '  wor',
      '  ld',
    ])
    assertEquals(changed, ['hello world'])
    await ui.send('\r')
    assertEquals(sent, ['hello world'])
  } finally {
    ui.free()
  }
})

Deno.test('soft rows scroll to the cursor and use allocated width, not terminal width', async () => {
  let ui = await mount(
    () =>
      h(
        'div',
        { row: '1' },
        h('div', { width: '8' }, h(Textarea, { max: 2 })),
        h('div', { grow: '1' }, 'side'),
      ),
    20,
    5,
  )
  try {
    await ui.send('abcdefghijklmnop')
    assertEquals(ui.text().split('\n').slice(0, 2), ['  ghijklside', '  mnop'])
    await ui.send('\x1b[A\x1b[A')
    assertEquals(ui.text().split('\n').slice(0, 2), [
      '> abcdefside',
      '  ghijkl',
    ])
  } finally {
    ui.free()
  }
})

Deno.test('a one-column input hides its gutter and keeps the cursor visible', async () => {
  let ui = await mount(() => h(Textarea, { max: 4 }), 1, 4)
  try {
    await ui.send('ab')
    assertEquals(ui.text().split('\n').slice(0, 3), ['a', 'b', ''])
    await ui.send('\x1b[A\x7f')
    assertEquals(ui.text().split('\n')[0], 'b')
  } finally {
    ui.free()
  }
})
