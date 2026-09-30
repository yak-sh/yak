/**
 * How wide a grid's columns are: CSS's grid track sizing, cut to what a
 * terminal needs. Every column grows toward its widest cell, all of them by
 * the same step, as far as the room allows; a column fixed at a `width`
 * keeps it; and whatever is left over goes to the `grow` columns. The
 * painter lays every row under a `grid` element out in these widths
 * (paint.ts), as a CSS grid's subgrid rows share its tracks.
 *
 * @module
 */

/** One column: how wide its widest cell runs, the width it is fixed at, and
 * whether it takes what is left. */
export type Track = { content: number; width?: number | null; grow?: boolean }

let sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0)

/// tracks([{ content: 4 }, { content: 30 }, { content: 3 }], 24, 1)
///   -> [4, 15, 3]
/// tracks([{ content: 4 }, { content: 10, grow: true }], 30, 2) -> [4, 24]
/// tracks([{ content: 9, width: 2 }, { content: 9 }], 8) -> [2, 6]
/** Each column's width, in `room` columns less `gap` between each two. */
export let tracks = (cols: Track[], room: number, gap = 0): number[] => {
  let out = cols.map((c) => c.width ?? 0)
  let left = room - gap * Math.max(0, cols.length - 1) - sum(out)
  let short = (i: number) => cols[i].width == null && out[i] < cols[i].content
  let open = cols.map((_, i) => i).filter(short)
  while (left > 0 && open.length) {
    let step = Math.max(1, Math.floor(left / open.length))
    for (let i of open) {
      let d = Math.min(step, cols[i].content - out[i], left)
      out[i] += d
      left -= d
    }
    open = open.filter(short)
  }
  let growers = cols.map((_, i) => i).filter((i) =>
    cols[i].grow && cols[i].width == null
  )
  growers.forEach((i, k) => {
    let share = Math.floor(Math.max(0, left) / (growers.length - k))
    out[i] += share
    left -= share
  })
  return out
}
