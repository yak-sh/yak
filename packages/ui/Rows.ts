/**
 * A list of rows, one `Rows.Item` each, and a `Rows.More` saying what was
 * left out. A list of things to pick from holds its `Tile`s directly, each
 * pressed to pick it, the one picked `on`. `Rows-nested` hangs the list off
 * what it belongs to, indented under a rule. `Rows-quiet` is a list of what
 * is kept but no longer live (archived), muted, its links too.
 *
 * `Rows-ordered` is a list put in order by dragging its rows: a row that can
 * be picked up says so under the pointer, and the row a dragged one would
 * land before is marked `Rows_Item-before` (after the last,
 * `Rows_Item-after`). A row that opens in place is a `Rows.Line`, its
 * `Rows.Toggle` (a glyph, pressed to open and close it) beside what it says,
 * then, while open, a `Rows.Detail` beneath it.
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
export let Rows:
  & Part
  & Record<
    'Item' | 'More' | 'Kind' | 'Link' | 'Line' | 'Toggle' | 'Detail',
    Part
  > = block(
    'div',
    'Rows',
    {
      Item: 'div',
      More: 'div',
      Kind: 'div',
      Link: 'div',
      Line: 'div',
      Toggle: 'button',
      Detail: 'div',
    },
  )

/** What it is, in a line. */
export let description = 'A list of rows, and what was left out.'

/** A nested list is indented; what was left out is muted. */
export let sheet = (c: Colors): Sheet => ({
  'Rows-nested': { indent: 2 },
  Rows_More: { fg: c.muted },
  Rows_Kind: { fg: c.muted },
  'Rows-ruled': { gap: true },
  'Rows-quiet': { fg: c.muted },
  Rows_Line: { row: true },
  Rows_Toggle: { fg: c.muted, width: 2 },
  Rows_Detail: { indent: 2 },
})

let { Item, More } = Rows
let row = (id: string, title: string) =>
  h(
    Item,
    { key: id },
    h(Tile, {}, h(Tile.Id, {}, id), h(Tile.Title, {}, title)),
  )
let line = (press: string, id: string, title: string) =>
  h(
    Rows.Line,
    {},
    h(Rows.Toggle, { type: 'button', 'aria-expanded': press == '▾' }, press),
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
  [
    'Rows-ruled',
    h(
      Rows,
      { mod: 'ruled' },
      h(Item, {}, h(Rows.Kind, {}, 'task'), 'Inspect the model'),
      h(Item, {}, h(Rows.Kind, {}, 'session'), 'Working on the model'),
    ),
  ],
  ['Rows-nested', h(Rows, { mod: 'nested' }, row('C-3', 'a comment'))],
  ['Rows-quiet', h(Rows, { mod: 'quiet' }, row('I-4', 'an archived belief'))],
  [
    'Rows-ordered, Line, Detail, Item-before',
    h(
      Rows,
      { mod: 'ordered' },
      h(
        Item,
        { draggable: true },
        line('▾', 'M-1', 'signal over noise'),
        h(
          Rows.Detail,
          {},
          'The words a person said, typed over where they stand.',
        ),
      ),
      h(Item, { draggable: true, mod: 'before' }, line('▸', 'M-2', 'the map')),
      h(Item, { draggable: true }, line('▸', 'M-3', 'the one idea')),
    ),
  ],
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
