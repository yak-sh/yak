// Admission: what a batch is allowed to say. Three rules, and each is a
// deliberate choice about which mistakes are loud and which are silent.
//
//   an unknown COMPONENT is dropped     forward compatibility: a newer client
//                                       may send a component this graph has
//                                       never heard of, and the rest of its
//                                       batch must still land
//   an unknown COLUMN is refused        on a component the vocabulary DOES
//                                       know, an unrecognized column is a
//                                       typo, and a silently dropped title is
//                                       worse than a refused batch
//   a server-owned column is dropped    `stamped` columns are readable, never
//                                       wire-writable; a caller who sends one
//                                       is ignored, not punished (a whole
//                                       bundle read back and sent again is a
//                                       normal thing to do)
//
// Column VALUES are checked against the vocabulary too — an enum member, a
// number where a number belongs, a scalar rather than a nested object. That is
// the vocabulary's own `check`, not a JSON Schema validator: this package
// carries no validator dependency, and a graph that wants full JSON Schema
// validation registers one as an `admit` hook.

import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp } from './bundle.ts'
import { comps, dead, RESERVED } from './bundle.ts'

/** A batch refused at admission: the component and column are named so the
 * caller can see which word was wrong. */
export class Refused extends Error {
  /** @param message what was wrong, in the caller's own spelling */
  constructor(message: string) {
    super(message)
    this.name = 'Refused'
  }
}

// The columns a caller may write on a component: its wire-writable ones, plus
// the server-owned ones when the caller is trusted. A computed column
// (`persist: false`) is in neither — it is derived, so there is nothing to
// write — and is dropped like a stamped one.
let allowed = (v: Vocab, comp: string, trusted: boolean): Set<string> => {
  let info = v.comp(comp)!
  return new Set(trusted ? [...info.writable, ...info.stamped] : info.writable)
}

// One component patch, admitted: unknown columns refused, unwritable ones
// dropped, values checked. Returns undefined when the caller sent columns and
// every one of them was dropped — nothing is left to write.
let admitComp = (
  v: Vocab,
  name: string,
  patch: Comp,
  trusted: boolean,
): Comp | undefined => {
  let columns = v.columns(name)
  let declared = new Set(columns)
  let alien = Object.keys(patch).filter((c) => !declared.has(c))
  if (alien.length) {
    // The refusal names the VOCABULARY, not just the mistake: a caller writing
    // a column that does not exist is a caller whose picture of this component
    // is wrong, and the columns it does have are the shortest way to fix it.
    throw new Refused(
      `unknown column${alien.length > 1 ? 's' : ''}: ${
        alien.map((c) => `${name}.${c}`).join(', ')
      } — ${name} declares ${columns.join(', ')}`,
    )
  }
  let keep = allowed(v, name, trusted)
  let kept = Object.fromEntries(
    Object.entries(patch).filter(([c]) => keep.has(c)),
  )
  if (Object.keys(patch).length && !Object.keys(kept).length) return undefined
  let errs = v.check(name, kept, { stamped: trusted })
  if (errs.length) throw new Refused(errs.join('; '))
  return kept
}

/**
 * The admit phase: every bundle in the batch, reduced to what this graph's
 * vocabulary knows and this caller may write. A bundle whose every component
 * was dropped leaves the batch — it asked for nothing this graph can do.
 * `trusted` admits server-owned columns, and is the door's decision, never a
 * client's.
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
      if (!info) continue // an unknown component is a no-op, not an error
      if (!info.wire && !trusted) continue // the spine is not wire-writable
      if (patch == null) {
        out[name] = null // dropping a component needs no columns
        kept++
        continue
      }
      let admitted = admitComp(vocab, name, patch, trusted)
      if (!admitted) continue
      out[name] = admitted
      kept++
    }
    // A delete stands on its own: dropping every component it also carried
    // does not make the death go away.
    return kept || dead(b) ? [out] : []
  })
