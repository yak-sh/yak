/** Content with a column of short annotations alongside it. @module */
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** Content with a column of short annotations alongside it. */
export let Annotated: Part & Record<'Content' | 'Margin' | 'Number', Part> =
  block('div', 'Annotated', {
    Content: 'div',
    Margin: 'aside',
    Number: 'span',
  })
/** What this part presents. */
export let description =
  'Content with a column of short annotations alongside it.'
/** The same parts in a terminal. */
export let sheet = (c: Colors): Sheet => ({
  Annotated: { row: true, spaced: true },
  Annotated_Content: { grow: true },
  Annotated_Margin: { fg: c.muted },
})
/** A complete example. */
export let specimens = (): Specimen[] => [[
  'Annotated',
  h(
    Annotated,
    {},
    h(Annotated.Content, {}, 'The text being described.'),
    h(Annotated.Margin, {}, h(Annotated.Number, {}, '#12')),
  ),
]]
