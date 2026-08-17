// Paint the fake DOM to the terminal: block elements stack as lines, inline
// elements flow into them, and class names look up the sheet — the same
// BEM names the web styles, wearing the same Everforest in ANSI truecolor.
// Layout is one column of lines (no flex, no boxes yet); the app's last
// line (the statusbar) is pinned to the bottom row, and the rest is a
// window onto the lines around the app's cursor.
import { TElement, TNode, TText } from './dom.ts'
import { safe, safeHref } from '../terminal.ts'

type Style = {
  fg?: string // hex
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  inverse?: boolean
  href?: string // OSC 8 hyperlink target (from an <a>, not the sheet)
  glyph?: string // paint this instead of children (the Dot)
  indent?: number // shift this element's lines right
  gap?: boolean // blank line after this element's lines
}

let sheet: Record<string, Style> = {
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
  TAccount_Title: { bold: true, gap: true },
  'TAccount_Title-on': { inverse: true },
  TAccount_State: { fg: '#9da9a0' },
  'TAccount_State-ready': { fg: '#a7c080' },
  'TAccount_State-error': { fg: '#e67e80' },
  'TAccount_State-unavailable': { fg: '#e67e80' },
  TAccount_Url: { fg: '#7fbbb3', underline: true },
  TAccount_Code: { fg: '#dbbc7f', bold: true },
  TAccount_Error: { fg: '#e67e80' },
  TAccount_Key: { fg: '#dbbc7f' },
  TAccount_Hint: { fg: '#7a8478', dim: true },
  TConfig_Title: { bold: true, gap: true },
  TConfig_Group: { fg: '#7a8478', bold: true },
  'TConfig_Row-on': { inverse: true },
  TConfig_Label: { fg: '#9da9a0' },
  TConfig_Value: { fg: '#dbbc7f' },
  TConfig_Source: { fg: '#7a8478' },
  'TConfig_Source-graph': { fg: '#a7c080' },
  TConfig_State: { fg: '#9da9a0' },
  'TConfig_State-configured': { fg: '#a7c080' },
  'TConfig_State-missing': { fg: '#7a8478' },
  'TConfig_State-unavailable': { fg: '#e67e80' },
  TConfig_Help: { fg: '#7a8478', dim: true },
  TConfig_Edit: { fg: '#dbbc7f' },
  TConfig_Hint: { fg: '#7a8478', dim: true },
  TConfig_Error: { fg: '#e67e80' },

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

type Seg = { text: string; style: Style }
type Line = Seg[]

let INLINE = new Set(['span', 'b', 'i', 'a', 'button', 'label'])

let own = (el: TElement): Style =>
  Object.assign(
    {},
    ...el.className.split(/\s+/).filter(Boolean).map((c) => sheet[c] ?? {}),
  )

// Inherit text style down the tree; glyph/indent/gap act only where set.
let inherit = (parent: Style, node: Style): Style => ({
  fg: node.fg ?? parent.fg,
  bold: node.bold ?? parent.bold,
  dim: node.dim ?? parent.dim,
  italic: node.italic ?? parent.italic,
  underline: node.underline ?? parent.underline,
  strike: node.strike ?? parent.strike,
  inverse: node.inverse ?? parent.inverse,
  href: node.href ?? parent.href,
})

let inline = (n: TNode, st: Style): Seg[] => {
  if (n instanceof TText) {
    let text = safe(n.data)
    return text ? [{ text, style: st }] : []
  }
  let el = n as TElement
  let o = own(el)
  // An href is content too — a markdown link in a body writes one — and it
  // rides inside an OSC 8, where a single BEL ends the sequence and lets the
  // rest of the URL run as its own. A URL needs nothing from the class.
  if (el.localName == 'a' && el.attr('href')) {
    o.href = safeHref(el.attr('href')!)
  }
  let s = inherit(st, o)
  if (o.glyph) return [{ text: o.glyph, style: s }]
  return el.childNodes.flatMap((c) => inline(c, s))
}

// The <pre> path's text, sanitized at the same seam — a text node's data is
// never painted raw, whichever branch reaches it.
let text = (n: TNode): string =>
  n instanceof TText
    ? safe(n.data)
    : (n as TElement).childNodes.map(text).join('')

let blocks = (el: TElement, st: Style): Line[] => {
  let o = own(el)
  let s = inherit(st, o)
  let lines: Line[] = []
  let cur: Seg[] = []
  let packed = el.className.split(/\s+/).includes('Md_Code')
  let flush = () => {
    if (cur.length) lines.push(cur)
    cur = []
  }
  if (el.localName == 'pre') {
    for (let l of text(el).split('\n')) lines.push([{ text: l, style: s }])
  } else {
    for (let c of el.childNodes) {
      if (c instanceof TText || INLINE.has((c as TElement).localName)) {
        let segs = inline(c, s)
        if (!segs.length) continue
        // The gap between inline siblings, unless one side brought its own.
        if (
          !packed && cur.length && !/\s$/.test(cur[cur.length - 1].text) &&
          !/^\s/.test(segs[0].text)
        ) {
          cur.push({ text: ' ', style: s })
        }
        for (let seg of segs) {
          // Newlines inside a text node (a task body) are line breaks.
          seg.text.split('\n').forEach((part, i) => {
            if (i) {
              lines.push(cur) // even empty — a blank line is content here
              cur = []
            }
            if (part) cur.push({ text: part, style: seg.style })
          })
        }
      } else {
        flush()
        lines.push(...blocks(c as TElement, s))
      }
    }
    flush()
  }
  if (o.indent) {
    lines = lines.map((l) => [{ text: ' '.repeat(o.indent!), style: s }, ...l])
  }
  if (o.gap && lines.length) lines.push([])
  return lines
}

let rgb = (hex: string) =>
  [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
    .map((h) => parseInt(h, 16))

// The bytes a line becomes — every escape the terminal sees is emitted HERE
// or by paint(), never by content. Exported so the test can read the stream.
export let ansi = (line: Line): string =>
  line.map((s) => {
    let codes: string[] = []
    if (s.style.fg) codes.push(`38;2;${rgb(s.style.fg).join(';')}`)
    if (s.style.bold) codes.push('1')
    if (s.style.dim) codes.push('2')
    if (s.style.italic) codes.push('3')
    if (s.style.underline) codes.push('4')
    if (s.style.inverse) codes.push('7')
    if (s.style.strike) codes.push('9')
    let t = codes.length ? `\x1b[${codes.join(';')}m${s.text}\x1b[0m` : s.text
    return s.style.href // OSC 8: the terminal makes it clickable
      ? `\x1b]8;;${s.style.href}\x07${t}\x1b]8;;\x07`
      : t
  }).join('')

let clip = (line: Line, width: number): Line => {
  let out: Line = []
  let len = 0
  for (let s of line) {
    if (len + s.text.length <= width) {
      out.push(s)
      len += s.text.length
    } else {
      out.push({ ...s, text: s.text.slice(0, width - len) })
      break
    }
  }
  return out
}

let enc = new TextEncoder()

// OSC 52: hand text to the clipboard THROUGH the terminal — the escape
// travels the tty like any output, so it works across ssh (the local
// terminal does the copying; tmux needs set-clipboard on).
export let clipboard = (text: string) => {
  let b64 = btoa(
    Array.from(enc.encode(text), (b) => String.fromCharCode(b)).join(''),
  )
  Deno.stdout.writeSync(enc.encode(`\x1b]52;c;${b64}\x07`))
}

// The lines a tree makes, minus the statusbar the app pins to the bottom
// row. The window and `l` read the same list, so what the cursor is on is
// exactly what you see it on.
export let pane = (root: TElement) => {
  let lines = blocks(root, {})
  while (lines.length && !lines[lines.length - 1].length) lines.pop()
  let status = lines.pop() ?? []
  return { lines, status }
}

// The link on a line, if it has one. Every Id chip and Inline title is
// already an anchor carrying the href the web navigates, so a row-selecting
// view (Inbox, List) is enterable from the terminal without growing a
// selection of its own.
export let link = (root: TElement, at: number) =>
  pane(root).lines[at]?.find((s) => s.style.href)?.style.href

// Where the window sits: the smallest move from `top` that keeps the cursor
// line on screen, never past the end of the content. `at < 0` — the board,
// whose cursor is over the QUERY rather than over lines — pins it to the
// first line.
export let win = (top: number, at: number, h: number, n: number) =>
  Math.max(0, Math.min(Math.max(top, at - h + 1), at, n - h))

// The line the window should follow. In an entity pane that's the line cursor
// (`at`). On the board the cursor is over the QUERY, not lines (`at < 0`), and
// it marks its selected row with an inverse style rather than a line number —
// so follow THAT line and a wall of tasks scrolls to keep the selection in
// view, exactly as the window tracks a real cursor. -1 (empty board / nothing
// selected) leaves win() to pin the top.
export let cursorLine = (lines: Line[], at: number) =>
  at >= 0 ? at : lines.findIndex((l) => l.some((s) => s.style.inverse))

// The cursor line, inverted: the terminal cursor is hidden, so the bar is
// the only thing saying where j/k are. A blank line still shows one cell.
let mark = (l: Line): Line =>
  (l.length ? l : [{ text: ' ', style: {} }])
    .map((s) => ({ ...s, style: { ...s.style, inverse: true } }))

// One full repaint: the window's lines fill the screen, the tree's last line
// rides the bottom row as the statusbar. `at` is the app's cursor line (-1
// for none); the window offset lives HERE because only the painter knows how
// tall the window or the content is. Returns the content's height so the app
// can pull back a cursor the content shrank past.
let top = 0
export let paint = (root: TElement, at = -1) => {
  let { columns, rows } = Deno.consoleSize()
  let { lines, status } = pane(root)
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
