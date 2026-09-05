// The components this package ships, as one vocabulary document to load
// beside your own. Think of a wall of sticky notes:
//
//   canvas                     the wall
//   card{target, view}         one note — a thing shown, in a chosen view
//   pin{canvas, x, y, w, h, z} where that note sits on the wall
//   camera{client, canvas, …}  where one window is looking at one wall
//   client{user_agent, actor}  one open window
//   cursor{client, target}     what one window has open
//   layout{root} / pane{…}     the other arrangement: a split of the screen
//   fold{client, board}        the sections one window has collapsed
//   shelf{client}              what one window is holding, off the wall
//
// A card is an ENTITY, not a private view-model, which is what lets anything
// else read the interface and move it — a second window, a script, an agent.
//
// DEATH. `card.target` is `death: cascade`: a note about a thing that no
// longer exists is not a note, so the card dies with what it shows, and its
// `pin` (which cascades on the canvas) goes with the wall. Nothing sweeps
// orphans because none are left behind.
//
// TIERS. Every component says where its data lives, as @yaks/sync's `persist`
// keyword. The per-window ones — `camera`, `cursor`, `fold`, `shelf`, and the
// `client` they hang off — are the interesting call: they describe ONE
// window, so `local` looks right, and it is wrong. They are `wire` because
// something other than that window has to read and write them: a second tab
// restoring the viewport it left, a directory of who is looking at what, a
// tool that moves somebody's open card by writing their `cursor`. State that
// never leaves the tab can do none of that.
//
// `pane.parent` yields its bare word (`bare: false`): `parent` is far too
// ordinary a word for this component to claim vocabulary-wide, so it is said
// in full — `.pane.parent=<id>`.
//
// No component here declares `before`. A `before` names ANOTHER kind, and
// `kindOrder` refuses one that no loaded document declares — so a package
// that ordered itself against a kind it does not ship could not load on its
// own. A vocabulary that pairs these components with its own content
// component says which of the two wins, in its own document.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// say and keeps the prose about why it is shaped the way it is.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component naming a wall things are arranged on. */
export let CANVAS = 'canvas'

/** The component naming one thing shown on a canvas. */
export let CARD = 'card'

/** The component naming where a card sits. */
export let PIN = 'pin'

/** The component naming where one window is looking. */
export let CAMERA = 'camera'

/** The component naming one open window. */
export let CLIENT = 'client'

/** The component naming what one window has open. */
export let CURSOR = 'cursor'

/** The component naming a split of the screen into panes. */
export let LAYOUT = 'layout'

/** The component naming one region of a layout. */
export let PANE = 'pane'

/** The component naming the sections one window has collapsed. */
export let FOLD = 'fold'

/** The component naming what one window holds off the canvas. */
export let SHELF = 'shelf'

/** The components that describe ONE window rather than the shared space. */
export let PER_CLIENT: string[] = [CLIENT, CAMERA, CURSOR, FOLD, SHELF]

/** A `card` component: one entity shown on a canvas. */
export type Card = {
  /** the entity this card displays — the card dies with it */
  target?: string
  /** the view the card renders that entity in */
  view?: string
}

/** A `pin` component: a card's place on the plane. `x`/`y` are its top-left
 * corner in canvas units; `w`/`h` its size, where `0` means "however big it
 * needs to be"; `z` its place in the stack. */
export type Pin = {
  /** the canvas it is pinned to */
  canvas?: string
  /** left edge, in canvas units */
  x?: number
  /** top edge, in canvas units */
  y?: number
  /** width, or 0 for automatic */
  w?: number
  /** height, or 0 for automatic */
  h?: number
  /** stacking order — higher sits in front */
  z?: number
}

/** A `camera` component: where one window is looking at one canvas. `x`/`y`
 * are the CENTRE of the viewport in canvas units, `zoom` its scale, and
 * `w`/`h` the size of the window in screen pixels. */
export type Camera = {
  /** the window doing the looking */
  client?: string
  /** the canvas it is looking at */
  canvas?: string
  /** viewport centre, in canvas units */
  x: number
  /** viewport centre, in canvas units */
  y: number
  /** scale: 2 means everything is drawn twice as large */
  zoom: number
  /** viewport width, in screen pixels */
  w: number
  /** viewport height, in screen pixels */
  h: number
}

/** A `cursor` component: what one window currently has open. */
export type Cursor = {
  /** the window */
  client?: string
  /** the entity it is showing */
  target?: string
  /** the view it is showing that entity in */
  view?: string
}

/**
 * The canvas vocabulary, to load beside your own:
 * `loadVocab([canvasDoc, ...mine], [idKeywords, nameKeywords, syncKeywords])`.
 *
 * It declares nothing about what a card SHOWS — `card.target` points at any
 * entity in your own vocabulary — only where things sit and who is looking.
 */
export let canvasDoc: VocabDoc = doc
