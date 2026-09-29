/**
 * A list of rows, one `Rows.Item` each, and a `Rows.More` saying what was
 * left out. `Rows-nested` hangs the list off what it belongs to, indented
 * under a rule.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Tile } from './Tile.ts'

/** A list of rows. */
export let Rows: Part & Record<'Item' | 'More', Part> = block('div', 'Rows', {
  Item: 'div',
  More: 'div',
})

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

/** A list, and one nested under it. */
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
]
