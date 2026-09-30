// The mutate phase: the patches are written. Everything interesting has
// already been decided — admission narrowed the change to what this vocabulary
// declares, and the preconditions held — so what is left is to hand the live
// bundles to the transaction and record the ids storage assigned.
//
// The one rule this phase owns is how a write meets a tombstone. A deleted
// entity is tombstoned, never erased: its identity keeps its eid and its
// number. A write that raced the delete — one whose `$was` names a value read
// before it — is swallowed, so an edit made against a view from before the
// delete loses deterministically. Any other write clears the tombstone and
// lands: the entity is back, with its eid, its number, and exactly the
// components that write gives it. Within one change, a patch after the
// change's own delete of an entity is dropped: the change said both, and the
// delete is what the cascade acts on.
//
// An event is a component that lives no time (`durable: "0s"`): the rules
// have read it, and it is never written. It leaves the change here, so
// nothing stamps or journals it (a journal that recorded one would have undo
// restore what was never stored), and rejoins it after the journal, on its
// entity, for whoever hears the applied change (`State.heard`). A bundle of
// nothing but events leaves whole.

import { after } from '@yaks/fp'
import type { Bundle } from './bundle.ts'
import { comps, dead, gives, raced } from './bundle.ts'
import type { Tx } from './storage.ts'
import type { State } from './state.ts'
import { durableOf, ms, type Vocab } from '@yaks/vocab'

// The components a vocabulary declares as events, found once.
let known = new WeakMap<Vocab, Set<string>>()
let eventsOf = (vocab: Vocab): Set<string> => {
  let found = known.get(vocab)
  if (!found) {
    found = new Set(
      vocab.all.filter((c) => ms(durableOf(vocab, c)) === 0),
    )
    known.set(vocab, found)
  }
  return found
}

// A bundle as it is written: without its events.
let written = (b: Bundle, events: Set<string>): Bundle => {
  if (!events.size || !comps(b).some(([c]) => events.has(c))) return b
  let out = { ...b }
  for (let c of events) delete out[c]
  return out
}

// A bundle's events alone, said of its entity.
let said = (b: Bundle, events: Set<string>): Bundle => ({
  entity: b.entity,
  ...Object.fromEntries(comps(b).filter(([c]) => events.has(c))),
})

/** The change with what was heard and never written back in it, each on its
 * entity's bundle, or beside the others where the change wrote nothing of
 * that entity. */
export let rejoin = (bundles: Bundle[], heard: Bundle[]): Bundle[] => {
  let out = [...bundles]
  let at = new Map(out.map((b, i) => [b.entity.eid, i]))
  for (let h of heard) {
    let i = at.get(h.entity.eid)
    if (i == null) at.set(h.entity.eid, out.push(h) - 1)
    else out[i] = { ...out[i], ...h, entity: out[i].entity }
  }
  return out
}

/**
 * The mutate phase: write the change's live bundles, swallow the ones that
 * raced a delete, revive a deleted entity any other write gives a component,
 * and record which entities were deleted and which were created. Delete
 * bundles stay in the change — the cascade phase is what acts on them.
 */
export let mutate = (
  bundles: Bundle[],
  tx: Tx,
  st: State,
  vocab: Vocab,
): Bundle[] | Promise<Bundle[]> => {
  let events = eventsOf(vocab)
  let eids = [...new Set(bundles.map((b) => b.entity.eid))]
  return after(tx.get(eids), (found) => {
    // Deleted before this change began: a write may bring one back.
    let buried = new Set(
      found.filter((b) => dead(b)).map((b) => b.entity.eid),
    )
    // Deleted by this change: nothing later in it writes to one.
    let gone = new Set<string>()
    let live: Bundle[] = []
    let back: string[] = []
    let kept = bundles.flatMap((b): Bundle[] => {
      let eid = b.entity.eid
      if (gone.has(eid)) return []
      if (buried.has(eid)) {
        // Deleting it again is nothing, a write that raced its delete is
        // swallowed, and one that gives no component has nothing to bring
        // back. Any other write revives it.
        if (dead(b) || raced(b) || !gives(b)) return []
        buried.delete(eid)
        back.push(eid)
      }
      if (dead(b)) {
        gone.add(eid)
        if (!st.killed.includes(eid)) st.killed.push(eid)
        return [b]
      }
      let w = written(b, events)
      if (w != b) {
        st.heard.push(said(b, events))
        if (!comps(w).length) return []
      }
      live.push(w)
      if (comps(w).length) st.touched.add(eid)
      return [w]
    })
    if (!live.length) return kept
    return after(
      back.length ? tx.revive(back) : undefined,
      () =>
        after(tx.patch(live), (born) => {
          st.born.push(...born)
          for (let e of born) st.touched.add(e.eid)
          return kept
        }),
    )
  })
}
