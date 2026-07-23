// Paint the fake DOM to the terminal: block elements stack as lines, inline
// elements flow into them, and class names look up the sheet — the same
// BEM names the web styles, wearing the same Everforest in ANSI truecolor.
// Layout is one column of lines (no flex, no boxes yet); the app's last
// line (the statusbar) is pinned to the bottom row.
import { TElement, TNode, TText } from './dom.ts'

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

  // shared views, styled by the same class names the web uses
  Dot: { glyph: '●', fg: '#7a8478' },
  'Dot-open': { fg: '#a7c080' }, // green = open, purple = done (GitHub's read)
  'Dot-wip': { fg: '#dbbc7f' },
  'Dot-done': { fg: '#d699b6' },
  'Dot-cancelled': { fg: '#7a8478' },
  'Dot-gated': { fg: '#e67e80' }, // open requires deps: blocked in fact
  Id: { fg: '#7a8478' },
  'Id-retired': { fg: '#7a8478', dim: true, strike: true },
  Task_Title: { bold: true },
  Task_Body: { fg: '#9da9a0' },
  Task_Claim: { fg: '#d699b6' },
  Debug_Claim: { fg: '#d699b6' },
  Comments_Who: { fg: '#7fbbb3' },
  Task_Prio: { fg: '#7a8478' },
  Debug_Prio: { fg: '#7a8478' },
  TComment: { fg: '#9da9a0' },
  Dependency: { fg: '#9da9a0' },
  'Dependency_Type-requires': { fg: '#e67e80' },
  'Dependency_Type-reads': { fg: '#7fbbb3' },
  'Dependency_Type-contains': { fg: '#dbbc7f' },
  'Inline_Title-settled': { strike: true },
  Debug_Kind: { fg: '#7a8478' },
  Debug_Comp: { fg: '#e69875' },
  Debug_Key: { fg: '#7a8478' },
  'Debug_Val-num': { fg: '#d699b6' },
  'Debug_Val-id': { fg: '#7a8478' },
  'Debug_Status-open': { fg: '#a7c080' },
  'Debug_Status-wip': { fg: '#dbbc7f' },
  'Debug_Status-done': { fg: '#d699b6' },
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
    // \n survives as a break (blocks() splits on it); \r and \t would let
    // the terminal do its own cursor moves — one scrolled line breaks the
    // whole absolute-positioned frame.
    let text = n.data.replaceAll('\r', '').replaceAll('\t', '  ')
    return text ? [{ text, style: st }] : []
  }
  let el = n as TElement
  let o = own(el)
  if (el.localName == 'a' && el.attr('href')) o.href = el.attr('href')
  let s = inherit(st, o)
  if (o.glyph) return [{ text: o.glyph, style: s }]
  return el.childNodes.flatMap((c) => inline(c, s))
}

let text = (n: TNode): string =>
  n instanceof TText ? n.data : (n as TElement).childNodes.map(text).join('')

let blocks = (el: TElement, st: Style): Line[] => {
  let o = own(el)
  let s = inherit(st, o)
  let lines: Line[] = []
  let cur: Seg[] = []
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
          cur.length && !/\s$/.test(cur[cur.length - 1].text) &&
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

let ansi = (line: Line): string =>
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

// One full repaint: content lines fill the screen (clipped — no scrolling
// yet), the tree's last line rides the bottom row as the statusbar.
export let paint = (root: TElement) => {
  let { columns, rows } = Deno.consoleSize()
  let lines = blocks(root, {})
  while (lines.length && !lines[lines.length - 1].length) lines.pop()
  let status = lines.pop() ?? []
  let out = '\x1b[H'
  for (let i = 0; i < rows - 1; i++) {
    out += ansi(clip(lines[i] ?? [], columns)) + '\x1b[K\r\n'
  }
  out += ansi(clip(status, columns)) + '\x1b[K'
  Deno.stdout.writeSync(enc.encode(out))
}
