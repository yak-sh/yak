// Admission: what a batch is allowed to contain. Three rules, and each is a
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
//   a server-owned property is refused    `stamped` properties are readable but
//                                       only trusted writers may write them;
//                                       a caller must send the patch it means,
//                                       not replay server-owned values
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
import { comps, dead, reserved } from './bundle.ts'

import { Refused } from './errors.ts'
import { prunable } from './prune.ts'
export { Refused } from './errors.ts'

let serverOwned = (name: string, prop: string): never => {
  throw new Refused(
    `${name}.${prop} is server-owned (stamped); only trusted writers may write it`,
  )
}

/** Check what an untrusted caller named before normalization can remove or
 * replace it. Identity is structural, but its declared properties have the
 * same ownership as every other component's. */
export let unstamped = (
  bundles: Bundle[],
  vocab: Vocab,
  ignored: readonly string[] = [],
): Bundle[] => {
  for (let b of bundles) {
    for (let [name, patch] of [['entity', b.entity] as const, ...comps(b)]) {
      for (let k of Object.keys(patch ?? {})) {
        if (vocab.prop(name, k)?.stamped && !ignored.includes(`${name}.${k}`)) {
          serverOwned(name, k)
        }
      }
    }
  }
  return bundles
}

/**
 * The bundles, refused unless they form a batch: an array whose every
 * member is an object whose `entity` names an eid. Every door hands `apply()`
 * what arrived, and the first phase reads each bundle's eid, so the shape is
 * refused here, before anything reads it, naming the bundle by its place.
 */
export let formed = (bundles: unknown): Bundle[] => {
  if (!Array.isArray(bundles)) {
    throw new Refused('a batch is an array of bundles')
  }
  bundles.forEach((b, i) => {
    let eid = b && typeof b == 'object' ? b.entity?.eid : undefined
    if (typeof eid != 'string' || (!eid && b.$prune !== true)) {
      throw new Refused(
        `bundle ${i} needs an entity: {entity: {eid}} — an eid you mint, or ` +
          `'$name' to have the graph mint one`,
      )
    }
    prunable(b)
  })
  return bundles
}

// One component patch, admitted: undeclared and server-owned properties refused,
// computed values dropped, writable values validated.
//
// A caller may write the client-writable properties, and the server-owned ones
// when it is trusted. A computed property (`computed: true`) is neither — it
// is derived, so there is nothing to write — and is dropped, except in a
// replica, which keeps the value the graph it copies derived.
let admitComp = (
  v: Vocab,
  name: string,
  patch: Comp,
  trusted: boolean,
  replica: boolean,
): Comp | undefined => {
  let alien: string[] = []
  let kept: Comp = {}
  // What a replica's source derived: kept as it was sent, never checked, since
  // a derivation may answer wider than the words a client writes (a claimed
  // task's status is `wip`).
  let derived: Comp = {}
  let ignored = false
  for (let k of Object.keys(patch)) {
    let p = v.prop(name, k)
    if (!p) {
      alien.push(k)
      continue
    }
    if (p.stamped && !trusted) {
      ignored = true
      continue
    }
    // A computed property is never a write, so a patch of nothing else names
    // the component alone: a server's `task: { status: 'open' }` is a task.
    if (p.computed) {
      if (replica) derived[k] = patch[k]
      continue
    }
    kept[k] = patch[k]
  }
  // The refusal lists the vocabulary, not just the mistake: a caller writing a
  // property that does not exist has the wrong idea of this component, and the
  // properties it actually has are the shortest way to correct that.
  if (alien.length) throw new Refused(unknownProps(v, name, alien))
  if (ignored && !Object.keys(kept).length) return undefined
  let cut = cast(v, name, kept)
  let errs = v.check(name, cut, { stamped: trusted })
  if (errs.length) throw new Refused(errs.join('; '))
  return { ...cut, ...derived }
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
 * The admit phase: every bundle in the batch, reduced to what this caller may
 * write, or refused if it names a component or property this graph's
 * vocabulary does not declare, or a server-owned property. A bundle whose
 * components were all dropped is removed from the batch — it asked for nothing
 * this caller may write.
 * `trusted` admits server-owned properties; it is the calling program's
 * decision, never a client's. `teach` ends the refusal of an undeclared
 * component (@yaks/vocab `unknownComps`). A `replica` (trusted) keeps the
 * computed values its source sent.
 * A host may name `ignoreStamped` properties its shipped callers still send;
 * those are dropped without granting the caller authority to write them.
 */
export let admit = (
  bundles: Bundle[],
  vocab: Vocab,
  trusted = false,
  teach?: string,
  replica = false,
  ignoreStamped: readonly string[] = [],
): Bundle[] => {
  let alien = new Set<string>()
  for (let b of bundles) {
    for (let k of Object.keys(b)) {
      if (!reserved(k) && !vocab.comp(k)) alien.add(k)
    }
  }
  if (alien.size) throw new Refused(unknownComps([...alien], teach))
  if (!trusted) unstamped(bundles, vocab, ignoreStamped)
  return bundles.flatMap((b) => {
    // Identity is reserved structurally, but its declared properties still
    // belong to the server (for example entity.archetype).
    if (!trusted) {
      for (let k of Object.keys(b.entity)) {
        if (!vocab.prop('entity', k)?.stamped) continue
        b = { ...b, entity: { ...b.entity } }
        delete (b.entity as Comp)[k]
      }
    }
    let sent = comps(b)
    if (!sent.length) return [b]
    let out: Bundle = { entity: b.entity }
    for (let k of Object.keys(b)) if (reserved(k)) out[k] = b[k]
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
      let admitted = admitComp(
        vocab,
        name,
        patch,
        trusted,
        replica && trusted,
      )
      if (!admitted) continue
      out[name] = admitted
      kept++
    }
    // A delete stands on its own: dropping every component the bundle also
    // carried does not cancel the delete.
    return kept || dead(b) ? [out] : []
  })
}
