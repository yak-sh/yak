/**
 * What a theme is. A theme is two faces of one palette: a stylesheet of CSS
 * custom properties (`--bg`, `--dim`, …) that every component's CSS reads
 * through `var()`, and the same colours as values, which a terminal sheet is
 * built from (kit.ts `stylesheet` and `sheet`).
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import type { VNode } from 'preact'

/** A theme's colours, named as its custom properties are. A terminal paints
 * with one palette; where the stylesheet re-points them for a light system,
 * these are the dark values. */
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
  green: string
  red: string
  orange: string
  purple: string
  blue: string
  yellow: string
  /** selection and the primary action */
  accent: string
  /** a link, whatever part it is in */
  link: string
}

/** A theme: its custom properties, and their colours. */
export type Theme = {
  /** the stylesheet defining the custom properties */
  css: URL
  colors: Colors
}

/** One sample in the style guide: what it shows, and the tree. */
export type Specimen = [label: string, node: VNode]

/** What each part of the kit brings besides its component: its terminal
 * entries, and its samples. Its CSS is the file its key in the kit names. */
export type Kit = {
  sheet: (c: Colors) => Sheet
  specimens: () => Specimen[]
}
