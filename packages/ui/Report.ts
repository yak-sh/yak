/**
 * A report: a `Card` that counts something, so it wears both. Its head is
 * a card's `Card.Head`, naming what it counts and saying the `Total` (its
 * `Unit` after the number) where a card's actions would sit; under it a
 * `Plot`, a chart of the days with its `Span` (the first day and the last)
 * under it, then the `Tops`, short lists side by side, each a `Column` under
 * its own heading and its `List` of names and counts.
 *
 * @module
 */

import { Time } from './Time.ts'
import type { Sheet } from '@yaks/tui/theme'
import { h, type VNode } from 'preact'
import { Card } from './Card.ts'
import { Columns } from './Chart.ts'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A report. */
export let Report:
  & Part
  & Record<
    | 'Total'
    | 'Unit'
    | 'Plot'
    | 'Span'
    | 'Tops'
    | 'Column'
    | 'List'
    | 'Heading'
    | 'Item'
    | 'Label'
    | 'Value',
    Part
  > = block(Card, 'Report', {
    Total: 'p',
    Unit: 'span',
    Plot: 'figure',
    Span: 'figcaption',
    Tops: 'div',
    Column: 'div',
    List: 'ul',
    Heading: 'h3',
    Item: 'li',
    Label: 'span',
    Value: 'b',
  })

/** What it is, in a line. */
export let description =
  'A card that counts something: its total, a chart of the days, and the tops.'

/** The total is the number to see; what it counts, and the days, step back. */
export let sheet = (c: Colors): Sheet => ({
  Report_Total: { bold: true },
  Report_Unit: { fg: c.muted, bold: false },
  Report_Span: { fg: c.muted, row: true, spaced: true },
  Report_Tops: { row: true, spaced: true },
})

let { Total, Unit, Plot, Span, Tops, Column, List } = Report

let column = (head: string, rows: [string, number][]) =>
  h(
    Column,
    {},
    h(Report.Heading, null, head),
    h(
      List,
      {},
      rows.map(([name, n]) =>
        h(
          Report.Item,
          { key: name },
          h(Report.Label, null, name),
          h(Report.Value, null, n),
        )
      ),
    ),
  )

let week = { from: '2026-09-01', values: [3, 4, 0, 7, 9, 5, 14], noun: 'visit' }

/** A week of visits to one app. */
export let specimens = (): Specimen[] => [
  [
    'Report, Total, Unit, Plot, Span, Tops, Column, List',
    h(
      Report,
      {},
      h(
        Card.Head,
        {},
        h(Card.Title, {}, 'Recipe Box'),
        h(Total, {}, '42 ', h(Unit, {}, 'visits')),
      ),
      h(
        Plot,
        {},
        h(Columns, week) as VNode,
        h(
          Span,
          {},
          h(Time, { at: '2026-09-01', written: true, timeZone: 'UTC' }),
          h(Time, { at: '2026-09-07', written: true, timeZone: 'UTC' }),
        ),
      ),
      h(
        Tops,
        {},
        column('Pages', [['/', 30], ['/recipes/soup-of-the-day', 12]]),
        column('Came from', [['google.com', 20], ['news.ycombinator.com', 4]]),
        column('Countries', [['United Kingdom', 25], ['France', 17]]),
      ),
    ),
  ],
]
