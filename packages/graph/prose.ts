// Which text a write stores as prose (@yaks/vocab `prose`, Graph.prose): a
// property declaring it, on an entity it is prose for. A property listing
// components is prose only on an entity carrying one of them, so a topic's
// contents hold eids while a transcript's entries keep what was said.

import type { Vocab } from '@yaks/vocab'
import type { Bundle } from './bundle.ts'

/** The components an entity must carry for `comp.prop` to be prose: none
 * (`[]`) when it is prose on every entity, undefined when it is not prose. */
export let proseOn = (
  vocab: Vocab,
  comp: string,
  prop: string,
): string[] | undefined => {
  let on = vocab.prop(comp, prop)?.prose
  return Array.isArray(on) ? on : on ? [] : undefined
}

/** Whether `comp.prop` is prose on this entity, as far as `b` shows it. */
export let isProse = (
  vocab: Vocab,
  comp: string,
  prop: string,
  b: Bundle | undefined,
): boolean => {
  let on = proseOn(vocab, comp, prop)
  return !!on && (!on.length || on.some((c) => b?.[c] != null))
}
