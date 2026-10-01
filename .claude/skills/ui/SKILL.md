---
name: ui
description: >
  How to build interface in this repo, browser and terminal alike: a new @yaks/ui
  part, a theme, a UX component in @yaks/ux (editing, picking, stacking,
  popovers), or a page or view that shows entities (the inspector, web's canvas,
  a package's /views). Use it whenever a change adds or changes something a
  person sees or presses, restyles anything, touches packages/ui, packages/ux,
  packages/inspect or packages/web/components, or when a screen is confusing,
  ugly, slow to read or looks different in the terminal, even if the request
  never says "UI".
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

packages/web already has most of what a new screen needs: editing, pickers,
popouts, lists, menus, entity chips (packages/web/components,
components/views). @yaks/ux's `Edit` came from there. Re-inventing a part that
exists gives two looks and two behaviors for one thing.

Moving a part is a refactor, not a copy. Split it along the three kinds: its
look into a kit, its behavior into @yaks/ux, its data access behind the host's
interface, its meaning in the domain package. Then delete web's copy and move
web onto the moved one in the same change.

## A UI part

A part is two files in packages/ui and one line in `groups` in
packages/ui/kit.ts:

- `Name.ts`: the Preact part, made with `el` or `block` (packages/ui/el.ts),
  with semantic variants through `mod` (`Block_Element-modifier` class names).
  It also exports a one-line `description`, `sheet(colors)` (its terminal
  entries) and `specimens()` (its samples in the style guide). packages/ui/Tabs.ts
  is a small example.
- `Name.css`: its look, reading only theme tokens.

A part shows things and nothing else: no state, no graph, no app imports, no
outer layout (margins, widths), and it never styles a part nested inside it.
That is what lets a part sit anywhere and look the same.

Colors come from **roles**, never hues: `--positive`, `--negative`, `--number`,
`--time`, `--link`, `--accent`, `--heading` and the rest of `Colors` in
packages/ui/theme.ts. A part that says `--green` because it means "done" breaks
under the second theme, which is why Rosé Pine exists beside Everforest.

- A **theme** is custom properties only: a CSS file of `--` names and the same
  colors for the terminal (packages/ui/everforest.css and .ts, rosepine.css and
  .ts; `themes` in kit.ts).
- A **skin** is a whole other rendering of the same parts. None exists yet.
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

## A page or a view of entities

Draw entities through @yaks/render registrations, `{view, match, Render}`,
where the most specific match wins. The package that owns a kind contributes its
view through its `/views` facet, so the inspector or the canvas draws a belief as
a belief without knowing what one is (packages/inspect/views.ts,
packages/render/views.ts, packages/web/components/registry.ts).

Draw for a person reading:

- what the thing says or is, first and in full;
- references by name, never a hash or an id printed twice;
- provenance (who made it, which build, which call) as one quiet line;
- editing only when the reader asks for it.

A generic property table is a fallback, not a page.

State a view needs lives in the page's graph, never in `useState`. A person's
half-typed text is a draft in @yaks/draft, kept and synced everywhere, never
lost (M-59093).

## Check it

- **Style guide:** `/ui?theme=everforest|rosepine&scheme=light|dark` in a
  browser, and `yak ui` in a terminal (`t` switches theme). Look at both themes,
  light and dark, at phone width, and in the terminal.
- **The app itself:** drive it as a person would, in a browser over CDP and in
  tmux, against a probe server (the `probe` skill). Assert on the DOM, since
  screenshots don't work for this app.
- **Tests:** `deno task test packages/ui` (and `packages/ux`, `packages/inspect`)
  run the part tests and the guide's checks.
