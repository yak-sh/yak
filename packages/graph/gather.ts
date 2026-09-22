// The gather: the reads a change is going to need, taken once, before the
// hooks run.
//
// Over a database on the far side of a network, the cost of `apply()` is not
// how much SQL it runs — it is how many times the caller has to wait. D1 has no
// interactive transaction, so every question a hook asks is its own round trip,
// and all those questions arrive before any row has changed. They are also all
// knowable before any row has changed: the `$was` check names its columns, a
// membership check names the app and the actor, a delete names the entity whose
// dependents have to be found. So a plugin declares what it is about to read —
// `wants` in ./plugin.ts — and everything declared is read together.
//
// Two kinds of ask, because two are all a hook has ever needed. `eids` means
// these entities, whole. `about` is the reverse direction: the entities whose
// reference columns point at these — the delete cascade's question, and a
// membership check's too, since a grant is an entity that references both an
// app and a person, so "everything about this actor" is one read where "their
// grant, and their seat" would be two. `comps` narrows which components an
// `about` looks through, so asking about a person does not drag back everything
// they ever created.
//
// Forgetting to declare A read is not an error. `wants` is written by a plugin
// this package has never seen, and one that forgets an eid must still get a
// correct answer — so the transaction built here falls back to the storage for
// anything it was not asked for, and caches the result. The cost of a forgotten
// ask is then exactly the round trip it would have saved, which is a number a
// test can measure (@yaks/d1's `hops_test.ts`), rather than a change that fails
// in production and passes in the test.
//
// The gather is also where an asynchronous storage becomes a single await: one
// `tx.get`, plus one reverse read when something asked `about`. That second one
// is a round trip, not just a query: an `about` finds the matching entities
// with one statement and then has to read them whole, which over a network is
// two waits unless the read of those entities can identify them by the query
// that found them. `Tx.whole` (./storage.ts) is the method for that, and `seek`
// below is where it is called, so an `about` costs one round trip on any
// adapter that offers it. Everything the hooks ask afterwards is answered from
// memory, synchronously, so the phases between them stay a plain loop
// (./pipe.ts).

import { and, eq, or, type Query as Ast } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Eid } from './bundle.ts'
import { comps } from './bundle.ts'
import type { Tx } from './storage.ts'
import { then } from './pipe.ts'

/**
 * One read a phase needs taken before it runs. Both directions are optional
 * and one ask may use both; an ask that uses neither reads nothing.
 */
export type Ask = {
  /** these entities, whole */
  eids?: Eid[]
  /** just these components, which is enough until something reads the whole
   * entity or writes to it. Omit it to read the whole entity; an ask for the
   * whole entity always wins over an ask for a subset. */
  select?: string[]
  /** the entities whose reference columns point at these */
  about?: Eid[]
  /** which components an `about` looks through (default: every component that
   * declares a reference column) */
  comps?: string[]
}

/**
 * What one gather read. `got` holds the entities it was asked for by id, with
 * `null` for one the storage does not hold; `near` is keyed by column AND
 * target, so a later ask through a narrower set of components can tell what
 * was already covered from what was not, and a write can re-index what
 * changed.
 */
export type Snap = {
  /** the entities asked for by id, `null` for one that does not exist */
  got: Map<Eid, Bundle | null>
  /** per `comp.prop <eid>`, the entities whose column points at that eid */
  near: Map<string, Bundle[]>
  /** the (component, column, target) triples `near` is keyed by */
  pairs: [string, string, Eid][]
  /** for entities read with `select`, which components have been read so far */
  only?: Map<Eid, Set<string>>
}

/** The key one reverse read is filed under. */
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
  eids.length
    ? cols(vocab, names).flatMap(([c, p]) =>
      eids.map((e) => [c, p, e] as [string, string, Eid])
    )
    : []

/**
 * The query that finds everything whose reference columns point at one of
 * these targets: one disjunction over (column, target), so what would have
 * been one read per column per entity is a single read. `null` when there is
 * nothing to ask.
 */
export let pointing = (pairs: [string, string, Eid][]): Ast | null =>
  pairs.length ? and(or(...pairs.map(([c, p, e]) => eq(`${c}.${p}`, e)))) : null

// Run a pointing query. It selects a set — a disjunction of equalities, never
// a windowed query — which is exactly what `Tx.whole` promises to answer in a
// single round trip, so every reverse read goes through here rather than
// `read`. An adapter without `whole` falls back to `read` and gets the same
// result.
let seek = (tx: Tx, q: Ast): Bundle[] | Promise<Bundle[]> =>
  (tx.whole ?? tx.read)(q)

// The value of one reference column, as an eid or nothing.
let at = (b: Bundle, comp: string, prop: string): Eid | undefined => {
  let v = (b[comp] as Comp | undefined)?.[prop]
  return v == null ? undefined : String(v)
}

// Index each row under every triple it satisfies, so one read answers many
// asks.
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

// The same bundle found through two different columns is returned once.
let once = (rows: Bundle[]): Bundle[] => {
  let seen = new Set<Eid>()
  return rows.filter((b) => !seen.has(b.entity.eid) && !!seen.add(b.entity.eid))
}

/**
 * A patch folded into what the snapshot holds: a null component removes it,
 * anything else merges in, so an omitted column keeps its value and a null one
 * clears it. That is the same rule ./mutate.ts gives the storage, implemented
 * again here because a hook that writes in a gathered phase has to be visible
 * to the hook after it (yaks.app's vouch writes the grant its own membership
 * check then reads), and because a rule is evaluated against exactly this
 * merge (./rules.ts).
 */
export let merged = (held: Bundle | null, b: Bundle): Bundle => {
  let out: Bundle = { ...(held ?? { entity: b.entity }) }
  if (b.entity.archetype !== undefined) {
    out.entity = { ...out.entity, archetype: b.entity.archetype }
  }
  for (let [name, comp] of comps(b)) {
    if (comp == null) delete out[name]
    else out[name] = { ...(out[name] as Comp | undefined ?? {}), ...comp }
  }
  return out
}

/**
 * Every entity a change names or references — what the core itself reads, and
 * what a storage adapter needs while writing. Passed to the gather as its
 * first ask, so `apply()` reads all of them from the database once.
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
 * Satisfy every ask at once: one `tx.get` for the entities named by id, and
 * one `tx.read` for everything referencing the entities asked about. Each is
 * skipped when nothing asked for it, so a change nobody needs to read around
 * costs nothing.
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
  // Reading a set of entities, or reading in reverse, already spreads the cost
  // of a whole read over many rows. Only the single-entity case gains anything
  // from deferring the components nobody asked for.
  let narrow = tx.pick && named.length == 1 && !back.length &&
    asks.every((a) => !a.eids?.length || a.select != null)
  let selected = new Set(['tombstone', ...asks.flatMap((a) => a.select ?? [])])
  let rows = !named.length
    ? []
    : narrow
    ? tx.pick!(named, [...selected])
    : tx.get(named)
  return then(rows, (found) => {
    for (let e of named) snap.got.set(e, null)
    for (let b of found) snap.got.set(b.entity.eid, b)
    if (narrow) snap.only = new Map(found.map((b) => [b.entity.eid, selected]))
    let q = pointing(back)
    if (!q) return snap
    return then(seek(tx, q), (rows) => {
      file(snap, back, rows)
      return snap
    })
  })
}

/** Read the rest of any partially-read entity, before anything writes or
 * before a phase that needs the whole entity to evaluate its rules. Only
 * compiled SQL is cached across applies, never row values. */
export let complete = (tx: Tx, snap: Snap): void | Promise<void> => {
  if (!snap.only?.size) return
  return then(tx.get([...snap.only.keys()]), (rows) => {
    let found = new Map(rows.map((b) => [b.entity.eid, b]))
    for (let [eid, selected] of snap.only!) {
      let b = found.get(eid)
      let held = snap.got.get(eid)
      // The calling program may have kept a reference to this very bundle for
      // its own lifecycle policy. Fill it in place before the first write can
      // consult that policy, preserving the values (and the absences) already
      // observed for the components that were read first.
      if (b && held) {
        for (let [name, comp] of comps(b)) {
          if (!selected.has(name)) held[name] = comp
        }
      } else snap.got.set(eid, b ?? null)
    }
    snap.only!.clear()
  })
}

/**
 * The transaction the hooks receive: the storage's own, with `get` and `about`
 * answered from what the gather read, and every `patch` made through it folded
 * back into the snapshot so the next hook sees what the one before it wrote.
 *
 * Anything the gather was not asked for is read from the storage and cached,
 * so a `wants` that forgot something costs a round trip rather than returning
 * a wrong answer. `read` is not answered from the snapshot at all: evaluating
 * a query is the storage's job, and doing it here would mean a second query
 * engine in the core.
 *
 * Only the phases that run before the change is written get one — a snapshot
 * of the graph as the change found it is exactly what a precondition needs,
 * and exactly what a phase reading after the write must not have. That is why
 * the cascade does a fresh gather of its own.
 */
export let holding = (tx: Tx, vocab: Vocab, snap: Snap): Tx => ({
  ...tx,
  // Not the storage's own delete cascade: it would answer about the rows the
  // storage holds, and this transaction is the one place where a hook's
  // pending write is not among them. A phase reading through the snapshot
  // walks the references instead (./cascade.ts `doomed`).
  doom: undefined,
  patch: (bundles) =>
    then(
      bundles.length ? complete(tx, snap) : undefined,
      () =>
        then(tx.patch(bundles), (born) => {
          for (let b of bundles) {
            let eid = b.entity.eid
            let held = merged(snap.got.get(eid) ?? null, b)
            if (snap.got.has(eid)) snap.got.set(eid, held)
            // Re-index it: what it references now, and what it no longer
            // references.
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
    ),
  remove: (entities) => then(complete(tx, snap), () => tx.remove(entities)),
  pick: (eids, names) => {
    if (
      eids.every((e) =>
        snap.got.has(e) &&
        (!snap.only?.has(e) || names.every((n) => snap.only!.get(e)!.has(n)))
      )
    ) {
      return eids.flatMap((e) => snap.got.get(e) ?? [])
    }
    return holding(tx, vocab, snap).get(eids)
  },
  get: (eids) => {
    if (eids.some((e) => snap.only?.has(e))) {
      return then(complete(tx, snap), () => holding(tx, vocab, snap).get(eids))
    }
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
 * The entities whose reference columns point at one of `eids` — from the
 * gather when some `wants` asked for them, and from the storage when none did.
 * This is the one function a phase or a hook reads references backwards
 * through.
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
