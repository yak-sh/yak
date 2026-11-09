/**
 * A row of tabs, one of them on:
 * `<Tabs><Tabs.Tab mod='on'>…</Tabs.Tab></Tabs>`. A tab's face is the
 * caller's (an icon, a word), and so is what pressing it does. `Tabs.Badge`,
 * inside a tab, counts what waits behind it.
 *
 * Tabs can hold what they show: a `TabSet` is the same block on a fieldset,
 * `TabSet.Legend` naming the choice and each `TabSet.Item` a radio, its `Tab`
 * (the radio's label) and its `Panel`. The radios own which tab is on, arrow
 * keys and all, so the set works without script; the checked one's panel
 * shows under the row. A panel holding a card's worth is drawn as one:
 * `<TabSet.Panel as={Card}>`.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A row of tabs. */
export let Tabs: Part & Record<'Tab' | 'Badge', Part> = block('div', 'Tabs', {
  Tab: 'button',
  Badge: 'span',
})

/** Tabs holding their panels: the same block on a form's elements, the row
 * a fieldset, each tab the label of its radio. */
export let TabSet:
  & Part
  & Record<'Legend' | 'Item' | 'Input' | 'Tab' | 'Badge' | 'Panel', Part> =
    block(
      'fieldset',
      'Tabs',
      {
        Legend: 'legend',
        Item: 'div',
        Input: 'input',
        Tab: 'label',
        Badge: 'span',
        Panel: 'section',
      },
    )

/** What it is, in a line. */
export let description = 'A row of tabs, one of them on.'

/** A tab is its face, a space between two where a browser pads them, and
 * one between its face and its badge where a browser's gap is; the lit one
 * is raised. A terminal has no checked radio to show one panel by, so a set
 * reads as its radios, each with its panel under it. */
export let sheet = (c: Colors): Sheet => ({
  Tabs: { spaced: true },
  Tabs_Tab: { fg: c.muted, spaced: true },
  'Tabs_Tab-hover': { fg: c.text },
  'Tabs_Tab-on': { fg: c.text, bg: c.card },
  Tabs_Badge: { fg: c.bg, bg: c.accent },
  Tabs_Legend: { bold: true },
  Tabs_Item: { spaced: true },
  Tabs_Panel: { indent: 2 },
})

let { Tab, Badge } = Tabs
let { Legend, Item, Panel } = TabSet

let item = (id: string, tab: string, panel: string, checked = false) =>
  h(
    Item,
    {},
    h(TabSet.Input, { type: 'radio', name: 'tabs-specimen', id, checked }),
    h(TabSet.Tab, { for: id }, tab),
    h(Panel, {}, panel),
  )

/** A row with one tab on, one under the pointer, and one with a badge; and
 * a set whose first tab is checked. */
export let specimens = (): Specimen[] => [
  [
    'Tabs, Tab-on, Tab-hover, Badge',
    h(
      Tabs,
      {},
      h(Tab, { type: 'button', mod: 'on' }, 'Board'),
      h(Tab, { type: 'button', mod: 'hover' }, 'List'),
      h(Tab, { type: 'button' }, 'Inbox', h(Badge, {}, '3')),
    ),
  ],
  [
    'TabSet, Legend, Item, Panel',
    h(
      TabSet,
      {},
      h(Legend, {}, 'Which app do you use?'),
      item('tabs-claude', 'Claude', 'Add the connector in Settings.', true),
      item('tabs-chatgpt', 'ChatGPT', 'Turn on developer mode first.'),
    ),
  ],
]
