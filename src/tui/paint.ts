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
  inverse?: boolean
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
  TStatus_Msg: { fg: '#9da9a0' },
  TStatus_Hint: { fg: '#7a8478' },

  // shared views, styled by the same class names the web uses
  Dot: { glyph: '●', fg: '#7a8478' },
  'Dot-open': { fg: '#7fbbb3' },
  'Dot-wip': { fg: '#dbbc7f' },
  'Dot-done': { fg: '#a7c080' },
  Id: { fg: '#7a8478' },
  Task_Title: { bold: true },
  Task_Body: { fg: '#9da9a0' },
  Dependency: { fg: '#9da9a0' },
  'Dependency_Type-requires': { fg: '#e67e80' },
  'Dependency_Type-reads': { fg: '#7fbbb3' },
  'Dependency_Type-contains': { fg: '#dbbc7f' },
  Debug_Kind: { fg: '#7a8478' },
  Debug_Comp: { fg: '#e69875' },
  Debug_Key: { fg: '#7a8478' },
  'Debug_Val-num': { fg: '#d699b6' },
  'Debug_Val-id': { fg: '#7a8478' },
  'Debug_Status-open': { fg: '#7fbbb3' },
  'Debug_Status-wip': { fg: '#dbbc7f' },
  'Debug_Status-done': { fg: '#a7c080' },
  Debug_Kids: { indent: 2 },
  Debug_More: { fg: '#7a8478' },
}

type Seg = { text: string; style: Style }
type Line = Seg[]

let INLINE = new Set(['span', 'b', 'i', 'a', 'button', 'label'])

let own = (el: TElement): Style =>
  Object.assign(
    {},
    ...el.className.split(/\s+/).filter(Boolean).map((c) => sheet[c] ?? {}),
  )

// Inherit color/weight down the tree; glyph/indent/gap act only where set.
let inherit = (parent: Style, node: Style): Style => ({
  fg: node.fg ?? parent.fg,
  bold: node.bold ?? parent.bold,
  dim: node.dim ?? parent.dim,
  inverse: node.inverse ?? parent.inverse,
})

let inline = (n: TNode, st: Style): Seg[] => {
  if (n instanceof TText) {
    return n.data ? [{ text: n.data, style: st }] : []
  }
  let el = n as TElement
  let o = own(el)
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
        if (cur.length) cur.push({ text: ' ', style: s })
        cur.push(...segs)
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
    if (s.style.inverse) codes.push('7')
    return codes.length ? `\x1b[${codes.join(';')}m${s.text}\x1b[0m` : s.text
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
