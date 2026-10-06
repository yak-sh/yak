# @yaks/ui

Preact parts with semantic variants, CSS and terminal sheet entries. Use the
same parts in a browser and [@yaks/tui](../tui/README.md), compose kits with
themes and skins, and inspect their specimens in the style guide.

## Parts and rendering

A **part** is a Preact component with a named CSS class, such as `Dot`,
rendering `<span class="Dot">` (`Part`). A **variant** is a `mod` value that
adds a class to a part: `mod: 'ring'` adds `Dot-ring`. `block` attaches named
parts using an underscore: `Menu.Item` renders `Menu_Item`.

A **piece** carries a part's `Component`, CSS URL, terminal `sheet` function,
`description` and `specimens` function (`Piece`). A **kit** names pieces
(`Kit`); `kit` contains the base pieces, `groups` arranges them for the guide,
and `kits` registers that kit as `base`. A **specimen** is a label and a Preact
tree showing a part or variant (`Specimen`).

Parts present what their caller supplies. The caller chooses variants, owns
state and handles presses; parts do not read a
[graph](../graph/README.md#data-model). Their class names let CSS and terminal
[sheets](../tui/README.md#style) style the same tree.

```ts
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Dot, Tile } from '@yaks/ui'
import { equal } from '@yaks/testing'

const tree = h(
  Tile,
  { href: '/books/dune' },
  h(Tile.Title, {}, 'Dune'),
  h(Dot, { mod: ['half', 'active'] }),
)
equal(
  renderToString(tree),
  '<a href="/books/dune" class="Tile"><span class="Tile_Title">Dune</span><span class="Dot Dot-half Dot-active"></span></a>',
)
```

## Exports

| Import                   | Offers                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/ui`               | Parts below; `el`, `block`, `Surround`, `Props`, `Part`; `relative`; browser placement; kits, themes, skins, composition helpers and their types; `Guide`, `Specimens` |
| `@yaks/ui/ui`            | Base `kits`, `themes`, `skins` for a host's UI facet                                                                                                                   |
| `@yaks/ui/contributions` | Browser-safe `gather` and `Contributions`                                                                                                                              |
| `@yaks/ui/guide`         | `Guide`, `Specimens`, `Contents`, `Page`, `sections`, `stopsOf`, `stops`, `title`                                                                                      |
| `@yaks/ui/routes`        | `page`, `routes`: the static browser guide at `/ui`                                                                                                                    |
| `@yaks/ui/cli`           | `commands`: the terminal guide, `yak ui`                                                                                                                               |

## Building parts

`el(tag, base)` makes a part. Falsy `mod` values drop, `class` adds classes,
`elRef` supplies the element's ref, and other props pass to the element.
`block(tag, base, elements)` attaches parts by name.

```ts
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { block, el } from '@yaks/ui'
import { equal } from '@yaks/testing'

const Mark = el('span', 'Mark')
const Card = block('article', 'Card', { Title: 'h2' })
equal(
  renderToString(
    h(
      Card,
      {},
      h(
        Card.Title,
        {},
        h(Mark, { mod: ['active', false], class: 'extra' }, 'Ready'),
      ),
    ),
  ),
  '<article class="Card"><h2 class="Card_Title"><span class="Mark Mark-active extra">Ready</span></h2></article>',
)
```

An `href` makes a part an anchor. `Surround` carries the enclosing anchor's
href: a nested part with the same href keeps its original tag, and a different
href becomes `role="link"` with `data-href`. The application handles following
`data-href`.

```ts
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Id, Tile } from '@yaks/ui'
import { equal } from '@yaks/testing'

equal(
  renderToString(
    h(
      Tile,
      { href: '/a' },
      h(Id, { href: '/a' }, 'A'),
      h(Id, { href: '/b' }, 'B'),
    ),
  ),
  '<a href="/a" class="Tile"><span class="Id">A</span><span role="link" tabindex="0" data-href="/b" class="Id">B</span></a>',
)
```

## Base kit

| component  | parts                                                                                                           | variants                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Dot`      | the pip                                                                                                         | shapes `ring` `dashed` `half` `pulse` `check` `cross` `alert`; tones `info` `active` `positive` `negative` `caution` `accent` `special`    |
| `Id`       | an identifier                                                                                                   | `hover`, `retired`                                                                                                                         |
| `Stamp`    | a moment, said in words                                                                                         |                                                                                                                                            |
| `Tabs`     | `Tab`, `Badge`                                                                                                  | `Tab-on`, `Tab-hover`                                                                                                                      |
| `Menu`     | `Item`, `Rule`                                                                                                  | `Item-hover`, `Item-danger`                                                                                                                |
| `Tip`      | a tooltip                                                                                                       |                                                                                                                                            |
| `Field`    | a text field                                                                                                    | `bare`; `lines` makes it a textarea, `caret` shows the caret in a terminal                                                                 |
| `Choices`  | `Item`, `Text`, `Note`                                                                                          | `Item-on` (the picked one), `Item-hover`                                                                                                   |
| `Button`   | a press                                                                                                         | `add`, `danger`, `quiet`                                                                                                                   |
| `Chip`     | a name, as a token                                                                                              | hues `0` to `5`, `ghost`                                                                                                                   |
| `Value`    | a stored value                                                                                                  | shapes `text` `num` `bool` `id` `time` `json` `nil`                                                                                        |
| `Pairs`    | `Key`, `Value`                                                                                                  |                                                                                                                                            |
| `Tile`     | `Icon`, `Id`, `Kind`, `Title`, `Note`, `Count`, `Sub`, `End`                                                    | `on` (the one picked), `hover`, `dim`; `Sub-negative`; `Icon` tones `info` `active` `positive` `negative` `caution` `accent` `special`     |
| `Rows`     | `Item`, `More`                                                                                                  | `nested`                                                                                                                                   |
| `Section`  | `Title`, `Count`, `Note`, `Sub`                                                                                 | `Note-refused`                                                                                                                             |
| `Timeline` | `Item`, `When`, `Who`, `What`                                                                                   |                                                                                                                                            |
| `Turns`    | `Turn`, `Who`, `Text`, `More`                                                                                   | `Turn-on` (the one a page is about), `Turn-quiet` (a tool's)                                                                               |
| `Body`     | the text of a thing, to be read, at its measure                                                                 | `short`                                                                                                                                    |
| `Quote`    | `Text`, `By`, `Note`: words somebody said, who said them, when, where                                           |                                                                                                                                            |
| `Stack`    | `Strip`, `Name`, `Kind`, `Pane`                                                                                 | `Strip-hover`, `Pane-on`                                                                                                                   |
| `Edit`     | a value typed over where it stands, or a control that reads as a value                                          | `fit`                                                                                                                                      |
| `Prop`     | `Val`, `Hand`, `Pop`, `Tab`, `Row`, `Find`, `Query`                                                             | `live`; `Val-nil`, `Hand-empty`, `Pop-list`, `Tab-on`, `Row-none`                                                                          |
| `Overlay`  | a position floating above the page                                                                              |                                                                                                                                            |
| `Table`    | `Head`, `Body`, `Row`, `Heading`, `Cell`                                                                        | `Row-picks`, `Row-focus`, `Row-hover`; `Heading-sorts`, `Heading-asc`, `Heading-desc`, `Heading-num`; `Cell-num`, `Cell-key`, `Cell-prose` |
| `Pager`    | `Span`, `Step`                                                                                                  | a `Step` is `disabled` with nowhere to go                                                                                                  |
| `Panes`    | `Pane`, `Top`, `Body`                                                                                           | `Pane-nav`, `Pane-main`, `Pane-on`                                                                                                         |
| `Head`     | `Title`, `Id`, `Kind`, `Sub`, `Facts`                                                                           | `Sub-refused`                                                                                                                              |
| `Inbox`    | `Tools`, `Search`, `Mode`, `Lane`, `Heading`, `Thread`, `Open`, `Title`, `Reason`, `Preview`, `Detail`, `Empty` | `Thread-unread`                                                                                                                            |
| `Notes`    | `Item`, `Text`, `Who`, `When`, `Children`                                                                       | `Item-done`                                                                                                                                |
| `Say`      | one line to send something on                                                                                   |                                                                                                                                            |
| `Index`    | `Group`, `Head`, `Item`                                                                                         | `Head-on`, `Item-on`, `Item-hover`                                                                                                         |
| `Catalog`  | `Group`, `Heading`, `Entry`, `Title`, `Sub`                                                                     |                                                                                                                                            |
| `Gallery`  | `Figure`, `Caption`, `Stage`                                                                                    |                                                                                                                                            |

A `hover` variant lets specimens show a pseudo-class without a pointer. Every
piece supplies specimens; use them to see the parts and their variants without
inventing application behavior.

A `Tile` is one thing in a list. Its pieces are written flat, in any order: the
tile sets its `Icon`, its words (the title line over the `Sub`) and its `End`
side by side on a row that never wraps, so the icon keeps its title's line. A
tile given an `onClick` is a button, picked from its list: `aria-current` says
whether it is the one `on`.

```ts
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Tile } from '@yaks/ui'
import { equal } from '@yaks/testing'

const pick = () => {}
equal(
  renderToString(
    h(
      Tile,
      { mod: 'on', onClick: pick },
      h(Tile.End, {}, 'Lv 3'),
      h(Tile.Sub, {}, 'Under way'),
      h(Tile.Title, {}, 'Wolves at the mill'),
      h(Tile.Icon, {}, '◆'),
    ),
  ),
  '<button type="button" aria-current="true" class="Tile Tile-on">' +
    '<span class="Tile_Icon">◆</span><span class="Tile_Text">' +
    '<span class="Tile_Line"><span class="Tile_Title">Wolves at the mill</span></span>' +
    '<span class="Tile_Sub">Under way</span></span>' +
    '<span class="Tile_End">Lv 3</span></button>',
)
```

```ts
import { kit } from '@yaks/ui'
import { renderToString } from 'preact-render-to-string'
import { equal } from '@yaks/testing'

for (const piece of Object.values(kit)) {
  const samples = piece.specimens()
  equal(samples.length > 0, true)
  for (const [label, tree] of samples) {
    equal(label.length > 0, true)
    equal(renderToString(tree).length > 0, true)
  }
}
```

`Field` uses an input or, with `lines`, a textarea. `caret` supplies the
terminal's `data-caret`; a browser uses its own caret. `Stamp` displays words
supplied by its caller; `relative` can produce those words from a time.

```ts
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Field, relative, Stamp } from '@yaks/ui'
import { equal } from '@yaks/testing'

const now = Date.parse('2026-09-29T12:00:00Z')
equal(
  renderToString(h(Stamp, {}, relative('2026-09-29T11:55:00Z', now))),
  '<span class="Stamp">5 minutes ago</span>',
)
equal(
  renderToString(h(Field, { lines: true, caret: 0, placeholder: 'Notes' })),
  '<textarea placeholder="Notes" data-caret="0" class="Field"></textarea>',
)
```

`Table` uses a CSS grid with subgrid rows and accessibility roles. `cols` names
the column tracks; apply matching variants to cells. Text cuts short with an
ellipsis, `num` sets right, and `prose` wraps. The table owns its `style` prop
to carry those tracks. Sorting and selection belong to its caller.

```ts
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Table } from '@yaks/ui'
import { equal } from '@yaks/testing'

const tree = h(
  Table,
  { cols: ['num'] },
  h(
    Table.Head,
    {},
    h(Table.Row, {}, h(Table.Heading, { mod: ['num', 'desc'] }, 'Pages')),
  ),
  h(Table.Body, {}, h(Table.Row, {}, h(Table.Cell, { mod: 'num' }, '412'))),
)
const html = renderToString(tree)
equal(html.includes('role="table"'), true)
equal(html.includes('Pages ↓'), true)
equal(html.includes('class="Table_Cell Table_Cell-num">412'), true)
```

## Themes and skins

A **theme** supplies a CSS URL defining custom properties and the same colors as
values for terminal sheets (`Theme`). `Colors` names color roles: background,
ink, links, headings, states, stored values and code syntax; `hues` holds six
colors for `Chip`. `themes` names `everforest` and `rosepine`; `everforest` is
the default. Browser themes offer light and dark schemes selected by
`color-scheme`; terminal colors use the dark scheme. Themes also set fonts,
spacing, reading measure, radius and shadow.

The CSS custom properties use the same names as `Colors`:

- Background and ink: `--bg`, `--surface`, `--card`, `--border`, `--border2`,
  `--text`, `--muted`, `--dim`.
- Selection and the primary action: `--accent`; links: `--link`; section titles:
  `--heading`.
- Dot tones: `--info`, `--active`, `--positive`, `--negative`, `--caution`,
  `--special`.
- Values: `--number`, `--literal` (true, false, null), `--time`, `--who`; code
  syntax: `--keyword`, `--string`, `--fn`, `--type`, `--attr`.
- Chip hues: `--hue-0` through `--hue-5`.

Fonts use `--font` and `--mono`; spacing uses `--gap`, `--radius` and
`--measure`; raised boxes use `--shadow`. The base CSS derives `--half-gap`,
`--soft` and the touch target floor `--tap`.

A **skin** supplies CSS replacements by piece name and optional terminal sheet
replacements (`Skin`). A missing replacement uses the kit's rendering. `ledger`
replaces Button, Tabs, Head and Tile with printed labels and ruled records;
other pieces retain the kit's rendering.

A **composition** supplies `{ kits, theme, skin?, ux? }` to render a page and
its guide (`Composition`). `composition` is the base kits with `everforest`.
`parts` flattens its kits and refuses duplicate piece names. `stylesheet` loads
the theme, then one CSS rendering per piece in kit order; it resolves relative
CSS `url()` and quoted `@import` addresses against each CSS URL. `sheet`
combines the selected terminal entries, including the base entries for
[@yaks/tui](../tui/README.md)'s widgets.

```ts
import { composition, ledger, sheet, stylesheet } from '@yaks/ui'
import { equal } from '@yaks/testing'

const dressed = { ...composition, skin: ledger }
const css = await stylesheet(dressed)
equal(css.includes('.Button'), true)
equal(sheet(dressed).Button.bold, true)
equal(sheet(dressed).Field.fg, dressed.theme.colors.text)
```

## Contributions

**Contributions** are named kits, UX specimens, themes and skins from a
[plugin](../graph/README.md#data-model)'s browser-safe `./ui` facet
(`Contributions`). `gather` combines facets and refuses duplicate contribution
names. A kit's CSS URLs travel with its pieces, so pieces can live in another
package. `ux` holds descriptions and specimens for controlled
[@yaks/ux](../ux/README.md) components; the guide does not load their behavior.

```ts
import { h } from 'preact'
import { gather } from '@yaks/ui/contributions'
import { kits, skins, themes } from '@yaks/ui/ui'
import { type Composition, parts } from '@yaks/ui'
import { equal, throws } from '@yaks/testing'

const extra = { ...kits.base.Dot, Component: () => h('span', {}, 'extra') }
const all = gather([{ kits, themes, skins }, {
  kits: { extra: { Extra: extra } },
}])
const c: Composition = { kits: all.kits!, theme: all.themes!.rosepine }
equal(parts(c).Extra.Component, extra.Component)
await throws(() => gather([{ kits }, { kits }]))
await throws(() =>
  parts({ ...c, kits: { first: kits.base, second: kits.base } })
)
```

## Style guide

`Guide` shows each piece's description and specimens, grouped by kit, and UX
specimens. `Specimens` shows one entry and, when a skin is selected, whether it
uses the skin or the kit. `Contents` links to each entry. A **stop** is the id
of the whole guide, a group or an entry (`stopsOf`); `Page` renders one stop.

```ts
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { composition, ledger, Specimens } from '@yaks/ui'
import { Contents, Page, stopsOf } from '@yaks/ui/guide'
import { equal } from '@yaks/testing'

const c = { ...composition, skin: ledger }
equal(stopsOf(c).includes('Button'), true)
equal(
  renderToString(h(Specimens, { name: 'Button', composition: c }))
    .includes('data-skin="skin"'),
  true,
)
equal(
  renderToString(h(Page, { stop: 'Button', composition: c }))
    .includes('skin rendering'),
  true,
)
equal(
  renderToString(
    h(Contents, { composition: c, entry: (stop) => ({ href: `#${stop}` }) }),
  ).includes('href="#Button"'),
  true,
)
```

`routes(host?)` serves `/ui` as static HTML with inline CSS, contents and theme,
skin and scheme links. A host supplies gathered contributions as `host.ui`; the
default shows the base kit. Query parameters select the rendering, for example
`/ui?theme=rosepine&scheme=light&skin=ledger`.

```ts
import { routes } from '@yaks/ui/routes'
import { equal } from '@yaks/testing'

const [route] = routes()
const response = await route.handle(
  new Request(
    'https://example.com/ui?theme=rosepine&scheme=light&skin=ledger',
  ),
)
const html = await response.text()
equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
equal(html.includes('color-scheme: light'), true)
equal(html.includes('skin rendering'), true)
```

The CLI facet opens the base guide as `yak ui`: j and k walk its contents, ↑ ↓
PgUp PgDn scroll, t changes theme, s changes skin, and q quits. Clicking
contents, theme or skin entries selects them. This interactive command needs a
terminal, so it is not run by this README's Deno examples.

```sh
yak ui
```

## Browser placement

`Float` renders its children into an `Overlay` fixed on `document.body`,
positioned on its anchor's live rectangle and carrying the originating tree's
Preact context. This avoids clipping and scaling by ancestors. `place` places a
fixed element above or below a rectangle, flipping and clamping to the viewport;
`placeAt` positions it at a point, optionally aligned right. `usePlaceAt`
repeats placement when the element resizes. `tips()` installs one delegated
tooltip for `[data-tip]` per page.

This example needs a browser DOM, viewport measurements and `ResizeObserver`, so
the Deno example runner cannot run it. The supplied point is inside a viewport
larger than the overlay.

```ts ignore
import { h, render } from 'preact'
import { Float, placeAt, Tip, tips } from '@yaks/ui'
import { equal } from '@yaks/testing'

const anchor = document.createElement('button')
anchor.textContent = 'Details'
anchor.setAttribute('data-tip', 'Open details')
document.body.append(anchor)
const root = document.createElement('div')
document.body.append(root)
render(
  h(
    Float,
    { anchor: { current: anchor }, side: 'below' },
    h(Tip, {}, 'Details'),
  ),
  root,
)
equal(document.body.querySelector('.Overlay')?.textContent, 'Details')
const overlay = document.body.querySelector<HTMLElement>('.Overlay')!
placeAt(overlay, 100, 100)
equal(overlay.style.left, '100px')
tips()
render(null, root)
root.remove()
anchor.remove()
```

## Limits

Application meaning, state and press behavior belong to callers; reusable
interaction components belong to [@yaks/ux](../ux/README.md). Terminal rendering
belongs to [@yaks/tui](../tui/README.md). A terminal host supplies no `Float`;
`Float` itself returns no rendered children when there is no browser body.
