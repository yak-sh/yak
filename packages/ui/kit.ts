import * as identity from './Identity.ts'
import * as toolbar from './Toolbar.ts'
import * as transcript from './Transcript.ts'
import * as attachments from './Attachments.ts'
import * as annotated from './Annotated.ts'
import * as preview from './Preview.ts'
import * as composer from './Composer.ts'
import * as popover from './Popover.ts'
import * as skip from './Skip.ts'
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
import * as surface from './Surface.ts'
import * as body from './Body.ts'
import * as button from './Button.ts'
import * as card from './Card.ts'
import * as modal from './Modal.ts'
import * as catalog from './Catalog.ts'
import * as cards from './Cards.ts'
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
import { halved } from './halved.ts'
import * as group from './Group.ts'
import * as head from './Head.ts'
import * as icon from './Icon.ts'
import * as id from './Id.ts'
import * as index from './Index.ts'
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
import * as save from './Save.ts'
import * as section from './Section.ts'
import * as shell from './Shell.ts'
import * as sideNav from './SideNav.ts'
import * as spark from './Spark.ts'
import * as stamp from './Stamp.ts'
import * as badge from './Badge.ts'
import * as state from './State.ts'
import * as table from './Table.ts'
import * as tabs from './Tabs.ts'
import * as tile from './Tile.ts'
import * as timeline from './Timeline.ts'
import * as tip from './Tip.ts'
import * as time from './Time.ts'
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
import type {
  Composition,
  Contributions,
  Kit,
  Native,
  Piece,
  Skin,
  Theme,
} from './theme.ts'

/** Every part, by what it is for: the document's defaults, what is said
 * inline, what is pressed or typed in, the way around, lists of things, and
 * what frames a page. A group's name is never a part's: each is a place in
 * the guide. */
let modules = {
  Prose: { base, Surface: surface, Body: body, Doc: doc, Quote: quote },
  Marks: {
    Dot: dot,
    State: state,
    Badge: badge,
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
    Time: time,
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
    Save: save,
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
  },
  Page: {
    Identity: identity,
    Toolbar: toolbar,
    Transcript: transcript,
    Attachments: attachments,
    Annotated: annotated,
    Preview: preview,
    Composer: composer,
    Popover: popover,
    Skip: skip,

    Loading: loading,
    Empty: empty,
    Shell: shell,
    Head: head,
    Metrics: metrics,
    Section: section,
    More: more,
    Card: card,
    Modal: modal,
    Report: report,
    Group: group,
    Panes: panes,
    Overlay: overlay,
    Peek: peek,
    Palette: palette,
    Catalog: catalog,
    Gallery: gallery,
    Cards: cards,
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

// Grid is a published name for Cards; both carry the same rendering.
groups.Page.Grid = groups.Page.Cards

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

/** A scoped skin entry changes one kit's part; bare names dress every match. */
export let rendering = (
  c: Composition,
  kit: string,
  name: string,
): Skin[string] | undefined => {
  let names = [
    name,
    ...Object.keys(c.kits[kit]).filter((alias) =>
      alias != name && c.kits[kit][alias] == c.kits[kit][name]
    ),
  ]
  return names.map((name) => c.skin?.[`${kit}/${name}`] ?? c.skin?.[name])
    .find((skin) => skin != undefined)
}

let pieces = (c: Composition) => {
  // Surface is the paint every kit composes, including a host's subset.
  let hasSurface = Object.values(c.kits).some((kit) =>
    Object.values(kit).some((part) => part.Component == surface.Surface)
  )
  let counts = new Map<string, number>()
  for (let kit of Object.values(c.kits)) {
    for (let name of Object.keys(kit)) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  let selected = Object.entries(c.kits).flatMap(([kit, parts]) =>
    Object.entries(parts).map(([name, part]) => ({
      name: counts.get(name) == 1 ? name : `${kit}/${name}`,
      part,
      skin: rendering(c, kit, name),
    }))
  )
  return hasSurface ? selected : [
    { name: 'Surface', part: kit.Surface, skin: c.skin?.Surface },
    ...selected,
  ]
}

/** Unique names retain their spelling; shared names are qualified by kit. */
export let parts = (c: Composition): Kit =>
  Object.fromEntries(pieces(c).map(({ name, part }) => [name, part]))

/** Theme colours, each kit's entries, and the skin's replacement entries. */
export let sheet = (c: Composition): Sheet =>
  Object.freeze(
    Object.assign(
      {},
      ...pieces(c).map(({ part, skin }) =>
        (skin?.sheet ?? part.sheet)(c.theme.colors)
      ),
    ),
  )

/** Each part's native entries, the skin's where it replaces one, over the
 * theme's colours: a native host's look of every class (@yaks/native). */
export let native = (c: Composition): Native =>
  Object.freeze(
    Object.assign(
      {},
      ...pieces(c).map(({ part, skin }) =>
        (skin?.native ?? part.native)?.(c.theme.colors)
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
  return halved(css).replace(
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
    ...pieces(c).map(({ name, part, skin }) => {
      let { css = part.css, over = [] } = skin ?? {}
      return each([css, ...[over].flat()]).then((
        css,
      ): [string, string] => [name, css.join('\n')])
    }),
  ])
}

/** Every sheet a browser gets, in order, as one. */
export let stylesheet = async (c: Composition): Promise<string> =>
  (await sheets(c)).map(([, css]) => css).join('\n')
