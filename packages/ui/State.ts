/**
 * How something stands, in a word beside a `Dot`: `<State mod='positive'>
 * Connected</State>`. Its tone is a `Dot`'s (`positive` when it works,
 * `negative` when it needs the person, and the rest), and the dot wears it
 * too, so a terminal colours the pip as a browser does. What the word is,
 * and which tone says it, is the caller's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { Dot, tones } from './Dot.ts'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

let Frame = el('span', 'State')

/** A state in a word, its dot first. */
export let State: Part = ({ mod, children, ...props }) =>
  h(Frame, { mod, ...props }, h(Dot, { mod }), children)

/** What it is, in a line. */
export let description = 'How something stands, in a word beside a dot.'

/** The word describes, so it is muted; the dot carries the tone. */
export let sheet = (c: Colors): Sheet => ({
  State: { fg: c.muted, spaced: true },
})

/** One untoned, then every tone. */
export let specimens = (): Specimen[] => [
  ['State', h(State, {}, 'Free')],
  ...tones.map((t): Specimen => [
    `State-${t}`,
    h(State, { mod: t }, t == 'negative' ? 'Needs you' : 'Connected'),
  ]),
]
