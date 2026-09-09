import { assert, assertEquals } from '@std/assert'
import { TElement, TText } from './dom.ts'
import { ansi, ansiBackend, type Line, screenful } from './paint.ts'

let el = (
  name: string,
  attrs: Record<string, unknown> = {},
  ...kids: unknown[]
) => {
  let e = new TElement(name)
  for (let [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  for (let k of kids) {
    e.appendChild(typeof k == 'string' ? new TText(k) : k as TElement)
  }
  return e
}
let words = (lines: Line[]) =>
  lines.map((l) => l.map((s) => s.text).join('').trimEnd())
let seen = (root: TElement, columns = 20, rows = 6) =>
  words(screenful(root, columns, rows).lines)

Deno.test('blocks stack and inline children run into one line', () => {
  let tree = el(
    'root',
    {},
    el('div', {}, 'one'),
    el('div', {}, el('span', {}, 'two'), el('span', {}, '-three')),
  )
  assertEquals(seen(tree), ['one', 'two-three', '', '', '', ''])
})

Deno.test('a text node keeps its newlines and loses every control byte', () => {
  let controls = Array.from({ length: 160 }, (_, n) => n)
    .filter((n) => (n < 32 || n >= 127) && n != 10 && n != 9)
    .map((n) => String.fromCharCode(n)).join('')
  let tree = el('root', {}, el('div', {}, `a${controls}b\nc\td`))
  // A tab is cursor movement the terminal would choose; spaces are ours.
  assertEquals(seen(tree).slice(0, 2), ['ab', 'c  d'])
})

Deno.test('an href is sanitized and rides in an OSC 8', () => {
  let a = el('a', { href: 'https://x/\x07evil' }, 'link')
  let line = screenful(el('root', {}, el('div', {}, a)), 20, 1).lines[0]
  assertEquals(ansi(line), '\x1b]8;;https://x/evil\x07link\x1b]8;;\x07')
})

Deno.test('a row puts a fixed sidebar beside a growing column', () => {
  let tree = el(
    'root',
    {},
    el(
      'div',
      { row: '1' },
      el('div', { grow: '1', col: '1' }, el('div', {}, 'main')),
      el('div', { width: '6', col: '1' }, el('div', {}, 'side')),
    ),
  )
  let lines = screenful(tree, 20, 2).lines
  assertEquals(words(lines)[0], 'main          side')
  assertEquals(lines[0][1].text, ' '.repeat(10)) // the main column is padded to width
})

Deno.test('a col gives its leftover rows to the growing child', () => {
  let tree = el(
    'root',
    { col: '1' },
    el('div', {}, 'head'),
    el(
      'div',
      { grow: '1', id: 'body', scroll: '0' },
      ...['a', 'b', 'c', 'd', 'e'].map((t) => el('div', {}, t)),
    ),
    el('div', {}, 'foot'),
  )
  let { lines, metrics } = screenful(tree, 20, 5)
  assertEquals(words(lines), ['head', 'a', 'b', 'c', 'foot'])
  assertEquals(metrics.body, { total: 5, height: 3 })
})

Deno.test('a scroll offset windows the content and is clamped to it', () => {
  let rows = (top: string) =>
    seen(
      el(
        'root',
        { col: '1' },
        el(
          'div',
          { grow: '1', id: 'log', scroll: top },
          ...['a', 'b', 'c', 'd'].map((t) => el('div', {}, t)),
        ),
      ),
      20,
      2,
    )
  assertEquals(rows('0'), ['a', 'b'])
  assertEquals(rows('1'), ['b', 'c'])
  assertEquals(rows('99'), ['c', 'd'])
})

Deno.test('a style becomes the escapes, and nothing else does', () => {
  let line = screenful(
    el('root', {}, el('div', { class: 'Title' }, 'hi')),
    10,
    1,
  ).lines[0]
  assertEquals(ansi(line), '\x1b[1mhi\x1b[0m')
})

Deno.test('the backend paints only the lines that changed', () => {
  let out: string[] = []
  let back = ansiBackend({
    size: () => ({ columns: 20, rows: 4 }),
    write: (s) => void out.push(s),
  })
  let rows = ['one', 'two', 'three']
  let tree = el('root', {}, ...rows.map((t) => el('div', {}, t)))
  assertEquals(back.draw(tree).written, 4) // first frame: the whole screen
  assertEquals(back.draw(tree).written, 0) // nothing moved, nothing written
  ;((tree.childNodes[1] as TElement).childNodes[0] as TText).data = 'TWO'
  out.length = 0
  assertEquals(back.draw(tree).written, 1)
  assert(out[0].startsWith('\x1b[2;1H'), out[0]) // addressed to that row alone
  assert(out[0].includes('TWO'))
  back.reset()
  assertEquals(back.draw(tree).written, 4) // a resize repaints everything
})
