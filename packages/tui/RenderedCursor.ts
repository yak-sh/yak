/** Cursor/selection over styled layout lines. No graph or Markdown dependency. */
import type { Line } from './paint.ts'
import type { Style } from './theme.ts'

export type TextPoint = { id: string; row: number; col: number }
export type RenderedCursor = TextPoint & { anchor?: TextPoint }

// Decorations occupy cells but never enter a copied selection.
export let textLength = (line: Line): number =>
  line.reduce((n, s) => n + s.text.length, 0)
export let clampPoint = (p: TextPoint, lines: Line[]): TextPoint => {
  let row = Math.max(0, Math.min(lines.length - 1, p.row))
  let text = (lines[row] ?? []).map((s) => s.text).join('')
  let col = Math.max(0, Math.min(Math.max(0, text.length - 1), p.col))
  // Never leave the cursor on the low half of a surrogate pair.
  if (col && /[\uDC00-\uDFFF]/.test(text[col])) col--
  return { ...p, row, col }
}
export let stepColumn = (line: Line, col: number, delta: number): number => {
  let text = line.map((s) => s.text).join('')
  let next = col + delta
  if (delta > 0 && /[\uD800-\uDBFF]/.test(text[col] ?? '')) next++
  if (delta < 0 && /[\uDC00-\uDFFF]/.test(text[next] ?? '')) next--
  return Math.max(0, Math.min(Math.max(0, text.length - 1), next))
}
export let comparePoint = (
  a: TextPoint,
  b: TextPoint,
  ids: readonly string[],
): number =>
  ids.indexOf(a.id) - ids.indexOf(b.id) || a.row - b.row || a.col - b.col

/** Decorate without changing the measured/cached lines. */
export let cursorLine = (
  line: Line,
  id: string,
  row: number,
  cursor: RenderedCursor,
  ids: readonly string[],
  style: Style,
): Line => {
  const anchor = cursor.anchor
  const [low, high] = anchor && comparePoint(anchor, cursor, ids) < 0
    ? [anchor, cursor]
    : [cursor, anchor ?? cursor]
  let col = 0
  const result: Line = []
  for (let seg of line) {
    for (let text of seg.text) {
      const point = { id, row, col }
      const active = anchor && comparePoint(point, low, ids) >= 0 &&
        comparePoint(point, high, ids) <= 0
      const caret = id == cursor.id && row == cursor.row && col == cursor.col
      result.push({
        ...seg,
        text,
        style: {
          ...seg.style,
          ...(active ? { inverse: true } : {}),
          ...(caret ? style : {}),
        },
      })
      col += text.length
    }
  }
  if (!col && id == cursor.id && row == cursor.row) {
    result.push({ text: ' ', style, decorative: true })
  }
  return result
}

/** Bounded displayed-text copy. Missing/unloaded endpoints are an error, not truncation. */
export let copyRendered = (
  cursor: RenderedCursor,
  ids: readonly string[],
  read: (id: string) => Line[] | undefined,
  limit = 65536,
): string => {
  let a = cursor.anchor ?? cursor, b: TextPoint = cursor
  if (!ids.includes(a.id) || !ids.includes(b.id)) {
    throw new Error('Selection exceeds retained text; select a smaller range')
  }
  if (comparePoint(a, b, ids) > 0) [a, b] = [b, a]
  let rows: string[] = [], size = 0, soft = false
  for (let i = ids.indexOf(a.id); i <= ids.indexOf(b.id); i++) {
    const id = ids[i], lines = read(id)
    if (!lines) throw new Error('Selection text is no longer retained')
    for (
      let row = id == a.id ? a.row : 0;
      row <= (id == b.id ? b.row : lines.length - 1);
      row++
    ) {
      let col = 0, text = '', hasText = false
      for (const seg of lines[row] ?? []) {
        for (const char of seg.text) {
          const selected = !(id == a.id && row == a.row && col < a.col) &&
            !(id == b.id && row == b.row && col > b.col)
          if (selected && !seg.decorative) {
            text += char
            hasText = true
          }
          col += char.length
        }
      }
      // Skip pure border rows, preserve empty content rows.
      if (hasText || !(lines[row] ?? []).length) {
        size += text.length + 1
        if (size > limit) {
          throw new Error('Selection exceeds 64 KiB; select a smaller range')
        }
        const nextSoft = (lines[row] ?? []).some((seg) => seg.softBreak)
        if (soft && rows.length) rows[rows.length - 1] += text
        else rows.push(text)
        soft = nextSoft
      }
    }
  }
  return rows.join('\n')
}
