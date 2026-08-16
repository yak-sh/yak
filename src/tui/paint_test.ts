// The window: where a screenful sits over the content, given a cursor — and
// the escape invariant: content never speaks to the terminal.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { TElement, TNode, TText } from './dom.ts'
import { ansi, cursorLine, pane, win } from './paint.ts'

// top, cursor, window height, content height -> where the window sits
let cases: [number[], number][] = [
  [[0, 0, 10, 100], 0], // a cursor on screen never moves the window
  [[0, 9, 10, 100], 0],
  [[0, 10, 10, 100], 1], // one past the bottom scrolls by one
  [[0, 40, 10, 100], 31],
  [[20, 10, 10, 100], 10], // a cursor above the window pulls it up to itself
  [[91, 99, 10, 100], 90], // the last line is reachable, and is the end
  [[91, 200, 10, 100], 90], // and nothing scrolls past the end
  [[0, 3, 10, 5], 0], // content shorter than the window: no scroll at all
  [[7, 3, 10, 5], 0],
  [[7, -1, 10, 100], 0], // no cursor (the board) pins it to the top
  [[0, 0, 10, 0], 0], // empty content
]

Deno.test('the window follows the cursor and stops at both ends', () => {
  for (let [[top, at, h, n], want] of cases) {
    assertEquals(win(top, at, h, n), want, `win(${top}, ${at}, ${h}, ${n})`)
  }
})

Deno.test('the board scrolls to its selected row, which paints inverse', () => {
  // The board's cursor is over the query (at<0); it marks the selected row
  // with TRow-on (inverse) rather than a line number. cursorLine finds that
  // line so the window follows it — a wall of tasks scrolls.
  let root = new TElement('root')
  let sel = (cls: string, text: string) => {
    let e = new TElement('div')
    e.className = cls
    e.appendChild(new TText(text))
    root.appendChild(e)
  }
  for (let i = 0; i < 40; i++) sel('TRow', `row ${i}`)
  sel('TRow TRow-on', 'selected') // line 40
  sel('footer', 'status') // pane() pops the last line off as the statusbar
  let { lines } = pane(root)
  let cur = cursorLine(lines, -1)
  assertEquals(cur, 40)
  assertEquals(win(0, cur, 10, lines.length), 31) // pulled down to keep it on screen

  // An entity pane has a real line cursor; the board with nothing selected
  // (cur<0) leaves win() to pin the top, exactly as before.
  assertEquals(cursorLine(lines, 5), 5)
  assertEquals(cursorLine([[{ text: 'x', style: {} }]], -1), -1)
})

// A div wearing a class, and the bytes a tree hands the terminal — what
// paint() writes, minus the screen it measures.
let div = (cls: string, ...kids: (TNode | string)[]) => {
  let e = new TElement('div')
  e.className = cls
  for (let k of kids) e.appendChild(typeof k == 'string' ? new TText(k) : k)
  return e
}
let bytes = (...kids: TNode[]) => {
  let root = new TElement('root')
  for (let k of kids) root.appendChild(k)
  let p = pane(root)
  return [...p.lines, p.status].map(ansi).join('\n')
}

// A task title, a comment, a letter from the open internet — all painted,
// none of it written by the operator.
let content: [string, string, string][] = [
  [
    'ESC goes, so no CSI/OSC/DCS can form',
    'a\x1b]52;c;QQ==\x07b',
    'a]52;c;QQ==b',
  ],
  ['erase-display never forms', 'a\x1b[2Jb', 'a[2Jb'],
  ['C1 goes too — 0x9b is CSI to some terminals', 'a\x9b2Jb', 'a2Jb'],
  ['DEL goes', 'a\x7fb', 'ab'],
  ['\\r goes — it would move the cursor in the frame', 'a\rb', 'ab'],
  ['NUL and the rest of C0 go', 'a\x00\x05\x0e\x1fb', 'ab'],
  ['an FTS snippet keeps its hit marks', 'a \x01hit\x02 b', 'a \x01hit\x02 b'],
  ['\\n stays a line break', 'a\nb', 'a\nb'],
  ['\\t expands to spaces we chose', 'a\tb', 'a  b'],
]

Deno.test('content cannot speak to the terminal', () => {
  for (let [what, data, want] of content) {
    assertEquals(bytes(div('', data)), want, what)
  }
})

Deno.test('the painter still speaks: SGR, OSC 8, and a sanitized href', () => {
  // Style the sheet knows is emitted by ansi(), not by the content.
  assertStringIncludes(bytes(div('Md_B', 'bold')), '\x1b[1mbold\x1b[0m')

  // A markdown link's href is content: a BEL in it would close the OSC 8
  // early and let the tail run as a clipboard write of its own.
  let a = new TElement('a')
  a.className = 'Md_A'
  a.setAttribute('href', 'http://x/\x07\x1b]52;c;QQ==\x07')
  a.appendChild(new TText('click'))
  let out = bytes(div('', a))
  assertStringIncludes(out, '\x1b]8;;http://x/]52;c;QQ==\x07')
  assertEquals(out.includes('\x1b]52'), false, 'no clipboard write')
  assertStringIncludes(out, '\x1b]8;;\x07') // and the link still closes
})
