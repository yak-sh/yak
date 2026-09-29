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
 * where one of its properties belongs; it names them, so the next line the
 * caller writes is the one that compiles. `by` is as for {@link Unsupported}. */
export let whole = (
  v: Vocab,
  comp: string,
  by = '@yaks/sql',
): Unsupported => {
  let props = v.comp(comp) ? v.props(comp).map((p) => `${comp}.${p}`) : []
  return new Unsupported(
    'a component where a property belongs',
    props.length ? `${comp} — try ${props.join(', ')}` : comp,
    by,
  )
}
