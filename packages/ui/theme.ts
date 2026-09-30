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
import type { VNode } from 'preact'

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
  /** a section's title */
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

/** One sample in the style guide: what it shows, and the tree. */
export type Specimen = [label: string, node: VNode]

/** What each part of the kit brings besides its component: a line saying
 * what it is, its terminal entries, and its samples. Its CSS is the file its
 * key in the kit names. */
export type Kit = {
  description: string
  sheet: (c: Colors) => Sheet
  specimens: () => Specimen[]
}
