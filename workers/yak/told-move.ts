// Every notification an Operator store kept while @yaks/notify named whom it
// tells in @yaks/mail's `deliver{to}` (T-853) says it in `notification{to}`,
// and carries no `deliver`: a notification is not a letter, so `mail_post`
// never takes one for a letter owed a send (bug abc0ed46). It moves in bounded
// alarm batches beside the store's other passes, never in boot.
//
// A reader that needs whom a notification tells finishes the pass first
// ({@link toldMoved}), so none reads a store whose notifications are still
// in the old shape. Once every store's mark is `done`, this module and its
// readers' calls are deleted.
import { line } from '@yaks/query'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Meta } from '@yaks/sqlite'

/** Where a store says its notifications name whom they tell in
 * `notification{to}`. A store made new is born done. */
export let TOLD = 'operator:told'

/** How many rows one batch moves. */
export let BATCH = 50

type Store = {
  g: Graph
  marks?: Pick<Meta, 'get' | 'set'>
  waiting?: () => number
}

/** The patch that moves one notification: its `deliver.to` into
 * `notification.to`, and its `deliver` gone. */
export let toldMove = (row: Bundle): Bundle => {
  let to = (row.deliver as Comp | undefined)?.to
  return {
    entity: row.entity,
    ...to ? { notification: { to } } : {},
    deliver: null,
  }
}

// One batch: the next notifications still carrying `deliver`, each moved.
// Answers whether more may remain.
let batch = async ({ g, marks }: Required<Pick<Store, 'g' | 'marks'>>) => {
  let rows = await g.read(
    line`.notification&.deliver&.limit=${BATCH}&.fields=deliver.to`,
  )
  if (rows.length) {
    await g.apply(rows.map(toldMove), { trusted: true, stamp: false })
  }
  if (rows.length < BATCH) marks.set(TOLD, 'done')
  return rows.length == BATCH
}

/** One alarm's batch of the pass. Answers whether another alarm has work. A
 * store kept nowhere was made in memory with the new word, and owes none. */
export let toldBackfill = async (store: Store): Promise<boolean> => {
  let { g, marks } = store
  if (!marks || marks.get(TOLD) == 'done') return false
  if (store.waiting?.()) return true
  return await batch({ g, marks })
}

/** The pass finished, for a reader of whom a notification tells. */
export let toldMoved = async (store: Store) => {
  let { g, marks } = store
  if (!marks) return
  while (marks.get(TOLD) != 'done') await batch({ g, marks })
}
