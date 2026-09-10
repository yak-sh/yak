# @yaks/tui

Preact, rendered to a terminal. Preact draws into a fake DOM; a **backend**
turns that tree into what the screen shows. The backend that ships is a ANSI
painter that repaints only the lines that changed.

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

## Backend contract

```ts
type Backend = {
  size: () => { columns: number; rows: number }
  start: () => void
  draw: (root: TElement) => { written: number; metrics: Metrics }
  reset: () => void
  stop: () => void
}
```

`draw` receives the rendered tree and returns the number of screen lines written
and its layout measurements — `{total, height}` per element `id`, which is how a
scroll region learns how much content it has, since only the thing that lays out
knows. `run(App, {backend})` takes another one; nothing in a widget names ANSI.

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
  soft-wraps at its measured content width, grows to `max` visual rows and then
  scrolls. Arrows and Home/End navigate visual rows; Ctrl+A/E still address hard
  lines. Soft wraps never change submitted text. `edit()` handles text edits;
  `visualRows()` and `visualEdit()` handle wrapping and visual navigation.
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
runtime-agnostic and tested through an injected size and write, but another
runtime still needs its own input and terminal-lifecycle adapter.

### Lazy lists

`VirtualList` accepts items with stable `id`s, `renderItem`, and an optional
content `version(item)` (default: JSON). Use `follow: true` for transcripts;
ordinary lists start at the first item. Detached scrolling keeps the top item ID
and its local visual-row offset. Reordering or changing earlier items does not
move that anchor. Shrinking the anchor clamps its offset; removing it selects
its old-index successor, or the final remaining item. A changed `id` resets the
viewport. Home/End with Ctrl jump to start/follow-end; paging and wheel keys
move locally. Viewport height changes preserve a detached top anchor, or the
bottom edge while following.

Cold bottom-open walks backward only until the screen fills. No earlier-item
height pass, prefix sum, total-height measurement, or spacer estimate is needed.
The painter delegates this viewport's layout directly, bypassing normal child
layout. There is no extra overscan: each visited item is measured as a unit and
its complete wrapped lines remain available for subsequent nearby scrolling.
Only visible items are revisited on warm paints. Preact structural trees (and
therefore parsed Markdown results) and wrapped lines are retained in separate
256-item LRU caches. Resize/theme changes re-layout visible cached trees only;
content versions invalidate trees as well. List item renderers must be static
presentation: live editing components belong outside this cache. If rendering
also depends on external data, include that revision in `version`.

This is rendering virtualization, not graph pagination: replacing the items
array builds an O(N) identity index; unchanged arrays do not. The application
still owns the full item data. Memory is bounded by item count, not bytes, and a
single giant entry still costs its whole parse/layout. No scrollbar is exposed,
so there is no misleading exact total height for unmeasured history.

### Pointer routing

`decode`/`feed` return `Input` (`Key | Mouse`): narrow `name === 'mouse'` before
sending keyboard input to `press`. SGR reports carry zero-based `x/y`, button,
modifiers, release, event type and signed wheel deltas. Button reports are
retained; no click synthesis or application click actions are installed.

The ANSI backend returns ownership-bearing, screen-clipped `lines`. `routeMouse`
hit-tests these painted cells and bubbles through `TElement.parentNode` to
Preact `onWheel`, `onMouseDown`, `onMouseUp` and `onMouseMove` listeners.
Handlers receive `target`, `currentTarget`, `preventDefault()` (consumption) and
`stopPropagation()`. Returning true also consumes. This is bubble-only, not a
full browser event model. Misses do not fall back to keyboard focus. Resize and
shutdown invalidate the saved hit surface. Custom backends without `lines`
continue to support keyboard input but do not provide pointer targets.

`Scroll` and `VirtualList` accept unmodified vertical wheel notches at the
pointed region, consuming movement and allowing known boundaries to bubble.
Keyboard scrolling is unchanged. Virtual item trees remain detached/lazy;
currently their painted cells target the list host, not individual item nodes.
Terminal mode 1000 supplies buttons/wheels, 1006 selects SGR; their previous
modes are saved/restored using DEC private mode save/restore. Alternate-scroll
mode remains enabled for terminals without mouse reporting. Terminals must
support these mode controls for restoration to work. Motion is decoded if
received, but motion reporting is not enabled.

Hit coordinates follow the painter's existing string-length width model, so wide
glyphs/combining characters share its existing limitations. No pointer capture,
capture-phase listeners, synthetic clicks or horizontal scrolling yet.

### Optional scrollbars

`VirtualList` and `Scroll` accept `scrollbar: true`. The bar reserves one column
and uses a three-row solid thumb on a `│` track (short viewports clamp it;
widths below two columns omit it). `Scrollbar` and `Scrollbar_Snapped` theme
tokens control its appearance; following the end dims the bar. This is visual
only, without dragging or click-to-jump.

Virtual-list thumb positions estimate unvisited heights from the bounded
measurement cache. Estimates may adjust as items are visited, but never move the
item-relative anchor or cause offscreen layout. Empty and short content still
show the thumb; an end-following list places it at the bottom.

### Characterwise VISUAL selection

A host supplies `useVisualController(get, set)`; application state stays outside
TUI widgets. `useTextSurface({id, snapshot, width, adjacent?})` opts in any text
region. Textarea registers its draft; VirtualList registers only when given
`textOf(item)`. That callback reads one anchored item, not rendered history.

Alt+v enters VISUAL (or cycles regions), Tab cycles opt-in regions, hjkl/arrows
extend an inclusive selection, Home/End select to row boundaries, `y` yanks and
exits, Escape cancels. Plain keys remain editing keys outside VISUAL. `[` / `]`
choose the previous/next item where supplied, resetting the selection.

This first implementation is **source selection**: the chosen region temporarily
shows its exact source in a plain wrapped view, with an inverse selection. This
avoids copying ANSI, borders or rendered metadata, and retains Markdown source
and explicit newlines without inventing soft-wrap newlines. Selection is bounded
to one surface/item; cross-item ranges and rendered-Markdown selection are not
implemented. Navigating within the source view scrolls locally and leaves the
normal virtual-list anchor unchanged. Unmounting a surface does not read its
data.

The ANSI backend requests OSC52 clipboard writes only on `y`. A terminal may
deny or truncate those writes: success is not acknowledged. iTerm2 clipboard
permission and tmux `set-clipboard`/OSC52 support must be enabled as
appropriate; no shell clipboard program or tmux passthrough bypass is used.
Hosts may supply their own clipboard backend. The harness retains the last yank
in its private ephemeral `visual.yank` field regardless of terminal clipboard
support.

Limitations: one active visual controller per terminal (like the existing
keyboard stack), no mouse selection yet, and display geometry uses the editor's
existing UTF-16 column model rather than grapheme/wcwidth-aware geometry. The
controller must return current state synchronously so burst input can advance
selection.
