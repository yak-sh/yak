// What a subscription's answer is read from, taken off its query once when it
// opens, so a commit that touches none of it does not run the query again. A
// refresh subscription runs its whole query on every commit it is asked about,
// and every writer waits for that inside the effect phase: before this, each
// tool call's bookkeeping rows paid for every open tab's session tray.
//
//   own   components every member wears: the top-level presence tests
//         (`.session`). An entity that wears none of them, and whose change
//         named none, can neither join the set nor leave it.
//   near  the components the query reads on each entity itself, which stand
//         in for `own` when there is no presence test to narrow it.
//   far   components read on other entities whose owner cannot be located.
//   via   components whose reference names the entity with the computed value.
//         An entry changing `session.status`, for example, names its session.
//   fixed exact reference values every member has, which exclude unrelated
//         writes from a window's whole-answer refresh.
//
// `null` is a query this cannot place — a text term, a neighbour, a walk, a
// computed property that declares no `reads` — and every commit reaches it.

import { type And, bare, type Clause } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'

/** The components one subscription's answer is read from. */
export type Interest = {
  own: string[]
  near: Set<string>
  far: Set<string>
  via: Map<string, string>
  fixed: { comp: string; prop: string; value: string }[]
  whole: boolean
}

// Clauses that shape or bound the answer without reading any component.
let QUIET = new Set(['every', 'never'])

class Opaque extends Error {}

/** What a parsed query reads, or `null` when it cannot be said. */
export let interest = (ast: And, v: Vocab): Interest | null => {
  let near = new Set<string>()
  let far = new Set<string>()
  let via = new Map<string, string>()
  let whole = false
  let path = (p: string[], facet: boolean, into: Set<string>) => {
    let assoc = v.assoc(p[0])
    let hops = assoc
      ? [assoc, ...p.length > 1 ? v.aim(p.slice(1).join('.')) : []]
      : v.aim(p.join('.'), facet)
    hops.forEach((h, i) => {
      ;(i || assoc ? far : into).add(h.comp)
      let d = v.prop(h.comp, h.prop)
      if (!d?.computed) return
      if (!d.reads) throw new Opaque()
      for (let r of d.reads) {
        let [comp, prop, extra] = r.split('.')
        if (
          !i && !assoc && prop && !extra &&
          v.prop(comp, prop)?.ref == h.comp &&
          (!via.has(comp) || via.get(comp) == prop)
        ) via.set(comp, prop)
        else far.add(comp)
      }
    })
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
      } else if (c.kind == 'refs' && c.op == '=' && c.value) {
        for (let [comp] of v.refProps()) into.add(comp)
      } else if (
        c.kind == 'count' || c.kind == 'limit' ||
        c.kind == 'after'
      ) {
        whole = true
      } else if (!QUIET.has(c.kind)) throw new Opaque()
    }
  }
  try {
    walk(ast.clauses, near)
    // A presence test (`.session`) is worn by every member. An absence
    // (`!session`) is a bare form too, and says the opposite: no member wears
    // it, so it narrows nothing and stays with the rest of `near`.
    let own = ast.clauses.flatMap((c) =>
      c.kind == 'pred' && bare(c) && c.op == '!'
        ? [v.aim(c.path[0], true)[0].comp]
        : []
    )
    // An exact reference at the top level of an AND belongs to every
    // member. It can rule out a changed nonmember before a window re-reads.
    let fixed = ast.clauses.flatMap((c) => {
      if (
        c.kind != 'pred' || c.path.length != 2 || c.op != '=' ||
        c.value?.kind != 'scalar' || !c.value.raw ||
        v.assoc(c.path[0])
      ) return []
      let [hop, ...more] = v.aim(c.path.join('.'))
      return !more.length && v.prop(hop.comp, hop.prop)?.category == 'ref'
        ? [{ ...hop, value: c.value.raw }]
        : []
    })
    return { own, near, far, via, fixed, whole }
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
    ? i.own.every((c) => worn.has(c)) || i.own.some((c) => named.has(c))
    : any(i.near, named) || any(i.near, worn))
