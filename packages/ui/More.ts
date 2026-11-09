/**
 * What most people never need, folded under one line that says so: a
 * `details` whose `summary` is that line, pressed to open it, and its
 * `More.Body` what it holds. Whether it starts open is the caller's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Field } from './Field.ts'

/** A fold and what it holds. */
export let More: Part & Record<'Summary' | 'Body', Part> = block(
  'details',
  'More',
  {
    Summary: 'summary',
    Body: 'div',
  },
)

/** What it is, in a line. */
export let description =
  'What most people never need, folded under one line that says so.'

/** What it holds is indented under its line. */
export let sheet = (_c: Colors): Sheet => ({
  More_Body: { indent: 2 },
})

let fold = (open: boolean) =>
  h(
    More,
    { open },
    h(More.Summary, null, 'Advanced options'),
    h(
      More.Body,
      {},
      h('p', null, 'The name its code reads the key by.'),
      h(Field, { value: 'WEATHER_API' }),
    ),
  )

/** Folded, and open. */
export let specimens = (): Specimen[] => [
  ['More', fold(false)],
  ['More, open, Body', fold(true)],
]
