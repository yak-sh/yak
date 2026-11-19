// The directory's graves as its journal tells them: each entity a window's
// transactions deleted, when, by whom, through what, and what it last held.
// A tombstone keeps only an eid and a time, and an erase forever purges the
// retained copy (workers/yak/erase.ts `erased`), so the journal is all that
// says what a dead row was. It records the components the directory's config
// names (workers/yak/config.ts `directoryConfig`: `space`, `doc`, `former`,
// `member`, `grant`, `invite`); a death of a row that held none of them, a
// lapsed browser session or a meter, is not here.
import type { Bundle } from '@yaks/graph'
import { line, sub } from '@yaks/query'

export type Window = {
  since: string
  until: string
  after?: string
  limit?: number
}

/** One deleted entity: its deletion's transaction, and each journaled
 * component as its history last told it held. */
export type Grave = {
  eid: string
  at: string
  by: string | null
  via: string | null
  held: Record<string, Record<string, unknown>>
}

/** A page of graves, newest death first, as the journal answers them, and
 * the cursor past it. */
export type Graves = { graves: Grave[]; next: string | null }

type Change = {
  tx: string
  target: string
  component: string
  value?: Record<string, unknown>
}

type Tx = { at: string; by?: string; via?: string }

let LIMIT = 100
// An entity's whole history in one read: a space renamed weekly for a year is
// a few hundred rows.
let HISTORY = 5000

let changeOf = (b: Bundle) => ({
  eid: b.entity.eid,
  ...(b._change as Change),
})

// A journal record's eid leads with its row id as at least eight hex digits
// (@yaks/sql derived.ts), so the longer is the later.
let byRow = (a: { eid: string }, b: { eid: string }) =>
  a.eid.length - b.eid.length || (a.eid < b.eid ? -1 : a.eid > b.eid ? 1 : 0)

/** What an entity held just before its last death, folding its changes oldest
 * first: an after-image merges onto what the component held, and a change
 * without one removes the component. */
export let heldBefore = (changes: Change[]) => {
  let held: Record<string, Record<string, unknown>> = {}
  let before = held
  for (let c of changes) {
    if (c.component == 'entity') {
      before = held
      held = {}
      continue
    }
    held = c.value
      ? { ...held, [c.component]: { ...held[c.component], ...c.value } }
      : Object.fromEntries(
        Object.entries(held).filter(([name]) => name != c.component),
      )
  }
  return before
}

let windowed = (w: Window) => {
  let since = Date.parse(w.since), until = Date.parse(w.until)
  let limit = w.limit ?? LIMIT
  if (!Number.isFinite(since) || !Number.isFinite(until) || since >= until) {
    throw new RangeError('graves needs since < until, each a time')
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError('graves reads 1 to 1,000 a page')
  }
  return {
    since: new Date(since).toISOString(),
    until: new Date(until).toISOString(),
    limit,
  }
}

/** A page of the graves whose deaths fall in [since, until), read through
 * `query`, the directory's own reads. Continue with `next` as `after`. */
export let graves = async (
  query: (q: string) => Promise<Bundle[]>,
  w: Window,
): Promise<Graves> => {
  let { since, until, limit } = windowed(w)
  let deaths = (await query(
    line`._change.component=entity&._change.tx._tx.at>=${since}&._change.tx._tx.at<${until}&.limit=${limit}${
      sub(w.after ? line`&.after=${w.after}` : line``)
    }`,
  )).map(changeOf)
  if (!deaths.length) return { graves: [], next: null }
  let targets = [...new Set(deaths.map((d) => d.target))]
  let [txs, histories] = await Promise.all([
    query(line`.entity.eid=${[...new Set(deaths.map((d) => d.tx))]}&._tx`),
    query(line`._change.target=${targets}&.limit=${HISTORY}`),
  ])
  let tx = new Map(txs.map((b) => [b.entity.eid, b._tx as Tx]))
  let history = Map.groupBy(
    histories.map(changeOf).sort(byRow),
    (c) => c.target,
  )
  return {
    graves: deaths.map((d) => {
      let at = tx.get(d.tx)
      // Only the changes up to this death: a revived entity may die again.
      let past = history.get(d.target) ?? []
      let upTo = past.findIndex((c) => c.eid == d.eid)
      return {
        eid: d.target,
        at: at?.at ?? '',
        by: at?.by ?? null,
        via: at?.via ?? null,
        held: heldBefore(upTo < 0 ? [] : past.slice(0, upTo + 1)),
      }
    }),
    next: deaths.length == limit ? deaths.at(-1)!.eid : null,
  }
}
