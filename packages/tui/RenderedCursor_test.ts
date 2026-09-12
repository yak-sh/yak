import { assertEquals, assertThrows } from '@std/assert'
import {
  clampPoint,
  copyRendered,
  cursorLine,
  stepColumn,
} from './RenderedCursor.ts'
import { VirtualWindow } from './VirtualList.ts'
import { type Line, wrap } from './paint.ts'
const lines = (text: string): Line[] =>
  text.split('\n').map((text) => [{ text, style: {} }])
Deno.test('rendered selection excludes borders and preserves styled text', () => {
  const content: Line[] = [
    [{ text: '╭─────╮', style: {}, decorative: true }],
    [{ text: '│', style: {}, decorative: true }, {
      text: 'bold',
      style: { bold: true },
    }, { text: '│', style: {}, decorative: true }],
    [{ text: '╰─────╯', style: {}, decorative: true }],
  ]
  const cursor = {
    id: 'a',
    row: 2,
    col: 6,
    anchor: { id: 'a', row: 0, col: 0 },
  }
  assertEquals(copyRendered(cursor, ['a'], () => content), 'bold')
  const painted = cursorLine(content[1], 'a', 1, cursor, ['a'], {
    inverse: true,
  })
  assertEquals(painted[1].style.bold, true)
  assertEquals(painted[1].style.inverse, true)
  assertEquals(content[1][1].style, { bold: true })
})
Deno.test('cross-entry copy bounded and Unicode cursor does not split surrogate pairs', () => {
  const cursor = {
    id: 'b',
    row: 0,
    col: 2,
    anchor: { id: 'a', row: 0, col: 1 },
  }
  assertEquals(
    copyRendered(
      cursor,
      ['a', 'b'],
      (id) => lines(id == 'a' ? 'hello' : 'world'),
    ),
    'ello\nwor',
  )
  assertThrows(() => copyRendered(cursor, ['b'], () => lines('x')))
  assertThrows(() => copyRendered(cursor, ['a', 'b'], () => lines('abcdef'), 2))
  assertEquals(stepColumn(lines('a😀b')[0], 1, 1), 3)
  assertEquals(stepColumn(lines('a😀b')[0], 3, -1), 1)
  assertEquals(clampPoint({ id: 'x', row: 0, col: 2 }, lines('a😀b')).col, 1)
})
Deno.test('rendered cursor crosses entries, reveals tall entries and reuses layout', () => {
  let measured = 0
  const w = new VirtualWindow<{ id: string }>(() => {
    measured++
    return lines('abc\ndef\nghi')
  }, () => 'v')
  w.update([{ id: 'a' }, { id: 'b' }])
  w.cursor = { id: 'a', row: 0, col: 1 }
  w.layout(10, 2)
  w.cursor = w.moveCursor({ name: 'down' }, w.cursor)!
  w.layout(10, 2)
  assertEquals(w.cursor.row, 1)
  w.cursor = w.moveCursor({ name: 'down' }, w.cursor)!
  w.layout(10, 2)
  assertEquals(w.anchor, { id: 'a', offset: 1 })
  w.cursor = w.moveCursor({ name: 'down' }, w.cursor)!
  w.layout(10, 2)
  assertEquals(w.cursor.id, 'b')
  const before = measured
  for (let i = 0; i < 10; i++) w.layout(10, 2)
  assertEquals(measured, before)
})

Deno.test('selection retains measured cross-page text and rejects an evicted endpoint', () => {
  const w = new VirtualWindow<{ id: string }>(
    (item) => lines(item.id),
    () => 'v',
    false,
    8,
  )
  w.update([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  w.layout(10, 3)
  w.update([{ id: 'c' }, { id: 'd' }, { id: 'e' }])
  w.layout(10, 3)
  assertEquals(
    w.copyCursor({
      id: 'd',
      row: 0,
      col: 0,
      anchor: { id: 'b', row: 0, col: 0 },
    }),
    'b\nc\nd',
  )
  w.update([{ id: 'x' }])
  w.layout(10, 3)
  assertThrows(() =>
    w.copyCursor({
      id: 'x',
      row: 0,
      col: 0,
      anchor: { id: 'b', row: 0, col: 0 },
    })
  )
})

Deno.test('copy joins soft wraps but keeps explicit newlines', () => {
  const wrapped = [...wrap(lines('hello world')[0], 6), ...lines('next')]
  assertEquals(
    copyRendered(
      { id: 'a', row: 2, col: 3, anchor: { id: 'a', row: 0, col: 0 } },
      ['a'],
      () => wrapped,
    ),
    'hello world\nnext',
  )
})

Deno.test('cursor is clamped after reflow and first NORMAL paint preserves follow', () => {
  const w = new VirtualWindow<{ id: string }>(
    (_item, width) => wrap(lines('abcdefghij')[0], width),
    () => 'v',
    true,
  )
  w.update([{ id: 'a' }])
  w.cursor = { id: 'a', row: 0, col: 8 }
  w.layout(10, 2)
  assertEquals(w.follow, true)
  w.layout(5, 2)
  assertEquals(w.cursor.col, 4)
  w.cursor = w.moveCursor({ name: 'down' }, w.cursor)!
  assertEquals(w.cursor.row, 1)
})
