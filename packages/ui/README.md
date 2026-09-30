# @yaks/ui

The UI components: named parts with semantic variants, for display only. A UI
component has no state, knows no graph and no application, sets no outer layout
(no margins, no widths of its own), and looks the same wherever it sits. What it
means and what a press on it does belong to the domain component that uses it.
The idea is https://yak.sh/composable-ui.md.

Each component is three things: a Preact component, its CSS file, and its
entries in a terminal sheet. So one tree paints in a browser, styled by CSS, and
in a terminal through @yaks/tui, styled by the sheet, under the same
`Block_Element-modifier` class names.

## Parts

`el(tag, base)` makes a part; its `mod` prop adds variants:

```ts
import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { el } from '@yaks/ui'

let Dot = el('span', 'Dot')
assertEquals(
  renderToString(h(Dot, { mod: ['half', 'active'] })),
  '<span class="Dot Dot-half Dot-active"></span>',
)
```

`block(tag, base, { Element: tag })` hangs a block's elements on it:
`block('div', 'Menu', { Item: 'button' })` carries `Menu.Item`, a
`button.Menu_Item`. A part given an `href` is a link, and links nest the way
HTML allows: inside a link, the same href is not a second link, and another
keeps its tag and says `role="link"` and `data-href`, for the application to
follow (web's nav.tsx listens for it).

| component  | parts                                                                  | variants                                                                                                                                |
| ---------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Dot`      | the pip                                                                | shapes `ring` `dashed` `half` `pulse` `check` `cross` `alert`; tones `info` `active` `positive` `negative` `caution` `accent` `special` |
| `Id`       | an identifier                                                          | `hover`, `retired`                                                                                                                      |
| `Stamp`    | a moment, said in words                                                |                                                                                                                                         |
| `Tabs`     | `Tab`, `Badge`                                                         | `Tab-on`, `Tab-hover`                                                                                                                   |
| `Menu`     | `Item`, `Rule`                                                         | `Item-hover`, `Item-danger`                                                                                                             |
| `Tip`      | a tooltip                                                              |                                                                                                                                         |
| `Field`    | a text field                                                           | `bare`; `lines` makes it a textarea, `caret` shows the caret in a terminal                                                              |
| `Choices`  | `Item`, `Text`, `Note`                                                 | `Item-on` (the picked one), `Item-hover`                                                                                                |
| `Button`   | a press                                                                | `add`, `danger`, `quiet`                                                                                                                |
| `Chip`     | a name, as a token                                                     | hues `0` to `5`, `ghost`                                                                                                                |
| `Value`    | a stored value                                                         | shapes `text` `num` `bool` `id` `time` `json` `nil`                                                                                     |
| `Pairs`    | `Key`, `Value`                                                         |                                                                                                                                         |
| `Tile`     | `Id`, `Kind`, `Title`, `Note`, `Count`                                 |                                                                                                                                         |
| `Rows`     | `Item`, `More`                                                         | `nested`                                                                                                                                |
| `Section`  | `Title`, `Count`, `Note`, `Sub`                                        | `Note-refused`                                                                                                                          |
| `Timeline` | `Item`, `When`, `Who`, `What`                                          |                                                                                                                                         |
| `Crumbs`   | `Item`                                                                 | `Item-here`                                                                                                                             |
| `Edit`     | a value typed over where it stands, or a control that reads as a value | `fit`                                                                                                                                   |
| `Prop`     | `Val`, `Hand`, `Pop`, `Tab`, `Row`, `Find`, `Query`                    | `live`; `Val-nil`, `Hand-empty`, `Pop-list`, `Tab-on`, `Row-none`                                                                       |
| `Overlay`  | a position floating above the page                                     |                                                                                                                                         |
| `Table`    | `Head`, `Body`, `Row`, `Heading`, `Cell`                               | `Row-picks`, `Row-on`, `Row-hover`; `Heading-sorts`, `Heading-asc`, `Heading-desc`, `Heading-num`; `Cell-num`, `Cell-key`, `Cell-prose` |
| `Pager`    | `Span`, `Step`                                                         | a `Step` is `disabled` with nowhere to go                                                                                               |
| `Panes`    | `Pane`, `Top`, `Body`                                                  | `Pane-nav`, `Pane-main`, `Pane-aside`, `Pane-on`                                                                                        |
| `Head`     | `Title`, `Id`, `Kind`, `Sub`, `Facts`                                  | `Sub-refused`                                                                                                                           |
| `Notes`    | `Item`, `Text`, `Who`, `When`                                          | `Item-done`                                                                                                                             |
| `Say`      | one line to send something on                                          |                                                                                                                                         |
| `Index`    | `Group`, `Head`, `Item`                                                | `Head-on`, `Item-on`, `Item-hover`                                                                                                      |

A variant for a pseudo-class (`hover`) lets the style guide show that state.

A `Table` is a grid, not an html table: its `cols` say what each column holds
(`h(Table, { cols: [null, 'prose', 'num'] }, …)`, the variant its cells wear or
nothing for text), each row is a subgrid of it so the cells line up, and a cell
keeps to one line, cut with an ellipsis, as a table cell cannot. Its parts say
`table`, `row`, `cell` and `columnheader` by their roles.

A part's terminal entries say what its CSS says of its layout (@yaks/tui's
`spaced`, `row`, `col`, `width`, `grow`, `grid`, `wrap`, `ellipsis`, `align`,
`border`), never an attribute on the element: a part laid out by a CSS gap is
`spaced`, so its runs stay apart in a terminal too, `Panes` are framed columns
of the screen, and a `Table` is a `grid` whose cells cut with an `ellipsis`.

## Themes

A theme is a stylesheet of CSS custom properties and the same colours as values.
Every colour names a role, never a hue, so a part says what a thing is and the
theme says how it looks:

- the ground and the ink: `--bg`, `--surface`, `--card`, `--border`,
  `--border2`, `--text`, `--muted`, `--dim`;
- `--accent`, selection and the primary action; `--link`, every link, whatever
  part it is in (an anchor, a `Pager.Step`); `--heading`, a section's title;
- the tones a state is said in, which are a `Dot`'s: `--info`, `--active`,
  `--positive`, `--negative`, `--caution`, `--special`;
- what a value is: `--number`, `--literal` (true, false, null), `--time`,
  `--who`; and code's `--keyword`, `--string`, `--fn`, `--type`, `--attr`;
- `--hue-0` to `--hue-5`, six colours that only tell things apart (a `Chip`'s).

`Colors` (theme.ts) lists them. Each is a `light-dark()` pair, so the page's
`color-scheme` picks the light scheme or the dark: the system's, unless the page
sets one. A terminal paints the dark. Besides its colours a theme sets its type
(`--font`, `--mono`), its spacing (`--gap`, `--radius`, `--measure`) and the
shadow under a raised box (`--shadow`); the base derives `--half-gap`, `--soft`
and the touch-target floor `--tap` from them. Every component's CSS reads the
properties through `var()`, and every component's terminal entries are a
function of the colours.

`themes` (kit.ts) is every theme by name. Everforest (`everforest.css`,
`everforest.ts`) is the first and the default. Rosé Pine (`rosepine.*`) shares
nothing with it but the names: a serif, round corners, more room, and a palette
with no green, so a part that leans on one theme's values shows in the other.

```ts ignore
import { everforest, sheet, stylesheet } from '@yaks/ui'

let css = await stylesheet(everforest) // the theme, then every part's CSS
let dress = sheet(everforest) // what @yaks/tui's painter styles them with
```

`sheet()` also colours @yaks/tui's own widgets (tables, scrollbars, panels, the
text entry), the way the base stylesheet colours a browser's scrollbars.

## The style guide

`Guide` is every part in every variant, on one page built of plain HTML, and
`Specimens` is one part's section of it. The routes facet (`@yaks/ui/routes`)
answers it at `/ui` as a static page with the stylesheet inline, and web's
terminal shows it on `:ui`. `/ui` takes the theme and the scheme it is seen in,
`?theme=rosepine&scheme=light`, and a row of links over the guide switches each.

The cli facet (`@yaks/ui/cli`) holds it in a terminal as `yak ui`, painted
through each part's terminal sheet: the themes as tabs over an index of the
parts, and beside them the whole guide or one part's section. j and k walk the
index and the page follows, ↑ ↓ PgUp PgDn scroll the page, t paints it all in
the next theme, and q quits; a press on an entry or a tab picks it. It reads
nothing from a graph.

## Files

| file            | owns                                                                  |
| --------------- | --------------------------------------------------------------------- |
| `el.ts`         | `el`, `block`, and the link nesting                                   |
| `kit.ts`        | the parts, `themes`, and `stylesheet(theme)` and `sheet(theme)`       |
| `theme.ts`      | the `Theme`, `Colors`, `Kit` and `Specimen` types                     |
| `base.*`        | the document's defaults: prose, code, tables, syntax, scrollbars      |
| `<Part>.ts/css` | one component: the part, its terminal entries, its specimens; its CSS |
| `everforest.*`  | the first theme                                                       |
| `rosepine.*`    | the second                                                            |
| `guide.ts`      | the style guide                                                       |
| `routes.ts`     | `/ui`                                                                 |
| `cli.ts`        | `yak ui`                                                              |
| `tui.ts`        | the style guide in a terminal                                         |

A new component is its module and its CSS file, and one line in `kit.ts`.
