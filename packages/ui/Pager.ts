/**
 * Where a page of rows sits among all of them, and the steps to the pages
 * either side: `Pager.Span` says which rows show (`51–100 of 12,403`), each
 * `Pager.Step` goes a page one way, and a step with nowhere to go is
 * `disabled`. What a step does is the caller's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A pager. */
export let Pager: Part & Record<'Span' | 'Step', Part> = block(
  'div',
  'Pager',
  { Span: 'span', Step: 'button' },
)

/** What it is, in a line. */
export let description =
  'Where a page of rows sits among them all, and the steps either side.'

/** The span dim, each step in the link colour. */
export let sheet = (c: Colors): Sheet => ({
  Pager: { fg: c.dim, spaced: true },
  Pager_Step: { fg: c.link },
})

let { Span, Step } = Pager

/** A page between two others, and the first of several. */
export let specimens = (): Specimen[] => [
  [
    'Pager, Span, Step',
    h(
      Pager,
      {},
      h(Span, {}, '51–100 of 12,403'),
      h(Step, { type: 'button' }, '‹ back'),
      h(Step, { type: 'button' }, 'next ›'),
    ),
  ],
  [
    'Pager, Step disabled',
    h(
      Pager,
      {},
      h(Span, {}, '1–50 of 917'),
      h(Step, { type: 'button', disabled: true }, '‹ back'),
      h(Step, { type: 'button' }, 'next ›'),
    ),
  ],
]
