/**
 * An app's frame: a sidebar of places beside the one page you are on. The
 * `Side` holds the app's `Brand`, a `Find` box around its search (an `Icon`
 * and a bare `Field`), and an `Item` per place, each an `Icon` and a `Label`
 * with an optional `Count`; the place you are on wears `Item-on`. The `Main`
 * column is the page: its `Bar` (a `Menu` for the sidebar where the window is
 * narrow, the page's `Title`, which an `Icon` may lead, then its `Tools`,
 * whatever the page offers) over the `Body`, which scrolls. Where the window
 * is narrow the tools take a line of their own under the title, and scroll
 * sideways when they outrun it.
 *
 * A phone-width window folds the sidebar away: `Menu` shows, and `Shell-open`
 * slides the sidebar over the page with a `Shade` behind it that a press on
 * closes. A terminal lays the sidebar beside the page always, by its sheet,
 * and has no menu.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import { Field } from './Field.ts'
import type { Colors, Specimen } from './theme.ts'

/** The frame. */
export let Shell:
  & Part
  & Record<
    | 'Side'
    | 'Brand'
    | 'Find'
    | 'Item'
    | 'Icon'
    | 'Label'
    | 'Count'
    | 'Shade'
    | 'Main'
    | 'Bar'
    | 'Menu'
    | 'Title'
    | 'Tools'
    | 'Body',
    Part
  > = block('div', 'Shell', {
    Side: 'nav',
    Brand: 'a',
    Find: 'div',
    Item: 'a',
    Icon: 'span',
    Label: 'span',
    Count: 'span',
    Shade: 'button',
    Main: 'div',
    Bar: 'header',
    Menu: 'span',
    Title: 'div',
    Tools: 'div',
    Body: 'div',
  })

/** What it is, in a line. */
export let description =
  'An app’s frame: a sidebar of places beside the one page you are on.'

/** The sidebar a framed column beside the page, a place to a line, where you
 * are in the accent; the page's bar a line over its body. */
export let sheet = (c: Colors): Sheet => ({
  Shell: { row: true, grow: true },
  Shell_Side: { col: true, width: 24, border: 'Shell_Edge' },
  Shell_Brand: { block: true, bold: true, fg: c.text, gap: true },
  Shell_Find: { block: true, gap: true },
  Shell_Item: { block: true, spaced: true, fg: c.text },
  'Shell_Item-on': { fg: c.accent, bold: true },
  Shell_Icon: { hidden: true },
  Shell_Count: { fg: c.muted },
  Shell_Shade: { hidden: true },
  Shell_Main: { col: true, grow: true },
  Shell_Bar: { row: true, spaced: true },
  Shell_Menu: { hidden: true },
  Shell_Title: { bold: true, fg: c.text, grow: true, ellipsis: true },
  Shell_Tools: { row: true, spaced: true },
  Shell_Body: { grow: true, wrap: true },
  Shell_Edge: { fg: c.border2 },
})

let { Side, Brand, Find, Item, Icon, Label, Count, Main, Bar, Title, Body } =
  Shell
let dot = h('svg', { width: 16, height: 16, viewBox: '0 0 16 16' }, [
  h('circle', { cx: 8, cy: 8, r: 5, fill: 'none', stroke: 'currentColor' }),
])
let place = (label: string, on?: boolean, count?: string) =>
  h(
    Item,
    { href: `#${label}`, mod: on && 'on' },
    h(Icon, {}, dot),
    h(Label, {}, label),
    count && h(Count, {}, count),
  )

/** An app on its inbox, with two more places and a page. */
export let specimens = (): Specimen[] => [
  [
    'Shell, Side, Brand, Find, Item, Item-on, Icon, Label, Count, Main, Bar, Title, Body',
    h(
      Shell,
      { style: 'height: 18rem; width: 40rem; max-width: 100%' },
      h(
        Side,
        {},
        h(Brand, { href: '#home' }, 'Yak'),
        h(
          Find,
          {},
          h(Icon, {}, dot),
          h(Field, { mod: 'bare', placeholder: 'Search' }),
        ),
        place('Inbox', true, '3'),
        place('Projects'),
        place('Sessions'),
      ),
      h(
        Main,
        {},
        h(Bar, {}, h(Title, {}, 'Inbox')),
        h(Body, {}, h('p', {}, 'The page you are on.')),
      ),
    ),
  ],
]
