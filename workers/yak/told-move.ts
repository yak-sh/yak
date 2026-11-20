// An ask kept before asks named their instructions (@yaks/session's told.ts)
// holds the whole text it sent, tens of kilobytes the same from one ask to the
// next: 775 asks held 37 MB in Jeff's store, of 31 texts. Each such ask is
// given the `told` row its text is kept in, once per text, and names it as
// `sending{told}`, in bounded alarm batches beside the store's other passes,
// never in boot. The text moves whole, so an ask is never without it. Until
// the pass is done a reader takes either (operator-host.ts `drawnOf`).
import type { Comp, Graph } from '@yaks/graph'
import type { Meta } from '@yaks/sqlite'
import { line } from '@yaks/query'
import { toldRow } from '@yaks/session/told'

/** Where a store says each of its asks names the instructions it sent. */
export let TOLD = 'operator:told'

/** How many asks one batch moves: each holds tens of kilobytes until moved. */
export let BATCH = 20

/** One batch of the pass: the next asks holding their instructions' text,
 * each given the told row that keeps it. Answers whether another alarm has
 * work. A store kept nowhere was made in memory with asks that name theirs,
 * and owes no pass. */
export let toldBackfill = async (store: {
  g: Graph
  marks?: Pick<Meta, 'get' | 'set'>
  waiting?: () => number
}): Promise<boolean> => {
  let { g, marks } = store
  if (!marks || marks.get(TOLD) == 'done') return false
  if (store.waiting?.()) return true
  let rows = await g.read(
    line`.ask&.sending.instructions&.limit=${BATCH}&.fields=sending.instructions`,
  )
  let toldBy = new Map(rows.map((row) => {
    let text = String((row.sending as Comp).instructions)
    return [row.entity.eid, toldRow(text)]
  }))
  let texts = new Map([...toldBy.values()].map((b) => [b.entity.eid, b]))
  let held = new Set(
    (await g.get([...texts.keys()], ['told']))
      .flatMap((b) => b?.told ? [b.entity.eid] : []),
  )
  let moved = [
    ...[...texts.values()].filter((b) => !held.has(b.entity.eid)),
    ...rows.map((row) => ({
      entity: row.entity,
      sending: {
        instructions: null,
        told: toldBy.get(row.entity.eid)!.entity.eid,
      },
    })),
  ]
  if (rows.length) await g.apply(moved, { trusted: true, stamp: false })
  if (rows.length < BATCH) marks.set(TOLD, 'done')
  return rows.length == BATCH
}
