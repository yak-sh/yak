/**
 * The kit: every part, by the name of the file its CSS is in, and what a
 * theme becomes for each place that paints. A new component is its module
 * and its CSS file, and one line here.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import * as base from './base.ts'
import * as dot from './Dot.ts'
import * as id from './Id.ts'
import * as menu from './Menu.ts'
import * as stamp from './Stamp.ts'
import * as tabs from './Tabs.ts'
import * as tip from './Tip.ts'
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
}

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
