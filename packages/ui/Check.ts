/**
 * A check box or a radio and the words it answers to, the label around
 * both, so pressing the words presses the box:
 * `<Check><Check.Input type="checkbox" />Send reminders</Check>`. A
 * `Check.Note` among the words says what choosing it means, muted. Which are
 * checked, and what checking one does, are the caller's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { type ComponentChildren, h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Native, Specimen } from './theme.ts'

/** A box or a radio and its words. */
export let Check: Part & Record<'Input' | 'Note', Part> = block(
  'label',
  'Check',
  { Input: 'input', Note: 'span' },
)

/** What it is, in a line. */
export let description = 'A check box or a radio, and its words.'

/** Its box and its words stay apart, as in a browser. */
export let sheet = (c: Colors): Sheet => ({
  Check: { spaced: true },
  Check_Note: { fg: c.muted },
})

/** A check on a phone is a row tall enough to press. */
export let native = (c: Colors): Native => ({
  Check: { fontSize: 17, color: c.text, paddingVertical: 6 },
})

let check = (
  words: ComponentChildren,
  { type = 'checkbox', checked = false, disabled = false, name = '' } = {},
) =>
  h(
    'p',
    {},
    h(
      Check,
      {},
      h(Check.Input, { type, checked, disabled, name: name || undefined }),
      words,
    ),
  )

/** Boxes and radios, checked, not, and not to be pressed. */
export let specimens = (): Specimen[] => [
  [
    'Check, checkbox',
    h(
      'div',
      {},
      check('Show completed apps', { checked: true }),
      check('Send reminders'),
      check(h('span', {}, 'Email reminders', h('br', {}), 'Before each event')),
      check('Unavailable option', { checked: true, disabled: true }),
    ),
  ],
  [
    'Check, radio',
    h(
      'div',
      {},
      check('Only me', { type: 'radio', name: 'check-who', checked: true }),
      check('Everyone', { type: 'radio', name: 'check-who' }),
      check(
        h('span', {}, 'Invited people', h('br', {}), 'Only people you choose'),
        {
          type: 'radio',
          name: 'check-who',
        },
      ),
      check('Team', { type: 'radio', name: 'check-who', disabled: true }),
    ),
  ],
  [
    'Check, Note',
    h(
      'div',
      {},
      check(
        h(
          'span',
          {},
          h('b', {}, 'Text'),
          ' ',
          h(Check.Note, {}, 'to 269-555-0142'),
        ),
        { type: 'radio', name: 'check-by', checked: true },
      ),
      check(
        h(
          'span',
          {},
          h('b', {}, 'Email'),
          ' ',
          h(Check.Note, {}, 'once you give an address'),
        ),
        { type: 'radio', name: 'check-by' },
      ),
    ),
  ],
]
