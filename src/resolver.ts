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
import { listed, matchQuery, type Pred } from './query.ts'

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

type QuerySet = { preds: Pred[]; ids: Signal<string[]>; n: number }
let queryKey = (preds: Pred[]) => JSON.stringify(preds)

export let memoryResolver = (store: Store): MemoryResolver => {
  let sets = new Map<string, QuerySet>()

  // Membership is row-local: this one row tested against the live cache. peek,
  // never .value — resolving a query must not subscribe the caller to the cache.
  let matches = (eid: string, preds: Pred[]) => {
    let r = store.read(eid)
    return !!r && listed(r, preds) && matchQuery(r, preds, store.read)
  }

  // One resolution pass: the index narrows to a candidate set (or the whole
  // cache when no pred anchors — the board fallback), then listed + matchQuery
  // filter. O(result), never O(graph).
  let scan = (preds: Pred[]): string[] => {
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
      sets.set(key, found = { preds, ids: signal(resolve(preds)), n: 0 })
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

  // A patch tests only its touched rows — a stable result keeps its subscribers
  // asleep while an unrelated entity changes.
  let refresh = (eids: Set<string>) => {
    for (let s of sets.values()) {
      let ids = s.ids.peek()
      let next = ids
      for (let eid of eids) {
        let had = next.includes(eid)
        let wants = matches(eid, s.preds)
        if (had != wants) {
          next = wants ? [...next, eid] : next.filter((x) => x != eid)
        }
      }
      if (next != ids) s.ids.value = next
    }
  }

  // A wholesale cache replacement (seed/reset) re-scans every held query.
  let reset = () => {
    for (let s of sets.values()) s.ids.value = resolve(s.preds)
  }

  return { resolve, subscribe, hold, drop, refresh, reset }
}
