/**
 * What most people never need, folded under one line that says so: a
 * `details` whose `More.Summary` is that line, pressed to open it, and its
 * `More.Body` what it holds. Whether it starts open is the caller's.
 *
 * `More-quiet` is a step in a conversation: a muted line with `›` after it,
 * and what it holds under a rule, at the size it is drawn. `More-on` is one
 * still running and `More-no` one that did not work. A fold in a fold is the
 * same fold.
 *
 * `More.Mark` is a second way to open a fold, drawn outside it: a button,
 * such as a phone mark inside a message's words, which leaves the words
 * ordinary text to select and copy. What it opens is its caller's; it wears
 * the accent while `aria-expanded` says the fold is open.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Native, Specimen } from './theme.ts'
import { Field } from './Field.ts'

/** A fold and what it holds. */
export let More:
  & Part
  & Record<'Summary' | 'Body' | 'Mark' | 'Label' | 'Value', Part> = block(
    'details',
    'More',
    {
      Summary: 'summary',
      Body: 'div',
      Mark: 'button',
      Label: 'p',
      Value: 'span',
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

let step = (mod: string[], open: boolean) =>
  h(
    More,
    { mod, open },
    h(More.Summary, {}, 'Read the file'),
    h(
      More.Body,
      {},
      h(More.Label, {}, 'What came back'),
      h(More.Value, {}, 'The file contents.'),
    ),
  )

/** Folded, open, a step in each tone, and a mark beside an open one. */
export let specimens = (): Specimen[] => [
  ['More', fold(false)],
  ['More, open, Body', fold(true)],
  ['More-quiet', step(['quiet'], true)],
  ['More-quiet More-on', step(['quiet', 'on'], false)],
  ['More-quiet More-no', step(['quiet', 'no'], false)],
  [
    'More, Mark',
    h(
      'div',
      null,
      h(
        'p',
        null,
        h(More.Mark, { type: 'button', 'aria-expanded': 'true' }, '☎'),
        ' Any errors?',
      ),
      step(['quiet'], true),
    ),
  ],
]

/** The same interface on a native host. */
export let native = (_c: Colors): Native => ({
  More_Body: { gap: 6 },
  'More-on': { opacity: 0.8 },
  'More-no': { opacity: 0.9 },
})
