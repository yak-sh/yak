/**
 * What an `Edit` reads off the vocabulary: pure functions. Whether a property
 * may be written, whether it is a body, the well its suggestions come from, a
 * value as its face says it.
 *
 * @module
 */

import { short } from '@yaks/id'
import type { Vocab } from '@yaks/vocab'

/** Whether a client may write this property: its component is on the wire and
 * the property is neither stamped nor computed. */
export let canEdit = (vocab: Vocab, comp: string, prop: string): boolean => {
  let info = vocab.comp(comp)
  return !!info?.wire && info.writable.includes(prop)
}

// A property's declaration as written, for the keywords only some packages
// read (@yaks/blob's `store`, a `well`).
let raw = (vocab: Vocab, comp: string, prop: string) =>
  (vocab.def(comp)?.properties?.[prop] ?? {}) as {
    store?: string
    well?: string
  }

/** Whether a property is a body: long text kept apart (`store: 'blob'`),
 * typed over on many lines. */
export let isBody = (vocab: Vocab, comp: string, prop: string): boolean =>
  raw(vocab, comp, prop).store == 'blob'

/** The well a property's suggestions come from, or '' for none. */
export let wellOf = (vocab: Vocab, comp: string, prop: string): string =>
  raw(vocab, comp, prop).well ?? ''

/**
 * A value as its face says it, or null for nothing to show: a priority with
 * its P, a flag as true or false, a reference as what it is called, a JSON
 * value as its text.
 */
export let formatProp = (
  vocab: Vocab,
  comp: string,
  prop: string,
  value: unknown,
  name: (eid: string) => string | undefined = () => undefined,
): string | null => {
  if (value == null || value === '') return null
  let p = vocab.prop(comp, prop)
  let type = p?.category == 'scalar' ? p.scalar : p?.category
  if (type == 'priority') return `P${Number(value)}`
  if (type == 'bool') return value ? 'true' : 'false'
  if (type == 'ref') return name(String(value)) ?? short(String(value))
  if (typeof value == 'object') return JSON.stringify(value)
  return String(value)
}
