/** A pending read, distinct from an answer with no rows. @module */
import { h } from 'preact'
import type { Sheet } from '@yaks/tui/theme'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

let Frame = el('div', 'Loading')

/** Announce a pending read without hiding rows already on screen. */
export let Loading: Part = ({ children = 'Loading…', ...props }) =>
  h(Frame, { role: 'status', 'aria-live': 'polite', ...props }, children)

export let description = 'A read is in progress, not empty.'
export let sheet = (c: Colors): Sheet => ({ Loading: { fg: c.muted } })
export let specimens = (): Specimen[] => [
  ['Loading', h(Loading, {})],
  ['Loading more', h(Loading, {}, 'Loading more…')],
]
