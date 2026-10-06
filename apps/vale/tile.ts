// Vale's pictures, for the kit's parts to hold: the picture on a list item's
// icon plate (packages/ui/Tile.ts, dressed by kit/skin/Tile.css), a line
// glyph's or a thing's sprite's markup, and a glyph set beside words in a
// title, a tab or a button.
import { h, type JSX } from 'preact'
import { Tile } from '@yaks/ui'
import { type Glyph, glyph } from './glyphs.ts'

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

/** A glyph beside words, which a screen reader passes over. */
export let mark = (icon: Glyph): JSX.Element =>
  h('span', {
    'aria-hidden': 'true',
    dangerouslySetInnerHTML: { __html: glyph(icon) },
  })
