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
 * An `Aside` after the `Main` column is what sits at the page's right (what
 * is happening, lists beside a conversation): a pane of its own height that
 * scrolls apart from the page, so the page centers in the width left beside
 * it. `Shell-shut` hides it and the page centers in the whole width. Narrower
 * than a laptop it stands only while it is the address's target, over the
 * page from the right, and so does a shut one opened that way: a `Layer`,
 * which slides in at a phone's width.
 *
 * A phone-width window folds the sidebar away: `Menu` shows, and `Shell-open`
 * slides the sidebar over the page with a `Shade` behind it that a press on
 * closes. A terminal lays the sidebar beside the page always, by its sheet,
 * and has no menu. `Shell-sheet` lays the page on a sheet rather than the
 * floor; the paper the page lies on is `--floor` either way.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { createElement as h } from 'react'
import { block, type Part } from './el.ts'
import { Field } from './Field.ts'
import { layer } from './Layer.ts'
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
    | 'Glyph'
    | 'Label'
    | 'Count'
    | 'Shade'
    | 'Main'
    | 'Bar'
    | 'Menu'
    | 'Title'
    | 'Tools'
    | 'Body'
    | 'Content'
    | 'Aside',
    Part
  > = block('div', 'Shell', {
    Side: 'nav',
    Brand: 'a',
    Find: 'div',
    Item: 'a',
    Icon: 'span',
    Glyph: 'svg',
    Label: 'span',
    Count: 'span',
    Shade: 'button',
    Main: 'div',
    Bar: 'header',
    Menu: 'span',
    Title: 'div',
    Tools: 'div',
    Body: 'div',
    Content: 'div',
    Aside: layer('aside', 'right'),
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
  Shell_Aside: { col: true, width: 30, border: 'Shell_Edge' },
  Shell_Edge: { fg: c.border2 },
})

let { Side, Brand, Find, Item, Icon, Label, Count, Main, Bar, Title, Body } =
  Shell
let dot = h(Shell.Glyph, { width: 16, height: 16, viewBox: '0 0 16 16' }, [
  h('circle', { cx: 8, cy: 8, r: 5, fill: 'none', stroke: 'currentColor' }),
])
let place = (label: string, on?: boolean, count?: string) =>
  h(
    Item,
    { href: '#', mod: on && 'on' },
    h(Icon, {}, dot),
    h(Label, {}, label),
    count && h(Count, {}, count),
  )

/** An app on its inbox, with two more places and a page, and beside the
 * page what sits beside it, open and put away. */
export let specimens = (): Specimen[] => [
  [
    'Shell, variants',
    h(
      Shell,
      { mod: ['open', 'sheet'], style: { height: '10rem' } },
      h(Shell.Shade, { 'aria-label': 'Close navigation' }),
      h(
        Shell.Main,
        {},
        h(
          Shell.Bar,
          {},
          h(Shell.Menu, {}, 'Menu'),
          h(Shell.Title, {}, 'Overview'),
          h(Shell.Tools, {}, 'Actions'),
        ),
        h(Shell.Body, {}, h(Shell.Content, {}, 'The page content.')),
      ),
    ),
  ],
  [
    'Shell, Side, Brand, Find, Item, Item-on, Icon, Label, Count, Main, Bar, Title, Body, Aside',
    h(
      Shell,
      { style: { height: '18rem', width: '40rem', maxWidth: '100%' } },
      h(
        Side,
        {},
        h(Brand, { href: '#' }, 'Yak'),
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
      h(Shell.Aside, {}, h('p', {}, 'Beside the page.')),
    ),
  ],
  [
    'Shell-shut, Aside',
    h(
      Shell,
      {
        mod: 'shut',
        style: { height: '8rem', width: '40rem', maxWidth: '100%' },
      },
      h(Main, {}, h(Body, {}, h('p', {}, 'The page, in the whole width.'))),
      h(Shell.Aside, {}, h('p', {}, 'Put away.')),
    ),
  ],
]
