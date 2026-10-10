// The stored death cascade, asked by the writable graph inside its transaction.
import type { Vocab } from '@yaks/vocab'
import type { Doom, Gone } from '@yaks/graph'
import {
  ARMS,
  DEEP,
  doomSql,
  type Driver,
  looseSql,
  narrow,
  type Raw,
} from '@yaks/sql'

/**
 * The whole death cascade, computed by one statement rather than walked:
 * everything that dies with these entities, and every soft reference that has
 * to let go of them (@yaks/sql's `doomSql`/`looseSql`). @yaks/graph would
 * otherwise read once per rung of the chain — free here, a round trip each over
 * a network — and that walk is what an adapter unable to compile this still
 * gets.
 *
 * A statement carries as many terms as the driver says its engine allows
 * (@yaks/sql `Driver.arms`), so an embedded SQLite asks the whole cascade at
 * once. A vocabulary too wide for one statement (@yaks/sql `narrow`) is
 * queried in rounds: each statement is transitive within its own tables, so
 * the result is complete when a round turns up nothing the last one had not.
 *
 * Asked inside the transaction, after the batch's patches have gone in, which
 * is what makes the result the one the cascade wants: who points at the dying
 * as the batch leaves the graph.
 */
export let doom = (driver: Driver, vocab: Vocab, eids: string[]): Doom => {
  let ask = (s: Raw) => driver.query(s)
  let terms = driver.arms ?? ARMS
  let depth = new Map<string, number>()
  let gone: Gone[] = []
  let seed = eids
  let base = 0
  for (;;) {
    let fresh: string[] = []
    let least = DEEP
    for (let s of doomSql(vocab, seed, terms)) {
      for (let r of ask(s)) {
        let eid = String(r.eid)
        if (depth.has(eid)) continue
        let rung = base + Number(r.depth)
        depth.set(eid, rung)
        gone.push({ eid, depth: rung })
        fresh.push(eid)
        least = Math.min(least, rung)
      }
    }
    if (narrow(vocab, terms) || !fresh.length) break
    seed = fresh
    base = least
  }
  return {
    gone,
    loose: looseSql(vocab, [...depth.keys()], terms).flatMap((s) =>
      ask(s).map((r) => ({
        eid: String(r.eid),
        comp: String(r.comp),
        prop: String(r.prop),
      }))
    ),
  }
}
