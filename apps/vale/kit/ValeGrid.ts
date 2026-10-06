/** Things in squares, the way a bag in a good game holds them: each `Cell` a
 * thing's `Picture` on a face framed in its rarity, as many to a row as fit,
 * every one the same square. Its corners say more: its `Tier` at the top
 * left, the level it `Need`s at the bottom left, in red, while it cannot be
 * worn yet, and its `Count` at the bottom right. `wide` sets three to a row,
 * each naming its place over its picture (`Label`) and what fills it under it
 * (`Name`): the slots a hero wears.
 *
 * A cell's frame is `--rarity`, which a rarity's class sets, so a common
 * thing goes unframed. Given an `onClick` it is a button, a thing picked from
 * its grid, and says so with `aria-current`, true while it wears `on`; the
 * skin draws the pick (skin/base.css) on the cell's rim, clear of its frame.
 * `dim` fades its picture: a thing that cannot be had yet, or is had already.
 * `empty` is a slot nothing fills, and `glow` lights a legendary's edge. */
import {
  block,
  type Colors,
  el,
  type Part,
  type Props,
  type Specimen,
} from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'

let Grid = block('div', 'ValeGrid', {
  Picture: 'span',
  Label: 'span',
  Name: 'span',
  Tier: 'span',
  Need: 'span',
  Count: 'span',
})
let Box = el('span', 'ValeGrid_Cell')
let Press = el('button', 'ValeGrid_Cell')
let Cell = (p: Props) =>
  typeof p.onClick == 'function'
    ? h(Press, {
      type: 'button',
      'aria-current': [p.mod].flat().includes('on'),
      ...p,
    })
    : h(Box, p)

export let ValeGrid:
  & Part
  & Record<
    'Cell' | 'Picture' | 'Label' | 'Name' | 'Tier' | 'Need' | 'Count',
    Part
  > = Object.assign(Grid, { Cell })

export let description =
  'Things in squares framed in their rarity, marked in their corners.'
export let sheet = (c: Colors): Sheet => ({
  ValeGrid: { spaced: true, wrap: true },
  'ValeGrid_Cell-on': { inverse: true },
  'ValeGrid_Cell-dim': { dim: true },
  'ValeGrid_Cell-empty': { dim: true },
  ValeGrid_Label: { fg: c.dim },
  ValeGrid_Tier: { fg: c.number },
  ValeGrid_Need: { fg: c.negative },
  ValeGrid_Count: { fg: c.number },
})

let { Picture, Label, Name, Tier, Need, Count } = ValeGrid
let pick = () => {}
// A rarity's colour, or a role's where a theme has no rarities.
let rare = (r: string, role: string) => ({
  style: `--rarity: var(--${r}, var(--${role}))`,
})
export let specimens = (): Specimen[] => [
  [
    'Cell, Picture, Tier, Need, Count: a bag',
    h(
      ValeGrid,
      {},
      h(
        Cell,
        { ...rare('legendary', 'caution'), mod: 'glow', onClick: pick },
        h(Picture, {}, '⚔'),
        h(Tier, {}, 'III'),
      ),
      h(
        Cell,
        { ...rare('epic', 'special'), mod: 'on', onClick: pick },
        h(Picture, {}, '⛨'),
        h(Tier, {}, 'II'),
      ),
      h(
        Cell,
        { ...rare('rare', 'info'), mod: 'dim', onClick: pick },
        h(Picture, {}, '⚒'),
        h(Tier, {}, 'IV'),
        h(Need, {}, '24'),
      ),
      h(Cell, { onClick: pick }, h(Picture, {}, '♥'), h(Count, {}, '4')),
      h(Cell, { onClick: pick }, h(Picture, {}, '✿'), h(Count, {}, '12')),
    ),
  ],
  [
    'wide: Label, Name, empty',
    h(
      ValeGrid,
      { mod: 'wide' },
      h(
        Cell,
        { ...rare('epic', 'special'), onClick: pick },
        h(Label, {}, 'Weapon'),
        h(Picture, {}, '⚔'),
        h(Name, {}, 'Fierce sword of Might'),
        h(Tier, {}, 'II'),
      ),
      h(
        Cell,
        { mod: 'empty', onClick: pick },
        h(Label, {}, 'Other hand'),
        h(Picture, {}, '·'),
        h(Name, {}, 'Nothing'),
      ),
      h(
        Cell,
        { onClick: pick },
        h(Label, {}, 'Head'),
        h(Picture, {}, '⛑'),
        h(Name, {}, 'Leather cap'),
      ),
    ),
  ],
]
