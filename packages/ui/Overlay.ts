/**
 * What floats above everything, on a point of the page: a popout editor, a
 * tooltip. It is only a position, fixed to the viewport at the rect of what it
 * springs from, so nothing clipping or scaling can cut it off; what is in it
 * keeps its own box (a `Prop_Pop`, a `Tip`). `Float` (./float.ts) floats
 * one.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Tip } from './Tip.ts'

/** A floating position. */
export let Overlay: Part = el('div', 'Overlay')

/** What it is, in a line. */
export let description =
  'A place floating above the page, for a picker or a tip.'

/** A terminal has nowhere to float: what is in one stays in the flow. */
export let sheet = (_c: Colors): Sheet => ({})

/** One holding a tip, kept in place here. */
export let specimens = (): Specimen[] => [
  ['Overlay', h(Overlay, { style: 'position: static' }, h(Tip, {}, 'floats'))],
]
