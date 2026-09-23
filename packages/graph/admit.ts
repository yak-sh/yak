// Admission: what a change is allowed to contain. Three rules, and each is a
// deliberate choice about which mistakes are loud and which are silent.
//
//   an undeclared component is dropped  forward compatibility: a newer client
//                                       may send a component this graph has
//                                       never heard of, and the rest of its
//                                       change must still be applied
//   an undeclared column is refused     on a component the vocabulary does
//                                       declare, an unrecognized column is a
//                                       typo, and silently dropping a title is
//                                       worse than refusing the change
//   a server-owned column is dropped    `stamped` columns are readable but
//                                       never writable by a client; a caller
//                                       that sends one is ignored rather than
//                                       refused (reading a whole bundle back
//                                       and sending it again is a normal thing
//                                       to do)
//
// A string column's value is cast to a string first (@yaks/vocab `cast`): the
// schema is what a reader gets back, so a number sent to a text column is
// stored, returned and broadcast as its text.
//
// Column values are validated against the vocabulary too — an enum member, a
// number where a number belongs, a scalar rather than a nested object. That is
// the vocabulary's own `check`, not a JSON Schema validator: this package
// depends on no validator, and a graph that wants full JSON Schema validation
// registers one as an `admit` hook.

import { cast, type Vocab } from '@yaks/vocab'
import type { Bundle, Comp } from './bundle.ts'
import { comps, dead, RESERVED } from './bundle.ts'

/** A change refused at admission: the message names the component and the
 * column, so the caller can see exactly what was wrong. */
export class Refused extends Error {
  /** @param message what was wrong, naming the component and column the caller
   * sent */
  constructor(message: string) {
    super(message)
    this.name = 'Refused'
  }
}

// The columns a caller may write on a component: the client-writable ones,
// plus the server-owned ones when the caller is trusted. A computed column
// (`computed: true`) is in neither — it is derived, so there is nothing to
// write — and is dropped like a stamped one.
let allowed = (v: Vocab, comp: string, trusted: boolean): Set<string> => {
  let info = v.comp(comp)!
  return new Set(trusted ? [...info.writable, ...info.stamped] : info.writable)
}

// One component patch, admitted: undeclared columns refused, unwritable ones
// dropped, values validated. Returns undefined when the caller sent columns
// and every one of them was dropped — nothing is left to write.
let admitComp = (
  v: Vocab,
  name: string,
  patch: Comp,
  trusted: boolean,
): Comp | undefined => {
  let columns = v.props(name)
  let declared = new Set(columns)
  let alien = Object.keys(patch).filter((c) => !declared.has(c))
  if (alien.length) {
    // The refusal lists the vocabulary, not just the mistake: a caller writing
    // a column that does not exist has the wrong idea of this component, and
    // the columns it actually has are the shortest way to correct that.
    throw new Refused(
      `unknown column${alien.length > 1 ? 's' : ''}: ${
        alien.map((c) => `${name}.${c}`).join(', ')
      } — ${name} declares ${columns.join(', ')}`,
    )
  }
  let keep = allowed(v, name, trusted)
  let kept = cast(
    v,
    name,
    Object.fromEntries(Object.entries(patch).filter(([c]) => keep.has(c))),
  )
  // A computed column is never a write, so a patch of nothing else names the
  // component alone: a server's `task: { status: 'open' }` is still a task.
  let asked = Object.keys(patch).filter((c) => !v.column(name, c)?.computed)
  if (asked.length && !Object.keys(kept).length) return undefined
  let errs = v.check(name, kept, { stamped: trusted })
  if (errs.length) throw new Refused(errs.join('; '))
  return kept
}

/**
 * The admit phase: every bundle in the change, reduced to what this graph's
 * vocabulary declares and this caller may write. A bundle whose components
 * were all dropped is removed from the change — it asked for nothing this
 * graph can do. `trusted` admits server-owned columns; it is the calling
 * program's decision, never a client's.
 */
export let admit = (
  bundles: Bundle[],
  vocab: Vocab,
  trusted = false,
): Bundle[] =>
  bundles.flatMap((b) => {
    let sent = comps(b)
    if (!sent.length) return [b]
    let out: Bundle = { entity: b.entity }
    for (let k of Object.keys(b)) {
      if (RESERVED.includes(k) || k.startsWith('$')) out[k] = b[k]
    }
    let kept = 0
    for (let [name, patch] of sent) {
      let info = vocab.comp(name)
      if (!info) continue // an undeclared component is a no-op, not an error
      // A component marked `wire: false` — the `entity` identity component,
      // for one — is not writable by a client.
      if (!info.wire && !trusted) continue
      if (patch == null) {
        out[name] = null // removing a component needs no columns
        kept++
        continue
      }
      let admitted = admitComp(vocab, name, patch, trusted)
      if (!admitted) continue
      out[name] = admitted
      kept++
    }
    // A delete stands on its own: dropping every component the bundle also
    // carried does not cancel the delete.
    return kept || dead(b) ? [out] : []
  })
