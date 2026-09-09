# @yaks/tui

Preact, rendered to a terminal. Preact draws into a fake DOM; a **backend**
turns that tree into what the screen shows. The backend that ships is a
hand-rolled ANSI painter that repaints only the lines that changed.

```ts
import { h } from 'preact'
import { Frame, run, Scroll, Textarea } from '@yaks/tui'

let App = () =>
  h(
    Frame,
    { sidebar: [{ title: 'Status', Render: () => h('div', null, 'ok') }] },
    h(Scroll, { id: 'log', grow: '1' }, h('div', null, 'hello')),
    h(Textarea, { onSubmit: (text: string) => console.log(text) }),
  )

await run(App)
```

`deno run -A demo.ts` (or `deno task tui:demo` from the repo root) is the whole
thing driven: 500 transcript lines to scroll, an input box that appends to them,
a sidebar of two panels. Ctrl-C quits.

## The seam

```ts
type Backend = {
  size: () => { columns: number; rows: number }
  start: () => void
  draw: (root: TElement) => { written: number; metrics: Metrics }
  reset: () => void
  stop: () => void
}
```

Five calls. `draw` is handed the rendered tree and answers with how many screen
lines it wrote (what the snappiness test asserts on) and what it measured —
`{total, height}` per element `id`, which is how a scroll region learns how much
content it has, since only the thing that lays out knows. `run(App, {backend})`
takes another one; nothing in a widget names ANSI.

## Layout

Four structural attributes, because only the painter knows the terminal's size:

| attribute        | means                                                                         |
| ---------------- | ----------------------------------------------------------------------------- |
| `row`            | element children side by side                                                 |
| `col`            | element children stacked                                                      |
| `width` / `grow` | a fixed column, or the one that takes what is left                            |
| `wrap`           | fold text at word boundaries (hard-fold long words) before scroll measurement |
| `height`         | a fixed box                                                                   |
| `scroll`         | window this box's content from that offset, and measure it                    |

Everything else flows: block elements stack as lines, inline elements (`span`,
`b`, `i`, `a`, `button`, `label`) run into them, `pre` keeps its newlines, and
class names look up the sheet. A lone element child inherits its parent's box,
so a wrapper is not a layout.

## Style

`theme.ts` is the default sheet — `Block_Element-modifier` class names, the same
spelling the web uses, in Everforest. Pass `{sheet}` to `ansiBackend` or `run`
to add to it or replace an entry. `Style` is the whole vocabulary a class has:
`fg`, `bold`, `dim`, `italic`, `underline`, `strike`, `inverse`, `glyph`,
`indent`, `gap`.

## Widgets

- **`Scroll`** — a window over its children. Follows the bottom while it is at
  the bottom; arrows, page keys and the wheel move it. `scrolled()` is the math
  on its own.
- **`Textarea`** — the input box. Enter submits, Shift+Enter opens a line (which
  is why `run` pushes the kitty keyboard flag), plus arrows, home/end, word jump
  and word delete, `^A ^E ^U ^K ^W`, bracketed paste, and a painted cursor. It
  grows to `max` rows and then scrolls. `edit()` is the whole editor as one pure
  function.
- **`Frame`** — a main column and a right sidebar of `{title, Render}` panels,
  which folds away below `min` columns.

Keys reach widgets through `screen.ts`: `useKeys(fn)` puts a handler on the
focus stack while mounted (newest first, falsy passes it down), and `press(key)`
offers one. `size` and `useMetric(id)` are what a widget knows about the screen.

## The boundary

Every text node and every href loses the C0/DEL/C1 class before it is painted
(`@yaks/text`'s `safe`, keeping `\n`, which means a line break here, and turning
a tab into two spaces). Every escape the terminal sees comes from `ansi()` or
from `draw()` — never from content.

## Compatibility

Deno today: `run()` uses `Deno.stdin`, `Deno.consoleSize` and `SIGWINCH`.
Everything below it — the DOM, the decoder, the painter, the widgets — is
runtime-agnostic and tested through an injected size and write, so another
host's entry point is a small file, not a port.
