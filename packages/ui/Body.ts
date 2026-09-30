/**
 * The text of a thing, to be read: its paragraphs (rendered markdown, or plain
 * lines) at a reading measure, in the ink. `Body-short` is one that is only a
 * line or two, set a little smaller, as the gist of a longer one.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A body of text. */
export let Body: Part = el('div', 'Body')

/** What it is, in a line. */
export let description = 'The text of a thing, to be read, at its measure.'

/** It folds to the width, and a blank line follows it. */
export let sheet = (c: Colors): Sheet => ({
  Body: { fg: c.text, wrap: true, gap: true },
  'Body-short': { fg: c.muted },
})

/** A body of two paragraphs and a quote, and a short one. */
export let specimens = (): Specimen[] => [
  [
    'Body',
    h(
      Body,
      {},
      h(
        'p',
        null,
        'Tests never share a lock. A run that waits on another run is two ' +
          'runs pretending to be one.',
      ),
      h('blockquote', null, h('p', null, 'runs never share a lock')),
    ),
  ],
  ['Body-short', h(Body, { mod: 'short' }, 'what a test checks')],
]
