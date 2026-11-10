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
import type { Colors, Native, Specimen } from './theme.ts'
import { Field } from './Field.ts'

/** A fold and what it holds. */
export let More:
  & Part
  & Record<
    | 'Summary'
    | 'Body'
    | 'Inline'
    | 'Toggle'
    | 'Inset'
    | 'Label'
    | 'Value'
    | 'Framed'
    | 'Legend'
    | 'Text'
    | 'Source'
    | 'Branch'
    | 'Mark'
    | 'Children',
    Part
  > = block(
    'details',
    'More',
    {
      Summary: 'summary',
      Body: 'div',
      Inline: 'details',
      Toggle: 'summary',
      Inset: 'div',
      Label: 'p',
      Value: 'span',
      Framed: 'details',
      Legend: 'summary',
      Text: 'div',
      Source: 'pre',
      Branch: 'details',
      Mark: 'summary',
      Children: 'div',
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
  [
    'More, inline detail',
    h(
      More.Inline,
      { open: true },
      h(More.Toggle, {}, 'Read the file'),
      h(
        More.Inset,
        {},
        h(More.Label, {}, 'What came back'),
        h(More.Value, {}, 'The file contents.'),
      ),
    ),
  ],
  [
    'More, framed source',
    h(
      More.Framed,
      { open: true },
      h(More.Legend, {}, 'Instructions'),
      h(More.Text, {}, 'What the reader was told.'),
      h(More.Source, {}, '{"name":"example"}'),
    ),
  ],
  [
    'More, branch',
    h(
      More.Branch,
      { open: true },
      h(More.Mark, {}, 'Earlier exchange'),
      h(More.Children, {}, 'The earlier messages.'),
    ),
  ],
  ['More', fold(false)],
  ['More, open, Body', fold(true)],
]

/** The same interface on a native host. */
export let native = (c: Colors): Native => ({
  More_Inline: { gap: 6 },
  'More_Inline-on': { opacity: 0.8 },
  'More_Inline-no': { opacity: 0.9 },
  More_Inset: {
    gap: 6,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: c.border,
  },
  More_Framed: { gap: 6 },
  More_Text: { gap: 6 },
  More_Children: { gap: 8, paddingLeft: 10 },
})
