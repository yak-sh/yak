---
name: code-style
description: >
  How code in ~/code/tasks is shaped at the scale of a file and a function: the
  owner's JS/TS style (curried `export let` arrows, `let` over `const`, no
  semicolons, `///` doctests, small vocabulary files composed top to bottom,
  factories over classes, effects as data, `when` tables, @yaks/fp), his CSS
  style (one file per `Block_Element-modifier` component, custom properties as
  the variant mechanism) and which of his code to imitate. Use it whenever you
  write a new module, function or stylesheet, refactor or split a file that
  grew long, name something, review a diff for shape, or a request says "clean
  this up", "make it idiomatic", "simplify", "tidy" or "match the style", even
  for a few lines. Which package code belongs in is `packages-and-plugins`;
  where a UI part lives and how it is themed is `ui-building`; tests are
  `testing`; prose in READMEs and doc comments is `writing-documentation`.
---

# Code style

The style here is the owner's own hand, read out of two bodies of his code:
yak-sh's `lib/` (`fp.js`, `core.js`, `runtime.js`) for JS and TS, and
cafe_car's `app/assets/stylesheets/ui/` for CSS. Both were written before
agents touched them, and both prove the same thing: small parts, each a plain
function you can call alone with its example beside it, compose into a whole
that does a lot. `runtime.js` is a complete logic language in about 700 lines.

The memories hold the detail, and they're worth reading whole before a
sizeable change:

- `graph_show` with `M-4454`: the ten rules for JS/TS, from `export let` arrows to
  the 600-line ceiling on a module.
- `graph_show` with `M-4455`: a module's shape, the whole app (platform as the
  framework, no build step, a pure core and a thin shell) and how tests are
  discovered.
- `graph_show` with `M-4456`: CSS as a scaling component system.
- `graph_show` with `M-4458`: the values underneath, what he deliberately leaves
  out, and which strata of his code to imitate.
- `graph_show` with `M-17880`: what that means in this repo (Deno and TypeScript,
  Preact, hand-written CSS, Everforest, the `anchor()` trap).
- `graph_show` with `M-4457`: the Ruby and Rails counterpart, for cafe_car.

## The forces

A file is a vocabulary. It reads top to bottom, each export made of the ones
above it (`export let inc = add(1)`), and complexity comes from composing them,
never from a long phased body. So the names carry the weight: short, lowercase,
evocative, so a call site reads like a sentence (`walk`, `beget`, `tap`,
`when`). A `Manager`, a `createThing`, an options bag where a second function
would do: each is a small wince.

Your pull runs the other way, and it's worth knowing which way. Mimicry gets
the surface tokens right (`let`, no semicolons, a doctest or two) and the
granularity wrong: one long file wearing the right syntax, with an
orchestrator function sequencing phases in the middle. His hand writes many
small files instead. When a module passes a few hundred lines, or a function
passes ten, that's the moment to find the vocabulary hiding in it.

Examples beat prose. A `///` doctest is the spec, the documentation and the
test at once, and it can't drift the way a paragraph does. A prose comment is
for rationale, and especially for what's deliberately absent: the layer you
didn't build and why. An abstraction earns its place by taking code away from
its callers, never by adding a hop between them.

## The tools

- @yaks/fp is the shared vocabulary: `id`, `always`, `tap`, `compose`, `pipe`,
  `when` (dispatch on a computed tag, with `_` as the default), `guard`, `or`,
  `beget` (copy, tweak, return), `mapObj`, and `after` and `each`, which stay
  synchronous over synchronous input and go async only when a promise arrives
  (packages/fp/mod.ts). Reach for these before writing a local helper.
- `deno fmt` holds the surface (no semicolons, single quotes; deno.json), and
  `deno lint` runs with `prefer-const` turned off on purpose: `let` is the
  default here, and `const` is for true module constants.
- Doctests and fenced examples run with the package's tests (`testing`).

When this skill is wrong or missing something, fix it in the same change.
