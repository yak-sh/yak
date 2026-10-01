// Paint the fake DOM to the terminal as a window of lines around the app's
// cursor. @yaks/tui lays the tree out and speaks ANSI; the class sheet is
// @yaks/ui's components in Everforest, then the board's own: the TUI's chrome,
// and the domain views' parts under the same BEM names the web styles. Then
// the window that follows the cursor, and the statusbar: the tree's last
// line, pinned to the bottom row.
import {
  ansi,
  base,
  clip,
  clipboard as osc52,
  lay,
  type Line,
  type Sheet,
  type TElement,
} from '@yaks/tui'
import { type Colors, everforest, kits, sheet as dress } from '@yaks/ui'

// The board's own classes, in the theme's colours.
let own = (c: Colors): Sheet => ({
  // TUI-only chrome
  TTitle: { bold: true, gap: true },
  TCol: { gap: true },
  TCol_Name: { fg: c.dim, bold: true },
  TRow: { indent: 2 },
  'TRow-on': { inverse: true },
  TDetail: { gap: true },
  TStatus_Mode: { fg: c.dim, bold: true },
  'TStatus_Mode-insert': { fg: c.active },
  'TStatus_Mode-visual': { fg: c.special },
  TStatus_Verb: { fg: c.accent },
  TStatus_Msg: { fg: c.muted },
  TStatus_Hint: { fg: c.dim },
  TKeys_Title: { bold: true, gap: true },
  TSearch_Title: { bold: true, gap: true },
  TSearch_Id: { fg: c.dim },
  TSearch_Kind: { fg: c.dim },
  TSearch_Hint: { fg: c.dim, dim: true },
  TFilter: { gap: true },
  TFilter_Label: { fg: c.dim, bold: true },
  TKeys_Key: { fg: c.accent },
  TKeys_Hint: { fg: c.dim, dim: true },

  // the domain views, under the class names the web styles
  Entry_Speaker: { fg: c.dim, bold: true, block: true },
  'Entry-user': { fg: c.who, indent: 2 },
  'Entry-agent': { fg: c.text },
  MemoryType: { fg: c.accent },
  Task_Title: { bold: true },
  Task_Body: { fg: c.muted },
  Task_Claim: { fg: c.special },
  Comments_Who: { fg: c.who },
  'Comments_Verdict-approved': { fg: c.positive },
  'Comments_Verdict-rejected': { fg: c.negative },
  'Comments_Verdict-changes-requested': { fg: c.caution },
  Task_Prio: { fg: c.dim },
  Dependency: { fg: c.muted },
  'Dependency_Type-requires': { fg: c.hues[5] }, // the edges, as styles.css
  'Dependency_Type-reads': { fg: c.hues[0] },
  'Dependency_Type-contains': { fg: c.hues[1] },
  'Inline_Title-settled': { strike: true },
  Debug_Claim: { fg: c.special },
  Debug_Prio: { fg: c.dim },
  Debug_Kind: { fg: c.dim },
  'Debug_Comp-0': { fg: c.hues[0] },
  'Debug_Comp-1': { fg: c.hues[1] },
  'Debug_Comp-2': { fg: c.special },
  'Debug_Comp-3': { fg: c.hues[3] },
  'Debug_Comp-4': { fg: c.hues[4] },
  'Debug_Comp-5': { fg: c.hues[5] },
  Debug_Key: { fg: c.dim },
  'Debug_Val-num': { fg: c.special },
  'Debug_Val-id': { fg: c.dim },
  'Debug_Status-open': { fg: c.hues[0] },
  'Debug_Status-wip': { fg: c.hues[1] },
  'Debug_Status-done': { fg: c.hues[3] },
  'Debug_Status-cancelled': { fg: c.dim },
  Debug_Kids: { indent: 2 },
  Debug_More: { fg: c.dim },

  // markdown (the TUI Md renderer's spans)
  Md_B: { bold: true },
  Md_I: { italic: true },
  Md_S: { strike: true },
  Md_Code: { fg: c.text, bg: c.card },
  Md_A: { fg: c.link, underline: true },
  Md_Ref: { fg: c.link, bold: true },
  Md_H: { bold: true, fg: c.heading },
  Md_Q: { fg: c.muted, italic: true },
  Md_Fence: { fg: c.dim },
})

export let sheet: Sheet = {
  ...base,
  ...dress({ kits, theme: everforest }),
  ...own(everforest.colors),
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
