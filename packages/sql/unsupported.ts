// Refusals: what the binder, and every other evaluator of the same grammar,
// throws for a clause it cannot answer exactly.

import type { Vocab } from '@yaks/vocab'

// Thrown for a clause the binder cannot express exactly. A caller catches it to
// fall back to another evaluator, or to report the gap. `by` names the package
// that declined, so that another evaluator of the same grammar (@yaks/match
// compiles the AST to an in-memory predicate) can refuse through this same
// class, leaving every caller with one error type to catch.
export class Unsupported extends Error {
  feature: string
  by: string
  constructor(feature: string, detail = '', by = '@yaks/sql') {
    super(`${by} cannot compile ${feature}${detail ? `: ${detail}` : ''}`)
    this.feature = feature
    this.by = by
    this.name = 'Unsupported'
  }
}

/** The refusal for a directive naming a whole component (`.order=created`)
 * where one of its properties belongs; it names them, written as the
 * directive takes one, so the next line the caller writes is the one that
 * compiles. An entity's own eid is a property of `entity` like the rest. `by`
 * is as for {@link Unsupported}.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * let v = loadVocab({
 *   $defs: {
 *     doc: { component: true, properties: { title: { type: 'string' } } },
 *   },
 * })
 * whole(v, 'doc').message
 * // '@yaks/sql cannot compile a component where a property belongs: doc — a directive names one property, as .order=doc.title or .fields=doc.title'
 * whole(v, 'entity').message
 * // '@yaks/sql cannot compile a component where a property belongs: entity — a directive names one property, as .order=entity.eid or .fields=entity.eid'
 * ```
 */
export let whole = (
  v: Vocab,
  comp: string,
  by = '@yaks/sql',
): Unsupported => {
  let props = [
    ...comp == 'entity' ? ['eid'] : [],
    ...v.comp(comp) ? v.props(comp).filter((p) => p != 'eid') : [],
  ].map((p) => `${comp}.${p}`)
  let [first, ...rest] = props
  return new Unsupported(
    'a component where a property belongs',
    first
      ? `${comp} — a directive names one property, as .order=${first} or ` +
        `.fields=${first}${
          rest.length ? `; ${comp} also has ${rest.join(', ')}` : ''
        }`
      : comp,
    by,
  )
}
