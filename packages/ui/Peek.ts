/**
 * A peek: a card floating over the page, showing one thing whole without
 * leaving the page under it. `Peek.Head` is the line it is held and moved by,
 * what it shows on one side and its presses on the other; `Peek.Body` is what
 * it shows, scrolling on its own; `Peek.Grip` is the corner it is sized by.
 * `Peek-sized` is one sized by hand, kept at the size it was given. Where it
 * floats, what opens and closes it, and what it shows are the caller's; a
 * terminal shows its head and body in the flow.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import { Body } from './Body.ts'
import { Id } from './Id.ts'
import { Tabs } from './Tabs.ts'
import type { Colors, Specimen } from './theme.ts'

/** A peek. */
export let Peek: Part & Record<'Head' | 'Body' | 'Grip', Part> = block(
  'div',
  'Peek',
  { Head: 'div', Body: 'div', Grip: 'div' },
)

/** What it is, in a line. */
export let description =
  'A card floating over the page, showing one thing whole without leaving it.'

/** Its head is one quiet line; a terminal has no corner to drag. */
export let sheet = (c: Colors): Sheet => ({
  Peek: { col: true },
  Peek_Head: { row: true, spaced: true, fg: c.muted },
  Peek_Grip: { hidden: true },
})

/** One holding a short document, kept in place here. */
export let specimens = (): Specimen[] => [
  [
    'Peek',
    h(
      Peek,
      { style: 'position: static' },
      h(
        Peek.Head,
        {},
        h(Id, {}, 'M-4492'),
        h(
          Tabs,
          {},
          h(Tabs.Tab, { type: 'button', 'aria-label': 'Open' }, '↗'),
          h(Tabs.Tab, { type: 'button', 'aria-label': 'Close' }, '×'),
        ),
      ),
      h(
        Peek.Body,
        {},
        h('h1', null, 'Persist your thinking'),
        h(
          Body,
          {},
          h(
            'p',
            null,
            'What you know and did lives in the graph, or it is lost.',
          ),
        ),
      ),
      h(Peek.Grip, {}),
    ),
  ],
]
