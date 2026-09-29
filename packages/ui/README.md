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

| component  | parts                                  | variants                                                                                                                                |
| ---------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Dot`      | the pip                                | shapes `ring` `dashed` `half` `pulse` `check` `cross` `alert`; tones `info` `active` `positive` `negative` `caution` `accent` `special` |
| `Id`       | an identifier                          | `hover`, `retired`                                                                                                                      |
| `Stamp`    | a moment, said in words                |                                                                                                                                         |
| `Tabs`     | `Tab`, `Badge`                         | `Tab-on`, `Tab-hover`                                                                                                                   |
| `Menu`     | `Item`, `Rule`                         | `Item-hover`, `Item-danger`                                                                                                             |
| `Tip`      | a tooltip                              |                                                                                                                                         |
| `Field`    | a text field                           | `bare`; `lines` makes it a textarea, `caret` shows the caret in a terminal                                                              |
| `Choices`  | `Item`, `Text`, `Note`                 | `Item-on` (the picked one), `Item-hover`                                                                                                |
| `Button`   | a press                                | `add`, `danger`, `quiet`                                                                                                                |
| `Chip`     | a name, as a token                     | hues `0` to `5`, `ghost`                                                                                                                |
| `Value`    | a stored value                         | shapes `text` `num` `bool` `id` `time` `json` `nil`                                                                                     |
| `Pairs`    | `Key`, `Value`                         |                                                                                                                                         |
| `Tile`     | `Id`, `Kind`, `Title`, `Note`, `Count` |                                                                                                                                         |
| `Rows`     | `Item`, `More`                         | `nested`                                                                                                                                |
| `Section`  | `Title`, `Count`, `Note`, `Fold`       | `Fold-open`                                                                                                                             |
| `Timeline` | `Item`, `When`, `Who`, `What`          |                                                                                                                                         |
| `Crumbs`   | `Item`                                 | `Item-here`                                                                                                                             |
| `Edit`     | a value where it can be changed        | the class @yaks/render's editors put on each control; `Edit` itself is the read-only value                                              |

A variant for a pseudo-class (`hover`) lets the style guide show that state.

## Themes

A theme is a stylesheet of CSS custom properties (`--bg`, `--dim`, …) and the
same colours as values. Every component's CSS reads the properties through
`var()`, and every component's terminal entries are a function of the colours.
Everforest is the first theme: `everforest.css`, with a light face for a light
system, and `everforest.ts`.

```ts ignore
import { everforest, sheet, stylesheet } from '@yaks/ui'

let css = await stylesheet(everforest) // the theme, then every part's CSS
let dress = sheet(everforest) // what @yaks/tui's painter styles them with
```

`sheet()` also colours @yaks/tui's own widgets (tables, scrollbars, panels, the
text entry), the way the base stylesheet colours a browser's scrollbars.

## The style guide

`Guide` is every part in every variant, on one page built of plain HTML. The
routes facet (`@yaks/ui/routes`) answers it at `/ui` as a static page with the
stylesheet inline, and web's terminal shows it on `:ui`.

## Files

| file            | owns                                                                  |
| --------------- | --------------------------------------------------------------------- |
| `el.ts`         | `el`, `block`, and the link nesting                                   |
| `kit.ts`        | the parts, and `stylesheet(theme)` and `sheet(theme)` over them       |
| `theme.ts`      | the `Theme`, `Colors`, `Kit` and `Specimen` types                     |
| `base.*`        | the document's defaults: prose, code, tables, syntax, scrollbars      |
| `<Part>.ts/css` | one component: the part, its terminal entries, its specimens; its CSS |
| `everforest.*`  | the first theme                                                       |
| `guide.ts`      | the style guide                                                       |
| `routes.ts`     | `/ui`                                                                 |

A new component is its module and its CSS file, and one line in `kit.ts`.
