---
name: ui-building
description: >
  How to build interface here, browser and terminal: @yaks/ui parts, themes,
  @yaks/ux components (editing, picking, stacking, popovers), entity pages and
  views (inspector, web canvas, TUI, style guides, /views), and drawing any
  entity anywhere through the shared renderers. Use it whenever a change adds
  or changes what a person sees or presses, shows entities in a row, list,
  inbox, panel or detail, restyles anything,
  touches packages/ui, packages/ux, packages/tui, packages/inspect,
  packages/visualize or packages/web/components, or a screen is confusing,
  ugly, slow to read, slow to draw, re-renders too much, drops frames or
  differs in the terminal, even if the request never says "UI". Reading platform anatomy or causal activity is
  `platform-visualize`; building that screen takes this skill too. A yaks app's
  pages are its author's; platform pages from workers/yak also take `yaks-app`.
  Proving a screen is `end-to-end-checks`; wiring /views is
  `packages-and-plugins`.
---

# Building UI

Interface here is three kinds of component, each owning one thing (M-39550,
D-58967):

- **UI components** are how it looks: display-only parts in a kit. @yaks/ui
  holds the base kit.
- **UX components** are how it behaves: stateless, controlled by bundles, in
  @yaks/ux.
- **Domain components** are what it means: they own the data names, ask for
  their rows as queries, and send edits as patches. They live in the package
  that owns the data.

Keeping the three apart is what lets one tree paint in a browser and in a
terminal, lets a theme or a skin change the look without touching behavior, and
lets the style guide show every part on its own.

## First, look for it

Look in the kit first. `yak ui` in a terminal, or `/ui` in a browser, shows
every part in every variant, and packages/ui/kit.ts lists them by group (Prose,
Marks, Controls, Navigation, Lists, Page). A text box is `Field`, a box and its
send button on one line is `Say`, a set of choices is `Choices`. A screen that
needs one of those uses it, and a screen that needs a part the kit lacks adds
the part to a kit, never markup styled where it is used. An entity is never
drawn by a part: its renderer draws it (below).

packages/web still has parts from before the kits: `block` parts defined in its
components and styled in packages/web/styles.css, such as `Comments` (its
composer is `Comments_New`), `Search` and `Filter`. The pull is to reuse one,
since it sits beside the screen being changed, is already imported, and
reusing it feels like looking first. It is not a kit part. Where the kit has
the same part, use the kit's and delete web's; where it does not, port it
first. Moving a part is a refactor, not a copy: split it along the three kinds
(its look into a kit, its behavior into @yaks/ux, its data access behind the
host's interface, its meaning in the domain package), then delete web's copy
and move web onto the moved one in the same change. Two copies of one part
give two looks and two behaviors for one thing.

## A UI part

A part lives in its author’s UI kit: two files and a `Piece` entry
`{Component, css: URL, sheet, description, specimens}` in a `Kit` record.
The base kit uses `groups` in packages/ui/kit.ts:

- `Name.ts`: the Preact part, made with `el` or `block` (packages/ui/el.ts),
  with semantic variants through `mod` (`Block_Element-modifier` class names).
  It also exports a one-line `description`, `sheet(colors)` (its terminal
  entries) and `specimens()` (its samples in the style guide). packages/ui/Tabs.ts
  is a small example.
- `Name.css`: its look, reading only theme tokens.

A part shows things and nothing else: no state, no graph, no app imports, no
outer layout (margins, widths), and it never styles a part nested inside it.
That is what lets a part sit anywhere and look the same.
A part made of other parts holds them, the way `Say` holds a `Field` and a
`Button`: an `input` or `textarea` a part styles itself is a second text box
beside `Field`, with its own look in both the browser and the terminal.

Colors come from **roles**, never hues: `--positive`, `--negative`, `--number`,
`--time`, `--link`, `--accent`, `--heading` and the rest of `Colors` in
packages/ui/theme.ts. A part that says `--green` because it means "done" breaks
under the second theme, which is why Rosé Pine exists beside Everforest.

- A **theme** is custom properties only: a CSS file of `--` names and the same
  colors for the terminal (packages/ui/everforest.css and .ts, rosepine.css and
  .ts; `themes` in kit.ts).
- A **skin** replaces the CSS and optional terminal entries of the parts it names.
  Unnamed parts fall back to their kit. A page and its guide share a composition.
- A **kit** is a set of parts. A plugin may add a kit of its own.

A consumer imports the parts and never knows which theme or skin paints them.

The terminal draws the same tree through the part's `sheet`, keyed by its class
names (@yaks/tui; packages/tui/theme.ts). Layout the terminal needs (grid,
ellipsis, alignment, wrapping) belongs in the sheet, not as terminal-only
attributes on the browser's elements.

## A UX component

packages/ux/README.md has the model and `Edit` and `Stack` as working examples.
In short:

- It is controlled by a bundle and emits a bundle of the same shape, like
  `<input value onChange>`. Keys and clicks are how it reaches its output,
  never its interface.
- When it has something to say that isn't a new value, it emits an event bundle,
  the exception: an event is a component with `durable: "0s"`, like `Refused`.
- Its own state is one CamelCase component named after it (`Edit{…}`,
  `Stack{panes}`), declared in packages/ux/vocab.json. It is page-only, and it
  sits on an eid derived from its owner and the value it changes, so a remount
  finds it again. CamelCase is reserved for this (packages/vocab/README.md).
- It declares no rules. Front-end rules belong to domain packages.

What a browser and a terminal do differently (a popover, focus, keys) is a
platform primitive with one interface: the browser's in @yaks/ui
(packages/ui/float.ts is the popover), the terminal's in @yaks/tui.

## Drawing an entity, anywhere

Every entity on screen is drawn by a shared renderer: a row in a list, a thread
in the inbox, a chip in prose, a cell, a panel, a page, an expanded detail
(M-39550). The screen asks the registry for the view it needs by name, and the
most specific renderer for that entity draws it: `Inbox.List.Tile` tries
`Inbox.List.Tile`, then `List.Tile`, then `Tile`. Renderers are @yaks/render
registrations, `{view, match, Render}`. The package that owns a kind contributes
its renderers through its `/views` facet, so any screen draws a belief as a
belief without knowing what one is (packages/inspect/views.ts,
packages/render/views.ts, packages/web/components/registry.ts).

A screen adds only what is its own around that renderer: the inbox's lane,
reason, unread dot and archive button, a board's drag handle. It never reads an
entity's components to draw the entity with markup of its own.

The pull the other way is strong: the nearest thing at hand is `e.doc?.title`
in a span, which looks right for kinds that carry a `doc` and draws everything
else as an empty row. A UI kit part that lays out an entity's title, body and
status is the same mistake one layer down. When a renderer draws a kind poorly,
fix that renderer, and every screen gets the fix.

Draw for a person reading:

- what the thing says or is, first and in full;
- references by name, never a hash or an id printed twice;
- provenance (who made it, which build, which call) as one quiet line;
- editing only when the reader asks for it.

A generic property table is a fallback, not a page.

State a view needs lives in the page's graph, never in `useState`. A person's
half-typed text is a draft in @yaks/draft, kept and synced everywhere, never
lost (M-59093).

## Render cost

Some screens repaint every frame: Mossvale's HUD is painted from the game loop
(apps/vale/hud.ts `show`). There, a part that re-renders when nothing it shows
has changed is a bug. @yaks/ui already depends on @preact/signals, and a test
can count renders per update through Preact's `options.diffed`.

## Check it

- Re-read the task’s comments before landing a screen slice, and address review
  feedback before reporting completion.

- **Style guide:** `/ui?theme=everforest|rosepine&scheme=light|dark` in a
  browser, and `yak ui` in a terminal (`t` switches theme). Look at both themes,
  light and dark, at phone width, and in the terminal.
- **The app itself:** drive it as a person would, in a browser over CDP and in
  tmux, against a probe server (the `end-to-end-checks` skill). Assert on the
  DOM, since screenshots don't work for this app.
- **Tests:** `deno task test packages/ui` (and `packages/ux`, `packages/inspect`)
  run the part tests and the guide's checks.

When this skill is wrong or missing something, fix it in the same change.
