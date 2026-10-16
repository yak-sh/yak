/** A searchable overlay: paint only; its caller owns the query and choices. */
import { h } from 'preact'
import { block } from './el.ts'
import { Field } from './Field.ts'
import { Value } from './Value.ts'
import type { Colors, Specimen } from './theme.ts'
import type { Sheet } from '@yaks/tui/theme'

/** A veil, query line, grouped choices and their feedback. */
export let Palette = block('div', 'Palette', {
  Box: 'div',
  Line: 'div',
  Page: 'a',
  Head: 'div',
  Hit: 'div',
  Message: 'div',
})
export let description = 'A query and its choices above the current page.'
export let sheet = (c: Colors): Sheet => ({
  Palette_Box: { col: true },
  Palette_Line: { row: true },
  Palette_Head: { fg: c.muted },
  'Palette_Hit-sel': { inverse: true },
  Palette_Message: { fg: c.muted },
})
export let specimens = (): Specimen[] => [
  [
    'Palette',
    h(
      Palette.Box,
      {},
      h(Palette.Line, {}, h(Field, { placeholder: 'Search…' })),
      h(Palette.Head, {}, 'Projects'),
      h(Palette.Hit, { mod: 'sel' }, h(Value, {}, 'A selected result')),
      h(Palette.Message, {}, 'Type to search'),
    ),
  ],
]
