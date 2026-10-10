// What a subscription's answer is read from, taken off its query once when it
// opens, so a commit that touches none of it does not run the query again. A
// refresh subscription runs its whole query on every commit it is asked about,
// so a commit that could not change the answer is a read wasted on the read
// thread every tab and every `/query` shares.
//
//   own   components every member wears: presence and direct positive property
//         tests required by the query, a computed property's among them when
//         its value needs the component (the store's `worn`), and the
//         reference a walk toward its target steps from. An entity missing one
//         cannot join.
//   near  the components the query reads on each entity itself, which stand
//         in for `own` when there is no presence test to narrow it.
//   far   components read on other entities whose owner cannot be located.
//   via   components whose reference names the entity with the computed value.
//         An entry changing `session.status`, for example, names its session.
//   fixed exact reference values every member has, which exclude unrelated
//         writes from a window's whole-answer refresh.
//   alone each entity alone says whether it is in the answer: the query reads
//         nothing far or via another entity, and keeps no cursor (`.after`)
//         and no backlink (`.refs`). Deleting an entity outside such an answer
//         cannot move it.
//
//   unseen the query reads a computed component, whose entities are in no
//         commit's bundles: the journal's `_change` gains rows with every
//         commit, beside what it applied. Every commit reads it again, whole.
//
// A walk (`.filed.project->P-19`, `.requires->T-42`) reads its path on every
// entity it passes through, none of which a commit's bundles name as a step:
// each hop of a chain of references is far, and so are a relation's edges,
// which wear `edge` beside their tag (@yaks/edge).
//
// `null` is a query this cannot place — a text term, a neighbour, a computed
// property that declares no `reads` — and every commit reaches it.

import { type And, bare, type Clause } from '@yaks/query'
import type { Hop, Vocab } from '@yaks/vocab'

/** The components one subscription's answer is read from. */
export type Interest = {
  own: string[]
  near: Set<string>
  far: Set<string>
  via: Map<string, string>
  fixed: { comp: string; prop: string; value: string }[]
  whole: boolean
  alone: boolean
  unseen: boolean
}

// Clauses that shape or bound the answer without reading any component.
let QUIET = new Set(['every', 'never'])

class Opaque extends Error {}

// A disjunction requires only what every arm requires; a conjunction requires
// all of its clauses. Missing properties satisfy absence and not-equals, and
// an empty equality alternative can do the same.
let missing = (c: Clause): boolean =>
  c.kind == 'pred' && c.op == '=' && (
    c.value?.kind == 'scalar' && !c.value.raw ||
    c.value?.kind == 'list' &&
      c.value.items.some((v) => v.kind == 'scalar' && !v.raw)
  )

// The hops a walk's path steps through when it is a chain of reference
// properties (`.filed.project`), or `undefined` for a relation's name.
let chain = (v: Vocab, path: string[]): Hop[] | undefined => {
  let hops: Hop[] = []
  try {
    hops = v.aim(path.join('.'))
  } catch {
    // a relation's name, which is no path
  }
  return hops.length > 0 &&
      hops.every((h) => h.prop && v.prop(h.comp, h.prop)?.category == 'ref')
    ? hops
    : undefined
}

let required = (
  c: Clause,
  v: Vocab,
  worn: (comp: string, prop: string) => boolean,
): Set<string> => {
  if (c.kind == 'and') {
    return new Set(c.clauses.flatMap((part) => [...required(part, v, worn)]))
  }
  if (c.kind == 'or') {
    let [first, ...rest] = c.clauses.map((part) => required(part, v, worn))
    return new Set(
      [...first].filter((comp) => rest.every((arm) => arm.has(comp))),
    )
  }
  // What walks a chain toward its target starts from a reference of its own.
  if (c.kind == 'walk') {
    let hops = c.dir == '->' ? chain(v, c.path) : undefined
    return new Set(hops ? [hops[0].comp] : [])
  }
  if (
    c.kind != 'pred' || c.not || c.where || v.assoc(c.path[0]) ||
    c.op == '?' || c.op == '!=' || missing(c)
  ) return new Set()
  let hops = v.aim(c.path.join('.'), bare(c))
  return hops.length == 1 && hops[0].comp != 'entity' &&
      (!hops[0].prop || worn(hops[0].comp, hops[0].prop))
    ? new Set([hops[0].comp])
    : new Set()
}

/** What a parsed query reads, or `null` when it cannot be said. */
export let interest = (
  ast: And,
  v: Vocab,
  worn: (comp: string, prop: string) => boolean,
): Interest | null => {
  let near = new Set<string>()
  let far = new Set<string>()
  let via = new Map<string, string>()
  let whole = false
  let alone = true
  let unseen = false
  let path = (p: string[], facet: boolean, into: Set<string>) => {
    let assoc = v.assoc(p[0])
    let hops = assoc
      ? [assoc, ...p.length > 1 ? v.aim(p.slice(1).join('.')) : []]
      : v.aim(p.join('.'), facet)
    hops.forEach((h, i) => {
      if (v.comp(h.comp)?.computed) unseen = true
      ;(i || assoc ? far : into).add(h.comp)
      // A status ladder reads marks on this same entity. They can change
      // membership without a patch to the component whose status is queried.
      if (h.prop == 'status') {
        for (let rung of v.comp(h.comp)?.ladder?.rungs ?? []) {
          ;(i || assoc ? far : into).add(rung.comp)
        }
      }
      let d = v.prop(h.comp, h.prop)
      if (!d?.computed) return
      if (!d.reads) throw new Opaque()
      for (let r of d.reads) {
        let [comp, prop, extra] = r.split('.')
        if (
          !i && !assoc && comp == h.comp
        ) into.add(comp)
        else if (
          !i && !assoc && prop && !extra &&
          v.prop(comp, prop)?.ref == h.comp &&
          (!via.has(comp) || via.get(comp) == prop)
        ) via.set(comp, prop)
        else far.add(comp)
      }
    })
  }
  // The components a walk steps through (@yaks/match `stepOf`): each hop of a
  // chain of reference properties, or the edges of a relation.
  let steps = (p: string[]) => {
    let hops = chain(v, p)
    if (!hops && p.length == 1 && v.comp('edge')) return far.add('edge')
    if (!hops) throw new Opaque()
    for (let h of hops) {
      far.add(h.comp)
      if (v.comp(h.comp)?.computed || v.prop(h.comp, h.prop)?.computed) {
        unseen = true
      }
    }
  }
  let walk = (cs: Clause[], into: Set<string>) => {
    for (let c of cs) {
      if (c.kind == 'and' || c.kind == 'or') walk(c.clauses, into)
      else if (c.kind == 'pred') {
        path(c.path, bare(c), into)
        if (c.where) walk([c.where], far)
      } else if (c.kind == 'order') {
        whole = true
        path(c.value.replace(/^-/, '').split('.'), false, into)
      } else if (c.kind == 'tally' || c.kind == 'distinct') {
        whole = true
        path(c.path, false, into)
      } else if (c.kind == 'fields') {
        for (let f of c.fields) path(f.path, false, into)
      } else if (c.kind == 'walk') {
        steps(c.path)
      } else if (c.kind == 'refs' && c.op == '=' && c.value) {
        alone = false
        for (let [comp] of v.refProps()) into.add(comp)
      } else if (c.kind == 'count' || c.kind == 'limit') {
        whole = true
      } else if (c.kind == 'after') {
        whole = true
        alone = false
      } else if (!QUIET.has(c.kind)) throw new Opaque()
    }
  }
  try {
    walk(ast.clauses, near)
    let own = [...required(ast, v, worn)]
    // An exact reference at the top level of an AND belongs to every
    // member. It can rule out a changed nonmember before a window re-reads.
    let fixed = ast.clauses.flatMap((c) => {
      if (
        c.kind != 'pred' || c.path.length != 2 || c.op != '=' ||
        c.value?.kind != 'scalar' || !c.value.raw ||
        v.assoc(c.path[0])
      ) return []
      let [hop, ...more] = v.aim(c.path.join('.'))
      return !more.length && worn(hop.comp, hop.prop) &&
          v.prop(hop.comp, hop.prop)?.category == 'ref'
        ? [{ ...hop, value: c.value.raw }]
        : []
    })
    alone &&= !far.size && !via.size && !unseen
    return { own, near, far, via, fixed, whole, alone, unseen }
  } catch {
    return null
  }
}

let any = (want: Set<string>, has: Set<string>) =>
  [...has].some((c) => want.has(c))

/**
 * Whether a change to one entity can move the answer: `named` are the
 * components the change wrote or removed, `worn` the ones the entity wears
 * now. A member, or an entity storage no longer holds, is always asked about
 * by the caller; this decides the rest.
 */
export let cares = (
  i: Interest,
  named: Set<string>,
  worn: Set<string>,
): boolean =>
  any(i.far, named) || any(i.far, worn) ||
  (i.own.length
    ? i.own.every((c) => worn.has(c))
    : any(i.near, named) || any(i.near, worn))
