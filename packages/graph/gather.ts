// The gather: the reads a batch is going to need, taken once, before the hooks
// run.
//
// Over a database on the far side of a network the cost of `apply()` is not how
// much SQL it is — it is how many times the caller waits. D1 has no interactive
// transaction, so every question a hook asks is its own round trip, and the
// questions all arrive before a row has moved. They are also all KNOWABLE
// before a row has moved: the `$was` guard names its columns, a membership
// guard names the app and the actor, a delete names the entity whose dependents
// have to be found. So a plugin DECLARES what it is about to read — `wants` in
// ./plugin.ts — and everything declared is read together.
//
// TWO ASKS, because two are all a hook has ever needed. `eids` is these
// entities, whole. `about` is the other direction: the entities whose reference
// columns point AT these — the death cascade's question, and a membership
// guard's alike, since a grant is an entity that points at an app and a person,
// so "everything about this actor" is one read where "their grant, and their
// seat" is two. `comps` narrows which components an `about` looks through, so
// asking about a person does not drag back everything they ever created.
//
// A MISS IS NOT AN ERROR. `wants` is a declaration written by a plugin this
// package has never seen, and one that forgets an eid must still get a correct
// answer — so the transaction built here falls back to the storage for anything
// it was not asked for, and keeps the answer. The cost of a forgotten ask is
// then exactly the round trip it would have saved, which is a number a clamp
// measures (@yaks/d1's `hops_test.ts`), rather than a batch that refuses in
// production and passes in the test.
//
// The gather is also where an asynchronous storage becomes a single await: one
// `tx.get`, and one backwards read when something asked `about`. That second
// one is a ROUND TRIP, not just a query: an `about` finds its hits with one
// statement and then has to read them whole, which over a network is two waits
// unless the gather of the hits can name them by the query that found them.
// `Tx.whole` (./storage.ts) is that door and `seek` below is where it is
// asked, so an `about` costs one trip wherever an adapter offers it. Everything
// the hooks then ask is answered from memory, synchronously, so the phases
// between them stay a plain loop (./pipe.ts).

import { and, eq, or, type Query as Ast } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Eid } from './bundle.ts'
import { comps } from './bundle.ts'
import type { Tx } from './storage.ts'
import { then } from './pipe.ts'

/**
 * One read a phase needs taken before it runs. Both directions are optional and
 * an ask may state both; an ask that states neither asks nothing.
 */
export type Ask = {
  /** these entities, whole */
  eids?: Eid[]
  /** the entities whose reference columns point AT these */
  about?: Eid[]
  /** which components an `about` looks through (default: every one that
   * declares a reference column) */
  comps?: string[]
}

/**
 * What one gather read. `got` is the entities it was handed by name, with
 * `null` for one the storage does not hold; `near` is keyed by column AND
 * target, so a later ask through a narrower set of components can tell what was
 * covered from what was not, and a write can re-file what moved.
 */
export type Snap = {
  /** the entities asked for by name, `null` for one that is not there */
  got: Map<Eid, Bundle | null>
  /** per `comp.prop <eid>`, the entities whose column points there */
  near: Map<string, Bundle[]>
  /** the (column, target) triples `near` is keyed by */
  pairs: [string, string, Eid][]
}

/** One backwards read, as the snapshot files it. */
let key = (comp: string, prop: string, eid: Eid): string =>
  `${comp}.${prop} ${eid}`

// The reference columns an ask looks through: the ones its components declare,
// or every one in the vocabulary.
let cols = (vocab: Vocab, names?: string[]): [string, string][] =>
  names ? vocab.refCols().filter(([c]) => names.includes(c)) : vocab.refCols()

// Every (column, target) triple an `about` over these entities covers.
let want = (
  vocab: Vocab,
  eids: Eid[],
  names?: string[],
): [string, string, Eid][] =>
  cols(vocab, names).flatMap(([c, p]) =>
    eids.map((e) => [c, p, e] as [string, string, Eid])
  )

/**
 * The query that finds everything whose reference columns point at one of these
 * targets: one disjunction over (column, target), so a walk that was a read per
 * column per entity is a read. `null` when there is nothing to ask.
 */
export let pointing = (pairs: [string, string, Eid][]): Ast | null =>
  pairs.length ? and(or(...pairs.map(([c, p, e]) => eq(`${c}.${p}`, e)))) : null

// A pointing query, asked. It names a SET — a disjunction of equalities, never
// a window — which is exactly what `Tx.whole` promises to answer in a single
// round trip, so every backwards read goes through here rather than `read`. An
// adapter without the door falls back to `read` and reads the same answer.
let seek = (tx: Tx, q: Ast): Bundle[] | Promise<Bundle[]> =>
  (tx.whole ?? tx.read)(q)

// The value of one reference column, as an eid or nothing.
let at = (b: Bundle, comp: string, prop: string): Eid | undefined => {
  let v = (b[comp] as Comp | undefined)?.[prop]
  return v == null ? undefined : String(v)
}

// File each row under every triple it satisfies, so one read answers many asks.
let file = (snap: Snap, pairs: [string, string, Eid][], rows: Bundle[]) => {
  for (let [c, p, e] of pairs) {
    snap.near.set(key(c, p, e), [])
    snap.pairs.push([c, p, e])
  }
  for (let b of rows) {
    for (let [c, p, e] of pairs) {
      if (at(b, c, p) === e) snap.near.get(key(c, p, e))!.push(b)
    }
  }
}

// The same bundle found through two columns is one answer.
let once = (rows: Bundle[]): Bundle[] => {
  let seen = new Set<Eid>()
  return rows.filter((b) => !seen.has(b.entity.eid) && !!seen.add(b.entity.eid))
}

// A patch folded into what the snapshot holds: a null component drops it,
// anything else merges in, so an omitted column keeps what it held and a null
// one clears it. The same rule ./mutate.ts hands the storage — said here
// because a hook that WRITES in the gathered phase has to be read back by the
// hook after it (yaks.app's vouch writes the grant its own membership guard
// then reads).
let merged = (held: Bundle | null, b: Bundle): Bundle => {
  let out: Bundle = { ...(held ?? { entity: b.entity }) }
  for (let [name, comp] of comps(b)) {
    if (comp == null) delete out[name]
    else out[name] = { ...(out[name] as Comp | undefined ?? {}), ...comp }
  }
  return out
}

/**
 * Every entity a batch names or points at — what the core itself reads, and
 * what a storage learns while patching. Handed to the gather as its first ask,
 * so `apply()` asks the database about all of them once.
 */
export let reached = (bundles: Bundle[], vocab: Vocab): Eid[] => {
  let out = new Set<Eid>()
  for (let b of bundles) {
    out.add(b.entity.eid)
    for (let [name, comp] of comps(b)) {
      for (let [prop, value] of Object.entries(comp ?? {})) {
        if (value != null && vocab.column(name, prop)?.category == 'ref') {
          out.add(String(value))
        }
      }
    }
  }
  return [...out]
}

/**
 * Take every ask at once: one `tx.get` for the entities named, one `tx.read`
 * for everything pointing at the entities asked about. Each is skipped when
 * nothing asked for it, so a batch nobody wants to read about costs nothing.
 */
export let gather = (
  tx: Tx,
  vocab: Vocab,
  asks: Ask[],
): Snap | Promise<Snap> => {
  let eids = new Set<Eid>()
  let pairs = new Map<string, [string, string, Eid]>()
  for (let a of asks) {
    for (let e of a.eids ?? []) eids.add(e)
    for (let t of want(vocab, a.about ?? [], a.comps)) pairs.set(key(...t), t)
  }
  let snap: Snap = { got: new Map(), near: new Map(), pairs: [] }
  let named = [...eids]
  let back = [...pairs.values()]
  return then(named.length ? tx.get(named) : [], (found) => {
    for (let e of named) snap.got.set(e, null)
    for (let b of found) snap.got.set(b.entity.eid, b)
    let q = pointing(back)
    if (!q) return snap
    return then(seek(tx, q), (rows) => {
      file(snap, back, rows)
      return snap
    })
  })
}

/**
 * The transaction the hooks receive: the storage's own, with `get` and `about`
 * answered from what the gather read, and every `patch` through it folded back
 * in so the next hook reads what the one before it wrote.
 *
 * Anything the gather was not asked for is read from the storage and kept, so a
 * `wants` that forgot something costs a round trip rather than giving a wrong
 * answer. `read` is not answered here at all: a query is the storage's to
 * evaluate, and pretending otherwise would put a second query engine in the
 * core.
 *
 * Only the phases that run BEFORE the batch writes are handed one — a snapshot
 * of the graph as the batch FOUND it is exactly what a precondition wants, and
 * exactly what a phase reading after the patches must not have. The cascade
 * takes a fresh one of its own for that reason.
 */
export let holding = (tx: Tx, vocab: Vocab, snap: Snap): Tx => ({
  ...tx,
  // Not the storage's own death cascade: it would answer about the rows the
  // storage HOLDS, and this transaction is the one place where a hook's
  // pending write is not among them. A phase reading through the snapshot
  // walks (./cascade.ts `doomed`).
  doom: undefined,
  patch: (bundles) =>
    then(tx.patch(bundles), (born) => {
      for (let b of bundles) {
        let eid = b.entity.eid
        let held = merged(snap.got.get(eid) ?? null, b)
        if (snap.got.has(eid)) snap.got.set(eid, held)
        // Where it points now, and where it no longer does.
        for (let [c, p, e] of snap.pairs) {
          let rows = snap.near.get(key(c, p, e))!
          let was = rows.findIndex((r) => r.entity.eid == eid)
          let hit = at(held, c, p) === e
          if (hit && was < 0) rows.push(held)
          else if (hit) rows[was] = held
          else if (was >= 0) rows.splice(was, 1)
        }
      }
      return born
    }),
  get: (eids) => {
    let mine = () => eids.flatMap((e) => snap.got.get(e) ?? [])
    let miss = eids.filter((e) => !snap.got.has(e))
    if (!miss.length) return mine()
    return then(tx.get(miss), (found) => {
      for (let e of miss) snap.got.set(e, null)
      for (let b of found) snap.got.set(b.entity.eid, b)
      return mine()
    })
  },
  about: (eids, names) => {
    let asked = want(vocab, eids, names)
    let mine = () =>
      once(asked.flatMap(([c, p, e]) => snap.near.get(key(c, p, e)) ?? []))
    let miss = asked.filter(([c, p, e]) => !snap.near.has(key(c, p, e)))
    let q = pointing(miss)
    if (!q) return mine()
    return then(seek(tx, q), (rows) => {
      file(snap, miss, rows)
      return mine()
    })
  },
})

/**
 * The entities whose reference columns point at one of `eids` — through the
 * gather when a `wants` asked for them, and through the storage when none did.
 * The one door a phase or a hook reads backwards through.
 */
export let about = (
  tx: Tx,
  vocab: Vocab,
  eids: Eid[],
  names?: string[],
): Bundle[] | Promise<Bundle[]> => {
  if (tx.about) return tx.about(eids, names)
  let q = pointing(want(vocab, eids, names))
  return q ? seek(tx, q) : []
}
