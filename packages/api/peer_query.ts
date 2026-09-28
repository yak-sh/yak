// The durable candidates of a query that also reads peer-held components.
// Replacing a peer condition with false or true gives storage a superset of
// the durable rows that can match. Held peer entities are fetched by id and
// the original query decides membership over the joined values.

import { type And, bare, type Clause, parse } from '@yaks/query'
import { syncOf, type Vocab } from '@yaks/vocab'

let NEVER: Clause = { kind: 'never' }

let aim = (v: Vocab, path: string[], facet = false) => {
  try {
    return v.aim(path.join('.'), facet)
  } catch {
    return []
  }
}

let peer = (v: Vocab, path: string[], facet = false) =>
  aim(v, path, facet).some((h) => syncOf(v, h.comp) == 'peers')

let uses = (v: Vocab, clauses: Clause[]): boolean =>
  clauses.some((c) => {
    if (c.kind == 'and' || c.kind == 'or') return uses(v, c.clauses)
    if (c.kind == 'pred') {
      return peer(v, c.path, bare(c)) ||
        !!c.where && uses(v, [c.where])
    }
    if (c.kind == 'order') {
      return peer(v, c.value.replace(/^-/, '').split('.'))
    }
    if (c.kind == 'distinct' || c.kind == 'tally') {
      return peer(v, c.path)
    }
    return false
  })

// A positive predicate on the entity's own peer component cannot match a
// durable row without a held value. Other peer predicates become true here:
// absence, optional projections and an association's far endpoint can still
// match a durable row, so they cannot narrow storage candidates.
let positive = (v: Vocab, c: Clause) => {
  if (c.kind != 'pred' || c.where || c.not || c.op == '?' || c.op == '!=') {
    return false
  }
  if (c.op == '=' && c.value?.kind == 'scalar' && c.value.raw == '') {
    return false
  }
  return syncOf(v, aim(v, c.path, bare(c))[0]?.comp ?? '') == 'peers'
}

// null is true and `never` is false while simplifying AND and OR. Directives
// are dropped so an order or limit never cuts candidates before the full
// query runs over durable rows and peer values together.
let relax = (v: Vocab, c: Clause, without = false): Clause | null => {
  if (c.kind == 'and' || c.kind == 'or') {
    let parts = c.clauses.map((p) => relax(v, p, without))
    if (c.kind == 'and') {
      if (parts.some((p) => p?.kind == 'never')) return NEVER
      let kept = parts.filter((p) => p != null)
      return kept.length ? { kind: 'and', clauses: kept } : null
    }
    if (parts.some((p) => p == null)) return null
    let kept = parts.filter((p) => p?.kind != 'never') as Clause[]
    return kept.length ? { kind: 'or', clauses: kept } : NEVER
  }
  if (c.kind == 'pred' && uses(v, [c])) {
    return without || positive(v, c) ? NEVER : null
  }
  if (
    c.kind == 'order' || c.kind == 'limit' || c.kind == 'after' ||
    c.kind == 'fields' || c.kind == 'every' || c.kind == 'count' ||
    c.kind == 'distinct' || c.kind == 'tally' || c.kind == 'edges'
  ) return null
  return c
}

// A peer predicate reached through one reference can be refreshed by finding
// the rows that point at the moved peer. Negative predicates also match when
// that peer has no held value, so they keep the ordinary whole-answer path.
let referent = (q: And, v: Vocab) => {
  let ref: { comp: string; prop: string; far: Set<string> } | undefined
  let count = 0
  let valid = true
  let walk = (cs: Clause[]) => {
    for (let c of cs) {
      if (c.kind == 'and' || c.kind == 'or') walk(c.clauses)
      else if (c.kind == 'pred' && uses(v, [c])) {
        count++
        let hops = aim(v, c.path, bare(c))
        let first = hops[0], last = hops[1]
        if (
          c.where || c.not || c.op == '?' || c.op == '!=' ||
          c.op == '=' && c.value?.kind == 'scalar' && c.value.raw == '' ||
          hops.length != 2 ||
          !first || v.prop(first.comp, first.prop)?.category != 'ref' ||
          syncOf(v, last?.comp ?? '') != 'peers' ||
          ref && (ref.comp != first.comp || ref.prop != first.prop)
        ) {
          valid = false
          continue
        }
        if (!ref) ref = { comp: first.comp, prop: first.prop, far: new Set() }
        ref.far.add(last.comp)
      } else if (c.kind == 'pred') {
        // A second relation could change a row's answer without moving the
        // peer reached through this reference.
        if (
          c.where || c.not || v.assoc(c.path[0]) ||
          aim(v, c.path, bare(c)).length > 1
        ) valid = false
      } else if (
        c.kind == 'order' || c.kind == 'limit' || c.kind == 'after' ||
        c.kind == 'count' || c.kind == 'distinct' || c.kind == 'tally' ||
        c.kind == 'refs' || c.kind == 'near' || c.kind == 'walk' ||
        c.kind == 'edges'
      ) valid = false
    }
  }
  walk(q.clauses)
  return valid && count ? ref : undefined
}

/** The original query reads peers, and the durable rows that might match it.
 * `durable: null` means every matching row must have a held peer value. */
export let peerPlan = (q: And, v: Vocab): {
  peers: boolean
  durable: And | null
  ref?: { comp: string; prop: string; far: Set<string> }
} => {
  if (!uses(v, q.clauses)) return { peers: false, durable: q }
  let ref = referent(q, v)
  let clause = relax(v, q, !!ref)
  if (clause?.kind == 'never') return { peers: true, durable: null, ref }
  if (!clause) return { peers: true, durable: parse('.entity&*') }
  let clauses = clause.kind == 'and' ? clause.clauses : [clause]
  return {
    peers: true,
    durable: { kind: 'and', clauses: [...clauses, { kind: 'every' }] },
    ...(ref ? { ref } : {}),
  }
}
