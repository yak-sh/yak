// Death, and what it spreads to. A reference column declares in the
// vocabulary what happens to it when the entity it points AT dies, and this
// phase is the whole of that meaning:
//
//   cascade  the referencing entity dies too — a review of a deleted book has
//            nothing left to be about
//   detach   the column is nulled and the survivor stays — a book whose
//            publisher is deleted is still a book
//   release  the referencing ROW dies, its entity lives — a bookmark whose
//            whole reason to exist was to point at something
//   keep     the reference stands as history — the tombstone is the mark
//
// The GRAPH decides who dies; storage only removes what it is told. That split
// is the point: a cascade is a rule about meaning, written in the vocabulary,
// and every adapter gets it for free instead of reimplementing it in SQL.
// Every survivor's change is synthesized back into the batch, so a client
// cache that applies the return keeps no ghosts.
//
// It reads BACKWARDS — who points at the dying — and that is ONE question:
// everything that dies with these, and everything that has to let go of them
// (`Doom`, ./storage.ts). A storage that can compile the closure asks it as one
// statement (@yaks/sql's `doomSql`); one that cannot is walked here instead, a
// backwards read per rung through `about()` (./gather.ts). Either way the
// question is asked AFTER the patches, because who points at the dying is a
// question about the graph as the batch LEAVES it.

import type { Death, Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Eid } from './bundle.ts'
import { tombstoned } from './bundle.ts'
import type { Doom, Gone, Loose, Tx } from './storage.ts'
import type { State } from './state.ts'
import { about, gather, holding } from './gather.ts'
import { then } from './pipe.ts'

// The components that carry a reference wearing one of these death words —
// what an `about` has to look through, and nothing wider.
let bearing = (vocab: Vocab, words: Death[]): string[] => [
  ...new Set(words.flatMap((w) => vocab.deaths(w).map(([comp]) => comp))),
]

// The soft words, in the order their patches are made.
let SOFT: Death[] = ['release', 'detach']

// The value of one reference column on a bundle, or null.
let at = (b: Bundle, comp: string, prop: string): Eid | null => {
  let v = (b[comp] as Comp | undefined)?.[prop]
  return v == null ? null : String(v)
}

// A backwards read's answer in the order the entities were CREATED, not the
// order the read happened to find them in — which is per column, so an entity
// pointing at the dying through two of them lands wherever the first one was.
// The one statement answers in that order too, and a client applying the batch
// must not be able to tell which asked.
let born = (bundles: Bundle[]): Bundle[] =>
  [...bundles].sort((a, b) => (a.entity.num ?? 0) - (b.entity.num ?? 0))

// The transitive closure, walked: breadth-first over the frontier, one
// backwards read per level, so a chain all falls for a read per rung rather
// than a read per column per link.
let walk = (
  tx: Tx,
  vocab: Vocab,
  killed: Eid[],
  look: string[],
): Gone[] | Promise<Gone[]> => {
  let list: Gone[] = killed.map((eid) => ({ eid, depth: 0 }))
  let cols = vocab.deaths('cascade')
  if (!cols.length) return list
  let rung = (front: Eid[], depth: number): Gone[] | Promise<Gone[]> => {
    if (!front.length) return list
    return then(about(tx, vocab, front, look), (found) => {
      let next: Eid[] = []
      for (let b of born(found)) {
        let eid = b.entity.eid
        if (list.some((g) => g.eid == eid)) continue
        let dies = cols.some(([comp, prop]) => {
          let to = at(b, comp, prop)
          return to != null && front.includes(to)
        })
        if (!dies) continue
        list.push({ eid, depth })
        next.push(eid)
      }
      return rung(next, depth + 1)
    })
  }
  return rung([...killed], 1)
}

/**
 * The transitive closure of `cascade` references over a set of dying entities:
 * everything that exists ABOUT one of them dies with it, and so does anything
 * about THAT.
 *
 * This phase's own worklist, exported because a plugin sometimes has to know
 * who is about to die BEFORE they do — an observer that reads a casualty's
 * components has one chance, before the rows go. It is always the WALK: a
 * plugin asks it in the phases that read from the gather, where the storage's
 * own answer would be about rows the batch has not written yet.
 */
export let doomed = (
  tx: Tx,
  vocab: Vocab,
  killed: Eid[],
  // Which components the walk reads through. It only ever JUDGES by the
  // cascade columns; a caller that will need the soft references of the same
  // casualties hands a wider set so one read serves both walks.
  look: string[] = bearing(vocab, ['cascade']),
): Eid[] | Promise<Eid[]> =>
  then(walk(tx, vocab, killed, look), (gone) => gone.map((g) => g.eid))

// The soft references into a set of dead, read out of the bundles pointing at
// them. Only SURVIVORS let go — a casualty's own tombstone already says
// everything about it.
let letting = (
  vocab: Vocab,
  owners: Bundle[],
  gone: Eid[],
): Loose[] => {
  let cols = SOFT.flatMap((w) => vocab.deaths(w))
  let out: Loose[] = []
  for (let b of owners) {
    let eid = b.entity.eid
    if (gone.includes(eid)) continue
    for (let [comp, prop] of cols) {
      let to = at(b, comp, prop)
      if (to != null && gone.includes(to)) out.push({ eid, comp, prop })
    }
  }
  return out
}

// Who dies, and what lets go: the storage's own answer when it has one, and
// the walk when it does not. The walk takes a gather of its own — this phase
// runs after `mutate`, so it must see the batch's own writes — and reads the
// cascade and soft columns together, so one backwards read serves both.
let reckon = (
  tx: Tx,
  vocab: Vocab,
  killed: Eid[],
): Doom | Promise<Doom> => {
  let soft = bearing(vocab, SOFT)
  let look = [...new Set([...bearing(vocab, ['cascade']), ...soft])]
  let walked = (): Doom | Promise<Doom> =>
    then(gather(tx, vocab, [{ about: killed, comps: look }]), (snap) => {
      let held = holding(tx, vocab, snap)
      return then(walk(held, vocab, killed, look), (gone) => {
        let dead = gone.map((g) => g.eid)
        // The soft references of everything that died, including the
        // casualties the walk turned up — one read, and none at all when the
        // batch's own deletes were the whole of it.
        return then(about(held, vocab, dead, soft), (owners) => ({
          gone,
          loose: letting(vocab, born(owners), dead),
        }))
      })
    })
  return tx.doom ? then(tx.doom(killed), (told) => told ?? walked()) : walked()
}

// A soft reference letting go: `detach` nulls the column, `release` drops the
// whole row. One patch per row that has to let go, in the vocabulary's column
// order — the same order however the answer was found.
let loosen = (
  tx: Tx,
  vocab: Vocab,
  loose: Loose[],
  word: 'detach' | 'release',
): Bundle[] | Promise<Bundle[]> => {
  let out: Bundle[] = []
  for (let [comp, prop] of vocab.deaths(word)) {
    for (let l of loose) {
      if (l.comp != comp || l.prop != prop) continue
      out.push({
        entity: { eid: l.eid },
        [comp]: word == 'detach' ? { [prop]: null } : null,
      })
    }
  }
  return out.length ? then(tx.patch(out), () => out) : out
}

/**
 * The cascade phase: work out everything that dies with what this batch
 * deleted, let the soft references go, remove the casualties, and synthesize a
 * bundle for each of them into the batch. A caller who applies the returned
 * batch to a cache ends up exactly where the graph is.
 */
export let cascade = (
  bundles: Bundle[],
  tx: Tx,
  vocab: Vocab,
  st: State,
): Bundle[] | Promise<Bundle[]> => {
  if (!st.killed.length) return bundles
  return then(reckon(tx, vocab, st.killed), ({ gone, loose }) => {
    // The named dead lead, whatever the answer's own order was: they are dying
    // by decree, and an entity the storage has never heard of is still one of
    // them.
    let dead = [...new Set([...st.killed, ...gone.map((g) => g.eid)])]
    return then(
      loosen(tx, vocab, loose, 'release'),
      (released) =>
        then(loosen(tx, vocab, loose, 'detach'), (detached) =>
          then(
            tx.remove(dead.map((eid) => ({ eid }))),
            () => [
              ...bundles,
              ...released,
              ...detached,
              // The entities that died because something else did. The ones the
              // batch named are already in it, wearing their own delete.
              ...dead.filter((eid) => !st.killed.includes(eid))
                .map((eid) => tombstoned({ eid })),
            ],
          )),
    )
  })
}
