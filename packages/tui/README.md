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
  is why `run` requests Kitty and xterm extended keys), plus arrows, home/end,
  word jump and word delete, `^A ^E ^U ^K ^W`, bracketed paste, and a painted
  cursor. It soft-wraps at its measured content width, grows to `max` visual
  rows and then scrolls. Arrows and Home/End navigate visual rows; Ctrl+A/E
  still address hard lines. Soft wraps never change submitted text. `edit()`
  handles text edits; `visualRows()` and `visualEdit()` handle wrapping and
  visual navigation.
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

## Inline images (experimental)

`Image` is a graph-independent component accepting an `ImageSource` with a
stable `key`, an asynchronous `load(): Promise<Uint8Array>`, `alt` text, and a
fixed cell height (`rows`). Enable `graphics: 'kitty'` on `ansiBackend` or `run`
to transmit PNG images using the Kitty graphics protocol. Pass `tmux: true` for
tmux DCS passthrough. Graphics are disabled by default; there is no capability
probe yet.

Images load only when their entire reserved rectangle is visible. Partially
clipped rectangles keep their text fallback instead of drawing over neighboring
content. Changing placement deletes the previous placement; removing the image
or stopping the backend cleans up its placements. A warm paint does not upload
image bytes again. Text changes may re-place a cached image, without
retransmitting it. Resizing recomputes the rectangle but does not invalidate its
bytes.

The first version supports PNG only, limits uploads to 4 MiB and declared pixel
area to 32 megapixels, and retains at most eight images (up to 32 MiB of source
bytes, plus temporary base64 encoding). Rows are clamped to 1–16. Images scale
to the reserved cell rectangle; aspect-ratio-aware sizing is not implemented. A
failed load keeps the label for the life of that cache entry. The terminal owns
PNG decoding; signature/dimension checks are not full image validation.

Kitty-capable terminal support must be configured by the application. In tmux,
`set -g allow-passthrough on` may be necessary. Protocol generation is tested,
but visual behavior depends on terminal/tmux versions and has not been verified
on a live iTerm2 installation. iTerm2's separate OSC 1337 protocol is not
implemented.

Kitty replies are terminal protocol data, not keystrokes. APC replies (including
fragmented replies and tmux-wrapped replies) are consumed before keyboard
handling. A bare Escape is distinguished from a fragmented reply with a short 25
ms delay. Every image upload chunk requests quiet operation. Error replies with
a known image ID leave a diagnostic fallback instead of inserting text into the
input box.

Image fallback labels distinguish loading, clipped/unvisited images, and failed
loads or rejected images. A “Kitty image sent” label means the backend sent its
commands, not that the terminal confirmed a visible placement. If that label
remains visible, verify terminal support and tmux passthrough configuration.

### Modified Enter

`feed()` preserves CSI keyboard sequences across stdin chunks, including Kitty
`CSI 13;2u` and xterm `CSI 27;2;13~` for Shift+Enter. Alt+Enter also inserts a
newline, including the legacy ESC-prefixed CR/LF form. Complete sequences are
dispatched immediately; partial CSI sequences are held without extending the
existing standalone Escape timeout.

If a terminal sends a bare CR or LF for Shift+Enter, it is indistinguishable
from plain Enter. The decoder cannot reconstruct the missing modifier. Inspect
the terminal's extended-key settings or reset its terminal session in that case;
application-side decoding changes cannot recover a modifier that was not sent.

### Compact sidebars and controlled shortcuts

A bounded `Frame` panel can set `fit: true`. It takes its natural content
height, up to an equal share of the available height; ordinary bounded panels
receive the unused rows. This keeps short summaries compact while a longer list
uses the remaining space. Overflow still scrolls. Panel order is display order,
so put a summary last to keep it at the bottom when another panel grows.

The layout attribute `grow-fit="1"` provides the same behavior inside a column.
The `fill="1"` attribute fills a row's available width with its inherited style,
useful for background selection without adding a marker column.

`Textarea` accepts an optional `passKey(key)` predicate. Returning true leaves
that key to another mounted handler, allowing an application to reserve
navigation shortcuts without changing the standalone editor's bindings.

## Controlled keyboard routing

`useKeymap(handler)` registers a mounted interceptor before widget focus and
VISUAL handling. Returning true consumes an event. This supports application
modes without coupling widgets to an application store. Keep mode state in the
host; unregistering on unmount restores ordinary key handling.

`useKeys(handler, id)` optionally names a target. `pressTo(id, key)` sends a
command to that target without moving focus; changing its ID does not reorder
the keyboard stack. `pressFocused(key)` forwards an already-routed key without
running interceptors again. `beginVisual(id)` begins source selection on a
specific registered text surface. A controlled `Textarea` can set `active` false
to hide its cursor while another mode owns input.

### Clipboard requests

`copyText(text)` requests a clipboard write through the backend installed by
`run`. It returns whether a writer was available, not whether the terminal
accepted the clipboard contents. The terminal backend uses OSC52 with UTF-8
base64 encoding. Callers own any local recovery buffer and should keep it before
clearing editable text. This API does not modify a textarea or VISUAL selection.

## Tables

Semantic `table`, `thead`, `tbody`, `tfoot`, `tr`, `th`, and `td` elements use
measured columns rather than text separated with pipes. Header cells are bold;
`Table_Header` and `Table_Border` theme tokens control their appearance. Borders
are dim by default, with a horizontal divider between every logical row. Cells
retain text styles and links, wrap words and long runs, and preserve explicit
line breaks. Use `align="left"`, `"center"`, or `"right"` on cells; a CSS
`text-align` declaration is also recognized. Shared Markdown rendering supplies
the alignment from its column markers.

Tables fill the available content width. Columns start at three text positions
and grow toward sampled content widths, capped at forty positions for this
initial allocation. Any remaining space is shared evenly across columns, with
leftmost columns receiving rounding remainders. Sizing samples the first 32
rows, at most 128 text positions/nodes per cell. Later or larger values wrap
rather than changing the allocation. Missing cells are empty. If there is not
room for these columns and their borders, rows become stacked records with
header labels repeated above each value. No columns are silently discarded.

Tables nested in quotes, lists, or bordered boxes use the remaining inner width.
A whole table is still laid out when its virtual-list item is measured; rows
within an individual table are not virtualized. Cached items are reused on warm
paints. Column/row spanning and CSS table sizing are not supported. Like the
rest of the current text painter, widths count UTF-16 code units, not terminal
grapheme widths; wide CJK characters, combining marks and emoji can therefore
misalign. This renderer does not introduce a separate, incompatible Unicode
width calculation just for tables.

### Code block backgrounds

Semantic `pre` elements fill their available width with the `Code` theme style,
including blank lines. The default code background is neutral dark grey
(`#343434`), without a blue tint; the foreground is unchanged. Enclosing borders
and indentation reduce that width. Inline `code` styles only its text. Source
text and the enclosing layout's existing long-line wrapping or clipping behavior
are unchanged.

### Proportional terminal sidebar

`Frame` defaults to a fixed 30-column sidebar. Set `ratio={0.2}` to use 20% of
terminal columns, rounded down, with `width` acting as the minimum (30 by
default). It leaves at least one terminal column for the main content. The
sidebar remains hidden below `min` terminal columns (90 by default).

`Frame` is a terminal-level layout: its width ratio and visibility threshold use
the terminal size, not a nested container's measured width. Nested layouts
should use the painter's row/column sizing or pass an explicit fixed `width`.
This option does not add general CSS percentage sizing.

### Controlled item selection

`VirtualList` accepts `selected: string` and `onSelect(id)` for item navigation.
Up/down select adjacent items, Home/End select endpoints, PageUp/PageDown move
approximately one viewport, and Ctrl+U/D move approximately half a viewport.
Page distances use measured average item heights; they do not measure unseen
history. The `List_Selected` theme token styles selection. A changed selection
is revealed automatically; wheel scrolling can subsequently move away from it.
Without `onSelect`, the existing row-scrolling behavior remains unchanged.

### Graceful quit

`run(App, {shutdown, force})` supports two-stage interruption. The first Ctrl+C
(or SIGINT) calls asynchronous `shutdown` and stops routing ordinary input.
Completion exits without another keypress. A second interrupt calls `force` and
exits without awaiting the drain. Applications can update their existing view
state inside `shutdown` to explain the wait. Without these callbacks, Ctrl+C
exits immediately. Fatal errors still restore the terminal.

### Partially loaded virtual lists

`VirtualList` accepts optional `range: { before, after }` and
`onRange({ anchor?, edge? })`. The flags describe unloaded neighbors. The widget
requests an overlapping range near a visible boundary; Home/End can request the
actual start/end rather than treating the loaded slice as the entire list. The
host fetches data, preserves the controlled item anchor, and replaces the loaded
items. Set `pending` while replacing a requested edge so the temporary
collection cannot overwrite the saved position.

The widget remains storage-independent. It uses the same item identity,
selection, and measured-line cache as a complete list. Its scrollbar estimates
unloaded ranges; it does not fetch or measure history to compute exact totals.

### Terminal focus and the input caret

The backend enables terminal focus reporting and restores its previous setting
on shutdown. `terminalFocused` describes terminal focus independently of widget
focus. `Textarea` hides its synthetic block caret on focus-out and restores it
on focus-in without changing its value or cursor position. Focus reports are
consumed before keyboard shortcuts and never become input text.

When no reports arrive, the terminal is assumed focused. Under tmux, focus
forwarding may require `set -g focus-events on`; the application does not change
your tmux configuration. Detection of inactive panes/windows depends on the
terminal and multiplexer forwarding those reports.
