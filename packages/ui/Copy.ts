/**
 * Words to paste somewhere else (an address, a command, a key), in the mono
 * face, and the button that copies them beside it:
 * `<Copy what='the link'>https://yaks.app/agent</Copy>`. The button is a
 * `Button` wearing `Copy_Go`, drawn as Lucide's copy glyph, and its label is
 * `Copy` and `what`. `Copy-copied` draws a check in its place, for the moment
 * after a copy. The words select whole at a press. What the button does is
 * the caller's; `go` is anything more it takes (`hidden`, a handler).
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { type FunctionComponent, h } from 'preact'
// @ts-types="./lucide.d.ts"
import copy from 'lucide/dist/esm/icons/copy.mjs'
// @ts-types="./lucide.d.ts"
import check from 'lucide/dist/esm/icons/check.mjs'
import { block, type Props } from './el.ts'
import { Button } from './Button.ts'
import { Icon } from './Icon.ts'
import type { Colors, Specimen } from './theme.ts'

let Box = block('span', 'Copy', { Text: 'span', Go: Button })

/** What a copyable takes: its words as children, what they are, and the
 * button's own props. */
export type CopyProps = Props & { what?: string; go?: Props }

/** Words to copy, and the button that copies them. */
export let Copy: FunctionComponent<CopyProps> = (
  { what, go, children, ...props },
) =>
  h(
    Box,
    props,
    h(Box.Text, null, children),
    h(
      Box.Go,
      {
        type: 'button',
        'aria-label': what ? `Copy ${what}` : 'Copy',
        title: 'Copy',
        ...go,
      },
      h(Icon, { of: copy, class: 'Copy_Icon' }),
      h(Icon, { of: check, class: 'Copy_Icon Copy_Icon-done' }),
    ),
  )

/** What it is, in a line. */
export let description =
  'Words to paste elsewhere, in the mono face, and the button that copies them.'

/** The words; a terminal has no button to click, so it shows only them. */
export let sheet = (c: Colors): Sheet => ({
  Copy: { spaced: true },
  Copy_Text: { fg: c.text },
  Copy_Go: { hidden: true },
})

/** A command to paste, and the moment after it is copied. */
export let specimens = (): Specimen[] => [
  [
    'Copy',
    h(
      Copy,
      { what: 'the command' },
      'claude mcp add --transport http yaks https://yaks.app/mcp',
    ),
  ],
  [
    'Copy-copied',
    h(Copy, { mod: 'copied', what: 'the link' }, 'https://yaks.app/agent'),
  ],
]
