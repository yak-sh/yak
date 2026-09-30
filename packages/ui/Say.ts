/**
 * One line to send something on: a form holding what is typed (a `Field`,
 * and a choice before it if one is needed) and the button that sends it.
 * The field runs as wide as the line allows. What sending does is the
 * caller's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Button } from './Button.ts'
import { Field } from './Field.ts'

/** A line to send something on. */
export let Say: Part = el('form', 'Say')

/** Its parts stay apart, as in a browser. */
export let sheet = (_c: Colors): Sheet => ({
  Say: { spaced: true },
})

/** A field and its button, and one with a choice before it. */
export let specimens = (): Specimen[] => [
  [
    'Say',
    h(
      Say,
      {},
      h(Field, { value: '', placeholder: 'a note…' }),
      h(Button, { type: 'submit' }, 'note'),
    ),
  ],
  [
    'Say, with a choice',
    h(
      Say,
      {},
      h(
        'select',
        { class: 'Edit Edit-fit' },
        h('option', { value: 'requires' }, 'requires'),
      ),
      h(Field, { value: '', placeholder: 'to (an id: T-12)' }),
      h(Button, { type: 'submit', mod: 'add' }, '+ edge'),
    ),
  ],
]
