/**
 * A vocabulary property as a matchable bundle. This is a projection for
 * selection, never a stored entity: editors receive the original bundle and
 * {comp, prop}. The four queryable fields are prop.comp, prop.prop, prop.type
 * and prop.ref. Type uses the vocabulary's own name for the scalar type, with
 * text → string and bool → boolean; ref and enum keep their own categories.
 */

import type { Bundle } from '@yaks/match'
import { loadVocab, type Prop, type Vocab } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import type { Context } from './types.ts'

/** The schema of the property projection, used by the ordinary query matcher. */
export let propVocab: Vocab = loadVocab([doc])

/** Read a declared property; an incomplete or unknown address is an error. */
export let declared = (vocab: Vocab, ctx: Context): Prop => {
  let { comp, prop } = ctx
  if (comp == null || prop == null) {
    throw new Error('property selection needs both comp and prop')
  }
  let schema = vocab.prop(comp, prop)
  if (!schema) throw new Error(`unknown property: ${comp}.${prop}`)
  return schema
}

/** Computed and server-owned values can be shown, never patched by an editor. */
export let writable = (vocab: Vocab, c: Prop): boolean =>
  !!vocab.comp(c.comp)?.wire && !c.stamped && !c.computed

/** Project the declaration, independently of the entity's current value. */
export let projection = (vocab: Vocab, ctx: Context): Bundle => {
  let schema = declared(vocab, ctx)
  let { comp, prop } = schema
  let type: string | undefined = schema.category == 'scalar'
    ? schema.scalar
    : schema.category
  if (type == 'text') type = 'string'
  if (type == 'bool') type = 'boolean'
  return {
    entity: { eid: `${comp}.${prop}` },
    prop: { comp, prop, type, ref: schema.ref },
  }
}
