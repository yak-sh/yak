/**
 * A vocabulary column as a matchable bundle. This is a projection for selection,
 * never a stored entity: editors receive the original bundle and {comp, col}.
 * The four queryable fields are column.comp, column.col, column.type and
 * column.ref. Type uses the vocabulary's scalar spelling, with text → string
 * and bool → boolean; ref and enum keep their own categories.
 */

import type { Bundle } from '@yaks/match'
import { type Column, loadVocab, type Vocab } from '@yaks/vocab'
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
export let declared = (vocab: Vocab, ctx: Context): Column => {
  let { comp, col } = ctx
  if (comp == null || col == null) {
    throw new Error('column selection needs both comp and col')
  }
  let schema = vocab.column(comp, col)
  if (!schema) throw new Error(`unknown column: ${comp}.${col}`)
  return schema
}

/** Computed and server-owned values can be shown, never patched by an editor. */
export let writable = (vocab: Vocab, c: Column): boolean =>
  !!vocab.comp(c.comp)?.wire && !c.stamped && c.persist

/** Project the declaration, independently of the entity's current value. */
export let column = (vocab: Vocab, ctx: Context): Bundle => {
  let schema = declared(vocab, ctx)
  let { comp, prop: col } = schema
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
