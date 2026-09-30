/**
 * The screen in columns, side by side: a narrow `Pane-nav` to find the way,
 * and the `Pane-main` page beside it, or any column that takes the rest (a
 * `Stack` of pages). What stays at a pane's top is its `Top`; its `Body`
 * scrolls on its own beneath. `Pane-on` is the pane that has the keyboard.
 *
 * A browser fills the window with the columns, and a phone-width one stacks
 * them. A terminal makes each pane a framed column of the screen, by its
 * sheet (@yaks/tui's `row`, `col`, `width`, `grow` and `border`): the nav as
 * wide as it needs, the main pane the rest, the frame of the pane with the
 * keyboard in the accent.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** The panes. */
export let Panes: Part & Record<'Pane' | 'Top' | 'Body', Part> = block(
  'div',
  'Panes',
  {
    Pane: 'section',
    Top: 'div',
    Body: 'div',
  },
)

/** What it is, in a line. */
export let description =
  'The screen in columns: a nav to find the way, and the page.'

/** Columns in a row, each framed, quiet but for the accent where the
 * keyboard is. */
export let sheet = (c: Colors): Sheet => ({
  Panes: { row: true, grow: true },
  Panes_Pane: { col: true, border: 'Panes_Edge' },
  'Panes_Pane-nav': { width: 30 },
  'Panes_Pane-main': { grow: true },
  'Panes_Pane-on': { border: 'Panes_Edge-on' },
  Panes_Body: { grow: true },
  Panes_Edge: { fg: c.border2 },
  'Panes_Edge-on': { fg: c.accent },
})

let { Pane, Top, Body } = Panes
let words = (...lines: string[]) => lines.map((l, i) => h('p', { key: i }, l))

/** A nav and the page, the page with the keyboard. */
export let specimens = (): Specimen[] => [
  [
    'Panes, Pane-nav, Pane-main, Pane-on, Top, Body',
    h(
      Panes,
      { style: 'height: 12rem; width: 40rem; max-width: 100%' },
      h(
        Pane,
        { mod: 'nav' },
        h(Top, {}, 'find…'),
        h(Body, {}, words('@yaks/task', 'task', 'claim')),
      ),
      h(
        Pane,
        { mod: ['main', 'on'] },
        h(Body, {}, words('task', 'a thing to do', 'Properties', 'status')),
      ),
    ),
  ],
]
