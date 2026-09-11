/** Semantic table layout. Intrinsic sizing samples bounded text; cells wrap at
 * their allocated widths. This module does not depend on Markdown or graphs. */
import { TElement, TText } from './dom.ts'
import type { Line } from './paint.ts'
import type { Sheet, Style } from './theme.ts'

type Cell = TElement | undefined
let elements = (el: TElement) =>
  el.childNodes.filter((n): n is TElement => n instanceof TElement)
let rowsOf = (el: TElement): TElement[] =>
  elements(el).flatMap((n) =>
    n.localName == 'tr'
      ? [n]
      : ['thead', 'tbody', 'tfoot'].includes(n.localName)
      ? elements(n).filter((r) => r.localName == 'tr')
      : []
  )
let cellsOf = (el: TElement) =>
  elements(el).filter((n) => ['td', 'th'].includes(n.localName))
let width = (line: Line) => line.reduce((n, s) => n + s.text.length, 0)

// Do not scan every large cell just to determine column widths. The actual
// layout still reads all displayed cells; virtualization operates per item.
let sample = (cell: Cell): string => {
  let text = '', visited = 0
  let walk = (node: TElement | TText) => {
    if (++visited > 128 || text.length >= 128) return
    if (node instanceof TText) text += node.data.slice(0, 128 - text.length)
    else if (node.localName == 'br') text += '\n'
    else {for (let child of node.childNodes) {
        if (child instanceof TElement || child instanceof TText) walk(child)
        if (visited > 128 || text.length >= 128) break
      }}
  }
  if (cell) walk(cell)
  return text
}

export let table = (
  el: TElement,
  available: number,
  style: Style,
  sheet: Sheet,
  layout: (cell: TElement, width: number) => Line[],
  wrap: (line: Line, width: number) => Line[],
): Line[] => {
  let rows = rowsOf(el).map(cellsOf)
  let count = rows.reduce((n, r) => Math.max(n, r.length), 0)
  if (!count || available < 1) return []
  let edge = { ...style, ...sheet.Table_Border }
  let seg = (text: string, st = style) => ({ text, style: st })
  let cellLines = (cell: Cell, w: number): Line[] => {
    if (!cell) return [[]]
    let result = layout(cell, w).flatMap((line) => wrap(line, w))
    if (cell.localName == 'th') {
      result = result.map((line) =>
        line.map((s) => ({
          ...s,
          style: { ...s.style, ...sheet.Table_Header },
        }))
      )
    }
    return result.length ? result : [[]]
  }
  // A vertical record layout is more useful than one-character columns.
  if (available < count * 6 + 1) {
    let header = rows[0].some((c) => c.localName == 'th') ? rows[0] : undefined
    let records = header && rows.length > 1 ? rows.slice(1) : rows
    return records.flatMap((row, index) => {
      let lines: Line[] = index ? [[seg('─'.repeat(available), edge)]] : []
      row.forEach((cell, col) => {
        if (header && records !== rows) {
          lines.push(...cellLines(header[col], available))
        }
        lines.push(...cellLines(cell, available))
      })
      return lines
    })
  }
  let budget = available - (count * 3 + 1)
  let desired = Array.from(
    { length: count },
    (_, col) =>
      Math.max(
        3,
        ...rows.slice(0, 32).map((row) =>
          Math.min(
            40,
            Math.max(...sample(row[col]).split('\n').map((s) => s.length)),
          )
        ),
      ),
  )
  let widths = Array(count).fill(3) as number[]
  let remaining = budget - count * 3
  while (remaining > 0) {
    let grew = false
    for (let i = 0; i < count && remaining > 0; i++) {
      if (widths[i] < desired[i]) {
        widths[i]++
        remaining--
        grew = true
      }
    }
    if (!grew) break
  }
  // Intrinsic widths guide the first allocation; share all remaining space.
  let extra = Math.floor(remaining / count)
  let remainder = remaining % count
  widths = widths.map((w, i) => w + extra + (i < remainder ? 1 : 0))
  let rule = (left: string, middle: string, right: string): Line => [seg(
    left + widths.map((w) => '─'.repeat(w + 2)).join(middle) + right,
    edge,
  )]
  let out: Line[] = [rule('┌', '┬', '┐')]
  rows.forEach((row, index) => {
    let columns = widths.map((w, i) => cellLines(row[i], w))
    let height = Math.max(...columns.map((c) => c.length))
    for (let y = 0; y < height; y++) {
      let line: Line = [seg('│', edge)]
      widths.forEach((w, col) => {
        let content = columns[col][y] ?? []
        let space = Math.max(0, w - width(content))
        let align = row[col]?.attr('align') ??
          /text-align\s*:\s*(left|right|center)/.exec(
            row[col]?.attr('style') ?? '',
          )?.[1]
        let before = align == 'right'
          ? space
          : align == 'center'
          ? Math.floor(space / 2)
          : 0
        line.push(
          seg(' ' + ' '.repeat(before)),
          ...content,
          seg(' '.repeat(space - before) + ' '),
          seg('│', edge),
        )
      })
      out.push(line)
    }
    if (index < rows.length - 1) {
      out.push(rule('├', '┼', '┤'))
    }
  })
  out.push(rule('└', '┴', '┘'))
  return out
}
