import { visualLines } from './visual.ts'
import { scrollbar } from './scrollbar.ts'
/**
 * The ANSI backend: a tree of fake-DOM nodes becomes lines, and lines become
 * bytes on a terminal.
 *
 * THE SEAM. A `Backend` is `{size, start, draw, reset, stop}` — five calls,
 * the whole contract `run()` knows. `draw(root)` is handed the rendered tree
 * and returns `{written, metrics}`: how many screen lines it actually wrote
 * (diagnostics, and what the snappiness test asserts on) and what it measured
 * while laying out (`{total, height}` per `id`, which is how a scroll region
 * learns how much content it has). Swapping this file for another renderer —
 * OpenTUI's renderable tree, say — means implementing those five, not touching
 * the widgets.
 *
 * LAYOUT is four structural attributes, because only the painter knows how
 * wide and tall the terminal is: `row` lays element children side by side
 * (`width` fixed, `grow` takes the rest), `col` stacks them (`grow` takes the
 * leftover rows), `height` fixes a box, and `scroll` windows a box's content
 * from that offset. Everything else flows: block elements stack as lines,
 * inline elements run into them, class names look up the sheet.
 *
 * THE BOUNDARY. Every text node and every href loses the C0/DEL/C1 class
 * before anything is painted (`@yaks/text`'s `safe`, with `\n` kept because a
 * newline inside a text node means a line break here). Every escape the
 * terminal sees is emitted by `ansi()` or by `draw()` — never by content.
 *
 * @module
 */

import { safe as strip, safeHref } from '@yaks/text'
import type { TElement, TNode } from './dom.ts'
import { touch, TText } from './dom.ts'
import { table } from './table.ts'
import { graphics } from './graphics.ts'
import { type Sheet, type Style, theme as base } from './theme.ts'

/** A run of text under one style. */
export type Seg = {
  /** Layout decoration, excluded from text selection copies. */
  decorative?: boolean
  /** This segment ends a visual wrap, not a source line break. */
  softBreak?: boolean
  text: string
  style: Style
  owner?: TElement
  image?: {
    source: import('./Image.ts').ImageSource
    row: number
    rows: number
    width: number
  }
}
/** One screen line, as styled runs. */
export type Line = Seg[]
/** What a scroll region measured on the last paint, per element id. */
export type Metrics = Record<
  string,
  { total: number; height: number; width: number }
>

/** The five calls `run()` makes of whatever draws the screen. */
export type Backend = {
  /** Receive an APC/DCS terminal protocol response, never keyboard text. */
  control?: (body: string) => void
  /** The terminal's size, in cells. */
  size: () => { columns: number; rows: number }
  /** Take the screen (alt screen, raw mode's escapes, hidden cursor). */
  start: () => void
  /** Paint the tree; report lines written and what was measured. */
  draw: (
    root: TElement,
  ) => { written: number; metrics: Metrics; lines?: Line[] }
  /** Forget what is on screen, so the next draw repaints every line. */
  reset: () => void
  /** Request clipboard write; terminals may deny it. */
  copy?: (text: string) => void
  /** Give the screen back exactly as it was found. */
  stop: () => void
}

// A newline inside a text node is a line break the painter honours, so the
// text host's boundary is applied per line rather than to the whole string.
let safe = (text: string) =>
  text.replaceAll('\t', '  ').split('\n').map(strip).join('\n')

// Semantic HTML emitted by shared Preact renderers. ANSI stays in this backend.
let semantic = (el: TElement, sheet: Sheet): Style => {
  let tag = el.localName
  if (tag == 'strong' || tag == 'b' || /^h[1-6]$/.test(tag) || tag == 'th') {
    return { bold: true }
  }
  if (tag == 'em' || tag == 'i') return { italic: true }
  if (tag == 'del') return { strike: true }
  if (tag == 'code' || tag == 'pre') return { ...sheet.Code }
  if (tag == 'blockquote') return { indent: 2, ...sheet.Quote }
  if (tag == 'hr') return { glyph: '────────', dim: true }
  return {}
}

let own = (el: TElement, sheet: Sheet): Style =>
  Object.assign(
    semantic(el, sheet),
    ...el.className.split(/\s+/).filter(Boolean).map((c) => sheet[c] ?? {}),
  )

// Inherit text style down the tree; glyph/indent/gap act only where set.
let inherit = (parent: Style, node: Style): Style => ({
  fg: node.fg ?? parent.fg,
  bg: node.bg ?? parent.bg,
  bold: node.bold ?? parent.bold,
  dim: node.dim ?? parent.dim,
  italic: node.italic ?? parent.italic,
  underline: node.underline ?? parent.underline,
  strike: node.strike ?? parent.strike,
  inverse: node.inverse ?? parent.inverse,
  href: node.href ?? parent.href,
})

let INLINE = new Set([
  'span',
  'br',
  'b',
  'i',
  'strong',
  'em',
  'del',
  'code',
  'a',
  'button',
  'label',
])

type Ctx = { sheet: Sheet; metrics: Metrics }

let inline = (n: TNode, st: Style, c: Ctx): Seg[] => {
  if (n instanceof TText) {
    let text = safe(n.data)
    return text ? [{ text, style: st, owner: n.parentNode ?? undefined }] : []
  }
  let el = n as TElement
  if (el.localName == 'br') return [{ text: '\n', style: st, owner: el }]
  let o = own(el, c.sheet)
  // An href is content too, and it rides inside an OSC 8 where a single BEL
  // ends the sequence and lets the rest of the URL run as its own.
  if (el.localName == 'a' && el.attr('href')) {
    o.href = safeHref(el.attr('href')!)
  }
  let s = inherit(st, o)
  if (o.glyph) return [{ text: o.glyph, style: s, owner: el }]
  return el.childNodes.flatMap((k) => inline(k, s, c))
}

// The <pre> path's text, sanitized at the same seam — a text node's data is
// never painted raw, whichever branch reaches it.
let text = (n: TNode): string =>
  n instanceof TText
    ? safe(n.data)
    : (n as TElement).childNodes.map(text).join('')

let kids = (el: TElement) =>
  el.childNodes.filter((n) => !(n instanceof TText)) as TElement[]

let num = (el: TElement, k: string) => {
  let v = el.attr(k)
  return v == null || v === '' ? null : +v
}

// Block flow: text and inline children run into a line, element children stack.
// A lone element child inherits the box: a wrapper div is not a layout, so the
// screen's height reaches the `col` or `row` an app returns from its root.
let flow = (
  el: TElement,
  s: Style,
  w: number,
  h: number | null,
  c: Ctx,
): Line[] => {
  let wrapper = kids(el).length == 1 &&
    !el.childNodes.some((n) =>
      n instanceof TText || INLINE.has((n as TElement).localName)
    )
  let lines: Line[] = []
  let cur: Seg[] = []
  let flush = () => {
    if (cur.length) lines.push(cur)
    cur = []
  }
  if (el.localName == 'tr') {
    for (let [i, cell] of kids(el).entries()) {
      if (i) cur.push({ text: ' | ', style: s })
      cur.push(...inline(cell, s, c))
    }
    flush()
    return lines
  }
  if (el.localName == 'hr') return [[{ text: '────────', style: s }]]
  if (el.localName == 'pre') {
    // A preformatted block paints its allocated width, including blank rows.
    // Keep long lines intact so the enclosing layout retains its wrap policy.
    for (let l of text(el).split('\n')) {
      lines.push([{ text: l.padEnd(Math.max(0, w), ' '), style: s }])
    }
    return lines
  }
  let previousParagraph = false
  for (let n of el.childNodes) {
    if (n instanceof TText || INLINE.has((n as TElement).localName)) {
      let segs = inline(n, s, c)
      if (!segs.length) continue
      previousParagraph = false
      for (let seg of segs) {
        // Newlines inside a text node are line breaks.
        seg.text.split('\n').forEach((part, i) => {
          if (i) {
            lines.push(cur) // even empty — a blank line is content here
            cur = []
          }
          if (part) cur.push({ ...seg, text: part })
        })
      }
    } else {
      flush()
      // HTML paragraphs have a visual boundary even without literal newlines.
      // Keep it between paragraphs, not after every paragraph/list item.
      let paragraph = (n as TElement).localName == 'p'
      if (paragraph && previousParagraph) lines.push([])
      previousParagraph = paragraph
      lines.push(...lay(n as TElement, s, w, wrapper ? h : null, c))
    }
  }
  flush()
  return lines
}

// Stack element children; `grow` children share whatever rows are left.
let col = (el: TElement, s: Style, w: number, h: number | null, c: Ctx) => {
  let all = kids(el)
  let fixed = new Map<TElement, Line[]>()
  for (let k of all) {
    if (k.attr('grow') == null) fixed.set(k, lay(k, s, w, null, c))
  }
  let used = [...fixed.values()].reduce((n, l) => n + l.length, 0)
  let growers = all.filter((k) => k.attr('grow') != null)
  let left = h == null ? null : Math.max(0, h - used)
  let out: Line[] = []
  if (left != null) {
    let shares = new Map<TElement, number>()
    let fitters = growers.filter((k) => k.attr('grow-fit') != null)
    let fair = Math.floor(left / Math.max(1, growers.length))
    for (let k of fitters) {
      let natural = lay(k, s, w, null, c).length
      let share = Math.min(natural, fair)
      shares.set(k, share)
      left -= share
    }
    let expanding = growers.filter((k) => !shares.has(k))
    expanding.forEach((k, i) => {
      let share = Math.floor(left! / (expanding.length - i))
      shares.set(k, share)
      left! -= share
    })
    for (let k of growers) fixed.set(k, lay(k, s, w, shares.get(k)!, c))
  }
  for (let k of all) out.push(...(fixed.get(k) ?? lay(k, s, w, null, c)))
  return out
}

// Lay element children side by side; `width` is fixed, `grow` takes the rest.
let row = (el: TElement, s: Style, w: number, h: number | null, c: Ctx) => {
  let all = kids(el)
  let fixed = all.map((k) => num(k, 'width'))
  let spare = w - fixed.reduce((n: number, v) => n + (v ?? 0), 0)
  let growers = fixed.filter((v) => v == null).length
  let taken = 0
  let widths = fixed.map((v, i) => {
    if (v != null) return v
    let last = fixed.lastIndexOf(null) == i
    let share = last ? spare - taken : Math.floor(spare / growers)
    taken += share
    return Math.max(0, share)
  })
  let cols = all.map((k, i) => lay(k, s, widths[i], h, c))
  let rows = h ?? Math.max(0, ...cols.map((l) => l.length))
  return Array.from({ length: rows }, (_, y) =>
    all.flatMap((_k, i) =>
      // The last column is not padded: the screen's own erase ends the line.
      i == all.length - 1
        ? clip(cols[i][y] ?? [], widths[i])
        : pad(clip(cols[i][y] ?? [], widths[i]), widths[i])
    ))
}

// Window a box's content from its scroll offset, recording what it measured.
let windowed = (
  el: TElement,
  lines: Line[],
  h: number | null,
  c: Ctx,
  width: number,
) => {
  let height = h ?? lines.length
  let id = el.attr('id')
  if (id) c.metrics[id] = { total: lines.length, height, width }
  let top = Math.min(
    Math.max(0, num(el, 'scroll') ?? 0),
    Math.max(0, lines.length - height),
  )
  return lines.slice(top, top + height)
}

/** The lines an element becomes, given a content width and allotted rows. */
let layout = (
  el: TElement,
  st: Style,
  w: number,
  h: number | null,
  c: Ctx,
): Line[] => {
  if (el.image) {
    let rows = Math.max(1, Math.min(16, Math.floor(el.image.rows) || 8))
    return Array.from({ length: rows }, (_, row) => [{
      text: row == 0
        ? safe(el.image!.alt).replaceAll('\n', ' ').slice(0, w).padEnd(w)
        : ' '.repeat(w),
      style: st,
      owner: el,
      image: { source: el.image!, row, rows, width: w },
    }])
  }
  let selected = visualLines(el.attr('id') ?? '', w, h ?? 6)
  if (selected) return selected
  if (el.viewport) return el.viewport(w, h ?? 0, st, c.sheet)
  let o = own(el, c.sheet)
  let s = inherit(st, o)
  let outer = num(el, 'height') ?? h
  // Borders consume real layout space; descendants measure the inner width.
  let border = el.attr('border')
  let framed = border != null && w >= 3
  let box = outer == null ? null : Math.max(0, outer - (framed ? 2 : 0))
  let bar = el.attr('scrollbar') != null && el.attr('scroll') != null &&
    w - (o.indent ?? 0) - (framed ? 2 : 0) >= 2
  let contentWidth = Math.max(
    0,
    w - (o.indent ?? 0) - (framed ? 2 : 0) - (bar ? 1 : 0),
  )
  let lines = el.localName == 'table'
    ? table(
      el,
      contentWidth,
      s,
      c.sheet,
      (cell, width) => {
        let ancestors: TElement[] = []
        for (
          let node = cell.parentNode;
          node && node !== el;
          node = node.parentNode
        ) {
          ancestors.unshift(node)
        }
        let inherited = ancestors.reduce(
          (style, node) => inherit(style, own(node, c.sheet)),
          s,
        )
        return lay(cell, inherited, width, null, c)
      },
      wrap,
    )
    : el.attr('row') != null
    ? row(el, s, contentWidth, box, c)
    : el.attr('col') != null
    ? col(el, s, contentWidth, box, c)
    : flow(
      el,
      s,
      contentWidth,
      el.attr('wrap') != null || el.attr('scroll') != null ? null : box,
      c,
    )
  if (el.localName == 'li') {
    let marker = safe(el.attr('data-marker') ?? '• ')
    lines = lines.map((
      line,
      i,
    ) => [{ text: i ? ' '.repeat(marker.length) : marker, style: s }, ...line])
  }
  if (el.attr('wrap') != null) {
    lines = lines.flatMap((line) => wrap(line, contentWidth))
  }
  const maximum = num(el, 'max-height')
  if (maximum != null && maximum >= 0 && lines.length > maximum) {
    lines = lines.slice(0, maximum)
    const overflow = el.attr('overflow-text')
    if (overflow) lines.push([{ text: safe(overflow), style: s }])
  }
  if (el.attr('scroll') != null) {
    let total = lines.length
    lines = windowed(el, lines, box, c, contentWidth)
    if (bar) {
      lines = scrollbar(lines, contentWidth + 1, {
        total,
        height: box ?? total,
        top: Math.min(
          Math.max(0, total - (box ?? total)),
          Math.max(0, num(el, 'scroll') ?? 0),
        ),
        bottom: el.attr('scroll-snapped') != null,
      }, c.sheet)
    }
  }
  if (o.indent) {
    lines = lines.map((
      l,
    ) => [{ text: ' '.repeat(o.indent!), style: s, decorative: true }, ...l])
  }
  if (o.gap && lines.length) lines.push([])
  if (box != null) lines = fit(lines, box)
  if (framed) {
    let edge = c.sheet[border!] ?? {}
    let rule = (left: string, right: string): Line => [{
      text: left + '─'.repeat(Math.max(0, w - 2)) + right,
      style: edge,
      decorative: true,
    }]
    lines = [
      rule('╭', '╮'),
      ...lines.map((line): Line => [
        { text: '│', style: edge, decorative: true },
        ...pad(clip(line, w - 2), w - 2),
        { text: '│', style: edge, decorative: true },
      ]),
      rule('╰', '╯'),
    ]
  }
  if (el.attr('fill') != null) {
    lines = lines.map((line) => {
      let clipped = clip(line, w)
      let remaining = Math.max(
        0,
        w - clipped.reduce((n, part) => n + part.text.length, 0),
      )
      return [...clipped, {
        text: ' '.repeat(remaining),
        style: s,
        decorative: true,
      }]
    })
  }
  return outer == null ? lines : fit(lines, outer)
}

/** Ownership travels with the painted cells through windowing, wrapping and clipping. */
export let lay = (
  el: TElement,
  st: Style,
  w: number,
  h: number | null,
  c: Ctx,
): Line[] =>
  layout(el, st, w, h, c).map((line) =>
    (el.viewport || el.attr('scroll') != null || el.attr('width') != null ||
        el.attr('grow') != null
      ? pad(clip(line, w), w)
      : line).map((seg) => ({
        ...seg,
        owner: el.viewport ? el : seg.owner ?? el,
      }))
  )

let fit = (lines: Line[], h: number): Line[] =>
  lines.length >= h
    ? lines.slice(0, h)
    : [...lines, ...Array.from({ length: h - lines.length }, () => [] as Line)]

let width = (l: Line) => l.reduce((n, s) => n + s.text.length, 0)

let pad = (l: Line, w: number): Line => {
  let n = w - width(l)
  return n > 0
    ? [...l, { text: ' '.repeat(n), style: {}, decorative: true }]
    : l
}

/** Cut a line to a column count, keeping whole segments where it can. */
export let clip = (line: Line, w: number): Line => {
  let out: Line = []
  let len = 0
  for (let s of line) {
    if (len + s.text.length <= w) {
      out.push(s)
      len += s.text.length
    } else {
      if (w > len) out.push({ ...s, text: s.text.slice(0, w - len) })
      break
    }
  }
  return out
}

/** Fold at word boundaries (hard-fold long words), preserving every styled
 * character. Uses the same column units as clip; runs before scroll measures. */
export let wrap = (line: Line, columns: number): Line[] => {
  let w = Math.floor(columns)
  if (w <= 0) return [[]]
  let text = line.map((s) => s.text).join('')
  if (text.length <= w) return [line]
  let out: Line[] = []
  let start = 0, seg = 0, offset = 0
  while (start < text.length) {
    let end = Math.min(start + w, text.length)
    if (end < text.length) {
      let space = text.slice(start, end).lastIndexOf(' ')
      if (space >= 0) end = start + space + 1
    }
    let row: Line = []
    let left = end - start
    while (left > 0 && seg < line.length) {
      let s = line[seg]
      let n = Math.min(left, s.text.length - offset)
      if (n) {
        row.push({ ...s, text: s.text.slice(offset, offset + n) })
      }
      left -= n
      offset += n
      if (offset == s.text.length) {
        seg++
        offset = 0
      }
    }
    if (end < text.length && row.length) {
      row[row.length - 1] = { ...row.at(-1)!, softBreak: true }
    }
    out.push(row)
    start = end
  }
  return out
}

let rgb = (hex: string) =>
  [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((h) =>
    parseInt(h, 16)
  )

/** The bytes a line becomes — every escape the terminal sees is emitted here. */
export let ansi = (line: Line): string =>
  line.map((s) => {
    let codes: string[] = []
    if (s.style.fg) codes.push(`38;2;${rgb(s.style.fg).join(';')}`)
    if (s.style.bg) codes.push(`48;2;` + rgb(s.style.bg).join(';'))
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

/** The whole screen a tree makes at a given size — the seam the tests read. */
export let screenful = (
  root: TElement,
  columns: number,
  rows: number,
  sheet: Sheet = base,
): { lines: Line[]; metrics: Metrics } => {
  let c: Ctx = { sheet, metrics: {} }
  return { lines: lay(root, {}, columns, rows, c), metrics: c.metrics }
}

let enc = new TextEncoder()

/**
 * OSC 52: hand text to the clipboard THROUGH the terminal — the escape travels
 * the tty like any output, so it works across ssh (tmux needs set-clipboard on).
 */
export let clipboard = (text: string): string =>
  `\x1b]52;c;${
    btoa(Array.from(enc.encode(text), (b) => String.fromCharCode(b)).join(''))
  }\x07`

/**
 * The ANSI backend. Paints only the lines that changed since the last frame:
 * a keystroke moves one line, so a keystroke writes one line. `size` and
 * `write` are injected so a test can drive it without a terminal.
 */
export let ansiBackend = (opts: {
  sheet?: Sheet
  size?: () => { columns: number; rows: number }
  write?: (s: string) => void
  graphics?: 'kitty' | 'none'
  tmux?: boolean
} = {}): Backend => {
  let pictures = graphics({
    enabled: opts.graphics == 'kitty',
    tmux: opts.tmux,
    changed: touch,
  })
  let sheet = { ...base, ...opts.sheet }
  let size = opts.size ?? (() => Deno.consoleSize())
  let write = opts.write ??
    ((s: string) => void Deno.stdout.writeSync(enc.encode(s)))
  let last: string[] = []
  return {
    size,
    copy: (text) => write(osc52(text)),
    control: pictures.reply,
    // Alt screen, hidden cursor, bracketed paste, alternate scroll (the wheel
    // arrives as arrow keys), and the kitty disambiguate flag — without it the
    // terminal collapses Shift+Enter to a bare CR.
    start: () =>
      write(
        '\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[?1007h\x1b[?1000s\x1b[?1004s\x1b[?1004h\x1b[?1006s\x1b[?1000h\x1b[?1006h\x1b[>4;2m\x1b[>1u',
      ),
    stop: () =>
      write(
        pictures.close() +
          '\x1b[<u\x1b[>4;0m\x1b[?1004r\x1b[?1006r\x1b[?1000r\x1b[?1007l\x1b[?2004l\x1b[?25h\x1b[?1049l',
      ),
    reset: () => {
      last = []
      pictures.reset()
    },
    draw: (root) => {
      let { columns, rows } = size()
      let { lines, metrics } = screenful(root, columns, rows, sheet)
      let annotated = pictures.annotate(lines)
      let out = ''
      let written = 0
      for (let y = 0; y < rows; y++) {
        let s = ansi(clip(annotated[y] ?? [], columns))
        if (s === last[y]) continue
        last[y] = s
        out += `\x1b[${y + 1};1H${s}\x1b[K`
        written++
      }
      last.length = rows
      out += pictures.draw(
        lines.slice(0, rows).map((line) => clip(line, columns)),
        !!out,
      )
      if (out) write(out)
      return {
        written,
        metrics,
        lines: lines.slice(0, rows).map((line) => clip(line, columns)),
      }
    },
  }
}

/** Clipboard bytes are base64, never interpolated as terminal controls. */
export let osc52 = (text: string): string => {
  let bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let b of bytes) binary += String.fromCharCode(b)
  return '\x1b]52;c;' + btoa(binary) + '\x07'
}
