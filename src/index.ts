// The cache's derived indexes — the reverse views the vocabulary implies, so
// a query resolves to a candidate set instead of a whole-graph scan. `comps`/
// `stamped` (types.ts) declare every `{eid}` reference; from that ONE list we
// build refs[comp.prop] = referenced → referrers, plus by-component-presence
// and edges-by-endpoint. Adding a component or an `{eid}` field gets indexed
// cache queries for free — the same list already drives the db schema and the
// dot-param router (CLAUDE.md, "the vocabulary is one list").
//
// This is the IN-MEMORY realization of that derivation. The DERIVATION
// (`refCols`) is the reusable, backend-agnostic piece — it is what a SQLite
// `create index` / IndexedDB store set is generated from too (T-17046/T-12764).
// live.ts drives maintenance from the eids each patch touches, and `anchor()`
// turns a query's `Pred[]` into the smallest candidate set. When the store
// moves to IDB, `anchor` swaps its lookup; the derivation and callers stay put.
import { type Dep, type Idx, indexes } from './types.ts'
import { isRef } from './props.ts'
import { EXISTS, ORDER, type Pred, refCols, TEXT, WANT } from './query.ts'

// A row as the index reads it — the merged-components shape both the live cache
// and a client Row speak. Kept structural so index.ts carries no cycle back to
// live.ts's `Comps`.
type Row = Record<string, Record<string, unknown> | undefined>

// The `{eid}` reference columns of the vocabulary live in query.ts (the reverse
// grammar and this index derive from the one list); re-export so callers that
// think of it as the INDEX derivation keep their import.
export { refCols }

// Every index a component declares — the ONE index vocabulary the cache, the
// SQL DDL (T-12764) and the IDB stores (T-17125) all read, so no backend
// hand-keeps its own set. Two sources merge: the composite/unique declarations
// in `indexes` (types.ts), and one single-column index per `{eid}` reference,
// auto-derived from `refCols` (never hand-listed). A single-column declaration
// OVERRIDES its auto twin — that is how a lone ref column earns the
// `unique`/`where` the plain derivation can't give it. The cache below realizes
// only the single-column half (its `refs` map maintains exactly `refCols`); the
// composites are for the durable backends. Nothing generates yet — this is the
// source those generators will read.
export let indexesFor = (comp: string): Idx[] => {
  let declared = indexes[comp] ?? []
  let overridden = new Set(
    declared.filter((i) => i.cols.length == 1).map((i) => i.cols[0]),
  )
  let auto = refCols
    .filter(([c, p]) => c == comp && !overridden.has(p))
    .map(([, p]): Idx => ({ cols: [p] }))
  return [...declared, ...auto]
}

let refKey = (comp: string, prop: string) => `${comp}.${prop}`

export type Index = {
  // "comp.prop" → referenced eid → the eids referring through that column
  refs: Map<string, Map<string, Set<string>>>
  // component name → the eids carrying it (kind resolves through here via
  // kindPreds — no stored by-kind map to drift from kindOf)
  byComp: Map<string, Set<string>>
  // the edge triples by endpoint (replaces relationIndex/childIndex)
  byParent: Map<string, Dep[]>
  byChild: Map<string, Dep[]>
}

export let emptyIndex = (): Index => ({
  refs: new Map(),
  byComp: new Map(),
  byParent: new Map(),
  byChild: new Map(),
})

let add = (m: Map<string, Set<string>>, k: string, eid: string) => {
  let s = m.get(k)
  if (s) s.add(eid)
  else m.set(k, new Set([eid]))
}
let drop = (m: Map<string, Set<string>>, k: string, eid: string) => {
  let s = m.get(k)
  if (!s) return
  s.delete(eid)
  if (!s.size) m.delete(k)
}

let refVal = (row: Row | undefined, comp: string, prop: string) => {
  let v = row?.[comp]?.[prop]
  return v == null ? undefined : String(v)
}

// Bring one eid's derived facets from `before` to `after` — the pair applyLocal
// already holds. Only a changed facet touches a set, so an unrelated column
// edit is O(1). A death is `after = undefined`; a birth `before = undefined`.
export let reindex = (
  ix: Index,
  eid: string,
  before: Row | undefined,
  after: Row | undefined,
) => {
  for (let [c, p] of refCols) {
    let was = refVal(before, c, p)
    let now = refVal(after, c, p)
    if (was == now) continue
    let key = refKey(c, p)
    let m = ix.refs.get(key)
    if (!m) ix.refs.set(key, m = new Map())
    if (was != null) {
      let s = m.get(was)
      if (s) {
        s.delete(eid)
        if (!s.size) m.delete(was)
      }
    }
    if (now != null) add(m, now, eid)
    if (!m.size) ix.refs.delete(key)
  }
  for (
    let c of new Set([
      ...Object.keys(before ?? {}),
      ...Object.keys(after ?? {}),
    ])
  ) {
    let had = !!before?.[c]
    let has = !!after?.[c]
    if (had == has) continue
    if (has) add(ix.byComp, c, eid)
    else drop(ix.byComp, c, eid)
  }
}

// An edge's endpoint index. A new array replaces the old on any change, so the
// narrow relation signals (live.ts publish()) see a fresh reference and fire.
export let reindexEdge = (ix: Index, d: Dep, gone: boolean) => {
  let put = (m: Map<string, Dep[]>, k: string, same: (x: Dep) => boolean) => {
    let cur = m.get(k)
    if (gone) {
      if (!cur) return
      let n = cur.filter((x) => !same(x))
      if (n.length == cur.length) return
      n.length ? m.set(k, n) : m.delete(k)
    } else if (!cur) m.set(k, [d])
    else if (!cur.some(same)) m.set(k, [...cur, d])
  }
  put(ix.byParent, d.parent, (x) => x.type == d.type && x.child == d.child)
  put(ix.byChild, d.child, (x) => x.type == d.type && x.parent == d.parent)
}

// A full build — the seed/reset path and the lazy rebuild after a wholesale
// cache replacement (tests, host integrations). Incremental maintenance is the
// steady state; this is the one O(graph) pass, never per patch.
export let indexAll = (ix: Index, graph: Record<string, Row>, deps: Dep[]) => {
  ix.refs.clear()
  ix.byComp.clear()
  ix.byParent.clear()
  ix.byChild.clear()
  for (let [eid, row] of Object.entries(graph)) reindex(ix, eid, undefined, row)
  for (let d of deps) reindexEdge(ix, d, false)
}

// Does satisfying this pred REQUIRE its component be present? Then byComp is a
// valid candidate superset. Absence tests (`= ''`, `!=`, a component `=`) match
// rows WITHOUT the component, so they anchor nothing. Exported so the durable
// backends (the IDB resolver, T-17125) make the SAME presence decision this
// in-memory anchor does — one anchoring predicate, every store.
export let implies = (p: Pred): boolean => {
  if (!p.prop) return p.op == EXISTS || p.op == '~' // .comp! / .comp~ present
  switch (p.op) {
    case '!':
      return false // `!=` matches an absent column too
    case '':
      return p.value != '' // `= ''` is absence; `= v` needs presence
    case '~':
      return p.value != '' // `~ ''` matches everything
    default:
      return true // EXISTS / < <= > >= all need a value present
  }
}

// The smallest candidate eid set for these preds, or undefined for a whole-cache
// scan. An eid-ref EQUALITY anchors on the reverse index (O(result)); any pred
// requiring a component present anchors on byComp. Path preds (`p.at`) anchor on
// their NEAR component's presence, never mistaking the near ref for a value.
// The returned set is the index's own — callers read it, never mutate it.
export let anchor = (ix: Index, preds: Pred[]): Set<string> | undefined => {
  let best: Set<string> | undefined
  let consider = (s: Set<string> | undefined) => {
    if (s && (!best || s.size < best.size)) best = s
  }
  for (let p of preds) {
    if (p.op == TEXT || p.op == ORDER || p.op == WANT) continue
    if (p.rev) {
      // A reverse hop needing ≥1 child anchors on the parents that HAVE one —
      // the KEYS of the reverse map (a superset of the matching-child parents).
      // A negated hop (NONE) or a count that admits zero also matches childless
      // parents — not in the keys — so it anchors nothing, a full scan.
      if (!p.rev.not && !p.rev.count) {
        let m = ix.refs.get(refKey(p.rev.comp, p.rev.prop))
        consider(new Set(m?.keys() ?? []))
      }
      continue
    }
    if (p.refs) {
      // The multi-column reverse-union: the referrers of `value` are the union
      // of every reverse map's set for it — O(referrers), never a graph scan.
      // Presence/absence (`.refs!`, `.refs=`) admit rows with no reference at
      // all, not in any reverse map, so they anchor nothing.
      if (p.op == '' && p.value) {
        let out = new Set<string>()
        for (let [c, pr] of refCols) {
          for (let e of ix.refs.get(refKey(c, pr))?.get(p.value) ?? []) {
            out.add(e)
          }
        }
        consider(out)
      }
      continue
    }
    if (
      !p.at && p.comp && p.prop && p.op == '' && p.value &&
      !p.value.includes(',') && !/\.\./.test(p.value) && isRef(p.comp, p.prop)
    ) {
      consider(ix.refs.get(refKey(p.comp, p.prop))?.get(p.value))
      continue
    }
    if (p.comp && implies(p)) consider(ix.byComp.get(p.comp))
  }
  return best
}

// The children a reverse hop resolves: the eids referring at `eid` through
// `comp.prop`. The reverse map IS this lookup — the whole reason index.ts keeps
// it — so live's Kids accessor is one read over it (live.ts binds the cache).
export let children = (
  ix: Index,
  eid: string,
  comp: string,
  prop: string,
): string[] => [...ix.refs.get(refKey(comp, prop))?.get(eid) ?? []]
