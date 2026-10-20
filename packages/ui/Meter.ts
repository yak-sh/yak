/**
 * How much of a whole is used: a bar of `width` cells that `value` (0 to 1)
 * fills, and `mark`, where given, a point on it to read the fill against,
 * such as how far through its window a budget would be at an even pace.
 * `<Meter value={0.42} mark={0.3} />`. A fill past its mark is `over`. The
 * bar is drawn in characters, so a browser and a terminal paint one bar.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { type FunctionComponent, h } from 'preact'
import { block, type Part, type Props } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

let Bar: Part & Record<'Fill' | 'Mark' | 'Rest', Part> = block(
  'span',
  'Meter',
  { Fill: 'span', Mark: 'span', Rest: 'span' },
)

// Eighths of a cell, for the fill's last one.
let EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

let clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0))

/**
 * The cells a fill draws, and the cell its mark falls in.
 *
 * ```ts
 * import { cells } from './Meter.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal(cells(0.5, 4), '██')
 * equal(cells(0.3, 4), '█▎')
 * ```
 */
export let cells = (value: number, width: number): string => {
  let eighths = Math.round(clamp(value) * width * 8)
  return '█'.repeat(Math.floor(eighths / 8)) + EIGHTHS[eighths % 8]
}

/** What a meter is drawn with: its value and mark, 0 to 1, how many cells
 * wide it is, and anything a part takes. */
export type MeterProps = Props & {
  value?: number
  mark?: number
  width?: number
}

/** A bar, filled to its value, with its mark. */
export let Meter: FunctionComponent<MeterProps> = (
  { value = 0, mark, width = 16, ...rest },
) => {
  let n = [...cells(value, width)].length
  let line = [...cells(value, width).padEnd(width, '·')]
  let at = mark == null
    ? -1
    : Math.min(width - 1, Math.floor(clamp(mark) * width))
  let over = mark != null && clamp(value) > clamp(mark)
  let piece = (part: Part, from: number, to: number, mod?: string) =>
    from < to
      ? h(part, mod ? { mod } : {}, line.slice(from, to).join(''))
      : null
  // The cells from one place to another: the filled ones, then the rest.
  let span = (from: number, to: number) => [
    piece(Bar.Fill, from, Math.min(to, n), over ? 'over' : undefined),
    piece(Bar.Rest, Math.max(from, n), to),
  ]
  return h(
    Bar,
    {
      role: 'meter',
      'aria-valuemin': 0,
      'aria-valuemax': 1,
      'aria-valuenow': clamp(value),
      ...rest,
    },
    at < 0
      ? span(0, width)
      : [...span(0, at), h(Bar.Mark, {}, '│'), ...span(at + 1, width)],
  )
}

/** What it is, in a line. */
export let description =
  'How much of a whole is used: a bar its value fills, with a mark to read it against.'

/** The fill is the accent, past its mark it needs watching, and what is left
 * is dim. */
export let sheet = (c: Colors): Sheet => ({
  Meter_Fill: { fg: c.accent },
  'Meter_Fill-over': { fg: c.caution },
  Meter_Mark: { fg: c.text, bold: true },
  Meter_Rest: { fg: c.dim },
})

/** A fill short of its mark, one past it, and one with no mark. */
export let specimens = (): Specimen[] => [
  ['Meter, Mark', h(Meter, { value: 0.19, mark: 0.3 })],
  ['Meter_Fill-over', h(Meter, { value: 0.62, mark: 0.4 })],
  ['Meter', h(Meter, { value: 0.85 })],
]
