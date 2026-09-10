/** A fixed three-cell thumb over an estimated (or exact) scroll range. */
import type { Line } from './paint.ts'
import type { Sheet } from './theme.ts'

export type ScrollPosition = {
  total: number
  top: number
  height: number
  bottom: boolean
}

export let scrollbar = (
  lines: Line[],
  width: number,
  position: ScrollPosition,
  sheet: Sheet,
): Line[] => {
  if (width < 2 || position.height <= 0) return lines
  let { height, total, top, bottom } = position
  let thumb = Math.min(3, height)
  let range = Math.max(0, total - height)
  let progress = bottom ? 1 : range ? Math.max(0, Math.min(1, top / range)) : 0
  let start = Math.round(progress * (height - thumb))
  let style = { ...sheet.Scrollbar, ...(bottom ? sheet.Scrollbar_Snapped : {}) }
  return Array.from({ length: height }, (_, i) => {
    let line = lines[i] ?? []
    let used = line.reduce((n, s) => n + s.text.length, 0)
    return [...line, {
      text: ' '.repeat(Math.max(0, width - 1 - used)),
      style: {},
    }, { text: i >= start && i < start + thumb ? '█' : '│', style }]
  })
}
