/**
 * One thing on one line, standing for it in a list: its `Id`, its `Kind`, its
 * `Title`, a `Note` after, and a `Count` at the end. Every element is
 * optional. Given an `href` the tile is a link, and the parts inside it stay
 * text (el.ts).
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Chip } from './Chip.ts'

/** A tile. */
export let Tile:
  & Part
  & Record<'Id' | 'Kind' | 'Title' | 'Note' | 'Count', Part> = block(
    'div',
    'Tile',
    {
      Id: 'span',
      Kind: 'span',
      Title: 'span',
      Note: 'span',
      Count: 'span',
    },
  )

/** The id and the kind are dim beside the title; a count stands out. A tile
 * is a line of its own even as a link, so its parts stand apart. */
export let sheet = (c: Colors): Sheet => ({
  Tile: { block: true, spaced: true },
  Tile_Id: { fg: c.dim },
  Tile_Kind: { fg: c.dim },
  Tile_Note: { fg: c.muted, spaced: true },
  Tile_Count: { fg: c.number },
})

let { Id, Kind, Title, Note, Count } = Tile

/** A whole tile, and a bare one. */
export let specimens = (): Specimen[] => [
  [
    'Tile, Id, Kind, Title, Note, Count',
    h(
      Tile,
      { href: '#tile' },
      h(Id, {}, 'T-45488'),
      h(Kind, {}, 'task'),
      h(Title, {}, 'Inspect the data model'),
      h(
        Note,
        {},
        h(Chip, { mod: '0' }, 'doc'),
        ' ',
        h(Chip, { mod: '1' }, 'task'),
      ),
      h(Count, {}, '6,736'),
    ),
  ],
  ['Tile, Title', h(Tile, {}, h(Title, {}, 'Just a title'))],
]
