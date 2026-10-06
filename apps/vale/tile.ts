// Vale's pictures and parts of a page, for the kit's parts to hold: the
// picture on a list item's icon plate (packages/ui/Tile.ts, dressed by
// kit/skin/Tile.css), a line glyph's or a thing's sprite's markup, a glyph
// set beside words in a title, a tab or a button; and a picked thing's page:
// its head, its titled parts (packages/ui/Section.ts), and the steps a quest
// or a deal asks.
import { type ComponentChildren, h, type JSX } from 'preact'
import { Rows, Section, Tile } from '@yaks/ui'
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

/** The head of a picked thing's page (packages/ui/Tile.ts `head`): its
 * picture, its name, a line under it for each of `subs` it has, and what can
 * be done with it. */
export let head = (
  pic: JSX.Element,
  title: ComponentChildren,
  subs: (string | false | undefined)[],
  end?: ComponentChildren,
): JSX.Element =>
  h(
    Tile,
    { mod: 'head' },
    pic,
    h(Tile.Title, {}, title),
    subs.flatMap((sub) => sub ? [h(Tile.Sub, { key: sub }, sub)] : []),
    end && h(Tile.End, {}, end),
  )

/** One thing a quest or a deal asks: what to do, its mark, and how far
 * along it is. */
export type Step = {
  icon: Glyph
  words: string
  have?: number
  need?: number
  done: boolean
}

/** What a quest or a deal asks, a step to a tile, ticked once done. */
export let steps = (rows: Step[]): JSX.Element =>
  part(
    'Steps',
    h(
      Rows,
      {},
      rows.map((s, i) =>
        h(
          Tile,
          { key: i },
          picture(glyph(s.done ? 'done' : s.icon), {
            mod: s.done && 'positive',
          }),
          h(Tile.Title, {}, s.words),
          s.need != null && h(Tile.End, {}, `${s.have ?? 0} / ${s.need}`),
        )
      ),
    ),
  )
