/**
 * The kit: every part, by the name of the file its CSS is in, in the groups
 * the style guide shows them in; every theme; and what a theme becomes for
 * each place that paints. A new component is its module and its CSS file,
 * and one line here, in its group.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import * as base from './base.ts'
import * as button from './Button.ts'
import * as catalog from './Catalog.ts'
import * as chip from './Chip.ts'
import * as choices from './Choices.ts'
import * as crumbs from './Crumbs.ts'
import * as dot from './Dot.ts'
import * as edit from './Edit.ts'
import * as field from './Field.ts'
import * as gallery from './Gallery.ts'
import * as head from './Head.ts'
import * as id from './Id.ts'
import * as index from './Index.ts'
import * as menu from './Menu.ts'
import * as notes from './Notes.ts'
import * as overlay from './Overlay.ts'
import * as pager from './Pager.ts'
import * as pairs from './Pairs.ts'
import * as panes from './Panes.ts'
import * as prop from './Prop.ts'
import * as rows from './Rows.ts'
import * as say from './Say.ts'
import * as section from './Section.ts'
import * as stamp from './Stamp.ts'
import * as table from './Table.ts'
import * as tabs from './Tabs.ts'
import * as tile from './Tile.ts'
import * as timeline from './Timeline.ts'
import * as tip from './Tip.ts'
import * as value from './Value.ts'
import { everforest } from './everforest.ts'
import { rosepine } from './rosepine.ts'
import type { Kit, Theme } from './theme.ts'

/** Every part, by what it is for: the document's defaults, what is said
 * inline, what is pressed or typed in, the way around, lists of things, and
 * what frames a page. A group's name is never a part's: each is a place in
 * the guide. */
export let groups: Record<string, Record<string, Kit>> = {
  Prose: { base },
  Marks: { Dot: dot, Id: id, Stamp: stamp, Chip: chip, Value: value, Tip: tip },
  Controls: {
    Button: button,
    Field: field,
    Choices: choices,
    Edit: edit,
    Say: say,
    Menu: menu,
    Prop: prop,
  },
  Navigation: { Tabs: tabs, Crumbs: crumbs, Index: index, Pager: pager },
  Lists: {
    Tile: tile,
    Rows: rows,
    Pairs: pairs,
    Table: table,
    Timeline: timeline,
    Notes: notes,
  },
  Page: {
    Head: head,
    Section: section,
    Panes: panes,
    Overlay: overlay,
    Catalog: catalog,
    Gallery: gallery,
  },
}

/** Every part, the document's defaults first, as the guide orders them. */
export let kit: Record<string, Kit> = Object.assign(
  {},
  ...Object.values(groups),
)

/** Every theme, by name; the first is the default. */
export let themes: Record<string, Theme> = { everforest, rosepine }

/** What @yaks/tui's painter dresses the kit with, in `theme`'s colours. */
export let sheet = (theme: Theme): Sheet =>
  Object.assign({}, ...Object.values(kit).map((k) => k.sheet(theme.colors)))

let read = (url: URL) => fetch(url).then((r) => r.text())

/** What a browser dresses the kit with: `theme`'s custom properties, then
 * every part's CSS. */
export let stylesheet = async (theme: Theme): Promise<string> =>
  (await Promise.all(
    [
      theme.css,
      ...Object.keys(kit).map((k) => new URL(`./${k}.css`, import.meta.url)),
    ].map(read),
  )).join('\n')
