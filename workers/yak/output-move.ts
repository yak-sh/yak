// The files an Operator's tools made (an image, a browser's screenshot)
// before each was attached beside the call that made it (operator-channels.ts
// `madeFiles`), which their results carry as `operator_files` alone, given
// those rows now, in bounded alarm batches beside the store's other passes,
// never in boot. The pass walks the store's results in eid order from where
// it stopped. A result whose files have rows already, named by it (the
// attachment pass, attachment-move.ts, before it left results to this one)
// or by its call, is left as it is, so a second run writes nothing.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Meta } from '@yaks/sqlite'
import { attachmentOf, attachmentRows } from '@yaks/blob/attachment'
import { attachedOf, type File } from './operator-files.ts'
import { OUTPUTS } from './operator-store.ts'

/** How many results one batch reads. */
export let BATCH = 50

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** One batch of the pass: the next results carrying files, each given its
 * call's attachment rows where neither it nor its call has them. Answers
 * whether another alarm has work; the cursor advances only after the batch's
 * writes land. A store kept nowhere was made in memory with the tools that
 * write them, and owes no pass. */
export let outputBackfill = async (
  store: {
    g: Graph
    marks?: Pick<Meta, 'get' | 'set'>
    waiting?: () => number
  },
): Promise<boolean> => {
  let { g, marks } = store
  let at = marks?.get(OUTPUTS)
  if (!marks || at == 'done') return false
  if (store.waiting?.()) return true
  let rows = await g.read(
    `.result&.operator_files${
      at ? `&.entity.eid>${at}` : ''
    }&.order=entity.eid&.limit=${BATCH}`,
  )
  let made = rows.flatMap((row) => {
    let call = comp(row, 'result')?.call
    let files = (comp(row, 'operator_files')?.files ?? []) as File[]
    return call && files.length ? [{ row, call: String(call), files }] : []
  })
  let held = new Set(
    (await g.get(
      made.flatMap(({ row, call }) => [
        attachmentOf(row.entity.eid, 0),
        attachmentOf(call, 0),
      ]),
    )).filter((b) => b.attachment).map((b) => b.entity.eid),
  )
  let owed = made.filter(({ row, call }) =>
    !held.has(attachmentOf(row.entity.eid, 0)) &&
    !held.has(attachmentOf(call, 0))
  ).flatMap(({ call, files }) => attachmentRows(call, files.map(attachedOf)))
  if (owed.length) await g.apply(owed, { trusted: true })
  let last = rows.at(-1)?.entity.eid
  marks.set(OUTPUTS, rows.length < BATCH || !last ? 'done' : last)
  return rows.length == BATCH
}
