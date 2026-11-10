/**
 * A menu: `Menu.Item`s, one to a row, and a `Menu.Rule` between groups. The
 * items are buttons; what each does is the caller's, and so is where the
 * menu floats.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { Surface } from './Surface.ts'
import { block, type Part, type Props } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

let Base = block(
  Surface.Raised,
  'Menu',
  {
    Trigger: 'button',
    Item: 'button',
    Rule: 'hr',
    List: 'div',
    Ask: 'p',
    Footer: 'div',
    Fold: 'details',
    Summary: 'summary',
  },
)

/** One menu surface, shared by floating actions and a summary's choices. */
export let Menu:
  & Part
  & Record<
    | 'Trigger'
    | 'Item'
    | 'Rule'
    | 'Ask'
    | 'Footer'
    | 'Fold'
    | 'Summary',
    Part
  > = Object.assign(
    ({ children, ...props }: Props) =>
      h(Base, props, h(Base.List, {}, children)),
    Base,
  )

/** What it is, in a line. */
export let description =
  'Things to do, one to a row, with a rule between groups.'

/** An item is a row of its own, as it is in a browser. */
export let sheet = (c: Colors): Sheet => ({
  Menu_Item: { block: true },
  Menu_Ask: { block: true, fg: c.muted },
  Menu_Footer: { block: true },
  'Menu_Item-hover': { bg: c.card },
  'Menu_Item-danger': { fg: c.negative },
  Menu_Rule: { fg: c.border2 },
})

let { Trigger, Item, Rule } = Menu

/** Two groups, one item under the pointer, and a dangerous one. */
export let specimens = (): Specimen[] => [
  [
    'Menu Fold, Summary, Ask, Footer',
    h(
      Menu.Fold,
      { open: true },
      h(Menu.Summary, {}, 'Change'),
      h(
        Menu,
        {},
        h(Menu.Ask, {}, 'Choose an action'),
        h(Item, { type: 'button' }, 'Open'),
        h(Rule, {}),
        h(Menu.Footer, {}, h(Item, { type: 'button' }, 'New')),
      ),
    ),
  ],
  [
    'Menu-float',
    h(
      Menu,
      { mod: 'float', style: 'position:static' },
      h(Item, { type: 'button' }, 'Copy'),
    ),
  ],
  [
    'Menu, Trigger, Item, Item-hover, Rule, Item-danger',
    h(
      Menu,
      {},
      h(Trigger, { type: 'button' }, 'a moment ago'),
      h(Item, { type: 'button' }, 'open here'),
      h(Item, { type: 'button', mod: 'hover' }, 'copy link'),
      h(Rule, {}),
      h(Item, { type: 'button', mod: 'danger' }, 'delete'),
    ),
  ],
]
