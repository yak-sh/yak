/** Source-offset preserving soft-wrap geometry, shared by editing and selection. */
export type VisualRow = { start: number; end: number }
export let visualRows = (text: string, width: number): VisualRow[] => {
  width = Math.max(1, Math.floor(width))
  let rows: VisualRow[] = []
  let start = 0
  for (let line of text.split('\n')) {
    let end = start + line.length
    while (end - start >= width) {
      let stop = start + width
      // Prefer a word boundary, retaining its whitespace on the preceding row.
      let space = text.slice(start, stop).search(/\s+\S*$/)
      if (end - start > width && space >= 0) {
        let after = start + space
        while (after < stop && /\s/.test(text[after])) after++
        if (after > start) stop = after
      }
      rows.push({ start, end: stop })
      start = stop
    }
    rows.push({ start, end })
    start = end + 1
  }
  return rows
}

export let visualSpot = (rows: VisualRow[], offset: number) => {
  let row = rows.findLastIndex((r) => r.start <= offset)
  row = Math.max(0, row)
  return { row, col: offset - rows[row].start }
}
