/**
 * A vocabulary column as a matchable bundle. This is a projection for selection,
 * never a stored entity: editors receive the original bundle and {comp, col}.
 * The four queryable fields are column.comp, column.col, column.type and
 * column.ref. Type uses the vocabulary's scalar spelling, with text → string
 * and bool → boolean; ref and enum keep their own categories.
 */

import type { Bundle } from '@yaks/match'
import { loadVocab, type Vocab } from '@yaks/vocab'
import type { Context } from './types.ts'

/** The schema of the column projection, used by the ordinary query matcher. */
export let columnVocab: Vocab = loadVocab([{
  $defs: {
    column: {
      type: 'object',
      properties: Object.fromEntries(
        ['comp', 'col', 'type', 'ref'].map((
          name,
        ) => [name, { type: 'string' }]),
      ),
    },
  },
}])

/** Read a declared column; an incomplete or unknown address is an error. */
export let column = (vocab: Vocab, ctx: Context): Bundle => {
  let { comp, col } = ctx
  if (comp == null || col == null) {
    throw new Error('column selection needs both comp and col')
  }
  let schema = vocab.column(comp, col)
  if (!schema) throw new Error(`unknown column: ${comp}.${col}`)
  let type: string | undefined = schema.category == 'scalar'
    ? schema.scalar
    : schema.category
  if (type == 'text') type = 'string'
  if (type == 'bool') type = 'boolean'
  return {
    entity: { eid: `${comp}.${col}` },
    column: { comp, col, type, ref: schema.ref },
  }
}
