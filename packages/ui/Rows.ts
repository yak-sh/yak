/**
 * A list of rows, one `Rows.Item` each, and a `Rows.More` saying what was
 * left out. A list of things to pick from holds its `Tile`s directly, each
 * pressed to pick it, the one picked `on`. `Rows-nested` hangs the list off
 * what it belongs to, indented under a rule.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Dot } from './Dot.ts'
import { Tile } from './Tile.ts'

/** A list of rows. */
export let Rows: Part & Record<'Item' | 'More', Part> = block('div', 'Rows', {
  Item: 'div',
  More: 'div',
})

/** What it is, in a line. */
export let description = 'A list of rows, and what was left out.'

/** A nested list is indented; what was left out is dim. */
export let sheet = (c: Colors): Sheet => ({
  'Rows-nested': { indent: 2 },
  Rows_More: { fg: c.dim },
})

let { Item, More } = Rows
let row = (id: string, title: string) =>
  h(
    Item,
    { key: id },
    h(Tile, {}, h(Tile.Id, {}, id), h(Tile.Title, {}, title)),
  )
let pick = () => {}
let choice = (title: string, sub: string, mod?: string, tone = 'positive') =>
  h(
    Tile,
    { mod, onClick: pick },
    h(Tile.Icon, { mod: tone }, h(Dot, { mod: ['check', tone] })),
    h(Tile.Title, {}, title),
    h(Tile.Sub, { mod: mod == 'dim' && 'negative' }, sub),
    h(Tile.End, {}, h(Tile.Count, {}, '3')),
  )

/** A list, one nested under it, and tiles to pick from. */
export let specimens = (): Specimen[] => [
  [
    'Rows, Item, More',
    h(
      Rows,
      {},
      row('T-1', 'first'),
      row('T-2', 'second'),
      h(More, {}, '48 more'),
    ),
  ],
  ['Rows-nested', h(Rows, { mod: 'nested' }, row('C-3', 'a comment'))],
  [
    'Rows of tiles to pick from: Tile-on, Tile-hover, Tile-dim',
    h(
      Rows,
      {},
      choice('Picked', 'the one shown beside the list', 'on'),
      choice('Under the pointer', 'a terminal has none', 'hover'),
      choice('Not yet', 'needs the one before it', 'dim', 'caution'),
      choice('Another', 'waiting to be picked'),
    ),
  ],
]
