// The store-agnostic resolver seam — the door "which entities match this query"
// opens through. A query is a value (Pred[], the query.ts grammar boards and
// graph_query already speak), resolved to a set of eids either one-shot
// (`resolve`) or as a NARROW live signal (`subscribe`) that fires only when the
// RESULT changes, never on an unrelated patch. The BACKING is swappable: this
// file ships the IN-MEMORY realization (index anchor + matchQuery over the live
// cache), the near-term backing D-17120 keeps; T-17125 drops an IndexedDB
// implementation behind the SAME interface with zero call-site churn — live.ts
// (queryEids) and useQuery call the seam, never a concrete cache.
import { type Signal, signal, untracked } from '@preact/signals'
import {
  type Field,
  fieldsOf,
  type Kids,
  listed,
  matchQuery,
  type Pred,
  textual,
} from './query.ts'

// A row as the resolver reads it — the merged-components bag both the live cache
// and a client Row speak (the same structural shape index.ts and query.ts use,
// so this file carries no cycle back to live.ts's `Comps`).
type Row = Record<string, Record<string, unknown> | undefined>

// The seam every backend implements: `resolve` is a one-shot GET, `subscribe`
// returns a live signal of the matching eids. An IndexedDB or SQLite backend
// satisfies this shape too — the whole point of the extraction.
export type Resolver = {
  resolve: (preds: Pred[]) => string[]
  subscribe: (preds: Pred[]) => Signal<string[]>
}

// What the in-memory resolver reads the world through: a cache row accessor, the
// whole-cache key pool (the anchorless board fallback), and the derived index's
// narrowing (index.ts `anchor`, bound to the live Index and healed before each
// read). Passed in rather than imported so the resolver stays store-shaped and
// cycle-free — the same discipline index.ts keeps.
export type Store = {
  read: (eid: string) => Row | undefined
  keys: () => Iterable<string>
  anchor: (preds: Pred[]) => Set<string> | undefined
  // The reverse-hop accessor: the children pointing back at an entity through a
  // ref column (index.ts `children`, bound to the live Index). Absent leaves a
  // reverse hop matching nothing, the same graceful absence a missing forward
  // deref gives — a store without a reverse index simply cannot answer one.
  kids?: Kids
}

// The in-memory resolver adds the maintenance the live cache drives it with:
// `refresh` re-tests the eids one patch touched, `reset` re-scans after a
// wholesale cache replacement, and `hold`/`drop` refcount a query for a
// component's lifetime so distinct queries don't accumulate. These stay OFF the
// Resolver seam on purpose — an IDB backend maintains itself from its own change
// stream and needs none of them; they belong to this concrete realization.
export type MemoryResolver = Resolver & {
  hold: (preds: Pred[]) => Signal<string[]>
  drop: (preds: Pred[]) => void
  refresh: (eids: Set<string>) => void
  reset: () => void
}

// A query set also carries its projection's WAKING fields (`.fields=…`, minus
// the `~`-volatile ones) and, per member, a signature of those columns' values.
// Membership drives the signal; on top of it, a change to a waking projected
// field of a STANDING member re-fires the set too, while a volatile column (a
// pin's z) changes its value in the cache without ever waking the list. `wake`
// is empty for a plain membership query, so the whole mechanism costs nothing
// there — the reverse-index helpers stay membership-only.
type QuerySet = {
  preds: Pred[]
  ids: Signal<string[]>
  n: number
  wake: Field[]
  vals: Map<string, string>
}
let queryKey = (preds: Pred[]) => JSON.stringify(preds)
let wakeFields = (preds: Pred[]): Field[] =>
  (fieldsOf(preds) ?? []).filter((f) => f.wake)

export let memoryResolver = (store: Store): MemoryResolver => {
  let sets = new Map<string, QuerySet>()

  // Membership is row-local: this one row tested against the live cache. peek,
  // never .value — resolving a query must not subscribe the caller to the cache.
  let matches = (eid: string, preds: Pred[]) => {
    let r = store.read(eid)
    return !!r && listed(r, preds) &&
      matchQuery(r, preds, store.read, undefined, store.kids)
  }

  // The value signature of one member's waking projected columns — what a
  // re-fire compares against to tell a move (x/y/w/h) from a mute z-bump.
  let sig = (eid: string, fields: Field[]): string => {
    let r = store.read(eid)
    return JSON.stringify(fields.map((f) => r?.[f.comp]?.[f.prop] ?? null))
  }
  let seed = (s: QuerySet, ids: Iterable<string>) => {
    if (!s.wake.length) return
    s.vals.clear()
    for (let e of ids) s.vals.set(e, sig(e, s.wake))
  }

  // One resolution pass: the index narrows to a candidate set (or the whole
  // cache when no pred anchors — the board fallback), then listed + matchQuery
  // filter. O(result), never O(graph).
  let scan = (preds: Pred[]): string[] => {
    if (textual(preds)) return []
    let cand = store.anchor(preds)
    let pool = cand ?? store.keys()
    let out: string[] = []
    for (let eid of pool) if (matches(eid, preds)) out.push(eid)
    return out
  }

  let resolve = (preds: Pred[]): string[] => untracked(() => scan(preds))

  let set = (preds: Pred[]): QuerySet => {
    let key = queryKey(preds)
    let found = sets.get(key)
    if (!found) {
      let ids = resolve(preds)
      found = {
        preds,
        ids: signal(ids),
        n: 0,
        wake: wakeFields(preds),
        vals: new Map(),
      }
      seed(found, ids)
      sets.set(key, found)
    }
    return found
  }

  let subscribe = (preds: Pred[]): Signal<string[]> => set(preds).ids

  let hold = (preds: Pred[]): Signal<string[]> => {
    let s = set(preds)
    s.n++
    return s.ids
  }
  let drop = (preds: Pred[]) => {
    let key = queryKey(preds)
    let s = sets.get(key)
    if (!s || --s.n > 0) return
    sets.delete(key)
  }

  // The parents a touched CHILD moves: a reverse hop makes a parent's membership
  // depend on its children, so a new/edited comment must re-test its target. Read
  // the child's ref column back to the parent — the forward complement of the hop.
  let revParents = (preds: Pred[], eids: Set<string>): string[] => {
    let out: string[] = []
    for (let p of preds) {
      if (!p.rev) continue
      for (let e of eids) {
        let v = store.read(e)?.[p.rev.comp]?.[p.rev.prop]
        if (v != null) out.push(String(v))
      }
    }
    return out
  }

  // A patch tests only its touched rows — a stable result keeps its subscribers
  // asleep while an unrelated entity changes. A reverse-hop query also re-tests
  // the parents of any touched child, since their membership turns on it.
  let refresh = (eids: Set<string>) => {
    for (let s of sets.values()) {
      let serverOwned = textual(s.preds)
      let extra = revParents(s.preds, eids)
      let test = extra.length ? new Set([...eids, ...extra]) : eids
      let ids = s.ids.peek()
      let next = ids
      let moved = false // a waking projected field of a standing member changed
      for (let eid of test) {
        let had = next.includes(eid)
        let wants = serverOwned ? had : matches(eid, s.preds)
        if (had != wants) {
          next = wants ? [...next, eid] : next.filter((x) => x != eid)
          if (s.wake.length) {
            if (wants) s.vals.set(eid, sig(eid, s.wake))
            else s.vals.delete(eid)
          }
        } else if (had && s.wake.length) {
          let now = sig(eid, s.wake)
          if (s.vals.get(eid) !== now) {
            s.vals.set(eid, now)
            moved = true
          }
        }
      }
      // A membership change publishes the new set; a pure move republishes the
      // same members as a fresh array so the view re-reads their boxes.
      if (next != ids) s.ids.value = next
      else if (moved) s.ids.value = [...next]
    }
  }

  // A wholesale cache replacement (seed/reset) re-scans every held query.
  let reset = () => {
    for (let s of sets.values()) {
      if (textual(s.preds)) continue
      let ids = resolve(s.preds)
      seed(s, ids)
      s.ids.value = ids
    }
  }

  return { resolve, subscribe, hold, drop, refresh, reset }
}
