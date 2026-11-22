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

/** Refuse a directive that needs a property and names a whole component.
 * Give the qualified properties and the query forms for matching a component
 * or including it in the result. `by` is as for {@link Unsupported}.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * let v = loadVocab({
 *   $defs: {
 *     doc: { component: true, properties: { title: { type: 'string' } } },
 *   },
 * })
 * whole(v, 'doc').message
 * // '@yaks/sql cannot compile a component where a property belongs: doc is a component. Its properties are doc.title. Use .order=doc.title or .fields=doc.title to name a property. Use .doc to match rows with the component or ?doc to include all its fields without filtering.'
 * whole(v, 'entity').message
 * // '@yaks/sql cannot compile a component where a property belongs: entity is a component. Its properties are entity.eid. Use .order=entity.eid or .fields=entity.eid to name a property.'
 * ```
 */
export let whole = (
  v: Vocab,
  comp: string,
  by = '@yaks/sql',
  path = comp,
): Unsupported => {
  let props = [
    ...new Set([
      ...comp == 'entity' ? ['eid'] : [],
      ...v.props(comp),
    ]),
  ].map((p) => `${path}.${p}`)
  let [first] = props
  let properties = first
    ? `Its properties are ${props.join(', ')}. ` +
      `Use .order=${first} or .fields=${first} to name a property.`
    : 'It has no properties.'
  let presence = comp != 'entity' && path == comp
    ? ` Use .${comp} to match rows with the component or ` +
      `?${comp} to include all its fields without filtering.`
    : ''
  return new Unsupported(
    'a component where a property belongs',
    `${comp} is a component. ${properties}${presence}`,
    by,
  )
}
