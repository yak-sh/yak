/**
 * Nothing here yet: what will be, and how to start. `<Empty><h2>No apps
 * yet</h2><p>…</p></Empty>`: its heading says what is missing, and what
 * follows it how to make the first. It is a place for something rather
 * than a thing, so its edge is dashed.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** Nothing here yet. */
export let Empty: Part = el('section', 'Empty')

/** What it is, in a line. */
export let description = 'Nothing here yet: what will be, and how to start.'

/** Muted, a blank line after it. */
export let sheet = (c: Colors): Sheet => ({ Empty: { fg: c.muted, gap: true } })

/** A place for the first app. */
export let specimens = (): Specimen[] => [
  [
    'Empty',
    h(
      Empty,
      {},
      h('h2', null, 'No apps yet'),
      h('p', null, 'Ask your assistant to make one, and it shows here.'),
    ),
  ],
]
