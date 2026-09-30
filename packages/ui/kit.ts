/**
 * The kit: every part, by the name of the file its CSS is in, every theme,
 * and what a theme becomes for each place that paints. A new component is
 * its module and its CSS file, and one line here.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import * as base from './base.ts'
import * as choices from './Choices.ts'
import * as button from './Button.ts'
import * as chip from './Chip.ts'
import * as crumbs from './Crumbs.ts'
import * as dot from './Dot.ts'
import * as edit from './Edit.ts'
import * as field from './Field.ts'
import * as head from './Head.ts'
import * as id from './Id.ts'
import * as index from './Index.ts'
import * as menu from './Menu.ts'
import * as notes from './Notes.ts'
import * as pager from './Pager.ts'
import * as pairs from './Pairs.ts'
import * as panes from './Panes.ts'
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
import type { Kit, Theme } from './theme.ts'

/** Every part: the document's defaults first, then each component. */
export let kit: Record<string, Kit> = {
  base,
  Dot: dot,
  Id: id,
  Stamp: stamp,
  Tabs: tabs,
  Menu: menu,
  Tip: tip,
  Field: field,
  Choices: choices,
  Button: button,
  Chip: chip,
  Value: value,
  Pairs: pairs,
  Tile: tile,
  Rows: rows,
  Section: section,
  Timeline: timeline,
  Crumbs: crumbs,
  Edit: edit,
  Table: table,
  Pager: pager,
  Panes: panes,
  Head: head,
  Notes: notes,
  Say: say,
  Index: index,
}

/** Every theme, by name. */
export let themes: Record<string, Theme> = { everforest }

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
