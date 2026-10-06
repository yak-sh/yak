// Vale's list items are the base kit's Tile (packages/ui/Tile.ts), dressed by
// the field-book skin (kit/skin/Tile.css). What the vale adds is the picture
// on a tile's icon plate: a line glyph's or a thing's sprite's markup.
import { h, type JSX } from 'preact'
import { Tile } from '@yaks/ui'

/** A tile's icon showing `html`, a glyph or a sprite; `props` gives it a
 * tone (`mod`) or a rarity (`class`). */
export let picture = (
  html: string,
  props: Record<string, unknown> = {},
): JSX.Element =>
  h(Tile.Icon, {
    'aria-hidden': 'true',
    ...props,
    dangerouslySetInnerHTML: { __html: html },
  })
