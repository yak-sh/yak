// The id a person types, resolved to the eid it names. `T-37580` is the
// entity holding that pair, `entity{prefix: 'T', num: 37580}` (./id.ts), so
// resolving one is a read: find the entities carrying that number, and keep
// the one in its series.
//
// A row numbered before series had letters stores no prefix. Its letter was
// derived from its components, which change: a persona that wore a component
// with its own prefix printed as `R-131280` and prints as `N-131280` once that
// component is gone. The ids people hold keep the letter they were printed
// with, so such a row answers to its number under any letter, after an entity
// holding the pair itself. A bare number (`37580`) names the entity holding it
// while there is one; several, and the graph refuses it, naming them.
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
// both, and the graph refuses the handle naming them. A deleted entity keeps
// its handle as it keeps its number, so the handle still names it, unless a
// live entity starts the same way and takes it. A handle carries no
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
import { LETTERED, parse, type Parsed, SHORT } from './id.ts'
import type { Vocab } from '@yaks/vocab'
import { groupBy } from '@yaks/fp'

/** A handle's hex with a uuid's dashes put back where they fall. */
let dashed = (hex: string): string =>
  [...hex].map((c, i) => ([8, 12, 16, 20].includes(i) ? '-' : '') + c)
    .join('')

/** Every eid that starts as this lowercase hex does, the deleted too when no
 * live one does, in either shape: a read
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
    tx.read(`.entity.eid=${p}${/^\d+$/.test(p) ? '-' : ''}..${p}g`, {
      graves: true,
    })
  )
  let held = (found: Bundle[][]) => {
    let fit = found.flat()
      .filter((b) => b.entity.eid.replaceAll('-', '').startsWith(hex))
    let live = fit.filter((b) => !b.tombstone)
    return [...new Set((live.length ? live : fit).map((b) => b.entity.eid))]
  }
  return reads.some((r) => r instanceof Promise)
    ? Promise.all(reads).then(held)
    : held(reads as Bundle[][])
}

/** Of the entities holding one number, the eids an id of that number with
 * this letter names: the one holding the pair, else one stored without a
 * prefix, which answers under any letter; for a bare number (`''`), every
 * holder. The living, where any are. */
let holding = (found: Bundle[], prefix: string): Eid[] => {
  let fit = !prefix ? found : [
    found.filter((b) => b.entity.prefix == prefix),
    found.filter((b) => !b.entity.prefix),
  ].find((l) => l.length) ?? []
  let live = fit.filter((b) => !b.tombstone)
  return (live.length ? live : fit).map((b) => b.entity.eid)
}

/** Resolves human ids to eids, for a graph that numbers its entities. */
export let ids = (vocab: Vocab): Plugin => ({
  name: 'ids',
  address: (tx, said) => {
    // One read for every number asked for, as a single any-of filter, and
    // one per handle.
    let want = new Map<number, Parsed[]>()
    let typed = new Map<Parsed, string>()
    let handles: string[] = []
    let lettered: string[] = []
    for (let id of said) {
      let p = parse(id)
      if (p) {
        if (vocab.prop('entity', 'num')) {
          want.set(p.num, [...want.get(p.num) ?? [], p])
          typed.set(p, id)
        }
      } else if (SHORT.test(id)) handles.push(id)
      else if (LETTERED.test(id)) lettered.push(id)
    }
    let at = new Map<string, Eid | Eid[] | null>()
    for (let id of lettered) at.set(id, null)
    if (!want.size && !handles.length) return at
    for (let id of typed.values()) at.set(id, null)
    // A deleted entity keeps its number, so the number still names it.
    let numbered = want.size
      ? tx.read(`.entity.num=${[...want.keys()].join(',')}`, { graves: true })
      : []
    let held = handles.map((id) => starting(tx, id.slice(1).toLowerCase()))
    let done = (found: Bundle[], starts: Eid[][]) => {
      let by = groupBy(found, (b: Bundle) => Number(b.entity.num))
      for (let [num, asked] of want) {
        for (let p of asked) {
          let eids = holding(by.get(num) ?? [], p.prefix)
          if (eids.length) {
            at.set(typed.get(p)!, eids.length == 1 ? eids[0] : eids)
          }
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
