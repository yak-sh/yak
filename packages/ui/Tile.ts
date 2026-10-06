/**
 * One thing in a list, standing for it: an `Icon` before it, its title line,
 * a `Sub` under the title saying more of it, and an `End` at the far side (a
 * level, a count, a key, a pin). The title line holds the thing's `Id` and
 * `Kind`, its `Title`, a `Note` after it and a `Count`, in the order given.
 * Every piece is optional, and they are written flat: the tile sets its icon,
 * its words (the title line over the sub) and its end side by side, on a row
 * that never wraps, so the icon keeps its title's line at any width.
 *
 * Given an `href` the tile is a link, and the parts inside it stay text
 * (el.ts); given an `onClick`, a button. A button is a thing picked from its
 * list: it says so with `aria-current`, true while it wears `on`. `dim` is a
 * thing that cannot be had yet, its icon and title faded and its sub saying
 * why (`Sub-negative`); an icon takes a tone (`Icon-positive` and the rest),
 * and an end that falls short says so (`End-negative`).
 * `hover` is the one under the pointer, for a terminal, which has none.
 * `head` heads a page of the thing's own, above what it says of it: its
 * icon and title larger, the end there what can be done with it, which goes
 * under the words where there is no room beside them.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { type ComponentChild, h, isValidElement, toChildArray } from 'preact'
import { block, el, type Part, type Props } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Chip } from './Chip.ts'
import { Dot } from './Dot.ts'

let Base = block('div', 'Tile', {
  Icon: 'span',
  Id: 'span',
  Kind: 'span',
  Title: 'span',
  Note: 'span',
  Count: 'span',
  Sub: 'span',
  End: 'span',
})
let Press = el('button', 'Tile')
let Words = el('span', 'Tile_Text')
let Line = el('span', 'Tile_Line')
let { Icon, Id, Kind, Title, Note, Count, Sub, End } = Base

// A tile with nothing beside its title line keeps the line as its row; one
// with an icon, a sub or an end stacks the line over the sub between them.
let lay = (children: Props['children']): ComponentChild[] => {
  let kids = toChildArray(children)
  let of = (part: Part) =>
    kids.filter((k) => isValidElement(k) && k.type == part)
  let [icon, sub, end] = [of(Icon), of(Sub), of(End)]
  let line = kids.filter((k) => ![...icon, ...sub, ...end].includes(k))
  return icon.length + sub.length + end.length
    ? [...icon, h(Words, {}, h(Line, {}, line), ...sub), ...end]
    : line
}

/** A tile. */
export let Tile:
  & Part
  & Record<
    'Icon' | 'Id' | 'Kind' | 'Title' | 'Note' | 'Count' | 'Sub' | 'End',
    Part
  > = Object.assign(
    ({ children, ...p }: Props) => {
      let press = typeof p.onClick == 'function' && !p.href
      let on = [p.mod].flat().includes('on')
      return h(
        press ? Press : Base,
        press ? { type: 'button', 'aria-current': on, ...p } : p,
        lay(children),
      )
    },
    { Icon, Id, Kind, Title, Note, Count, Sub, End },
  )

/** What it is, in a line. */
export let description =
  'One thing in a list: its icon, title, a line under it, and an end.'

/** The id and the kind are dim beside the title, the sub muted after it; a
 * count stands out. A tile is a line of its own even as a link, so its parts
 * stand apart; the one picked is raised, the one under the pointer a little. */
export let sheet = (c: Colors): Sheet => ({
  Tile: { block: true, spaced: true },
  'Tile-on': { bg: c.card, bold: true },
  'Tile-hover': { bg: c.surface },
  'Tile-dim': { dim: true },
  'Tile-head': { bold: true },
  Tile_Text: { spaced: true },
  Tile_Line: { spaced: true },
  Tile_Id: { fg: c.dim },
  Tile_Kind: { fg: c.dim },
  Tile_Note: { fg: c.muted, spaced: true },
  Tile_Count: { fg: c.number },
  Tile_Sub: { fg: c.muted },
  'Tile_Sub-negative': { fg: c.negative },
  'Tile_End-negative': { fg: c.negative },
  'Tile_Icon-info': { fg: c.info },
  'Tile_Icon-active': { fg: c.active },
  'Tile_Icon-positive': { fg: c.positive },
  'Tile_Icon-negative': { fg: c.negative },
  'Tile_Icon-caution': { fg: c.caution },
  'Tile_Icon-accent': { fg: c.accent },
  'Tile_Icon-special': { fg: c.special },
})

/** A whole tile, a bare one, and one with an icon, a sub and an end. */
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
  [
    'Tile, Icon, Title, Sub, End',
    h(
      Tile,
      {},
      h(Icon, { mod: 'info' }, h(Dot, { mod: ['half', 'info'] })),
      h(Title, {}, 'A title long enough to need the room it is given'),
      h(Sub, {}, 'what it is, under it'),
      h(End, {}, h(Count, {}, '12')),
    ),
  ],
  [
    'head: Tile heading its own page',
    h(
      Tile,
      { mod: 'head' },
      h(Icon, { mod: 'accent' }, h(Dot, { mod: 'accent' })),
      h(Title, {}, 'Inspect the data model'),
      h(Sub, {}, 'Task · open'),
    ),
  ],
]
