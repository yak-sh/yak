/**
 * A series over time drawn as a chart: `<Sparkline from='2026-10-01'
 * values={[0, 2, 5]} noun='visit' />` beside a number, `<Columns … />` as wide
 * as the page. The marks are ./chart-marks.ts, which a server page renders
 * too. A terminal paints no SVG and reads its `Spark`.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { type FunctionComponent, h, type VNode } from 'preact'
import { columns, type Series, sparkline } from './chart-marks.ts'
import type { Colors, Specimen } from './theme.ts'

/** A line beside a number. */
export let Sparkline: FunctionComponent<Series> = (s) =>
  sparkline(h as never, s) as VNode | null

/** A column a day, as wide as the page. */
export let Columns: FunctionComponent<Series> = (s) =>
  columns(h as never, s) as VNode

/** What it is, in a line. */
export let description = 'A series over time, as a line or a column a day.'

/** Nothing of its own: a terminal does not draw it. */
export let sheet = (_: Colors): Sheet => ({})

let week = { from: '2026-10-01', values: [0, 2, 5, 3, 0, 8, 6], noun: 'visit' }

/** One of each. */
export let specimens = (): Specimen[] => [
  ['Chart-line, Chart_Line, Chart_End', h(Sparkline, week) as VNode],
  ['Chart-bars, Chart_Bar', h(Columns, week) as VNode],
]
