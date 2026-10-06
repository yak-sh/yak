---
name: ui-building
description: >
  How to build interface here, browser and terminal: @yaks/ui parts, themes,
  @yaks/ux components (editing, picking, stacking, popovers), entity pages and
  views (inspector, web canvas, TUI, style guides, /views), and drawing any
  entity anywhere through the shared renderers. Use it whenever a change adds
  or changes what a person sees or presses, shows entities in a row, list,
  inbox, panel or detail, restyles anything, touches packages/ui, packages/ux,
  packages/tui, packages/inspect, packages/visualize or packages/browse, or a
  screen is confusing, ugly, slow to read or different in the terminal, even
  if the request never says "UI". Reading platform anatomy or causal activity
  is `platform-visualize`; building that screen takes this skill too. A yaks
  app's pages are its author's; platform pages from workers/yak also take
  `yaks-app`. Proving a screen is `end-to-end-checks`; wiring /views is
  `packages-and-plugins`.
---

# Building UI

Everything a person sees here is drawn twice: once in a browser, once in a
terminal, from the same Preact tree. That only works because interface is
three kinds of component, each owning one thing (M-39550, D-58967):

- **UI components** are how it looks: display-only parts in a kit. @yaks/ui
  holds the base kit.
- **UX components** are how it behaves: stateless, controlled by bundles, in
  @yaks/ux.
- **Domain components** are what it means: they own the data names, ask for
  their rows as queries, and send edits as patches. They live in the package
  that owns the data.

Kept apart, one tree paints in both places, a theme or a skin changes the look
without touching behavior, and the style guide can show every part on its own.
Let them blur and each screen grows its own look and its own behavior, and the
terminal quietly falls behind. Most of what follows is that one idea, met
again at each layer.

The words a domain component owns are `vocabulary`'s, and where a kit or a
`/views` facet is wired is `packages-and-plugins`. Proving a screen in a
browser and a terminal is `end-to-end-checks`; its tests are `testing`.

## Feel

We want screens that feel instant and light, the way a great native app does.
Build with the instincts of a frontend engineer who cares how it feels in the
hand: curious about what renders and why, quick to reach for the profiler
rather than a guess, happy when an update touches only what it must.
@preact/signals is there when a value moves fast.

## The kit is the shelf

Start by looking at what's built. `yak ui` in a terminal, or `/ui` in a
browser, shows every part in every variant; packages/ui/kit.ts lists them by
group (Prose, Marks, Controls, Navigation, Lists, Page). A text box is `Field`,
a box and its send button on one line is `Say`, a set of choices is `Choices`.
When a screen needs a part the kit lacks, the part goes into a kit, where
every screen and both hosts get it, rather than into markup styled where it's
used.

The pull the other way comes from packages/browse. The browsing app has parts
from before the kits: `block` parts in its components, styled in
packages/browse/styles.css (`Search`, `Filter`, `Peek`, `Tray` and more). One
of them sits beside the screen you're changing, already imported, and reusing
it feels like looking first. But it isn't a kit part, and two copies of one
part give two looks and two behaviors for one thing. Where the kit has the
part, the kit's wins and browse's goes; where it doesn't, port it. A port is a
refactor, not a copy:
its look into a kit, its behavior into @yaks/ux, its data access behind the
host's interface, its meaning into the domain package, and browse moves onto
it in the same change. packages/kernel/Comments.tsx is one that made the trip:
its composer is a kit `Say` holding a `Field`, its words are @yaks/draft
drafts, and it lives with the comments it draws.

## A UI part

A part lives in its author's kit as two files and a `Piece`
`{Component, css, sheet, description, specimens}` (packages/ui/theme.ts):

- `Name.ts`: the Preact part, made with `el` or `block` (packages/ui/el.ts),
  with semantic variants through `mod` (`Block_Element-modifier` class names).
  It also exports a one-line `description`, `sheet(colors)` (its terminal
  entries) and `specimens()` (its samples in the style guide).
  packages/ui/Tabs.ts is a small one to read first.
- `Name.css`: its look, reading only theme tokens.

A part is paint. It holds no state, reads no graph, imports no app, sets no
outer layout (margins, widths), and leaves the parts nested in it to style
themselves. That's what lets it sit anywhere and look the same. A part made of
other parts holds them, the way `Say` holds a `Field` and a `Button`: an
`input` a part styles itself is a second text box beside `Field`, with its own
look in both hosts.

Colors are **roles**, not hues: `--positive`, `--negative`, `--number`,
`--time`, `--link`, `--accent`, `--heading` and the rest of `Colors` in
packages/ui/theme.ts. A part that says `--green` because it means "done" breaks
under the second theme. That's why Rosé Pine sits beside Everforest: its
palette has no green and two pinks, so a hue posing as a role shows at once.

- A **theme** is custom properties only: a CSS file of `--` names and the same
  colors for the terminal (packages/ui/everforest.css and .ts, rosepine.css and
  .ts; `themes` in kit.ts).
- A **skin** replaces the CSS and optional terminal entries of the parts it
  names; the rest fall back to their kit. packages/ui/ledger.ts is one,
  deliberately partial so the guide shows both.
- A **kit** is a set of parts. A plugin contributes kits, themes, skins and UX
  specimens through its `./ui` facet (`Contributions` in theme.ts).

A consumer imports the parts and never learns which theme or skin paints them.

The terminal draws the same tree through each part's `sheet`, keyed by its
class names (@yaks/tui; packages/tui/theme.ts). Layout the terminal needs
(grid, ellipsis, alignment, wrapping) belongs in the sheet, so the browser's
elements stay free of terminal-only attributes.

## A UX component

packages/ux/README.md has the model, with `Edit` and `Stack` as working
examples. The shape of it:

- It's controlled by a bundle and emits a bundle of the same shape, like
  `<input value onChange>`. Keys and clicks are how it reaches its output, not
  its interface.
- When it has something to say that isn't a new value, it emits an event
  bundle: a component with `durable: "0s"`, like `Refused`.
- Its own state is one CamelCase component named after it (`Edit{…}`,
  `Stack{panes}`), declared in packages/ux/vocab.json. It's page-only, and it
  sits on an eid derived from its owner and the value it changes, so a remount
  finds it again. CamelCase is reserved for this (packages/vocab/README.md).
- It declares no rules; front-end rules belong to domain packages.

What a browser and a terminal do differently (a popover, focus, keys) is a
platform primitive with one interface: the browser's in @yaks/ui
(packages/ui/float.ts is the popover), the terminal's in @yaks/tui.

## Drawing an entity, anywhere

Every entity on screen is drawn by a shared renderer: a row in a list, a thread
in the inbox, a chip in prose, a cell, a panel, a page, an expanded detail
(M-39550). The screen asks the registry for a view by name, and the most
specific renderer for that entity draws it: `Inbox.List.Tile` tries
`Inbox.List.Tile`, then `List.Tile`, then `Tile`. Renderers are @yaks/render
registrations, `{view, match, Render}`, and the package that owns a kind
contributes them through its `/views` facet, so any screen draws a belief as a
belief without knowing what one is (packages/inspect/views.ts,
packages/render/views.ts, packages/browse/components/registry.ts).

A screen adds only what's its own around that renderer: the inbox's lane,
reason, unread dot and archive button, a board's drag handle.

The nearest thing at hand is always `e.doc?.title` in a span. It looks right
for every kind that carries a `doc` and draws everything else as an empty row.
A kit part that lays out an entity's title, body and status is the same move
one layer down. When a renderer draws a kind poorly, fix the renderer, and
every screen gets the fix.

Draw for a person reading:

- what the thing says or is, first and in full;
- references by name, not a hash, and no id printed twice;
- provenance (who made it, which build, which call) as one quiet line;
- editing when the reader asks for it.

A generic property table is a fallback, not a page.

What a view remembers (what's expanded, which pane is open) is data like
anything else, so it lives in the page's graph, where a remount finds it again
and the rest of the page can ask for it; `useState` keeps it where nothing else
can see it. A person's half-typed text is a draft in @yaks/draft, kept and
synced everywhere, so it's never lost (M-59093).

## Looking at it

A screen is done when it reads well to someone using it, so look the way they
will:

- **The style guide:** `/ui?theme=everforest|rosepine&scheme=light|dark` (add
  `&skin=ledger`) in a browser, and `yak ui` in a terminal (`t` cycles the
  theme, `s` the skin, `j`/`k` walk). Both themes, light and dark, phone width
  and the terminal: each one catches what the others hide.
- **The app itself:** drive it as a person would, in a browser over CDP and in
  tmux, against a probe server (`end-to-end-checks`). Its `dom.ts` reads the
  DOM, which is where behavior is checked, and with `--width 390 --shot` gives
  you a picture at phone width to look at.
- **Tests:** `deno task test packages/ui` (and `packages/ux`,
  `packages/inspect`) runs the part tests and the guide's checks.
- **The task:** review of a screen arrives as comments on its task, often
  while you work. Read them again before you land a slice; what the owner saw
  is the measure.

When this skill is wrong or missing something, fix it in the same change.
