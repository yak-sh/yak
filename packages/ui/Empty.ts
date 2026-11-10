/**
 * Nothing here yet: what will be, and how to start. `<Empty><Empty.Title>No apps
 * yet</Empty.Title><p>…</p></Empty>`: its heading says what is missing, and what
 * follows it how to make the first. It is a place for something rather
 * than a thing, so its edge is dashed.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Native, Specimen } from './theme.ts'

/** Nothing here yet. */
export let Empty: Part & Record<'Title', Part> = block('section', 'Empty', {
  Title: 'h2',
})

/** What it is, in a line. */
export let description = 'Nothing here yet: what will be, and how to start.'

/** Muted, a blank line after it. */
export let sheet = (c: Colors): Sheet => ({
  Empty: { fg: c.muted, gap: true },
})

/** Nothing here yet, on a phone: a dashed outline round what will be. */
export let native = (c: Colors): Native => ({
  Empty: {
    borderColor: c.border2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 16,
    gap: 6,
    color: c.muted,
  },
})

/** A place for the first app. */
export let specimens = (): Specimen[] => [
  [
    'Empty, variants',
    h(
      Empty,
      { mod: 'welcome' },
      h(Empty.Title, { mod: 'welcome' }, 'Welcome'),
      h('p', {}, 'What would you like to do?'),
    ),
  ],
  [
    'Empty',
    h(
      Empty,
      {},
      h(Empty.Title, null, 'No apps yet'),
      h('p', null, 'Ask your assistant to make one, and it shows here.'),
    ),
  ],
]
