/**
 * A list of rows, one `Rows.Item` each, and a `Rows.More` saying what was
 * left out. A row of like things is a `Rows.Main`, a thing's `Rows.Name`
 * over the `Rows.Meta` that describes it, then the `Rows.Actions` that act
 * on it, at the far side. A list of things to pick from holds its `Tile`s directly, each
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
 * A row that opens its thing leads with the thing's `Rows.Mark` (its
 * picture) and names it with a `Rows.Open` inside its `Rows.Name`: the link's
 * target is the whole row, lit under the pointer, while what sits in its
 * `Rows.Actions` stays pressable on its own.
 *
 * `Item-split` puts an action beside the row's content; `Detail-inset`
 * spans both columns on a padded background. `Rows.Note` is a full-size
 * line below the rows, whether none are present or more were left out.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { createElement as h } from 'react'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Dot } from './Dot.ts'
import { Tile } from './Tile.ts'
import { Button } from './Button.ts'
import { Badge } from './Badge.ts'
import { Icon } from './Icon.ts'
import { Menu } from './Menu.ts'
// @ts-types="./lucide.d.ts"
import lock from 'lucide/dist/esm/icons/lock.mjs'
// @ts-types="./lucide.d.ts"
import ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'

/** A list of rows. */
export let Rows:
  & Part
  & Record<
    | 'Item'
    | 'More'
    | 'Note'
    | 'Kind'
    | 'Link'
    | 'Line'
    | 'Toggle'
    | 'Detail'
    | 'Main'
    | 'Name'
    | 'Meta'
    | 'Actions'
    | 'Mark'
    | 'Open'
    | 'Form',
    Part
  > = block(
    'div',
    'Rows',
    {
      Item: 'div',
      More: 'div',
      Note: 'p',
      Kind: 'div',
      Link: 'div',
      Line: 'div',
      Toggle: 'button',
      Detail: 'div',
      Main: 'div',
      Name: 'strong',
      Meta: 'span',
      Actions: 'div',
      Mark: 'img',
      Open: 'a',
      Form: 'form',
    },
  )

/** What it is, in a line. */
export let description = 'A list of rows, and what was left out.'

/** A nested list is indented; what was left out is muted. */
export let sheet = (c: Colors): Sheet => ({
  'Rows-nested': { indent: 2 },
  Rows_More: { fg: c.muted },
  Rows_Note: { fg: c.muted },
  Rows_Kind: { fg: c.muted },
  'Rows-ruled': { gap: true },
  'Rows-quiet': { fg: c.muted },
  Rows_Line: { row: true },
  Rows_Toggle: { fg: c.muted, width: 2 },
  Rows_Detail: { indent: 2 },
  Rows_Main: { spaced: true },
  Rows_Meta: { fg: c.muted },
  Rows_Actions: { spaced: true },
  Rows_Mark: { hidden: true },
})

let { Item, More } = Rows
let row = (id: string, title: string) =>
  h(
    Item,
    { key: id },
    h(
      Rows.Link,
      { href: '#' },
      h(Tile, {}, h(Tile.Id, {}, id), h(Tile.Title, {}, title)),
    ),
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

let person = (name: string, meta: string, ...actions: string[]) =>
  h(
    Item,
    { key: name },
    h(
      Rows.Main,
      {},
      h(Rows.Name, { mod: 'line' }, name),
      h(Rows.Meta, { mod: 'line' }, meta),
    ),
    actions.length > 0 &&
      h(
        Rows.Actions,
        {},
        actions.map((a) =>
          h(Rows.Form, { key: a }, h(Button, { type: 'button' }, a))
        ),
      ),
  )

// A thing's picture, as a square drawn from its first letter.
let picture = (letter: string, fill: string) =>
  'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${fill}"/><text x="32" y="43" font-family="system-ui,sans-serif" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`,
  )
let opens = (name: string, meta: string, fill: string, errors = 0) =>
  h(
    Item,
    { key: name },
    h(Rows.Mark, { src: picture(name[0], fill), alt: '' }),
    h(
      Rows.Main,
      {},
      h(Rows.Name, { mod: 'line' }, h(Rows.Open, { href: '#' }, name)),
      h(Rows.Meta, { mod: 'line' }, meta),
    ),
    h(
      Rows.Actions,
      {},
      errors
        ? h(Badge, { as: 'button', type: 'button' }, `${errors} errors`)
        : null,
      h(
        Rows.Meta,
        { role: 'img', 'aria-label': 'Private', 'data-tip': 'Private' },
        h(Icon, { of: lock }),
      ),
      h(
        Menu.Fold,
        {},
        h(
          Menu.Summary,
          { mod: 'icon', 'aria-label': `More for ${name}` },
          h(Icon, { of: ellipsis }),
        ),
        h(
          Menu,
          { mod: ['below', 'end'] },
          h(Menu.Item, { as: 'a', href: '#' }, 'Edit data'),
        ),
      ),
    ),
  )

/** A list, one of people, one nested under it, and tiles to pick from. */
export let specimens = (): Specimen[] => [
  [
    'Rows, Item-split, Meta, Detail-inset, Note',
    h(
      Rows,
      {},
      h(
        Item,
        { as: 'article', mod: 'split' },
        h('div', {}, 'An item', h(Rows.Meta, {}, 'Available')),
        h(Button, { type: 'button' }, 'Hide'),
        h(Rows.Detail, { mod: 'inset' }, 'More about this item.'),
      ),
      h(Rows.Note, {}, '2 more'),
    ),
  ],
  [
    'Rows, Item, Mark, Name, Open, Meta, Actions',
    h(
      Rows,
      {},
      opens('Recipes', 'ada.yaks.app/recipes · changed 2 days ago', '#4f7a5a'),
      opens(
        'Book club',
        'ada.yaks.app/books · changed 1 hour ago',
        '#3f6b8a',
        2,
      ),
    ),
  ],
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
    'Rows, Item, Main, Name, Meta, Actions',
    h(
      Rows,
      {},
      person('Dana', 'dana@example.com · editor'),
      person('sam', 'sam@example.com · viewer', 'Resend', 'Take off'),
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
    'Rows-ordered, Item-after',
    h(
      Rows,
      { mod: 'ordered' },
      h(Item, { draggable: true }, 'First row'),
      h(Item, { draggable: true, mod: 'after' }, 'Last row'),
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
