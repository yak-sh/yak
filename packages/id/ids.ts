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
// that way. A content-addressed eid has no dashes, so the bare hex is asked
// for as well. Two entities starting the same way are no answer. A handle
// carries no letter, so one written with a letter (`T#47e9678bdf`) names
// nothing and is refused, rather than taken for an eid of that spelling.
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

/** The reads that find every entity whose eid starts as this hex does, in
 * either shape: the range from the prefix to just past it (`g` sorts after
 * every hex digit and the dash). */
let starting = (tx: Tx, hex: string): (Bundle[] | Promise<Bundle[]>)[] =>
  [...new Set([dashed(hex), hex])].map((p) =>
    tx.read(`.entity.eid=${p}..${p}g`)
  )

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
    let at = new Map<string, Eid | null>()
    for (let id of lettered) at.set(id, null)
    if (!want.size && !handles.length) return at
    for (let id of [...want.values()].flat()) at.set(id, null)
    let wore = (found: Bundle[]) => {
      for (let b of found) {
        for (let id of want.get(Number(b.entity.num)) ?? []) {
          at.set(id, b.entity.eid)
        }
      }
    }
    let held = (id: string, found: Bundle[]) => {
      let hex = id.slice(1).toLowerCase()
      let hits = new Map<Eid, Bundle>()
      for (let b of found) {
        if (b.entity.eid.replaceAll('-', '').startsWith(hex)) {
          hits.set(b.entity.eid, b)
        }
      }
      let [only] = hits.values()
      at.set(id, hits.size == 1 ? only.entity.eid : null)
    }
    // Each read, and the handle it answers for (none: the numbers).
    let reads: [string | null, Bundle[] | Promise<Bundle[]>][] = []
    if (want.size) {
      reads.push([null, tx.read(`.entity.num=${[...want.keys()].join(',')}`)])
    }
    for (let id of handles) {
      for (let r of starting(tx, id.slice(1).toLowerCase())) {
        reads.push([id, r])
      }
    }
    let done = (got: Bundle[][]) => {
      let by = new Map<string, Bundle[]>()
      got.forEach((found, i) => {
        let id = reads[i][0]
        if (id == null) wore(found)
        else by.set(id, [...by.get(id) ?? [], ...found])
      })
      for (let id of handles) held(id, by.get(id) ?? [])
      return at
    }
    let answers = reads.map(([, r]) => r)
    return answers.some((r) => r instanceof Promise)
      ? Promise.all(answers).then(done)
      : done(answers as Bundle[][])
  },
})
