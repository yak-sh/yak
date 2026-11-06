/**
 * A report: a `Card` that counts something, worn as `Card Report`. Its head
 * names what it counts and says the `Total` (its `Unit` after the number)
 * where a card's actions would sit; under it a `Plot`, a chart of the days
 * with its `Span` (the first day and the last) under it, then the `Tops`,
 * short lists side by side, each a `Column` under its own heading and its
 * `List` of names and counts.
 *
 * @module
 */

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
    'Total' | 'Unit' | 'Plot' | 'Span' | 'Tops' | 'Column' | 'List',
    Part
  > = block('article', 'Report', {
    Total: 'p',
    Unit: 'span',
    Plot: 'figure',
    Span: 'figcaption',
    Tops: 'div',
    Column: 'div',
    List: 'ul',
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
    h('h3', null, head),
    h(
      List,
      {},
      rows.map(([name, n]) =>
        h('li', { key: name }, h('span', null, name), h('b', null, n))
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
      { class: 'Card' },
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
        h(Span, {}, h('span', null, '1 Sept'), h('span', null, '7 Sept')),
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
