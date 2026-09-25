// The id a person types, resolved to the eid it names. `T-37580` is stored
// nowhere: what is stored is the number beside the entity, and the letter is
// derived from the components the entity has (./id.ts). So resolving one is a
// read — find the entity carrying that number, and check which letters it could
// be printed with.
//
// This is a graph plugin's `address`, which @yaks/graph calls before a caller's
// ids are used, so every entry point accepts the ids people type: the MCP
// server, the HTTP `/query` endpoint, the command line, a write. A bare number
// (`37580`) resolves too, because the number is the identity. An id written
// this way that finds no entity wearing its number and letter is answered
// `null`: it names nothing, and it is no eid either, so the graph refuses it
// instead of minting an entity whose eid is the string `T-998`.
//
// The short handle an entity shows before it is numbered (`T#47e9678bdf`, see
// ./id.ts `short`) resolves here too. It is the start of the eid with the
// dashes taken out, and a uuid's dashes sit at fixed places, so the handle is
// put back into the eid's own shape and read as a range: every eid that starts
// that way. A content-addressed eid has no dashes, so the bare hex is asked
// for as well. Two entities starting the same way are no answer, and neither
// is a letter the entity cannot be printed with.
//
// Every write asks about the ids it names, and most name none of these, so
// that answer comes back without a promise and a synchronous store's writes
// stay synchronous — the branch @yaks/graph's `then` hides, written out as in
// ./number.ts.

import type { Bundle, Eid, Plugin, Tx } from './graph.ts'
import { parse, prefixOf, SHORT } from './id.ts'
import type { Vocab } from '@yaks/vocab'

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
export let ids = (vocab: Vocab): Plugin => {
  let letter = prefixOf(vocab)
  // Every letter this entity could be printed with, not only the one it
  // displays as. An entity has several kinds at once — a task is a `doc` too —
  // and a person typing `T-17` for the thing to do is right whichever kind
  // happens to win the display.
  let series = (b: Bundle) =>
    new Set(vocab.kinds.filter((k) => b[k]).map((k) => letter(k)))
  let agrees = (b: Bundle, prefix: string) =>
    !prefix || series(b).has(prefix.toUpperCase())
  return {
    name: 'ids',
    address: (tx, said) => {
      // One read for every number asked for, as a single any-of filter, and
      // one per handle.
      let want = new Map<number, string[]>()
      let handles: string[] = []
      for (let id of said) {
        let p = parse(id)
        if (p) want.set(p.num, [...want.get(p.num) ?? [], id])
        else if (SHORT.test(id)) handles.push(id)
      }
      let at = new Map<string, Eid | null>()
      if (!want.size && !handles.length) return at
      for (let id of [...want.values()].flat()) at.set(id, null)
      let wore = (found: Bundle[]) => {
        for (let b of found) {
          for (let id of want.get(Number(b.entity.num)) ?? []) {
            let p = parse(id)
            if (p && agrees(b, p.prefix)) at.set(id, b.entity.eid)
          }
        }
      }
      let held = (id: string, found: Bundle[]) => {
        let [prefix, hex] = id.toLowerCase().split('#')
        let hits = new Map<Eid, Bundle>()
        for (let b of found) {
          if (b.entity.eid.replaceAll('-', '').startsWith(hex)) {
            hits.set(b.entity.eid, b)
          }
        }
        let [only] = hits.values()
        at.set(
          id,
          hits.size == 1 && agrees(only, prefix) ? only.entity.eid : null,
        )
      }
      // Each read, and the handle it answers for (none: the numbers).
      let reads: [string | null, Bundle[] | Promise<Bundle[]>][] = []
      if (want.size) {
        reads.push([null, tx.read(`.entity.num=${[...want.keys()].join(',')}`)])
      }
      for (let id of handles) {
        for (let r of starting(tx, id.split('#')[1].toLowerCase())) {
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
  }
}
