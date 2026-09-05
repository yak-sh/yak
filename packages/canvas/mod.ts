/**
 * @yaks/canvas — the spatial-UI component domain for a yaks graph.
 *
 * A yaks UI is itself data: the cards on screen, where they sit, and where each
 * viewer is looking are all entities wearing components. This plugin
 * contributes that vocabulary — a `card` (an entity placed on the canvas), a
 * `pin` (its position and size), and a `camera` (a viewer's pan and zoom) — so
 * a layout is stored, shared, queried, and undone exactly like the content it
 * frames.
 *
 * Keeping the interface in the graph is what lets a tool read and move it: a
 * card is a real entity, not a private view-model. The package owns these
 * components; rendering them is a client's job. It plugs into
 * {@link https://jsr.io/@yaks/graph | @yaks/graph} like any other domain.
 *
 * @module
 */

import type { Eid, Plugin } from '@yaks/graph'

/** A `card` component: an entity shown on the canvas. */
export type Card = {
  /** the entity this card displays */
  shows: Eid
  /** the view the card renders the entity in */
  view?: string
}

/** A `pin` component: a card's place on the plane. */
export type Pin = {
  /** horizontal position */
  x: number
  /** vertical position */
  y: number
  /** width in canvas units */
  w?: number
  /** height in canvas units */
  h?: number
}

/** A `camera` component: where one viewer is looking. */
export type Camera = {
  /** horizontal pan */
  x: number
  /** vertical pan */
  y: number
  /** zoom factor */
  zoom: number
}

/** The plugin that contributes `card`, `pin`, and `camera` to a graph. */
export type plugin = () => Plugin
