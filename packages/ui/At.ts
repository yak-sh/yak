/**
 * A field with a fixed ending beside it, the way an address ends in its
 * domain: `<At><Field /><At.End>.yaks.app</At.End></At>`. The field runs as
 * wide as the line allows; the ending keeps its own width.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Field } from './Field.ts'

/** A field and its fixed ending. */
export let At: Part & Record<'End', Part> = block('span', 'At', { End: 'span' })

/** What it is, in a line. */
export let description = 'A field with a fixed ending beside it.'

/** The ending describes the field, so it is muted. */
export let sheet = (c: Colors): Sheet => ({
  At_End: { fg: c.muted },
})

/** An address and its domain. */
export let specimens = (): Specimen[] => [
  [
    'At, End',
    h(At, {}, h(Field, { value: 'dana' }), h(At.End, {}, '.yaks.app')),
  ],
]
