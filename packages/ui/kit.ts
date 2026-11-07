/**
 * The kit: every part, by the name of the file its CSS is in, in the groups
 * the style guide shows them in; every theme; and what a theme becomes for
 * each place that paints. A new component is its module and its CSS file,
 * and one line here, in its group.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import * as address from './Address.ts'
import * as at from './At.ts'
import * as base from './base.ts'
import * as body from './Body.ts'
import * as button from './Button.ts'
import * as card from './Card.ts'
import * as catalog from './Catalog.ts'
import * as chart from './Chart.ts'
import * as check from './Check.ts'
import * as chip from './Chip.ts'
import * as chips from './Chips.ts'
import * as choices from './Choices.ts'
import * as copy from './Copy.ts'
import * as doc from './Doc.ts'
import * as dot from './Dot.ts'
import * as drop from './Drop.ts'
import * as edit from './Edit.ts'
import * as empty from './Empty.ts'
import * as field from './Field.ts'
import * as form from './Form.ts'
import * as gallery from './Gallery.ts'
import * as group from './Group.ts'
import * as head from './Head.ts'
import * as icon from './Icon.ts'
import * as id from './Id.ts'
import * as index from './Index.ts'
import * as inbox from './Inbox.ts'
import * as menu from './Menu.ts'
import * as meter from './Meter.ts'
import * as metrics from './Metrics.ts'
import * as more from './More.ts'
import * as loading from './Loading.ts'
import * as match from './Match.ts'
import * as notes from './Notes.ts'
import * as notice from './Notice.ts'
import * as palette from './Palette.ts'
import * as overlay from './Overlay.ts'
import * as pager from './Pager.ts'
import * as pairs from './Pairs.ts'
import * as passage from './Passage.ts'
import * as peek from './Peek.ts'
import * as panes from './Panes.ts'
import * as prop from './Prop.ts'
import * as quote from './Quote.ts'
import * as report from './Report.ts'
import * as rows from './Rows.ts'
import * as say from './Say.ts'
import * as section from './Section.ts'
import * as shell from './Shell.ts'
import * as sideNav from './SideNav.ts'
import * as spark from './Spark.ts'
import * as stamp from './Stamp.ts'
import * as state from './State.ts'
import * as table from './Table.ts'
import * as tabs from './Tabs.ts'
import * as tile from './Tile.ts'
import * as timeline from './Timeline.ts'
import * as tip from './Tip.ts'
import * as turns from './Turns.ts'
import * as value from './Value.ts'
import { everforest } from './everforest.ts'
import { gouache } from './gouache.ts'
import { ledger } from './ledger.ts'
import { linen } from './linen.ts'
import { paper } from './paper.ts'
import { pencil } from './pencil.ts'
import { rosepine } from './rosepine.ts'
import { Fragment } from 'preact'
import { text } from '@yaks/api/asset'
import type { Composition, Contributions, Kit, Piece, Theme } from './theme.ts'

/** Every part, by what it is for: the document's defaults, what is said
 * inline, what is pressed or typed in, the way around, lists of things, and
 * what frames a page. A group's name is never a part's: each is a place in
 * the guide. */
let modules = {
  Prose: { base, Body: body, Doc: doc, Quote: quote },
  Marks: {
    Dot: dot,
    State: state,
    Id: id,
    Stamp: stamp,
    Chip: chip,
    Chips: chips,
    Address: address,
    Icon: icon,
    Match: match,
    Value: value,
    Meter: meter,
    Spark: spark,
    Chart: chart,
    Tip: tip,
  },
  Controls: {
    Button: button,
    Copy: copy,
    Field: field,
    At: at,
    Check: check,
    Form: form,
    Drop: drop,
    Notice: notice,
    Choices: choices,
    Edit: edit,
    Say: say,
    Menu: menu,
    Prop: prop,
  },
  Navigation: { Tabs: tabs, SideNav: sideNav, Index: index, Pager: pager },
  Lists: {
    Tile: tile,
    Rows: rows,
    Pairs: pairs,
    Table: table,
    Timeline: timeline,
    Turns: turns,
    Passage: passage,
    Notes: notes,
    Inbox: inbox,
  },
  Page: {
    Loading: loading,
    Empty: empty,
    Shell: shell,
    Head: head,
    Metrics: metrics,
    Section: section,
    More: more,
    Card: card,
    Report: report,
    Group: group,
    Panes: panes,
    Overlay: overlay,
    Peek: peek,
    Palette: palette,
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
/** Gouache and paper, yak.sh's design, are the default: the first of each. */
export let themes: Record<string, Theme> = {
  gouache,
  everforest,
  rosepine,
  linen,
}
export let skins: NonNullable<Contributions['skins']> = {
  paper,
  ledger,
  pencil,
}
export let composition: Composition = { kits, theme: gouache, skin: paper }

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
  Object.freeze(
    Object.assign(
      {},
      ...Object.entries(parts(c)).map(([name, part]) =>
        (c.skin?.[name]?.sheet ?? part.sheet)(c.theme.colors)
      ),
    ),
  )

let read = async (url: URL) => {
  let css = await text(url)
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

/** What every theme derives the same way, dressed after the theme whatever
 * the parts: the half gap, the faint wash, the touch floor, the type scale. */
let DERIVED = new URL('./derived.css', import.meta.url)

/** Each sheet a browser gets, by what it dresses: `theme` first (the theme,
 * and what every theme derives), then one rendering per part, the skin's
 * where it replaces one, the kit's otherwise, and whatever the skin lays over
 * it. A host that layers its own CSS reads them apart. */
export let sheets = async (c: Composition): Promise<[string, string][]> => {
  let each = (urls: URL[]) => Promise.all(urls.map(read))
  return await Promise.all([
    each([c.theme.css, DERIVED]).then((css): [string, string] => [
      'theme',
      css.join('\n'),
    ]),
    ...Object.entries(parts(c)).map(([name, part]) => {
      let { css = part.css, over = [] } = c.skin?.[name] ?? {}
      return each([css, ...[over].flat()]).then((
        css,
      ): [string, string] => [name, css.join('\n')])
    }),
  ])
}

/** Every sheet a browser gets, in order, as one. */
export let stylesheet = async (c: Composition): Promise<string> =>
  (await sheets(c)).map(([, css]) => css).join('\n')
