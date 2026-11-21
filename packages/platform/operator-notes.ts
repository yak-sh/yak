// The recall and decision notes an Operator store kept before T-2197 made
// them turn notes, re-scoped `prompt{scope: 'turn'}` in bounded alarm batches
// beside the store's other passes, never in boot. Written as
// `prompt{scope: 'local'}`, they rode every request of their conversation:
// an elision boundary passes over turn notes only (@yaks/session pruning.ts
// `elide`), and checks' main conversation sent 108 of them, about 13k tokens,
// a turn. Once re-scoped, the next cold turn leaves them out.
import type { Graph } from '@yaks/graph'
import type { Meta } from '@yaks/sqlite'
import { line } from '@yaks/query'

/** Where an Operator store says its notes are turn notes. */
export let NOTES = 'operator:turn-notes'

/** How many notes one batch re-scopes. */
export let BATCH = 200

/** One batch of the pass: the next notes kept as local prompts, each made a
 * turn note. Answers whether another alarm has work. A store kept nowhere was
 * made in memory with turn notes, and owes no pass. */
export let noteBackfill = async (store: {
  g: Graph
  marks?: Pick<Meta, 'get' | 'set'>
  waiting?: () => number
}): Promise<boolean> => {
  let { g, marks } = store
  if (!marks || marks.get(NOTES) == 'done') return false
  if (store.waiting?.()) return true
  let rows = await g.read(
    line`.prompt.scope=local&(.prompt.source=operator:earlier|.prompt.source=operator:decisions)&.limit=${BATCH}&.fields=entity.eid`,
  )
  if (rows.length) {
    await g.apply(
      rows.map((row) => ({ entity: row.entity, prompt: { scope: 'turn' } })),
      { trusted: true, stamp: false },
    )
  }
  if (rows.length < BATCH) marks.set(NOTES, 'done')
  return rows.length == BATCH
}
