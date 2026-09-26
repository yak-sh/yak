# @yaks/tui

`@yaks/tui` renders Preact components in a terminal. Preact writes an in-memory
tree through the small DOM implementation in `dom.ts`; a `Backend` measures and
paints that tree. The included ANSI backend updates only changed terminal rows.

The package does not persist application data. Components keep transient input,
scroll, measurement, and selection state in memory. Applications own durable
data and pass it into their component tree.

```ts ignore
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

From this directory, run `deno task demo`. From the repository root, run
`deno task tui:demo`. The demo provides 500 scrollable transcript lines, a
multiline input, and two responsive sidebar panels. Press Ctrl+C to exit.

The public entry point is `mod.ts`. It exports:

- application lifecycle: `run` and `quit`, and `print`, which paints a tree once
  for a command that prints and exits (also `@yaks/tui/print`, without the
  widgets);
- components and related types: `Frame`, `Panel`, `Scroll`, `View`, `Textarea`,
  `VirtualList`, `VirtualWindow`, `VirtualItem`, `Anchor`, `Image`, and
  `ImageSource`;
- rendering: `ansiBackend`, `Backend`, `Line`, `Seg`, `Metrics`, `lay`, `clip`,
  `wrap`, `screenful`, `printout`, `ansi`, and `clipboard`;
- styling: `theme`, `everforest`, `Sheet`, and `Style`;
- input and routing: `decode`, `feed`, `Input`, `Key`, `Mouse`, `MouseEvent`,
  `Name`, `Keys`, `useKeys`, `useKeymap`, `press`, `pressTo`, `pressFocused`,
  `hit`, and `routeMouse`;
- screen state: `size`, `metrics`, `terminalFocused`, `useMetric`, `measured`,
  and `clear`;
- selection: `useVisualController`, `useTextSurface`, `emptyVisual`,
  `VisualState`, `beginVisual`, `visualKey`, `copyText`, `RenderedCursor`, and
  `TextPoint`;
- low-level DOM utilities: `doc`, `install`, `onPaint`, `touch`, `TNode`,
  `TText`, and `TElement`;
- pure editor and scrolling helpers: `Edit`, `bol`, `eol`, `spot`, `edit`, and
  `scrolled`.

Most applications need only `run` and the components. The lower-level exports
support custom backends, focused tests, and applications that own input routing.

## Backend contract

```ts
type Backend = {
  control?: (body: string) => void
  size: () => { columns: number; rows: number }
  start: () => void
  draw: (
    root: TElement,
  ) => { written: number; metrics: Metrics; lines?: Line[] }
  reset: () => void
  copy?: (text: string) => void
  stop: () => void
}
```

`run(App, { backend })` accepts a custom backend. `draw` receives the rendered
tree and returns the number of terminal rows written plus measurements for
elements with an `id`. Each measurement contains `{ total, height, width }`,
which lets scrolling components respond to layout without knowing terminal
dimensions themselves. Optional painted `lines` enable pointer hit testing.
`control` receives terminal protocol replies, and `copy` handles clipboard
requests. Widgets do not depend directly on ANSI escape sequences.

## Layout

The painter recognizes these structural attributes:

| Attribute       | Meaning                                                           |
| --------------- | ----------------------------------------------------------------- |
| `row`           | Lay out element children side by side.                            |
| `col`           | Stack element children vertically.                                |
| `width`         | Reserve a fixed number of columns.                                |
| `grow`          | Use space left by fixed siblings.                                 |
| `grow-fit`      | In a column, shrink to content within the element's share.        |
| `wrap`          | Wrap at word boundaries and split words longer than the width.    |
| `height`        | Reserve a fixed number of rows.                                   |
| `max-height`    | Cap rows without padding shorter content.                         |
| `overflow-text` | Add a final plain-text row when `max-height` clips content.       |
| `scroll`        | Display content starting at a row offset and report measurements. |
| `fill`          | Extend the inherited style across the available row width.        |

Block elements stack as rows. Inline elements such as `span`, `b`, `i`, `a`,
`button`, and `label` share a row. `pre` preserves newlines. A class name looks
up a `Style` in the active `Sheet`. A wrapper with one element child passes its
box to that child.

Semantic `strong`, `em`, `del`, headings, links, code, block quotes, rules, and
tables receive terminal-specific rendering without requiring application
components to emit ANSI.

## Style

`theme.ts` exports the default `theme` sheet and the `everforest` color palette.
Class names use the repository's `Block_Element-modifier` convention. Pass
`sheet` to `run` or `ansiBackend`; provided entries replace default entries with
the same names.

A `Style` may set `fg`, `bg`, `bold`, `dim`, `italic`, `underline`, `strike`,
`inverse`, `glyph`, `indent`, and `gap`. The painter also uses `href` internally
for sanitized links.

## Widgets

- `Scroll` displays a window over its children. It follows appended content
  while positioned at the bottom. Arrow keys, page keys, Ctrl+Home/Ctrl+End, and
  the mouse wheel change its offset. Set `follow={false}` for content that
  should open at the top, `keyboard={false}` when another component owns keys,
  or `scrollbar` to reserve a visual scrollbar column. `scrolled` exposes its
  offset calculation as a pure function.
- `Textarea` is a multiline editor. Enter submits and Shift+Enter or Alt+Enter
  inserts a newline. It supports navigation, word movement and deletion,
  Ctrl+A/E/U/K/W, bracketed paste, soft wrapping, and a painted cursor. `max`
  limits its visible rows. The pure helpers `edit`, `bol`, `eol`, and `spot`
  support editor tests and custom controls.
- `Frame` places application content beside an optional right sidebar. Each
  `Panel` supplies a `title` and Preact `Render` component. The sidebar is
  hidden below `min` terminal columns.
- `VirtualList` renders only enough stable-ID items to fill its viewport. Use it
  for large transcripts or lists whose items are static presentation.
- `Image` reserves terminal cells for an asynchronously loaded PNG when Kitty
  graphics are enabled and otherwise displays its fallback label.

`useKeys(handler)` registers a handler while its component is mounted. Newer
handlers run first, and a falsy return passes the key to the next handler.
`press(key)` starts normal routing. `size` is a signal containing terminal
dimensions; `useMetric(id)` returns the last layout measurement for an element.

## The boundary

Before painting, the backend removes C0, DEL, and C1 control characters from
text and link targets with `@yaks/text`. Newlines remain line breaks and tabs
become two spaces. All terminal escape sequences originate in backend code,
including `ansi`, drawing, graphics, and clipboard output.

## Compatibility

`run` currently requires Deno because it uses `Deno.stdin`, `Deno.consoleSize`,
and signal listeners. The DOM, input decoder, painter, and widgets accept
injected data and can be used in another runtime, but that runtime must provide
its own terminal input and lifecycle adapter.

### Lazy lists

Each `VirtualList` item must have a stable string `id`. Pass `renderItem` to
produce its Preact content and optionally pass `version(item)` when content can
change without its ID changing. The default version is `JSON.stringify(item)`.
Use `follow` for a transcript that starts and remains at the end; otherwise the
list starts at its first item.

The viewport stores an item ID and visual-row offset instead of a global row
number. Changes before that item therefore preserve the visible position.
Removing the anchor selects its former successor or the last remaining item.
Changing the list component's `id` resets its viewport.

Opening at the bottom measures backward only until the screen is full. The list
does not calculate every earlier item height or mount every item. It retains up
to 256 Preact trees and 256 laid-out items in separate least-recently-used
caches. A resize or theme change lays out visible cached trees again; a changed
version rebuilds the affected tree. Render item content as static presentation,
and include revisions of external dependencies in `version`.

The application still owns the complete item array. Replacing that array builds
an O(N) ID index; passing the same array does not. Cache limits count items, so
one very large item can still consume substantial memory.

### Pointer routing

`decode` and `feed` return `Input`, which is `Key | Mouse`. Check
`input.name === 'mouse'` before passing keyboard input to `press`. SGR mouse
reports contain zero-based coordinates, button data, modifiers, release state,
event type, and signed wheel movement.

The ANSI backend attaches owning elements to its clipped painted lines.
`routeMouse` hit-tests those cells and bubbles `onClick`, `onWheel`,
`onMouseDown`, `onMouseUp`, and `onMouseMove` through `TElement.parentNode`.
Handlers receive `target`, `currentTarget`, `preventDefault`, and
`stopPropagation`; returning `true` also consumes the event. This is a small
bubbling event system rather than a browser event model. A backend without
painted `lines` still supports keyboard input but cannot target pointers.

`Scroll` and `VirtualList` handle unmodified vertical wheel reports over their
painted region. At a known boundary, the report can bubble to an enclosing
scroll region. Virtual-list item trees are detached from the main tree, so their
painted cells target the list element.

The ANSI backend enables terminal modes 1000 and 1006 and restores their saved
values on shutdown. It decodes motion reports if a terminal sends them, but does
not request motion reporting. Coordinates use JavaScript string lengths; wide
glyphs and combining characters can therefore misalign. Pointer capture,
capture-phase listeners, and horizontal scrolling are not implemented.

### Optional scrollbars

Set `scrollbar` on `Scroll` or `VirtualList` to reserve one column for a
three-row thumb on a `│` track. Very short viewports clamp the thumb, and widths
under two columns omit it. `Scrollbar` and `Scrollbar_Snapped` style the bar;
following the end uses the snapped style. The scrollbar does not support
dragging or click-to-jump.

`VirtualList` estimates unmeasured item heights from its bounded measurement
cache. The estimate can change as items are visited, but it does not move the
item-relative viewport anchor or trigger offscreen layout.

### Characterwise VISUAL selection

An application can store `VisualState` and register it with
`useVisualController(get, set)`. `useTextSurface` registers a selectable text
region. `Textarea` registers its draft automatically; `VirtualList` registers
item source only when passed `textOf(item)`.

Alt+V enters source selection or cycles regions. Tab cycles registered regions;
H/J/K/L or arrows extend an inclusive selection; Home/End move to row edges; `[`
and `]` select adjacent items when available; `y` copies and exits; Escape
cancels. Outside this mode, ordinary editing keys keep their normal behavior.

During source selection, the active region displays its source as wrapped plain
text with an inverse selection. Copied text excludes ANSI, borders, and rendered
metadata and preserves explicit newlines without adding soft-wrap newlines.
Selection is limited to one surface or item. Moving through source does not
change a virtual list's normal scroll anchor.

Copying asks the ANSI backend to write OSC52. The terminal may reject or
truncate the request without acknowledgement. iTerm2 clipboard permission and
tmux OSC52 support may need configuration. Applications can provide a custom
backend `copy` method. The test harness records its last requested copy in the
ephemeral `visual.yank` field.

Only one visual controller may be active for a terminal. Mouse selection is not
implemented. Positions use UTF-16 columns instead of grapheme or terminal-cell
widths, and the controller's `get` function must return current state
synchronously.

## Inline images (experimental)

`Image` accepts an `ImageSource` containing a stable `key`, asynchronous
`load(): Promise<Uint8Array>`, fallback `alt` text, and fixed cell height in
`rows`. Set `graphics: 'kitty'` on `run` or `ansiBackend`; set `tmux: true` when
tmux DCS passthrough is required. Graphics default to disabled, with no
capability probe.

An image loads only when its complete reserved rectangle is visible. Clipped or
unvisited images retain a text fallback. The backend caches uploaded bytes,
updates placement after text or size changes, and deletes placements when an
image moves, unmounts, or the backend stops.

Only PNG is supported. Uploads are limited to 4 MiB, declared pixel area to 32
megapixels, height to 1–16 terminal rows, and the cache to eight images or 32
MiB of source bytes. The terminal performs PNG decoding; local signature and
dimension checks are not full validation. A failed load stays failed until that
cache entry is replaced.

Applications must configure compatible terminals. tmux may require
`set -g allow-passthrough on`. iTerm2's OSC 1337 image protocol is not
implemented.

Kitty APC replies are terminal protocol data. `feed` consumes complete,
fragmented, and tmux-wrapped replies before key routing. Known upload errors
change the fallback label. A “Kitty image sent” label only confirms that the
backend wrote protocol commands; it does not confirm display by the terminal.

### Modified Enter

`feed` preserves CSI keyboard sequences across input chunks, including Kitty
`CSI 13;2u` and xterm `CSI 27;2;13~` for Shift+Enter. It also recognizes
Alt+Enter in CSI and legacy Escape-prefixed CR/LF forms. Complete sequences are
returned immediately; incomplete CSI sequences remain buffered without extending
the 25 ms timeout used to distinguish a bare Escape key.

If a terminal sends bare CR or LF for Shift+Enter, the modifier is absent and
cannot be reconstructed. Enable the terminal's extended-key reporting or reset
the terminal session.

### Compact sidebars and controlled shortcuts

A bounded `Frame` panel can set `fit: true` to use its natural content height up
to an equal share of available rows. Other bounded panels receive unused rows,
and overflow still scrolls. Panel order is display order, so a summary placed
last remains below a growing panel.

The `grow-fit="1"` layout attribute provides the same behavior in any column.
`fill="1"` extends inherited styling through the row's available width.

`Textarea` accepts `passKey(key)`. Returning true leaves that key for another
mounted handler, which lets applications reserve shortcuts while retaining the
editor's default bindings.

## Controlled keyboard routing

`useKeymap(handler)` installs a mounted interceptor before widget focus and
source-selection handling. Return true to consume a key. Keep application mode
state outside this package; unmounting the hook restores normal routing.

`useKeys(handler, id)` assigns a stable target. `pressTo(id, key)` sends a key
to that target without changing focus. `pressFocused(key)` continues routing an
already intercepted key without invoking interceptors again. `beginVisual(id)`
starts source selection on a registered surface. Set a controlled `Textarea`'s
`active` prop to false when another mode should hide its cursor.

### Clipboard requests

`copyText(text)` asks the backend installed by `run` to copy text. Its boolean
return reports whether a clipboard writer exists, not whether the terminal
accepted the content. The ANSI backend emits UTF-8 text as base64 OSC52. Callers
must retain any local recovery buffer before clearing editable text.

## Tables

Semantic `table`, `thead`, `tbody`, `tfoot`, `tr`, `th`, and `td` elements use
measured columns. Header cells are bold; `Table_Header` and `Table_Border`
control their styles. Cells preserve text styles, links, and explicit line
breaks and wrap words and long runs. Set `align` to `left`, `center`, or
`right`; the painter also recognizes CSS `text-align` written by shared
renderers.

Tables fill available content width. Initial widths sample at most 32 rows and
128 text positions or nodes per cell, with sampled content widths capped at 40
positions. Later or longer values wrap. Missing cells remain empty. When the
available width cannot contain columns and borders, each row becomes a stacked
record with repeated header labels.

Nested tables use their container's remaining width. A table inside one
virtual-list item is fully laid out when that item is measured; its rows are not
separately virtualized. Row spans, column spans, and CSS table sizing are not
supported. Width uses UTF-16 code units, so CJK characters, combining marks, and
emoji can misalign.

### Code block backgrounds

Semantic `pre` elements fill available width, including blank rows, with the
`Code` theme style. The default background is `#343434`; inline `code` styles
only its text. Borders and indentation reduce available width. Existing wrapping
or clipping behavior still controls long source lines.

### Proportional terminal sidebar

`Frame` uses a 30-column sidebar by default. Set `ratio={0.2}` to request 20% of
terminal columns, rounded down. `width` then acts as a minimum, and the frame
always leaves at least one terminal column for main content. The sidebar remains
hidden below `min`, which defaults to 90 columns.

The ratio and visibility threshold use terminal dimensions, not a nested
container's width. Nested layouts should use row and column attributes or a
fixed `width`.

### Controlled item selection

Pass `selected` and `onSelect(id)` to `VirtualList` for controlled item
selection. Up/Down select adjacent items, Home/End select endpoints,
PageUp/PageDown move about one viewport, and Ctrl+U/D move about half a
viewport. Distances use average measured item heights and do not measure unseen
items. `List_Selected` styles the selection. A changed selection is revealed;
the mouse wheel may then scroll away from it. Without `onSelect`, the same keys
scroll by rendered rows.

### Graceful quit

`run(App, { shutdown, force })` supports two-stage interruption. The first
Ctrl+C or SIGINT calls asynchronous `shutdown` and stops ordinary input routing.
When it finishes, the app exits. A second interrupt calls `force` and exits
without waiting. The application may update its existing view state during
shutdown. Without these callbacks, Ctrl+C exits immediately. Errors still
restore terminal state.

### Partially loaded virtual lists

For paged data, pass `range: { before, after }` and `onRange(request)`. The
flags say whether unloaded neighbors exist. Near a visible boundary, or after a
Home/End request, the list asks the application for overlapping data. The
application fetches it, preserves the controlled viewport anchor, and replaces
`items`.

Set `pending` while replacing a requested page. The list retains its last
painted viewport and scrollbar during that transition; an initially pending list
displays `Loading…`. Pending lists ignore navigation and do not publish
normalized viewport positions. Set `pending={false}` for a completed empty
result so old content is cleared. Changing the list `id` also clears the paint
cache.

The widget does not fetch or store application records. It retains only
identity, selection, viewport, rendered-line caches, and measurements needed for
display.

### Terminal focus and the input caret

The ANSI backend enables terminal focus reporting and restores the saved mode on
shutdown. `terminalFocused` is a signal independent of widget focus. `Textarea`
hides its synthetic block cursor on focus-out and restores it on focus-in
without changing text or cursor position. Focus reports are consumed before
keyboard routing.

If no reports arrive, the terminal is considered focused. tmux may require
`set -g focus-events on`; the application does not change tmux configuration.

### Mouse clicks

Preact `onClick` handlers receive unmodified primary-button clicks through the
same clipped hit testing and bubbling used for wheel events. The press and
release must occur on the same clickable element or its inline child. Right
clicks, modifier-assisted clicks, and drags do not activate it. Unmounting
clears an unfinished press. Source-selection mode suppresses mouse navigation.

Virtualized item contents target the list element, so controls inside an item do
not receive individual clicks. Mouse text selection is not implemented.

`max-height` caps any block without padding shorter content. Optional
`overflow-text` adds a plain-text final row only when content is clipped. The
source data is unchanged.

### Rendered text cursor

`VirtualList` can accept a controlled `cursor`, `onCursor`, and `onYank`.
`RenderedCursor` contains an item `id`, local rendered `row`, UTF-16 `col`, and
an optional selection `anchor`. With these props, arrows move through rendered
lines. Movement measures only visited items and requests neighboring data
through `onRange`. `v` begins a range, `y` copies it, and Escape clears it; the
application chooses any additional aliases and stores cursor state.

Cursor styling decorates cached lines without reparsing item content.
`Seg.decorative` excludes generated borders and padding from copied text, while
`Seg.softBreak` distinguishes wrapping from source line breaks. Copies contain
displayed text rather than Markdown syntax; table copies contain visible cell
text and spacing.

A selection may span overlapping loaded pages while their measured lines remain
cached. Missing or evicted endpoints produce an error instead of truncated text.
Copies are limited to 65,536 UTF-16 code units. Resize and reflow clamp
positions but do not preserve a semantic character offset. Surrogate pairs stay
together; other terminal-width limitations still apply.

### Estimated virtual scroll ranges

A partial `VirtualList` may include `range.total`, the complete logical item
count, and `range.offset`, the logical index of the first loaded item. Supply
both together with `before` and `after`. The scrollbar estimates unknown item
heights from measured averages and retains numeric heights after rendered text
leaves the bounded cache. Drawing it does not measure more items or move the
viewport anchor.

Height metadata grows with visited items and contains numbers rather than item
text. Width or theme changes invalidate it, and a changed item version is
remeasured when revisited. Insertions or removals outside a loaded page can make
remembered estimates temporarily approximate. Without total and offset, the list
uses its neighboring-page estimate. The three-row terminal thumb remains an
approximate row-level indicator.
