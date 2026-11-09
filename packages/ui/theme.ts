/**
 * What a theme is. A theme is two faces of one palette: a stylesheet of CSS
 * custom properties (`--bg`, `--dim`, …) that every component's CSS reads
 * through `var()`, and the same colours as values, which a terminal sheet is
 * built from (kit.ts `stylesheet` and `sheet`).
 *
 * Every colour names a role, never a hue: `--number` is a number wherever
 * one shows, whatever colour a theme gives it. A theme's stylesheet sets
 * these names, its type and its spacing, and nothing else.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import type { ComponentType, VNode } from 'preact'

/** A theme's colours, named as its custom properties are (`hues` are
 * `--hue-0` to `--hue-5`). A terminal paints with one palette; where the
 * stylesheet has a light and a dark scheme, these are the dark. */
export type Colors = {
  /** the floor */
  bg: string
  /** panels and chrome */
  surface: string
  /** a raised body */
  card: string
  border: string
  /** a stronger border */
  border2: string
  /** the foreground */
  text: string
  muted: string
  dim: string
  /** selection and the primary action */
  accent: string
  /** a link, whatever part it is in */
  link: string
  /** a section's title: the text's own ink in both themes, set apart by
   * size and weight, not hue */
  heading: string
  /** the tones a state is said in (a `Dot`'s): something to know, or still
   * open */
  info: string
  /** under way */
  active: string
  /** went well: done, passed, approved */
  positive: string
  /** went wrong, or would destroy something */
  negative: string
  /** needs watching */
  caution: string
  /** set apart from the rest */
  special: string
  /** a number, stored or in code */
  number: string
  /** true, false and null, stored or in code */
  literal: string
  /** a moment */
  time: string
  /** who did it: a person or a session */
  who: string
  /** code: the language's own words */
  keyword: string
  /** code: a string */
  string: string
  /** code: a function's or a class's name */
  fn: string
  /** code: a type, or what the language builds in */
  type: string
  /** code: an attribute or a variable */
  attr: string
  /** six colours that only tell things apart (a `Chip`'s), none of them a
   * role */
  hues: [string, string, string, string, string, string]
}

/** A theme: its custom properties, and their colours. */
export type Theme = {
  /** the stylesheet defining the custom properties */
  css: URL
  colors: Colors
}

/** A native style: a React Native style object's keys and values. */
export type Style = Record<string, string | number>

/** A part's native entries: the style of each class it renders, beside its
 * terminal `sheet`, which a native host draws its views with (@yaks/native). */
export type Native = Record<string, Style>

/** One sample in the style guide: what it shows, and the tree. */
export type Specimen = [label: string, node: VNode]

/** What each part of the kit brings besides its component: a line saying
 * what it is, its terminal entries, its native ones where it has a native
 * look, and its samples. Its CSS address travels with the part, wherever its
 * author keeps it. */
export type Piece = {
  // Kits contain components with different props; consumers import their typed component.
  // deno-lint-ignore no-explicit-any -- heterogeneous component registry
  Component: ComponentType<any>
  css: URL
  description: string
  sheet: (c: Colors) => Sheet
  native?: (c: Colors) => Native
  specimens: () => Specimen[]
}

/** A kit names a set of parts. Skin keys are bare names or kit/name. */
export type Kit = Record<string, Piece>

/** Another rendering of just the parts it changes, keyed by kit/name or a bare
 * name matching every kit. An entry's `css` replaces
 * the part's own, and its `over` (one sheet or several, in order) is laid on
 * top of whichever the part wears, so a skin can add to a part without
 * copying it, and two skins can share what they lay. Missing entries fall back
 * to the kit; a missing terminal sheet or native entry keeps the kit's. */
export type Skin = Record<string, {
  css?: URL
  over?: URL | URL[]
  sheet?: (c: Colors) => Sheet
  native?: (c: Colors) => Native
}>

/** The guide only needs UX specimens, not a dependency on their behaviour. */
export type Behaviours = Record<string, {
  description: string
  components: Record<string, Pick<Piece, 'description' | 'specimens'>>
}>

/** Browser-safe contributions from a plugin's ./ui facet. */
export type Contributions = {
  kits?: Record<string, Kit>
  ux?: Behaviours
  themes?: Record<string, Theme>
  skins?: Record<string, Skin>
}

/** The same value dresses a page and its guide in both renderers. */
export type Composition = {
  kits: Record<string, Kit>
  theme: Theme
  skin?: Skin
  ux?: Behaviours
}
