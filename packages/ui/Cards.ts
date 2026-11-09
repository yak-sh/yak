/**
 * Like things side by side in equal columns, as many to a line as fit: cards
 * of services to connect, of apps, of anything a person scans across to pick
 * one. Each child is a cell, and they line up in rows the same height; on a
 * phone it is one column; `compact` fits smaller choices side by side. A terminal lists them, one under another.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { Button } from './Button.ts'
import { Card } from './Card.ts'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** Cards in a grid. */
export let Cards: Part = block('div', 'Cards', {})

/** What it is, in a line. */
export let description =
  'Like things side by side in equal columns, as many to a line as fit.'

/** A terminal lists the cells, each a blank line from the next. */
export let sheet = (_c: Colors): Sheet => ({
  Cards: { gap: true },
})

let cell = (title: string, sub: string) =>
  h(
    Card,
    {},
    h(
      Card.Head,
      {},
      h(Card.Title, { as: 'h3' }, title),
      h(Card.Actions, {}, h(Button, { type: 'button' }, 'Connect')),
    ),
    h(Card.Sub, {}, sub),
  )

/** Four cards, one saying more than the others. */
export let specimens = (): Specimen[] => [
  [
    'Cards',
    h(
      Cards,
      {},
      cell('Calendar', 'Productivity'),
      cell('Weather API', 'Forecasts for any place on Earth, by the hour.'),
      cell('Mail', 'Communication'),
      cell('Payments', 'Payment · Invoicing'),
    ),
  ],
  [
    'Cards-compact',
    h(
      Cards,
      { mod: 'compact' },
      cell('Calendar', 'Productivity'),
      cell('Mail', 'Communication'),
    ),
  ],
]
