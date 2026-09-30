/**
 * A menu: `Menu.Item`s, one to a row, and a `Menu.Rule` between groups. The
 * items are buttons; what each does is the caller's, and so is where the
 * menu floats.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A menu. */
export let Menu: Part & Record<'Item' | 'Rule', Part> = block('div', 'Menu', {
  Item: 'button',
  Rule: 'hr',
})

/** What it is, in a line. */
export let description =
  'Things to do, one to a row, with a rule between groups.'

/** An item is a row of its own, as it is in a browser. */
export let sheet = (c: Colors): Sheet => ({
  Menu_Item: { block: true },
  'Menu_Item-hover': { bg: c.card },
  'Menu_Item-danger': { fg: c.negative },
  Menu_Rule: { fg: c.border2 },
})

let { Item, Rule } = Menu

/** Two groups, one item under the pointer, and a dangerous one. */
export let specimens = (): Specimen[] => [
  [
    'Menu, Item, Item-hover, Rule, Item-danger',
    h(
      Menu,
      {},
      h(Item, { type: 'button' }, 'open here'),
      h(Item, { type: 'button', mod: 'hover' }, 'copy link'),
      h(Rule, {}),
      h(Item, { type: 'button', mod: 'danger' }, 'delete'),
    ),
  ],
]
