// What a delete takes with it. Each reference column declares in the
// vocabulary what should happen to it when the entity it points AT is deleted,
// and this phase implements all four possibilities:
//
//   cascade  the referencing entity is deleted too — a review of a deleted
//            book has nothing left to be about
//   detach   the column is set to null and the referencing entity survives — a
//            book whose publisher is deleted is still a book
//   release  the referencing component ROW is deleted, its entity survives — a
//            bookmark whose whole reason to exist was to point at something
//   keep     the reference stays as history — the tombstone is the record
//
// The GRAPH decides what is deleted; storage only removes what it is told to.
// That split is the point: a cascade rule is about meaning, it is written in
// the vocabulary, and every storage adapter gets it without reimplementing it
// in SQL. Every surviving entity's change is added back into the change the
// caller gets, so a client cache that applies the return value keeps no stale
// rows.
//
// It reads references BACKWARDS — what points at the entities being deleted —
// and that is ONE question: everything deleted along with these, and every
// reference that has to be cleared (`Doom`, ./storage.ts). A storage adapter
// that can compile the whole closure asks it as one statement (@yaks/sql's
// `doomSql`); one that cannot is walked here instead, with one reverse read
// per level through `about()` (./gather.ts). Either way the question is asked
// AFTER the patches are written, because what points at the entities being
// deleted is a question about the graph as this change LEAVES it.

import type { Death, Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Eid } from './bundle.ts'
import { tombstoned } from './bundle.ts'
import type { Doom, Gone, Loose, Tx } from './storage.ts'
import type { State } from './state.ts'
import { about, gather, holding } from './gather.ts'
import { then } from './pipe.ts'

// The components holding a reference declared with one of these death
// behaviors — exactly what an `about` read has to look through, and nothing
// wider.
let bearing = (vocab: Vocab, words: Death[]): string[] => [
  ...new Set(words.flatMap((w) => vocab.deaths(w).map(([comp]) => comp))),
]

// The two behaviors that clear a reference without deleting the referencing
// entity, in the order their patches are built.
let SOFT: Death[] = ['release', 'detach']

// The value of one reference column on a bundle, or null.
let at = (b: Bundle, comp: string, prop: string): Eid | null => {
  let v = (b[comp] as Comp | undefined)?.[prop]
  return v == null ? null : String(v)
}

// Sort a reverse read's results in the order the entities were CREATED, not
// the order the read happened to return them in — which is per column, so an
// entity referencing a deleted one through two columns would land wherever the
// first column put it. The single-statement version returns that order too, so
// a client applying the change cannot tell which path produced it.
let born = (bundles: Bundle[]): Bundle[] =>
  [...bundles].sort((a, b) => (a.entity.num ?? 0) - (b.entity.num ?? 0))

// The transitive closure, walked: breadth-first, one reverse read per level,
// so a whole chain costs one read per level rather than one read per column
// per link.
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
 * The transitive closure of `cascade` references over a set of entities being
 * deleted: everything that exists ABOUT one of them is deleted with it, and so
 * is anything that exists about THAT.
 *
 * This is the phase's own worklist, exported because a plugin sometimes has to
 * know which entities are about to be deleted BEFORE they are — an observer
 * that reads a doomed entity's components has one chance, before the rows go.
 * It always WALKS the references: a plugin calls it in the phases that read
 * from the gather, where storage's own single-statement answer would be about
 * rows this change has not written yet.
 */
export let doomed = (
  tx: Tx,
  vocab: Vocab,
  killed: Eid[],
  // Which components the walk reads through. It only ever DECIDES by the
  // cascade columns; a caller that will also need the detach/release
  // references of the same entities passes a wider set, so one read serves
  // both.
  look: string[] = bearing(vocab, ['cascade']),
): Eid[] | Promise<Eid[]> =>
  then(walk(tx, vocab, killed, look), (gone) => gone.map((g) => g.eid))

// The detach/release references into a set of deleted entities, read out of
// the bundles that point at them. Only SURVIVING entities need their
// references cleared — a deleted entity's own tombstone covers the rest.
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

// What is deleted, and which references are cleared: storage's own answer when
// it has one, and the walk when it does not. The walk does a gather of its own
// — this phase runs after `mutate`, so it must see this change's own writes —
// and reads the cascade columns together with the detach/release ones, so one
// reverse read serves both.
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
        // The detach/release references into everything deleted, including
        // the entities the walk turned up — one read, and no read at all when
        // this change's own deletes were all of it.
        return then(about(held, vocab, dead, soft), (owners) => ({
          gone,
          loose: letting(vocab, born(owners), dead),
        }))
      })
    })
  return tx.doom ? then(tx.doom(killed), (told) => told ?? walked()) : walked()
}

// Clearing a reference: `detach` sets the column to null, `release` removes
// the whole component row. One patch per row that has to be cleared, in the
// vocabulary's column order — the same order however the answer was
// obtained.
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
 * The cascade phase: work out everything that is deleted along with what this
 * change deleted, clear the detach and release references, remove those
 * entities, and add a bundle for each of them to the change. A caller that
 * applies the returned change to a cache ends up exactly where the graph is.
 */
export let cascade = (
  bundles: Bundle[],
  tx: Tx,
  vocab: Vocab,
  st: State,
): Bundle[] | Promise<Bundle[]> => {
  if (!st.killed.length) return bundles
  return then(reckon(tx, vocab, st.killed), ({ gone, loose }) => {
    // The entities the change named come first, whatever order the answer
    // arrived in: they are deleted because the caller said so, and an entity
    // storage has never heard of is still one of them.
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
              // The entities deleted because something else was. The ones the
              // change named are already in it, carrying their own delete.
              ...dead.filter((eid) => !st.killed.includes(eid))
                .map((eid) => tombstoned({ eid })),
            ],
          )),
    )
  })
}
