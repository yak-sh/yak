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
 * A `More` that is not a `details` opens from its `More.Mark` alone, wherever
 * outside its body that mark is drawn: a mark inside a message's words leaves
 * the words ordinary text, to select and copy, and only the mark is pressed.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part, type Props } from './el.ts'
import type { Colors, Native, Specimen } from './theme.ts'
import { Field } from './Field.ts'

// A mark: a label pressed to flip the box beside it, whose state opens the
// fold's body (More.css). `open` starts it open.
let Mark = ({ open, children, ...props }: Props) =>
  h(
    'label',
    props,
    h('input', { type: 'checkbox', class: 'More_Open', checked: !!open }),
    children,
  )

/** A fold and what it holds. */
export let More:
  & Part
  & Record<'Summary' | 'Body' | 'Mark' | 'Label' | 'Value', Part> = block(
    'details',
    'More',
    {
      Summary: 'summary',
      Body: 'div',
      Mark: Mark as Part,
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

/** Folded, open, a step in each tone, and one opened by its mark. */
export let specimens = (): Specimen[] => [
  ['More', fold(false)],
  ['More, open, Body', fold(true)],
  ['More-quiet', step(['quiet'], true)],
  ['More-quiet More-on', step(['quiet', 'on'], false)],
  ['More-quiet More-no', step(['quiet', 'no'], false)],
  [
    'More, Mark',
    h(
      More,
      { as: 'div', mod: 'quiet' },
      h('p', null, h(More.Mark, { open: true }, '☎'), ' Any errors?'),
      h(More.Body, {}, 'What was done with it.'),
    ),
  ],
]

/** The same interface on a native host. */
export let native = (_c: Colors): Native => ({
  More_Body: { gap: 6 },
  'More-on': { opacity: 0.8 },
  'More-no': { opacity: 0.9 },
})
