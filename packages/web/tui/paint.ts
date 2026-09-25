// Paint the fake DOM to the terminal as a window of lines around the app's
// cursor. @yaks/tui lays the tree out and speaks ANSI; what is the board's own
// is its class sheet — the TUI's chrome, and the same BEM names the web
// styles, wearing the same Everforest in truecolor — the window that follows
// the cursor, and the statusbar: the tree's last line, pinned to the bottom
// row.
import {
  ansi,
  clip,
  clipboard as osc52,
  lay,
  type Line,
  type Sheet,
  type TElement,
} from '@yaks/tui'

export let sheet: Sheet = {
  // TUI-only chrome
  TTitle: { bold: true, gap: true },
  TCol: { gap: true },
  TCol_Name: { fg: '#7a8478', bold: true },
  TRow: { indent: 2 },
  'TRow-on': { inverse: true },
  TDetail: { gap: true },
  TStatus_Mode: { fg: '#7a8478', bold: true },
  'TStatus_Mode-insert': { fg: '#dbbc7f' },
  'TStatus_Mode-visual': { fg: '#d699b6' },
  TStatus_Verb: { fg: '#a7c080' },
  TStatus_Msg: { fg: '#9da9a0' },
  TStatus_Hint: { fg: '#7a8478' },
  TKeys_Title: { bold: true, gap: true },
  TKeys_Key: { fg: '#dbbc7f' },
  TKeys_Hint: { fg: '#7a8478', dim: true },

  // shared views, styled by the same class names the web uses. The web's
  // glyph pips speak character here: ring open, half-moon wip — a full
  // disc when a live hand is on it (Dot-live) — ✓ done, ✕ cancelled,
  // ! blocked.
  Dot: { glyph: '●', fg: '#7a8478' },
  'Dot-open': { glyph: '○', fg: '#7fbbb3' },
  'Dot-wip': { glyph: '◐', fg: '#dbbc7f' },
  'Dot-live': { glyph: '●' },
  'Dot-done': { glyph: '✓', fg: '#a7c080' },
  'Dot-cancelled': { glyph: '✕', fg: '#7a8478' },
  'Dot-gated': { glyph: '!', fg: '#e67e80', bold: true }, // the blocked facet: stuck on an external reason (D-17094)
  Id: { fg: '#7a8478' },
  'Id-retired': { fg: '#7a8478', dim: true, strike: true },
  MemoryType: { fg: '#a7c080' },
  Stamp: { fg: '#7a8478', dim: true },
  Task_Title: { bold: true },
  Task_Body: { fg: '#9da9a0' },
  Task_Claim: { fg: '#d699b6' },
  Debug_Claim: { fg: '#d699b6' },
  Comments_Who: { fg: '#7fbbb3' },
  'Comments_Verdict-approved': { fg: '#a7c080' },
  'Comments_Verdict-rejected': { fg: '#e67e80' },
  'Comments_Verdict-changes-requested': { fg: '#dbbc7f' },
  Task_Prio: { fg: '#7a8478' },
  Debug_Prio: { fg: '#7a8478' },
  Dependency: { fg: '#9da9a0' },
  'Dependency_Type-requires': { fg: '#e67e80' },
  'Dependency_Type-reads': { fg: '#7fbbb3' },
  'Dependency_Type-contains': { fg: '#dbbc7f' },
  'Inline_Title-settled': { strike: true },
  Debug_Kind: { fg: '#7a8478' },
  'Debug_Comp-0': { fg: '#7fbbb3' },
  'Debug_Comp-1': { fg: '#dbbc7f' },
  'Debug_Comp-2': { fg: '#d699b6' },
  'Debug_Comp-3': { fg: '#a7c080' },
  'Debug_Comp-4': { fg: '#e69875' },
  'Debug_Comp-5': { fg: '#e67e80' },
  Debug_Key: { fg: '#7a8478' },
  'Debug_Val-num': { fg: '#d699b6' },
  'Debug_Val-id': { fg: '#7a8478' },
  'Debug_Status-open': { fg: '#7fbbb3' },
  'Debug_Status-wip': { fg: '#dbbc7f' },
  'Debug_Status-done': { fg: '#a7c080' },
  'Debug_Status-cancelled': { fg: '#7a8478' },
  Debug_Kids: { indent: 2 },
  Debug_More: { fg: '#7a8478' },

  // markdown (the TUI Md renderer's spans)
  Md_B: { bold: true },
  Md_I: { italic: true },
  Md_S: { strike: true },
  Md_Code: { fg: '#e69875' },
  Md_A: { fg: '#7fbbb3', underline: true },
  Md_Ref: { fg: '#7fbbb3', bold: true },
  Md_H: { bold: true, fg: '#a7c080' },
  Md_Q: { fg: '#9da9a0', italic: true },
  Md_Fence: { fg: '#7a8478' },
  'hljs-keyword': { fg: '#e67e80' },
  'hljs-selector-tag': { fg: '#e67e80' },
  'hljs-literal': { fg: '#d699b6' },
  'hljs-number': { fg: '#d699b6' },
  'hljs-string': { fg: '#a7c080' },
  'hljs-title': { fg: '#7fbbb3' },
  'hljs-section': { fg: '#7fbbb3', bold: true },
  'hljs-built_in': { fg: '#dbbc7f' },
  'hljs-type': { fg: '#dbbc7f' },
  'hljs-attr': { fg: '#e69875' },
  'hljs-variable': { fg: '#e69875' },
  'hljs-comment': { fg: '#7a8478', italic: true },
  'hljs-meta': { fg: '#7a8478' },
  'hljs-addition': { fg: '#a7c080' },
  'hljs-deletion': { fg: '#e67e80' },
}

// The lines a tree makes, minus the statusbar the app pins to the bottom row.
// The window and `l` read the same list, so what the cursor is on is exactly
// what you see it on. The components are the browser's, kept apart by CSS
// gaps there, so the layout is `spaced`. The width only pads a `pre` block;
// with no terminal attached (a test) there is none to read.
let width = () => {
  try {
    return Deno.consoleSize().columns
  } catch {
    return 80
  }
}
export let pane = (root: TElement, columns = width()) => {
  let lines = lay(root, {}, columns, null, { sheet, metrics: {}, spaced: true })
  while (lines.length && !lines[lines.length - 1].length) lines.pop()
  let status = lines.pop() ?? []
  return { lines, status }
}

let enc = new TextEncoder()

// OSC 52: hand text to the clipboard through the terminal — the escape travels
// the tty like any output, so it works across ssh (the local terminal does the
// copying; tmux needs set-clipboard on).
export let clipboard = (text: string) =>
  Deno.stdout.writeSync(enc.encode(osc52(text)))

// The link on a line, if it has one. Every Id chip and Inline title is already
// an anchor carrying the href the web navigates, so a row-selecting view
// (Inbox, List) is enterable from the terminal without growing a selection of
// its own.
export let link = (root: TElement, at: number) =>
  pane(root).lines[at]?.find((s) => s.style.href)?.style.href

// Where the window sits: the smallest move from `top` that keeps the cursor
// line on screen, never past the end of the content. `at < 0` — the board,
// whose cursor is over the query rather than over lines — pins it to the
// first line.
export let win = (top: number, at: number, h: number, n: number) =>
  Math.max(0, Math.min(Math.max(top, at - h + 1), at, n - h))

// The line the window should follow. In an entity pane that's the line cursor
// (`at`). On the board the cursor is over the query, not lines (`at < 0`), and
// it marks its selected row with an inverse style rather than a line number —
// so follow that line and a wall of tasks scrolls to keep the selection in
// view. -1 (empty board, nothing selected) leaves win() to pin the top.
export let cursorLine = (lines: Line[], at: number) =>
  at >= 0 ? at : lines.findIndex((l) => l.some((s) => s.style.inverse))

// The cursor line, inverted: the terminal cursor is hidden, so the bar is the
// only thing saying where j/k are. A blank line still shows one cell.
let mark = (l: Line): Line =>
  (l.length ? l : [{ text: ' ', style: {} }])
    .map((s) => ({ ...s, style: { ...s.style, inverse: true } }))

// One full repaint: the window's lines fill the screen, the tree's last line
// rides the bottom row as the statusbar. `at` is the app's cursor line (-1 for
// none); the window offset lives here because only the painter knows how tall
// the window or the content is. Returns the content's height so the app can
// pull back a cursor the content shrank past.
let top = 0
export let paint = (root: TElement, at = -1) => {
  let { columns, rows } = Deno.consoleSize()
  let { lines, status } = pane(root, columns)
  let h = rows - 1
  at = Math.min(at, lines.length - 1)
  top = win(top, cursorLine(lines, at), h, lines.length)
  let out = '\x1b[H'
  for (let i = 0; i < h; i++) {
    let l = lines[top + i] ?? []
    out += ansi(clip(top + i == at ? mark(l) : l, columns)) + '\x1b[K\r\n'
  }
  out += ansi(clip(status, columns)) + '\x1b[K'
  Deno.stdout.writeSync(enc.encode(out))
  return lines.length
}
