/**
 * The multi-line input box. `edit()` is the whole editor as one pure function
 * — a `{text, at}` and a key in, the next `{text, at}` out, null when the key
 * is none of its business — so every binding is a table row in the test rather
 * than a branch in a component. Enter submits and Shift+Enter opens a line,
 * which is the one thing a terminal cannot say on its own and the reason the
 * kitty keyboard flag is pushed at startup. The box grows with its text to
 * `max` rows and then scrolls, keeping the cursor in view.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { useRef, useState } from 'preact/hooks'
import type { Key } from './input.ts'
import { size, useKeys, useMetric } from './screen.ts'

/** The editor's whole state: the text, and where the cursor sits in it. */
export type Edit = { text: string; at: number }

let word = /\s/

let ins = (s: Edit, t: string): Edit => ({
  text: s.text.slice(0, s.at) + t + s.text.slice(s.at),
  at: s.at + t.length,
})
let cut = (s: Edit, from: number, to: number): Edit => ({
  text: s.text.slice(0, Math.max(0, from)) + s.text.slice(to),
  at: Math.max(0, from),
})
let at = (s: Edit, i: number): Edit => ({
  text: s.text,
  at: Math.min(Math.max(0, i), s.text.length),
})

/** The offset of the start of the line the cursor is on. */
export let bol = (t: string, i: number): number =>
  t.lastIndexOf('\n', i - 1) + 1
/** The offset of the end of the line the cursor is on. */
export let eol = (t: string, i: number): number => {
  let n = t.indexOf('\n', i)
  return n < 0 ? t.length : n
}
let back = (t: string, i: number) => {
  while (i > 0 && word.test(t[i - 1])) i--
  while (i > 0 && !word.test(t[i - 1])) i--
  return i
}
let fwd = (t: string, i: number) => {
  while (i < t.length && word.test(t[i])) i++
  while (i < t.length && !word.test(t[i])) i++
  return i
}
// Up and down keep the column, the way every editor does.
let vertical = (s: Edit, up: boolean): Edit => {
  let start = bol(s.text, s.at)
  let col = s.at - start
  if (up) {
    if (!start) return at(s, 0)
    let prev = bol(s.text, start - 1)
    return at(s, Math.min(prev + col, start - 1))
  }
  let end = eol(s.text, s.at)
  if (end == s.text.length) return at(s, s.text.length)
  return at(s, Math.min(end + 1 + col, eol(s.text, end + 1)))
}

/** Apply one key to the editor; null when the key is not an edit. */
export let edit = (s: Edit, k: Key): Edit | null => {
  let jump = k.alt || k.ctrl
  if (k.name == 'char' && k.ctrl && !k.alt) {
    let c = k.text
    if (c == 'a') return at(s, bol(s.text, s.at))
    if (c == 'e') return at(s, eol(s.text, s.at))
    if (c == 'u') return cut(s, bol(s.text, s.at), s.at)
    if (c == 'k') return cut(s, s.at, eol(s.text, s.at))
    if (c == 'w') return cut(s, back(s.text, s.at), s.at)
    if (c == 'b') return at(s, s.at - 1)
    if (c == 'f') return at(s, s.at + 1)
    return null
  }
  if (k.name == 'char' && k.alt) {
    if (k.text == 'b') return at(s, back(s.text, s.at))
    if (k.text == 'f') return at(s, fwd(s.text, s.at))
    if (k.text == 'd') return cut(s, s.at, fwd(s.text, s.at))
    return null
  }
  if (k.name == 'char') return ins(s, k.text ?? '')
  if (k.name == 'paste') return ins(s, (k.text ?? '').replaceAll('\r\n', '\n'))
  if (k.name == 'enter') return k.shift || k.alt ? ins(s, '\n') : null
  if (k.name == 'backspace') {
    return k.alt ? cut(s, back(s.text, s.at), s.at) : cut(s, s.at - 1, s.at)
  }
  if (k.name == 'delete') {
    return k.alt ? cut(s, s.at, fwd(s.text, s.at)) : cut(s, s.at, s.at + 1)
  }
  if (k.name == 'left') return at(s, jump ? back(s.text, s.at) : s.at - 1)
  if (k.name == 'right') return at(s, jump ? fwd(s.text, s.at) : s.at + 1)
  if (k.name == 'up') return vertical(s, true)
  if (k.name == 'down') return vertical(s, false)
  if (k.name == 'home') return at(s, k.ctrl ? 0 : bol(s.text, s.at))
  if (k.name == 'end') {
    return at(s, k.ctrl ? s.text.length : eol(s.text, s.at))
  }
  return null
}

/** Visual rows retain source offsets; whitespace and submitted text are never rewritten. */
export type VisualRow = { start: number; end: number }
export let visualRows = (text: string, width: number): VisualRow[] => {
  width = Math.max(1, Math.floor(width))
  let rows: VisualRow[] = []
  let start = 0
  for (let line of text.split('\n')) {
    let end = start + line.length
    while (end - start >= width) {
      let stop = start + width
      // Prefer a word boundary, retaining its whitespace on the preceding row.
      let space = text.slice(start, stop).search(/\s+\S*$/)
      if (end - start > width && space >= 0) {
        let after = start + space
        while (after < stop && /\s/.test(text[after])) after++
        if (after > start) stop = after
      }
      rows.push({ start, end: stop })
      start = stop
    }
    rows.push({ start, end })
    start = end + 1
  }
  return rows
}

export let visualSpot = (rows: VisualRow[], offset: number) => {
  let row = rows.findLastIndex((r) => r.start <= offset)
  row = Math.max(0, row)
  return { row, col: offset - rows[row].start }
}

/** Vertical arrows and Home/End address displayed rows, not just hard lines. */
export let visualEdit = (s: Edit, k: Key, width: number): Edit | null => {
  let rows = visualRows(s.text, width)
  let { row, col } = visualSpot(rows, s.at)
  let end = (i: number) =>
    rows[i + 1]?.start == rows[i].end
      ? Math.max(rows[i].start, rows[i].end - 1)
      : rows[i].end
  if (k.name == 'up' || k.name == 'down') {
    let target = row + (k.name == 'up' ? -1 : 1)
    if (target < 0) return at(s, 0)
    if (target >= rows.length) return at(s, s.text.length)
    return at(s, Math.min(rows[target].start + col, end(target)))
  }
  if (!k.ctrl && k.name == 'home') return at(s, rows[row].start)
  if (!k.ctrl && k.name == 'end') return at(s, end(row))
  return edit(s, k)
}

/** Where the cursor is, as a row and a column into the text's lines. */
export let spot = (s: Edit): { row: number; col: number } => {
  let before = s.text.slice(0, s.at).split('\n')
  return { row: before.length - 1, col: before[before.length - 1].length }
}

/** The editing box: `onSubmit` gets the text on Enter, and it clears. */
export let Textarea = (
  { id = 'input', max = 8, prompt = '> ', onSubmit, onChange, value, onEdit }: {
    id?: string
    max?: number
    prompt?: string
    onSubmit?: (text: string) => void
    onChange?: (text: string) => void
    /** Controlled editor state; onEdit receives cursor-only changes too. */
    value?: Edit
    onEdit?: (next: Edit) => void
  },
): JSX.Element => {
  let [local, set] = useState<Edit>({ text: '', at: 0 })
  let s = value ?? local
  // One read of stdin can carry several keys, and Preact re-renders after the
  // whole batch — so the handler edits from this ref rather than from the
  // state its render closed over, or every key but the last would be lost.
  let live = useRef(s)
  live.current = s
  let take = (next: Edit) => {
    let was = live.current
    live.current = next
    if (value == null) set(next)
    onEdit?.(next)
    if (next.text != was.text) onChange?.(next.text)
  }
  let metric = useMetric(id)
  let columns = metric.width || size.value.columns
  let hint = prompt.slice(0, Math.max(0, columns - 1))
  let width = Math.max(1, columns - hint.length)
  useKeys((k) => {
    let now = live.current
    if (k.name == 'enter' && !k.shift && !k.alt) {
      if (now.text) onSubmit?.(now.text)
      take({ text: '', at: 0 })
      return true
    }
    let next = visualEdit(now, k, width)
    if (!next) return false
    take(next)
    return true
  })
  let rows = visualRows(s.text, width)
  let lines = rows.map((r) => s.text.slice(r.start, r.end))
  let { row, col } = visualSpot(rows, s.at)
  let height = Math.max(1, Math.min(lines.length, max, size.value.rows))
  let top = Math.min(
    Math.max(0, row - height + 1),
    Math.max(0, lines.length - height),
  )
  let gutter = (i: number) =>
    h('span', { class: 'Entry_Hint' }, i ? ' '.repeat(hint.length) : hint)
  return h(
    'div',
    { id, class: 'Entry', height: String(height), scroll: String(top) },
    ...lines.map((line, i) =>
      h(
        'div',
        { key: i },
        gutter(i),
        i == row
          ? [
            h('span', {}, line.slice(0, col)),
            h('span', { class: 'Cursor' }, line[col] ?? ' '),
            h('span', {}, line.slice(col + 1)),
          ]
          : h('span', {}, line),
      )
    ),
  )
}
