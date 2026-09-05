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

import type { VocabDoc } from '@yaks/vocab'

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
export let canvasDoc: VocabDoc = {
  title: 'canvas',
  $defs: {
    camera: {
      type: 'object',
      kind: true,
      persist: 'wire',
      description:
        'where one window is looking at one canvas — shared so another tab, or a tool, can read and move it',
      properties: {
        client: {
          type: 'string',
          ref: 'client',
          death: 'cascade',
          description: 'the window doing the looking',
        },
        canvas: {
          type: 'string',
          ref: 'entity',
          death: 'cascade',
          description: 'the canvas it is looking at',
        },
        x: { type: 'number', description: 'viewport centre, in canvas units' },
        y: { type: 'number', description: 'viewport centre, in canvas units' },
        zoom: {
          type: 'number',
          description: 'scale — 2 draws everything twice as large',
        },
        w: { type: 'number', description: 'viewport width, in pixels' },
        h: { type: 'number', description: 'viewport height, in pixels' },
      },
    },
    canvas: {
      type: 'object',
      kind: true,
      by_name: true,
      persist: 'wire',
      description: 'a plane things are arranged on',
    },
    card: {
      type: 'object',
      kind: true,
      persist: 'wire',
      description: 'one entity shown on a canvas',
      properties: {
        target: {
          type: 'string',
          ref: 'entity',
          death: 'cascade',
          description:
            'the entity shown — the card dies with it, because a card about nothing is nothing',
        },
        view: {
          type: 'string',
          description: 'the view it is rendered in',
        },
      },
    },
    client: {
      type: 'object',
      kind: true,
      persist: 'wire',
      description:
        'one open window — what a camera, a cursor, a fold and a shelf each belong to',
      properties: {
        user_agent: {
          type: 'string',
          description: 'what the window said it was',
        },
        actor: {
          type: 'string',
          ref: 'entity',
          death: 'detach',
          description:
            'who is at the window — cleared, not killed, when they are gone',
        },
        ip: {
          type: 'string',
          stamped: true,
          description: 'where it connected from — the server writes this',
        },
      },
    },
    cursor: {
      type: 'object',
      kind: true,
      persist: 'wire',
      description:
        'what one window has open — shared, so a tool can move somebody there by writing it',
      properties: {
        client: {
          type: 'string',
          ref: 'client',
          death: 'cascade',
          description: 'the window',
        },
        target: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          description:
            'the entity it is showing — kept when that dies, so the trail back still reads',
        },
        view: {
          type: 'string',
          description: 'the view it is showing it in',
        },
      },
    },
    fold: {
      type: 'object',
      kind: true,
      persist: 'wire',
      description: 'the sections of a list one window has collapsed',
      properties: {
        client: {
          type: 'string',
          ref: 'client',
          death: 'cascade',
          description: 'the window',
        },
        board: {
          type: 'string',
          ref: 'board',
          death: 'cascade',
          description:
            'the list whose sections are folded — a `board` in your own vocabulary',
        },
        statuses: {
          type: 'string',
          description: 'which sections are collapsed',
        },
      },
    },
    layout: {
      type: 'object',
      kind: true,
      prefix: 'L',
      by_name: true,
      persist: 'wire',
      description: 'a named split of the screen into panes',
      properties: {
        root: {
          type: 'string',
          ref: 'pane',
          death: 'detach',
          description: 'the pane everything else hangs under',
        },
      },
    },
    pane: {
      type: 'object',
      kind: true,
      persist: 'wire',
      description: 'one region of a layout: a split, or something shown',
      properties: {
        layout: {
          type: 'string',
          ref: 'layout',
          death: 'cascade',
          description: 'the layout it belongs to',
        },
        parent: {
          type: 'string',
          ref: 'pane',
          death: 'cascade',
          bare: false,
          description: 'the pane it sits inside',
        },
        size: {
          type: 'number',
          description: 'its share of the parent',
        },
        order: {
          type: 'number',
          description: 'its place among its siblings',
        },
        dir: {
          enum: ['h', 'v'],
          description: 'how it splits: side by side, or stacked',
        },
        content: {
          type: 'string',
          ref: 'entity',
          death: 'detach',
          description: 'the entity shown in it, when it shows one',
        },
        view: {
          type: 'string',
          description: 'the view that entity is shown in',
        },
      },
    },
    pin: {
      type: 'object',
      persist: 'wire',
      description: 'where a card sits on a canvas',
      properties: {
        canvas: {
          type: 'string',
          ref: 'entity',
          death: 'cascade',
          description: 'the canvas it is pinned to',
        },
        x: { type: 'number', description: 'left edge, in canvas units' },
        y: { type: 'number', description: 'top edge, in canvas units' },
        w: { type: 'number', description: 'width, or 0 for automatic' },
        h: { type: 'number', description: 'height, or 0 for automatic' },
        z: { type: 'number', description: 'stacking order — higher is front' },
      },
    },
    shelf: {
      type: 'object',
      persist: 'wire',
      description: 'what one window is holding, off the canvas',
      properties: {
        client: {
          type: 'string',
          ref: 'client',
          death: 'release',
          description:
            'the window holding it — the shelf empties when the window goes, the things on it live on',
        },
      },
    },
  },
}
