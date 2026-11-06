/**
 * Words to paste somewhere else, `Copy.Text`, with the button that copies
 * them beside it, a `Button` wearing `Copy_Go`:
 * `<Copy><Copy.Text>…</Copy.Text><Button class='Copy_Go'>Copy</Button></Copy>`.
 * The words select whole at a press. What the button does is the caller's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import { Button } from './Button.ts'
import type { Colors, Specimen } from './theme.ts'

/** Words to copy, and the button that copies them. */
export let Copy: Part & Record<'Text', Part> = block('span', 'Copy', {
  Text: 'span',
})

/** What it is, in a line. */
export let description =
  'Words to paste elsewhere, and the button that copies them.'

/** The words, then the button, a space apart. */
export let sheet = (c: Colors): Sheet => ({
  Copy: { spaced: true },
  Copy_Text: { fg: c.text },
})

/** A command to paste, and its button. */
export let specimens = (): Specimen[] => [
  [
    'Copy, Text, Go',
    h(
      Copy,
      {},
      h(
        Copy.Text,
        {},
        'claude mcp add --transport http yaks https://yaks.app/mcp',
      ),
      h(Button, { type: 'button', class: 'Copy_Go' }, 'Copy'),
    ),
  ],
]
