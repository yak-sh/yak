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
// It reads BACKWARDS — who points at the dying — and that is one question, not
// one per column per casualty: `about()` (./gather.ts) asks it as a single
// disjunction over (column, target), and this phase takes its own gather
// because it runs AFTER the patches and has to see the batch's own writes.

import type { Death, Vocab } from '@yaks/vocab'
import type { Bundle, Comp, Eid } from './bundle.ts'
import { tombstoned } from './bundle.ts'
import type { Tx } from './storage.ts'
import type { State } from './state.ts'
import { about, gather, holding } from './gather.ts'
import { then } from './pipe.ts'

// The components that carry a reference wearing one of these death words —
// what an `about` has to look through, and nothing wider.
let bearing = (vocab: Vocab, words: Death[]): string[] => [
  ...new Set(words.flatMap((w) => vocab.deaths(w).map(([comp]) => comp))),
]

// The value of one reference column on a bundle, or null.
let at = (b: Bundle, comp: string, prop: string): Eid | null => {
  let v = (b[comp] as Comp | undefined)?.[prop]
  return v == null ? null : String(v)
}

/**
 * The transitive closure of `cascade` references over a set of dying entities:
 * everything that exists ABOUT one of them dies with it, and so does anything
 * about THAT. Breadth-first over the frontier, one backwards read per level, so
 * a chain all falls for a read per rung rather than a read per column per link.
 *
 * This phase's own worklist, exported because a plugin sometimes has to know
 * who is about to die BEFORE they do — an observer that reads a casualty's
 * components has one chance, before the rows go.
 */
export let doomed = (
  tx: Tx,
  vocab: Vocab,
  killed: Eid[],
  // Which components the walk reads through. It only ever JUDGES by the
  // cascade columns; a caller that will need the soft references of the same
  // casualties hands a wider set so one read serves both walks.
  look: string[] = bearing(vocab, ['cascade']),
): Eid[] | Promise<Eid[]> => {
  let list = [...killed]
  let cols = vocab.deaths('cascade')
  if (!cols.length) return list
  let walk = (front: Eid[]): Eid[] | Promise<Eid[]> => {
    if (!front.length) return list
    return then(about(tx, vocab, front, look), (owners) => {
      let next: Eid[] = []
      for (let b of owners) {
        let eid = b.entity.eid
        if (list.includes(eid)) continue
        let dies = cols.some(([comp, prop]) => {
          let to = at(b, comp, prop)
          return to != null && front.includes(to)
        })
        if (!dies) continue
        list.push(eid)
        next.push(eid)
      }
      return walk(next)
    })
  }
  return walk([...killed])
}

// A soft reference letting go: `detach` nulls the column, `release` drops the
// whole row. Only SURVIVORS get a change — a casualty's own tombstone already
// says everything about it. Both words read the same backwards answer, so it is
// taken once and each word picks its own columns out of it.
let loosen = (
  tx: Tx,
  vocab: Vocab,
  owners: Bundle[],
  gone: Eid[],
  word: 'detach' | 'release',
): Bundle[] | Promise<Bundle[]> => {
  let out: Bundle[] = []
  for (let [comp, prop] of vocab.deaths(word)) {
    for (let eid of gone) {
      for (let b of owners) {
        let o = b.entity.eid
        if (gone.includes(o) || at(b, comp, prop) != eid) continue
        out.push({
          entity: { eid: o },
          [comp]: word == 'detach' ? { [prop]: null } : null,
        })
      }
    }
  }
  return out.length ? then(tx.patch(out), () => out) : out
}

/**
 * The cascade phase: work out everything that dies with what this batch
 * deleted, let the soft references go, remove the casualties, and synthesize a
 * bundle for each of them into the batch. A caller who applies the returned
 * batch to a cache ends up exactly where the graph is.
 *
 * The gather is its own, and taken here rather than with the batch's: this
 * phase runs after `mutate`, so who points at the dying is a question about the
 * graph AS THE BATCH LEAVES IT, not as it found it.
 */
export let cascade = (
  bundles: Bundle[],
  tx: Tx,
  vocab: Vocab,
  st: State,
): Bundle[] | Promise<Bundle[]> => {
  if (!st.killed.length) return bundles
  let soft = bearing(vocab, ['detach', 'release'])
  let look = [...new Set([...bearing(vocab, ['cascade']), ...soft])]
  return then(
    gather(tx, vocab, [{ about: st.killed, comps: look }]),
    (snap) => {
      let held = holding(tx, vocab, snap)
      return then(doomed(held, vocab, st.killed, look), (gone) =>
        // The soft references of everything that died, including the casualties
        // the walk turned up — one read, and none at all when the batch's own
        // deletes were the whole of it.
        then(about(held, vocab, gone, soft), (owners) =>
          then(
            loosen(tx, vocab, owners, gone, 'release'),
            (released) =>
              then(loosen(tx, vocab, owners, gone, 'detach'), (detached) =>
                then(
                  tx.remove(gone.map((eid) => ({ eid }))),
                  () => [
                    ...bundles,
                    ...released,
                    ...detached,
                    // The entities that died because something else did. The
                    // ones the batch named are already in it, wearing their own
                    // delete.
                    ...gone.filter((eid) => !st.killed.includes(eid))
                      .map((eid) => tombstoned({ eid })),
                  ],
                )),
          )))
    },
  )
}
