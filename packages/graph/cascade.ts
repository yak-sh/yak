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

import { and, eq } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { Bundle, Eid } from './bundle.ts'
import { tombstoned } from './bundle.ts'
import type { Tx } from './storage.ts'
import type { State } from './state.ts'
import { over, then } from './pipe.ts'

// The entities whose `comp.prop` reference points at `eid`, read through the
// transaction so the walk sees this batch's own writes.
let pointing = (
  tx: Tx,
  comp: string,
  prop: string,
  eid: Eid,
): Eid[] | Promise<Eid[]> =>
  then(
    tx.read(and(eq(`${comp}.${prop}`, eid))),
    (bs) => bs.map((b) => b.entity.eid),
  )

/**
 * The transitive closure of `cascade` references over a set of dying entities:
 * everything that exists ABOUT one of them dies with it, and so does anything
 * about THAT. Breadth-first over a growing worklist, so a chain all falls.
 *
 * This phase's own worklist, exported because a plugin sometimes has to know
 * who is about to die BEFORE they do — an observer that reads a casualty's
 * components has one chance, before the rows go.
 */
export let doomed = (
  tx: Tx,
  vocab: Vocab,
  killed: Eid[],
): Eid[] | Promise<Eid[]> => {
  let list = [...killed]
  let cols = vocab.deaths('cascade')
  let walk = (i: number): Eid[] | Promise<Eid[]> => {
    if (i >= list.length) return list
    return then(
      over(
        cols,
        ([comp, prop]) =>
          then(pointing(tx, comp, prop, list[i]), (owners) => {
            for (let o of owners) if (!list.includes(o)) list.push(o)
          }),
      ),
      () => walk(i + 1),
    )
  }
  return walk(0)
}

// A soft reference letting go: `detach` nulls the column, `release` drops the
// whole row. Only SURVIVORS get a change — a casualty's own tombstone already
// says everything about it.
let loosen = (
  tx: Tx,
  vocab: Vocab,
  gone: Eid[],
  word: 'detach' | 'release',
): Bundle[] | Promise<Bundle[]> => {
  let out: Bundle[] = []
  return then(
    over(
      vocab.deaths(word),
      ([comp, prop]) =>
        over(gone, (eid) =>
          then(pointing(tx, comp, prop, eid), (owners) => {
            for (let o of owners) {
              if (gone.includes(o)) continue
              out.push({
                entity: { eid: o },
                [comp]: word == 'detach' ? { [prop]: null } : null,
              })
            }
          })),
    ),
    () => out.length ? then(tx.patch(out), () => out) : out,
  )
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
  return then(
    doomed(tx, vocab, st.killed),
    (gone) =>
      then(
        loosen(tx, vocab, gone, 'release'),
        (released) =>
          then(loosen(tx, vocab, gone, 'detach'), (detached) =>
            then(
              tx.remove(gone.map((eid) => ({ eid }))),
              () => [
                ...bundles,
                ...released,
                ...detached,
                // The entities that died because something else did. The ones the
                // batch named are already in it, wearing their own delete.
                ...gone.filter((eid) => !st.killed.includes(eid))
                  .map((eid) => tombstoned({ eid })),
              ],
            )),
      ),
  )
}
