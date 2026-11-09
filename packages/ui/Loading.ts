/**
 * A pending read, distinct from an answer with no rows: `<Loading>` says
 * so, and a `Loading.Mark` before its words shows something at work (an
 * animation, a mascot) where the page has one. The words are what a screen
 * reader reads, so the mark is decoration.
 *
 * @module
 */
import { h } from 'preact'
import type { Sheet } from '@yaks/tui/theme'
import { Dot } from './Dot.ts'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

let Frame = el('div', 'Loading')
let Mark = el('span', 'Loading_Mark')
let Image = el('img', 'Loading_Image')

let Say: Part = ({ children = 'Loading…', ...props }) =>
  h(Frame, { role: 'status', 'aria-live': 'polite', ...props }, children)

/** Announce a pending read without hiding rows already on screen. */
export let Loading: Part & { Mark: Part; Image: Part } = Object.assign(Say, {
  Mark,
  Image,
})

export let description = 'A read is in progress, not empty.'
/** A terminal has no animation to show, so the mark takes no room. */
export let sheet = (c: Colors): Sheet => ({
  Loading: { fg: c.muted },
  Loading_Mark: { hidden: true },
})
export let specimens = (): Specimen[] => [
  ['Loading', h(Loading, {})],
  ['Loading more', h(Loading, {}, 'Loading more…')],
  [
    'Loading, Mark',
    h(
      Loading,
      {},
      h(Mark, { 'aria-hidden': true }, h(Dot, { mod: ['pulse', 'active'] })),
      'Checking the files…',
    ),
  ],
]
