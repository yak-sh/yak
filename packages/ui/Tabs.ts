/**
 * A row of tabs, one of them on:
 * `<Tabs><Tabs.Tab mod='on'>…</Tabs.Tab></Tabs>`. A tab's face is the
 * caller's (an icon, a word), and so is what pressing it does. `Tabs.Badge`,
 * inside a tab, counts what waits behind it.
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

/** What it is, in a line. */
export let description = 'A row of tabs, one of them on.'

/** A tab is its face, a space between two where a browser pads them; the lit
 * one is raised. */
export let sheet = (c: Colors): Sheet => ({
  Tabs: { spaced: true },
  Tabs_Tab: { fg: c.dim },
  'Tabs_Tab-hover': { fg: c.muted },
  'Tabs_Tab-on': { fg: c.text, bg: c.card },
  Tabs_Badge: { fg: c.bg, bg: c.accent },
})

let { Tab, Badge } = Tabs

/** A row with one tab on, one under the pointer, and one with a badge. */
export let specimens = (): Specimen[] => [
  [
    'Tabs, Tab-on, Tab-hover, Badge',
    h(
      Tabs,
      {},
      h(Tab, { type: 'button', mod: 'on' }, 'Board'),
      h(Tab, { type: 'button', mod: 'hover' }, 'List'),
      h(Tab, { type: 'button' }, 'Inbox ', h(Badge, {}, '3')),
    ),
  ],
]
