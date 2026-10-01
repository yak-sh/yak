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
import * as body from './Body.ts'
import * as button from './Button.ts'
import * as catalog from './Catalog.ts'
import * as chip from './Chip.ts'
import * as choices from './Choices.ts'
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
import * as quote from './Quote.ts'
import * as rows from './Rows.ts'
import * as say from './Say.ts'
import * as section from './Section.ts'
import * as stack from './Stack.ts'
import * as stamp from './Stamp.ts'
import * as table from './Table.ts'
import * as tabs from './Tabs.ts'
import * as tile from './Tile.ts'
import * as timeline from './Timeline.ts'
import * as tip from './Tip.ts'
import * as turns from './Turns.ts'
import * as value from './Value.ts'
import { everforest } from './everforest.ts'
import { ledger } from './ledger.ts'
import { rosepine } from './rosepine.ts'
import { Fragment } from 'preact'
import type { Composition, Contributions, Kit, Piece, Theme } from './theme.ts'

/** Every part, by what it is for: the document's defaults, what is said
 * inline, what is pressed or typed in, the way around, lists of things, and
 * what frames a page. A group's name is never a part's: each is a place in
 * the guide. */
let modules = {
  Prose: { base, Body: body, Quote: quote },
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
  Navigation: { Tabs: tabs, Stack: stack, Index: index, Pager: pager },
  Lists: {
    Tile: tile,
    Rows: rows,
    Pairs: pairs,
    Table: table,
    Timeline: timeline,
    Turns: turns,
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

/** The base parts, with their component and CSS address carried by the part,
 * so another package's kit need not live beside this module. */
export let groups: Record<string, Kit> = Object.fromEntries(
  Object.entries(modules).map(([group, parts]) => [
    group,
    Object.fromEntries(
      Object.entries(parts).map(([name, part]) => [name, {
        ...part,
        Component: name == 'base' ? Fragment : Reflect.get(part, name),
        css: new URL(`./${name}.css`, import.meta.url),
      } as Piece]),
    ),
  ]),
)

/** Every base part, document defaults first. */
export let kit: Kit = Object.assign({}, ...Object.values(groups))
export let kits: Record<string, Kit> = { base: kit }
export let themes: Record<string, Theme> = { everforest, rosepine }
export let skins: NonNullable<Contributions['skins']> = { ledger }
export let composition: Composition = { kits, theme: everforest }

export { gather } from './contributions.ts'

/** Parts may only have one home in a composition. */
export let parts = ({ kits }: Composition): Kit => {
  let out: Kit = {}
  for (let kit of Object.values(kits)) {
    for (let [name, part] of Object.entries(kit)) {
      if (Object.hasOwn(out, name)) {
        throw new Error(`duplicate UI part: ${name}`)
      }
      out[name] = part
    }
  }
  return out
}

/** Theme colours, each kit's entries, and the skin's replacement entries. */
export let sheet = (c: Composition): Sheet =>
  Object.assign(
    {},
    ...Object.entries(parts(c)).map(([name, part]) =>
      (c.skin?.[name]?.sheet ?? part.sheet)(c.theme.colors)
    ),
  )

let read = async (url: URL) => {
  let response = await fetch(url)
  if (!response.ok) throw new Error(`UI stylesheet ${url}: ${response.status}`)
  let css = await response.text()
  // Inlining must retain each external sheet's address for images and imports.
  let at = (path: string) =>
    path.startsWith('#') || path.startsWith('data:')
      ? path
      : new URL(path, url).href
  return css.replace(
    /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,
    (_, _quote, path) => `url("${at(path)}")`,
  )
    .replace(
      /(@import\s+)(['"])([^'"]+)\2/g,
      (_, start, _quote, path) => `${start}"${at(path)}"`,
    )
}

/** Theme first, then one rendering per part: skin where named, kit otherwise. */
export let stylesheet = async (c: Composition): Promise<string> =>
  (await Promise.all([
    c.theme.css,
    ...Object.entries(parts(c)).map(([name, part]) =>
      c.skin?.[name]?.css ?? part.css
    ),
  ].map(read))).join('\n')
