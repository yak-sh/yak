// The small series a store keeps in memory. An eid in prose is drawn as the
// entity's id (@yaks/markdown `drawn`), and no door reads an entity only to
// draw its id: so the series small enough to hold (projects, personas, goals,
// boards, topics, people) are held whole, and every door draws from them.
//
// What is held is read again once it is older than `fresh`, on the next
// door that asks: an entity made since then by another process draws as its
// short handle until that read.

import type { Eid, Tx } from './types.ts'
import type { Vocab } from '@yaks/vocab'
import { human, prefixes } from './id.ts'

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
 * entity called by the id it prints with ({@link human}). Nothing is read
 * until the first door asks.
 */
export let held = (
  vocab: Vocab,
  tx: Pick<Tx, 'read' | 'get'>,
  { fresh = 60_000, now = Date.now, small = SMALL }: {
    fresh?: number
    now?: () => number
    small?: number
  } = {},
): Held => {
  let id = human(vocab)
  let at = -Infinity
  let known = new Map<Eid, string>()
  let loading: Promise<void> | undefined
  let load = async () => {
    let series = await Promise.all(
      Object.keys(prefixes(vocab)).map((comp) =>
        tx.read(`.${comp}&.fields=entity.num&.limit=${small}`)
      ),
    )
    let eids = [
      ...new Set(
        series.filter((s) => s.length < small).flat().map((b) => b.entity.eid),
      ),
    ]
    let rows = eids.length ? await tx.get(eids) : []
    known = new Map(
      rows.filter((b) => b.entity.num).map((b) => [b.entity.eid, id(b)]),
    )
    at = now()
  }
  return async () => {
    if (now() - at >= fresh) {
      await (loading ??= load().finally(() => loading = undefined))
    }
    return (eid) => known.get(eid)
  }
}
