// Every entity of an Operator store kept before its owners were (T-155781)
// given the owner it makes (operator-owner.ts), in bounded alarm batches
// beside the store's other passes, never in boot. An entity written since is
// the rule's. The pass walks the store in eid order from where it stopped;
// until it is done, the store is read by the paths an owner is named on
// (operator-access.ts `owned`), never by owners it has yet to write.
import type { Meta } from '@yaks/sqlite'
import type { Graph } from '@yaks/graph'
import { MADE, OWNED, OWNERS, reckon } from './operator-owner.ts'

// What can name an owner, on an entity or by what it hangs on.
let BEARING = [
  ...OWNED.map(([name]) => name),
  'spawned',
  'entry',
  'operator_files',
  ...MADE,
].map((c) => `.${c}`).join('|')

/** How many entities one batch reads. */
export let BATCH = 200

/** One batch of the pass: the next entities that may have an owner, each
 * given the one it makes. Answers whether another alarm has work; the cursor
 * advances only after the batch's writes land. A store kept nowhere was made
 * in memory with the rule, and owes no pass. */
export let ownerBackfill = async (
  store: { g: Graph; marks?: Pick<Meta, 'get' | 'set'> },
): Promise<boolean> => {
  let { g, marks } = store
  let at = marks?.get(OWNERS)
  if (!marks || at == 'done') return false
  let rows = await g.read(
    `(${BEARING})${
      at ? `&.entity.eid>${at}` : ''
    }&.order=entity.eid&.limit=${BATCH}&.fields=entity.eid`,
  )
  let eids = rows.map((r) => r.entity.eid)
  let owed = await reckon((e, c) => g.get(e, c), eids)
  for (let i = 0; i < owed.length; i += 50) {
    await g.apply(owed.slice(i, i + 50), { trusted: true, stamp: false })
  }
  let last = eids.at(-1)
  marks.set(OWNERS, eids.length < BATCH || !last ? 'done' : last)
  return eids.length == BATCH
}
