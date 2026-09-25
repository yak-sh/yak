// Admission: what a change is allowed to contain. Three rules, and each is a
// deliberate choice about which mistakes are loud and which are silent.
//
//   an undeclared component is refused  a component this graph's vocabulary
//                                       does not declare is a word it cannot
//                                       keep: a typo, or a package the graph
//                                       was not composed with, and a write
//                                       that said it saved a title it dropped
//                                       is worse than one that refused
//   an undeclared property is refused     on a component the vocabulary does
//                                       declare, an unrecognized property is a
//                                       typo, for the same reason
//   a server-owned property is dropped    `stamped` properties are readable but
//                                       never writable by a client; a caller
//                                       that sends one is ignored rather than
//                                       refused (reading a whole bundle back
//                                       and sending it again is a normal thing
//                                       to do)
//
// A string property's value is cast to a string first (@yaks/vocab `cast`): the
// schema is what a reader gets back, so a number sent to a text property is
// stored, returned and broadcast as its text.
//
// Property values are validated against the vocabulary too — an enum member, a
// number where a number belongs, a scalar rather than a nested object. That is
// the vocabulary's own `check`, not a JSON Schema validator: this package
// depends on no validator, and a graph that wants full JSON Schema validation
// registers one as an `admit` hook.

import { cast, unknownComps, unknownProps, type Vocab } from '@yaks/vocab'
import type { Bundle, Comp } from './bundle.ts'
import { comps, dead, RESERVED } from './bundle.ts'

/** A change refused at admission: the message names the component and the
 * property, so the caller can see exactly what was wrong. */
export class Refused extends Error {
  /** @param message what was wrong, naming the component and property the
   * caller sent */
  constructor(message: string) {
    super(message)
    this.name = 'Refused'
  }
}

// The properties a caller may write on a component: the client-writable ones,
// plus the server-owned ones when the caller is trusted. A computed property
// (`computed: true`) is in neither — it is derived, so there is nothing to
// write — and is dropped like a stamped one.
let allowed = (v: Vocab, comp: string, trusted: boolean): Set<string> => {
  let info = v.comp(comp)!
  return new Set(trusted ? [...info.writable, ...info.stamped] : info.writable)
}

// One component patch, admitted: undeclared properties refused, unwritable ones
// dropped, values validated. Returns undefined when the caller sent properties
// and every one of them was dropped — nothing is left to write.
let admitComp = (
  v: Vocab,
  name: string,
  patch: Comp,
  trusted: boolean,
): Comp | undefined => {
  let declared = new Set(v.props(name))
  let alien = Object.keys(patch).filter((c) => !declared.has(c))
  // The refusal lists the vocabulary, not just the mistake: a caller writing a
  // property that does not exist has the wrong idea of this component, and the
  // properties it actually has are the shortest way to correct that.
  if (alien.length) throw new Refused(unknownProps(v, name, alien))
  let keep = allowed(v, name, trusted)
  let kept = cast(
    v,
    name,
    Object.fromEntries(Object.entries(patch).filter(([c]) => keep.has(c))),
  )
  // A computed property is never a write, so a patch of nothing else names the
  // component alone: a server's `task: { status: 'open' }` is still a task.
  let asked = Object.keys(patch).filter((c) => !v.prop(name, c)?.computed)
  if (asked.length && !Object.keys(kept).length) return undefined
  let errs = v.check(name, kept, { stamped: trusted })
  if (errs.length) throw new Refused(errs.join('; '))
  return kept
}

/**
 * A replica's copy of rows another graph already admitted, with the components
 * this vocabulary does not declare left out (@yaks/graph `ApplyOpts.replica`):
 * a copy holds only the words it was loaded with. A bundle left with nothing
 * leaves the batch, unless it is a delete.
 */
export let known = (bundles: Bundle[], vocab: Vocab): Bundle[] =>
  bundles.flatMap((b) => {
    let sent = comps(b)
    let alien = sent.filter(([name]) => !vocab.comp(name))
    if (!alien.length) return [b]
    if (alien.length == sent.length && !dead(b)) return []
    let out = { ...b }
    for (let [name] of alien) delete out[name]
    return [out]
  })

/**
 * The admit phase: every bundle in the change, reduced to what this caller may
 * write, or refused if it names a component or property this graph's
 * vocabulary does not declare. A bundle whose components were all dropped is
 * removed from the change — it asked for nothing this caller may write.
 * `trusted` admits server-owned properties; it is the calling program's
 * decision, never a client's.
 */
export let admit = (
  bundles: Bundle[],
  vocab: Vocab,
  trusted = false,
): Bundle[] => {
  let alien = [
    ...new Set(
      bundles.flatMap((b) =>
        comps(b).map(([name]) => name).filter((n) => !vocab.comp(n))
      ),
    ),
  ]
  if (alien.length) throw new Refused(unknownComps(alien))
  return bundles.flatMap((b) => {
    let sent = comps(b)
    if (!sent.length) return [b]
    let out: Bundle = { entity: b.entity }
    for (let k of Object.keys(b)) {
      if (RESERVED.includes(k) || k.startsWith('$')) out[k] = b[k]
    }
    let kept = 0
    for (let [name, patch] of sent) {
      let info = vocab.comp(name)!
      // A component marked `wire: false` — the `entity` identity component,
      // for one — is not writable by a client.
      if (!info.wire && !trusted) continue
      if (patch == null) {
        out[name] = null // removing a component needs no properties
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
}
