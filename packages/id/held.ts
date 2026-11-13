// The small series a store keeps in memory. An eid in prose is drawn as the
// entity's id (@yaks/markdown `drawn`), and no door reads an entity only to
// draw its id: so the series small enough to hold (projects, personas, goals,
// boards, topics, people) are held whole, and every door draws from them.
//
// What is held is read again once it is older than `fresh`, on the next
// door that asks: an entity made since then by another process draws as its
// short handle until that read.
//
// An id needs an entity's number and its kind, the first kind in the
// vocabulary's order it wears. One found in a series wears that series'
// component, so only the kinds ordered before it can decide, and only those
// are read: never its body, which is most of what a whole entity holds (a get
// of every held entity whole read 10.8 MB and waited 22 s on a cold disk).

import type { Eid, Tx } from './types.ts'
import type { Vocab } from '@yaks/vocab'
import { format, prefixes } from './id.ts'

/** A series with fewer entities than this is held whole. */
export let SMALL = 1000

/** What a store calls each entity of its small series, by eid. */
export type Known = (eid: Eid) => string | undefined

/** The held series, read again where older than `fresh`: what a door awaits
 * before it draws. */
export type Held = () => Promise<Known>

/**
 * The small series over a store, held: each component that declares a
 * `prefix` and that fewer than `small` ({@link SMALL}) entities wear, each
 * entity called by the id it prints with. Nothing is read until the first
 * door asks.
 */
export let held = (
  vocab: Vocab,
  tx: Pick<Tx, 'read'>,
  { fresh = 60_000, now = Date.now, small = SMALL }: {
    fresh?: number
    now?: () => number
    small?: number
  } = {},
): Held => {
  let table = prefixes(vocab)
  let order = new Map(vocab.kinds.map((kind, at) => [kind, at]))
  let known = new Map<Eid, string>()
  let at = -Infinity
  let loading: Promise<void> | undefined
  let load = async () => {
    let names = Object.keys(table)
    let series = await Promise.all(
      names.map((comp) =>
        tx.read(
          `.${comp}&.fields=entity.num,entity.prefix&.limit=${small}`,
        )
      ),
    )
    // Each numbered entity by the series it is found in that comes first in
    // kind order, the one it is numbered in (@yaks/id `seriesOf`), unless it
    // stored its letter when it was numbered.
    let first = new Map<Eid, { place: number; id: string }>()
    series.forEach((rows, i) => {
      if (rows.length >= small) return
      let place = order.get(names[i]) ?? vocab.kinds.length
      for (let { entity: { eid, num, prefix } } of rows) {
        if (!num || (first.get(eid)?.place ?? Infinity) <= place) continue
        first.set(eid, { place, id: format(prefix || table[names[i]], num) })
      }
    })
    known = new Map([...first].map(([eid, { id }]) => [eid, id]))
    at = now()
  }
  return async () => {
    if (now() - at >= fresh) {
      await (loading ??= load().finally(() => loading = undefined))
    }
    return (eid) => known.get(eid)
  }
}
