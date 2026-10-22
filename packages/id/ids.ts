// The id a person types, resolved to the eid it names. `T-37580` is stored
// nowhere: what is stored is the number beside the entity, and the letter is
// derived from the components the entity has (./id.ts). So resolving one is a
// read: find the entity carrying that number.
//
// The number is the identity, and the letter is how the id was printed. An
// entity's components change, and its letter with them: a persona that wore a
// component with its own prefix printed as `R-131280` and prints as
// `N-131280` once that component is gone. The ids people hold in links,
// comments and tasks keep the letter they were printed with, so any letter
// names the entity carrying the number, and a bare number (`37580`) does too.
//
// This is a graph plugin's `address`, which @yaks/graph calls before a caller's
// ids are used, so every entry point accepts the ids people type: the MCP
// server, the HTTP `/query` endpoint, the command line, a write. An id written
// this way whose number no entity carries is answered `null`: it names
// nothing, and it is no eid either, so the graph refuses it instead of minting
// an entity whose eid is the string `T-998`.
//
// The short handle an entity shows before it is numbered (`#47e9678bdf`, see
// ./id.ts `short`) resolves here too. It is the start of the eid with the
// dashes taken out, and a uuid's dashes sit at fixed places, so the handle is
// put back into the eid's own shape and read as a range: every eid that starts
// that way (`starting`). A content-addressed eid has no dashes, so the bare hex
// is asked for as well. Two entities starting the same way are answered with
// both, and the graph refuses the handle naming them. A handle carries no
// letter, so one written with a letter (`T#47e9678bdf`) names nothing and is
// refused, rather than taken for an eid of that spelling. The same handle
// copied without its `#` is the graph's to resolve, after every other name
// (./id.ts `BARE`).
//
// Every write asks about the ids it names, and most name none of these, so
// that answer comes back without a promise and a synchronous store's writes
// stay synchronous — the branch @yaks/fp's `after` hides, written out as in
// ./number.ts.

import type { Bundle, Eid, Plugin, Tx } from './types.ts'
import { parse, SHORT } from './id.ts'
import type { Vocab } from '@yaks/vocab'

/** A short handle with a letter in front of its `#`, as handles were once
 * written. */
let LETTERED = /^[a-z]+#[0-9a-f]{6,64}$/i

/** A handle's hex with a uuid's dashes put back where they fall. */
let dashed = (hex: string): string =>
  [...hex].map((c, i) => ([8, 12, 16, 20].includes(i) ? '-' : '') + c)
    .join('')

/** Every eid that starts as this lowercase hex does, in either shape: a read
 * of the range from the prefix to just past it (`g` sorts after every hex
 * digit and the dash), once with a uuid's dashes put back and once as bare
 * hex. A bound of digits alone reads as a number, which an eid is never
 * ranged by, so such a range starts at the prefix and a dash instead: a dash
 * sorts before every hex digit, and an eid goes on with one or the other. */
export let starting = (
  tx: Pick<Tx, 'read'>,
  hex: string,
): Eid[] | Promise<Eid[]> => {
  let reads = [...new Set([dashed(hex), hex])].map((p) =>
    tx.read(`.entity.eid=${p}${/^\d+$/.test(p) ? '-' : ''}..${p}g`)
  )
  let held = (found: Bundle[][]) => [
    ...new Set(
      found.flat().map((b) => b.entity.eid)
        .filter((eid) => eid.replaceAll('-', '').startsWith(hex)),
    ),
  ]
  return reads.some((r) => r instanceof Promise)
    ? Promise.all(reads).then(held)
    : held(reads as Bundle[][])
}

/** Resolves human ids to eids, for a graph that numbers its entities. */
export let ids = (vocab: Vocab): Plugin => ({
  name: 'ids',
  address: (tx, said) => {
    // One read for every number asked for, as a single any-of filter, and
    // one per handle.
    let want = new Map<number, string[]>()
    let handles: string[] = []
    let lettered: string[] = []
    for (let id of said) {
      let p = parse(id)
      if (p) {
        if (vocab.prop('entity', 'num')) {
          want.set(p.num, [...want.get(p.num) ?? [], id])
        }
      } else if (SHORT.test(id)) handles.push(id)
      else if (LETTERED.test(id)) lettered.push(id)
    }
    let at = new Map<string, Eid | Eid[] | null>()
    for (let id of lettered) at.set(id, null)
    if (!want.size && !handles.length) return at
    for (let id of [...want.values()].flat()) at.set(id, null)
    let numbered = want.size
      ? tx.read(`.entity.num=${[...want.keys()].join(',')}`)
      : []
    let held = handles.map((id) => starting(tx, id.slice(1).toLowerCase()))
    let done = (found: Bundle[], starts: Eid[][]) => {
      for (let b of found) {
        for (let id of want.get(Number(b.entity.num)) ?? []) {
          at.set(id, b.entity.eid)
        }
      }
      handles.forEach((id, i) => {
        let eids = starts[i]
        at.set(id, eids.length == 1 ? eids[0] : eids.length ? eids : null)
      })
      return at
    }
    return numbered instanceof Promise || held.some((r) => r instanceof Promise)
      ? Promise.all([numbered, Promise.all(held)]).then(([f, e]) => done(f, e))
      : done(numbered, held as Eid[][])
  },
})
