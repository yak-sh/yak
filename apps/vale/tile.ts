// Vale's pictures and parts of a page, for the kit's parts to hold: the
// picture on a list item's icon plate (packages/ui/Tile.ts, dressed by
// kit/skin/Tile.css), a line glyph's or a thing's sprite's markup, a glyph
// set beside words in a title, a tab or a button, and a titled part of a
// picked thing's page (packages/ui/Section.ts).
import { type ComponentChildren, h, type JSX } from 'preact'
import { Section, Tile } from '@yaks/ui'
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

/** A part of a picked thing's page: its `title`, then what it holds. */
export let part = (
  title: ComponentChildren,
  ...kids: ComponentChildren[]
): JSX.Element => h(Section, {}, h(Section.Title, {}, title), ...kids)

/** What a page says where it has nothing to show: what to do to see some. */
export let hint = (words: string): JSX.Element =>
  h('p', { class: 'Pack_Hint' }, words)
