// Every entity of an Operator store kept before it numbered what it keeps
// (operator-store.ts `NUMBERS`) given its number, in the order they were
// made, in bounded alarm batches beside the store's other passes, never in
// boot. An entity made since is numbered by its write. The pass reads the
// oldest that still have none each batch, so it needs no cursor, and a
// second run finds nothing; the store's meta says when it is done.
import type { Meta } from '@yaks/sqlite'
import type { Bundle, Graph } from '@yaks/graph'
import { seriesOf } from '@yaks/graph/storage'
import { NUMBERED, NUMBERS, operatorVocab } from './operator-store.ts'

/** How many entities one batch numbers. */
export let BATCH = 200

let series = seriesOf(operatorVocab, NUMBERS)
let comps = Object.keys(NUMBERS)
let wearing = comps.map((c) => `.${c}`).join('|')

/** One batch of the pass: the oldest entities with a numbered kind and no
 * number, each given the next in its series. Answers whether another alarm
 * has work. A store kept nowhere was made in memory numbering, and owes no
 * pass. */
export let numberBackfill = async (
  store: {
    g: Graph
    marks?: Pick<Meta, 'get' | 'set'>
    waiting?: () => number
    lettered?: () => boolean
  },
): Promise<boolean> => {
  let { g, marks } = store
  if (!marks || marks.get(NUMBERED) == 'done') return false
  // A spine still counting once across its series (its rebuild refused) takes
  // no stated pair of a series' own; the pass waits for one that is rebuilt.
  if (store.lettered && !store.lettered()) return false
  if (store.waiting?.()) return true
  let page = await g.read(
    `(${wearing})&!entity.num&.order=created.at&.limit=${BATCH}&.fields=entity.eid`,
  )
  let rows = page.length
    ? await g.get(page.map((b) => b.entity.eid), comps)
    : []
  let highs = new Map<string, number>()
  let high = async (prefix: string) => {
    if (!highs.has(prefix)) {
      let [last] = await g.read(
        `.entity.prefix=${prefix}&.order=-entity.num&.limit=1&.fields=entity.num`,
      )
      highs.set(prefix, Number(last?.entity.num ?? 0))
    }
    return highs.get(prefix)!
  }
  let owed: Bundle[] = []
  let at = new Map(rows.map((b) => [b.entity.eid, b]))
  for (let { entity: { eid } } of page) {
    let b = at.get(eid)
    let prefix = b && !b.tombstone && series(Object.keys(b))
    if (!prefix) continue
    let num = await high(prefix) + 1
    highs.set(prefix, num)
    owed.push({ entity: { eid, prefix, num } })
  }
  for (let i = 0; i < owed.length; i += 50) {
    if (store.waiting?.()) return true
    await g.apply(owed.slice(i, i + 50), { trusted: true, stamp: false })
  }
  if (page.length < BATCH) marks.set(NUMBERED, 'done')
  return page.length == BATCH
}
