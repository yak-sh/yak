import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { TElement, TText } from './dom.ts'
import { ansi, ansiBackend, lay, type Line, screenful } from './paint.ts'

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

// A theme's worth of classes, for the tests that read colours.
let dress = {
  Title: { bold: true },
  Dim: { fg: '#7a8478', dim: true },
  Code: { fg: '#7fbbb3', bg: '#343434' },
  Quote: { fg: '#d3c6aa', bg: '#343f44', dim: false },
  Composer_Border: { fg: '#7a8478', dim: true },
}

test('blocks stack and inline children run into one line', () => {
  let tree = el(
    'root',
    {},
    el('div', {}, 'one'),
    el('div', {}, el('span', {}, 'two'), el('span', {}, '-three')),
  )
  assertEquals(seen(tree), ['one', 'two-three', '', '', '', ''])
})

test('a text node keeps its newlines and loses every control byte', () => {
  let controls = Array.from({ length: 160 }, (_, n) => n)
    .filter((n) => (n < 32 || n >= 127) && n != 10 && n != 9)
    .map((n) => String.fromCharCode(n)).join('')
  let tree = el('root', {}, el('div', {}, `a${controls}b\nc\td`))
  // A tab is cursor movement the terminal would choose; spaces are ours.
  assertEquals(seen(tree).slice(0, 2), ['ab', 'c  d'])
})

test('a text field paints its value, its placeholder, and its caret', () => {
  let line = (attrs: Record<string, unknown>) =>
    screenful(el('root', {}, el('div', {}, el('input', attrs))), 20, 1)
      .lines[0].map((s) => [s.text, !!s.style.inverse, !!s.style.dim])
  assertEquals(line({ value: 'abc' }), [['abc', false, false]])
  assertEquals(line({ value: '', placeholder: 'find…' }), [
    ['find…', false, true],
  ])
  assertEquals(line({ value: 'abc', 'data-caret': 1 }), [
    ['a', false, false],
    ['b', true, false],
    ['c', false, false],
  ])
  assertEquals(line({ value: 'ab', 'data-caret': 2 }), [
    ['ab', false, false],
    [' ', true, false],
  ])
  assertEquals(line({ type: 'number', value: 2 }), [['2', false, false]])
  assertEquals(line({ type: 'password', value: 'abc' }), [[
    '•••',
    false,
    false,
  ]])
  assertEquals(line({ type: 'checkbox', value: 'on' }), [['☐', false, false]])
  assertEquals(line({ type: 'checkbox', checked: true }), [['☑', false, false]])
  assertEquals(line({ type: 'hidden', value: 'x' }), [])
})

test('a select paints its chosen option, as it shows closed', () => {
  let shown = (attrs: Record<string, unknown>, ...options: TElement[]) =>
    seen(el('root', {}, el('div', {}, el('select', attrs, ...options))))[0]
  let option = (text: string, attrs = {}) => el('option', attrs, text)
  assertEquals(shown({ value: 'b' }, option('a'), option('b')), 'b ▾')
  assertEquals(
    shown({ value: '' }, option('+ add', { value: '' }), option('x')),
    '+ add ▾',
  )
  assertEquals(
    shown({}, option('a'), option('b', { selected: '' })),
    'b ▾',
  )
  assertEquals(
    shown({}, el('optgroup', {}, option('a')), option('b')),
    'a ▾',
  )
})

test('an href is sanitized and rides in an OSC 8', () => {
  let a = el('a', { href: 'https://x/\x07evil' }, 'link')
  let line = screenful(el('root', {}, el('div', {}, a)), 20, 1).lines[0]
  assertEquals(ansi(line), '\x1b]8;;https://x/evil\x07link\x1b]8;;\x07')
  // A link its sheet lays out as a block links all the same.
  let row = el('a', { href: '/T-1', class: 'Row' }, el('span', {}, 'T-1'))
  let laid = screenful(el('root', {}, row), 20, 1, { Row: { block: true } })
  assertEquals(ansi(laid.lines[0]), '\x1b]8;;/T-1\x07T-1\x1b]8;;\x07')
})

test('a spaced layout keeps the parts of a sheet block apart, even in a dd', () => {
  let tile = () =>
    el(
      'a',
      { href: '/T-1', class: 'Tile' },
      el('span', {}, 'T-1'),
      el('span', {}, 'task'),
    )
  let tree = el(
    'root',
    {},
    tile(),
    el('dl', {}, el('dt', {}, 'to'), el('dd', {}, tile())),
  )
  let c = { sheet: { Tile: { block: true } }, metrics: {}, spaced: true }
  assertEquals(words(lay(tree, {}, 20, null, c)), ['T-1 task', 'to: T-1 task'])
})

test('a row puts a fixed sidebar beside a growing column', () => {
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

test('a col gives its leftover rows to the growing child', () => {
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
  assertEquals(metrics.body, { total: 5, height: 3, width: 20 })
})

test('a scroll region reports the line an element marked reveal paints', () => {
  let tree = (at?: string) =>
    el(
      'root',
      { col: '1' },
      el(
        'div',
        { grow: '1', id: 'body', scroll: '0' },
        ...['a', 'b', 'c', 'd', 'e'].map((t) =>
          el('div', t == at ? { reveal: '' } : {}, el('span', {}, t))
        ),
      ),
    )
  assertEquals(screenful(tree('d'), 20, 2).metrics.body.reveal, 3)
  assertEquals(screenful(tree(), 20, 2).metrics.body.reveal, undefined)
})

test('a scroll offset windows the content and is clamped to it', () => {
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

test('a spaced style keeps its runs apart, as a CSS gap does', () => {
  let tree = (cls: string) =>
    el(
      'root',
      {},
      el('div', { class: cls }, el('span', {}, 'id'), el('span', {}, 'title')),
    )
  assertEquals(words(screenful(tree('Row'), 20, 1).lines), ['idtitle'])
  assertEquals(
    words(screenful(tree('Row'), 20, 1, { Row: { spaced: true } }).lines),
    ['id title'],
  )
})

test('a sheet lays a box out as its attributes would', () => {
  let tree = (attrs: Record<string, string>) =>
    el(
      'root',
      {},
      el(
        'div',
        { class: 'Row', ...attrs },
        el('div', { class: 'Nav', ...attrs.row && { width: '4' } }, 'ab'),
        el('div', {}, 'cd'),
      ),
    )
  let sheet = { Row: { row: true }, Nav: { width: 4 } }
  assertEquals(words(screenful(tree({ row: '1' }), 10, 1).lines), ['ab  cd'])
  assertEquals(words(screenful(tree({}), 10, 1, sheet).lines), ['ab  cd'])
})

test('a grid lines its rows up in shared columns, each cell cut or set to its side', () => {
  let row = (...cells: string[]) =>
    el(
      'div',
      { class: 'Row' },
      ...cells.map((text) =>
        el('div', { class: /^[\d,n]+$/.test(text) ? 'Num' : 'Cell' }, text)
      ),
    )
  let tree = el(
    'root',
    {},
    el(
      'div',
      { class: 'Grid' },
      el('div', {}, row('id', 'title', 'n')),
      el(
        'div',
        {},
        row('T-1', 'a title far too long to fit', '7'),
        row('T-22', 'short', '1,204'),
      ),
    ),
  )
  let sheet = {
    Grid: { grid: true },
    Row: { row: true, bg: '#111111' },
    Cell: { ellipsis: true },
    Num: { align: 'right' as const },
  }
  let { lines } = screenful(tree, 24, 3, sheet)
  assertEquals(words(lines), [
    'id    title            n',
    'T-1   a title fa…      7',
    'T-22  short        1,204',
  ])
  // A row's colours run under its gaps and out to the grid's edge.
  assert(lines.every((l) => l.every((s) => s.style.bg == '#111111')))
})

test('a bare anchor wears the sheet’s Link; one with a class wears its class', () => {
  let fg = (a: TElement) =>
    screenful(el('root', {}, el('div', {}, a)), 20, 1, {
      Link: { fg: '#0000ff' },
      Tile: { fg: '#00ff00' },
    }).lines[0][0].style.fg
  assertEquals(fg(el('a', { href: '/x' }, 'x')), '#0000ff')
  assertEquals(fg(el('a', { href: '/x', class: 'Tile' }, 'x')), '#00ff00')
})

test('a block style lays an inline tag out on lines of its own', () => {
  let item = (text: string) => el('button', { class: 'Item' }, text)
  let tree = el('root', {}, el('div', {}, item('one'), item('two')))
  assertEquals(words(screenful(tree, 20, 2).lines), ['onetwo', ''])
  assertEquals(
    words(screenful(tree, 20, 2, { Item: { block: true } }).lines),
    ['one', 'two'],
  )
})

test('a style becomes the escapes, and nothing else does', () => {
  let line = screenful(
    el('root', {}, el('div', { class: 'Title' }, 'hi')),
    10,
    1,
    dress,
  ).lines[0]
  assertEquals(ansi(line), '\x1b[1mhi\x1b[0m')
})

test('the backend paints only the lines that changed', () => {
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

test('wrap folds words and long tokens before measuring and scrolling', () => {
  let tree = el(
    'div',
    { wrap: '1', scroll: '1', id: 'log' },
    'hello world\nabcdefghijk\n\nend',
  )
  let { lines, metrics } = screenful(tree, 6, 4)
  assertEquals(words(lines), ['world', 'abcdef', 'ghijk', ''])
  assertEquals(metrics.log, { total: 6, height: 4, width: 6 })
  assertEquals(seen(el('div', { wrap: '1' }, 'abcdef'), 3, 2), ['abc', 'def'])
  assertEquals(seen(el('div', { wrap: '1' }, 'abc'), 0, 1), [''])
})

test('wrap preserves inline styles, explicit blank lines and indent width', () => {
  let tree = el(
    'div',
    { wrap: '1', class: 'Inset' },
    el('span', { class: 'Title' }, 'hello '),
    el('span', {}, 'world'),
  )
  let { lines } = screenful(tree, 8, 3, {
    Inset: { indent: 2 },
    Title: { bold: true },
  })
  assertEquals(words(lines), ['  hello', '  world', ''])
  assertEquals(lines[0][1].style.bold, true)
  assertEquals(lines[1][1].style.bold, undefined)
  assertEquals(seen(el('pre', { wrap: '1' }, '123456\n\nx'), 3, 4), [
    '123',
    '456',
    '',
    'x',
  ])
})

test('inline and fenced code wear the Code style', () => {
  let tree = el(
    'root',
    {},
    el('p', {}, 'before ', el('code', {}, 'a < b'), ' after'),
    el('pre', {}, el('code', {}, '  first\nsecond')),
  )
  let { lines } = screenful(tree, 40, 4, dress)
  assertEquals(words(lines).slice(0, 3), [
    'before a < b after',
    '  first',
    'second',
  ])
  let output = lines.map(ansi).join('\n')
  assert(
    output.includes('\x1b[38;2;127;187;179;48;2;52;52;52ma < b\x1b[0m after'),
  )
  assert(output.includes('\x1b[38;2;127;187;179;48;2;52;52;52m  first'))
  assert(output.includes('\x1b[38;2;127;187;179;48;2;52;52;52msecond'))
  assert(!output.includes('\x1b[7m'))
  // A highlighter's spans keep their colours inside the block.
  let lit = el(
    'pre',
    {},
    el('code', {}, el('span', { class: 'Title' }, 'let'), ' n\nsay()'),
  )
  let [first] = screenful(el('root', {}, lit), 12, 2, dress).lines
  assertEquals(first.map((s) => [s.text, !!s.style.bold]).slice(0, 2), [
    ['let', true],
    [' n       ', false],
  ])
  let custom = screenful(tree, 40, 4, {
    Code: { fg: '#112233', bg: '#223344' },
  })
  assert(
    custom.lines.map(ansi).join('').includes('38;2;17;34;51;48;2;34;51;68'),
  )
})

test('themed borders reserve inner width and height without dimming content', () => {
  let root = el(
    'div',
    { border: 'Composer_Border' },
    el('div', { id: 'inside', scroll: '0' }, 'abc'),
  )
  let got = screenful(root, 7, 4, dress)
  assertEquals(words(got.lines), ['╭─────╮', '│abc  │', '│     │', '╰─────╯'])
  assertEquals(got.metrics.inside.width, 5)
  assertEquals(got.metrics.inside.height, 2)
  assertEquals(got.lines[1][0].style.dim, true)
  assertEquals(got.lines[1][1].style.dim, undefined)
  for (let width of [1, 2]) {
    let narrow = screenful(root, width, 3, dress)
    assertEquals(narrow.metrics.inside.width, width)
  }
})

test('quotes use a muted surface with normal text and preserve nested inline styles', () => {
  let tree = el(
    'div',
    { class: 'Dim' },
    el(
      'blockquote',
      {},
      el(
        'p',
        {},
        'normal ',
        el('strong', {}, 'bold'),
        ' ',
        el('em', {}, 'italic'),
        ' ',
        el('code', {}, 'code'),
      ),
      el('blockquote', { wrap: '1' }, 'nested words wrap here'),
    ),
  )
  let got = screenful(tree, 22, 10, dress)
  let spans = got.lines.flat()
  let normal = spans.find((s) => s.text.includes('normal'))!
  assertEquals(normal.style.fg, '#d3c6aa')
  assertEquals(normal.style.bg, '#343f44')
  assertEquals(normal.style.dim, false)
  assertEquals(spans.find((s) => s.text.includes('bold'))!.style.bold, true)
  assertEquals(spans.find((s) => s.text.includes('italic'))!.style.italic, true)
  assertEquals(spans.find((s) => s.text.includes('code'))!.style.fg, '#7fbbb3')
  assert(words(got.lines).some((line) => line.startsWith('  normal')))
  assert(words(got.lines).some((line) => line.startsWith('    nested')))
  assert(words(got.lines).some((line) => line.startsWith('    here')))
  let output = got.lines.map(ansi).join('')
  assert(output.includes('\x1b[38;2;211;198;170;48;2;52;63;68mnormal '))
  let custom = screenful(el('blockquote', {}, 'custom'), 20, 2, {
    Quote: { fg: '#112233', bg: '#223344', dim: false },
  })
  assert(
    custom.lines.map(ansi).join('').includes('38;2;17;34;51;48;2;34;51;68'),
  )
  assertEquals(words(custom.lines)[0], '  custom')
})

test('br preserves explicit breaks inside styled inline content and blank rows', () => {
  assertEquals(
    seen(
      el(
        'div',
        {},
        'first',
        el('span', {}, el('br'), el('strong', {}, 'second')),
        el('br'),
        el('br'),
        'third',
      ),
      30,
      4,
    ),
    ['first', 'second', '', 'third'],
  )
})

test('pre backgrounds fill allocated width including empty lines; inline code does not', () => {
  let code = el('pre', {}, el('code', {}, 'one\n\nthree'))
  let lines = screenful(el('root', {}, code), 12, 3, dress).lines
  assertEquals(lines.map((row) => row.map((s) => s.text).join('')), [
    'one         ',
    '            ',
    'three       ',
  ])
  for (let row of lines) {
    assert(row.every((s) => s.style.bg == '#343434'))
  }
  let inline = screenful(
    el('root', {}, el('div', {}, el('code', {}, 'x'), 'y')),
    12,
    1,
    dress,
  ).lines[0]
  assertEquals(inline.map((s) => s.text).join(''), 'xy')
  assertEquals(inline[0].style.bg, '#343434')
  assertEquals(inline[1].style.bg, undefined)
})

test('pre fill respects nested borders, indentation and narrow widths', () => {
  let root = el(
    'root',
    {},
    el(
      'div',
      { border: 'Composer_Border' },
      el('blockquote', {}, el('pre', {}, el('code', {}, 'x\n'))),
    ),
  )
  let lines = screenful(root, 12, 5, dress).lines
  for (let row of lines.slice(1, 3)) {
    assertEquals(row.map((s) => s.text).join('').length, 12)
    let filled = row.filter((s) => s.style.fg == '#7fbbb3')
    assertEquals(filled.map((s) => s.text).join('').length, 8)
  }
  assertEquals(seen(el('root', {}, el('pre', {}, 'long\n')), 1, 2), [
    'long',
    '',
  ])
})

test('full-width pre background is stable on warm paints', () => {
  let root = el('root', {}, el('pre', {}, 'short\n\nlast'))
  let backend = ansiBackend({
    size: () => ({ columns: 20, rows: 3 }),
    write: () => {},
  })
  assertEquals(backend.draw(root).written, 3)
  assertEquals(backend.draw(root).written, 0)
})

test('terminal focus reporting is saved, enabled, and restored', () => {
  let out: string[] = []
  let back = ansiBackend({ write: (s) => void out.push(s) })
  back.start()
  assert(out.join('').includes('\x1b[?1004s\x1b[?1004h'))
  out.length = 0
  back.stop()
  assert(out.join('').includes('\x1b[?1004r'))
})

test('maximum height bounds wrapped previews and emits overflow only when needed', () => {
  const attrs = { wrap: '1', 'max-height': '2', 'overflow-text': 'more' }
  assertEquals(seen(el('div', attrs, 'x'.repeat(50)), 10, 6).filter(Boolean), [
    'xxxxxxxxxx',
    'xxxxxxxxxx',
    'more',
  ])
  assertEquals(seen(el('div', attrs, 'short'), 10, 6).filter(Boolean), [
    'short',
  ])
})
