// The directory's graves: each entity whose tombstone was laid in a window,
// and whatever still tells what it was. A tombstone keeps only an eid and a
// time. The journal tells when, by whom and through what it died and what it
// last held, for a row that held a component the directory journals
// (workers/yak/config.ts `directoryConfig`: `space`, `doc`, `former`,
// `member`, `grant`, `invite`), since the journal began. The trash keeps a copy
// of every other delete. An erase forever purges both (workers/yak/erase.ts
// `erased`), so its grave is an eid and a time alone.
import type { Bundle } from '@yaks/graph'
import type { Trash, TrashPage } from '@yaks/graph/trash'
import { line } from '@yaks/query'

export type Window = { since: string; until: string; after?: number }

/** One deleted entity: when its tombstone was laid; its death's transaction
 * and each journaled component as its history last told it held, where the
 * journal keeps them; and the copy the trash retained of it, where it does. */
export type Grave = {
  eid: string
  at: string
  by: string | null
  via: string | null
  held: Record<string, Record<string, unknown>>
  kept: Bundle | null
}

/** A page of graves, and the cursor past the tombstones it read: a page may
 * name none and still have a `next`. */
export type Graves = { graves: Grave[]; next: number | null }

/** What a page is read from in the directory's own store: its tombstones laid
 * in a window, a page of its tombstone table at a time; its query; and its
 * trash, the retained groups holding any of the eids asked. */
export type Reads = {
  buried: (w: Window) => Promise<{
    graves?: { eid: string; at: string }[]
    next: number | null
  }>
  query: (q: string) => Promise<Bundle[]>
  trash: (eids: string[], page: TrashPage) => Promise<Trash[]>
}

type Change = {
  eid: string
  tx: string
  target: string
  component: string
  value?: Record<string, unknown>
}

type Tx = { at: string; by?: string; via?: string }

// Eids one read names, which a query's line carries in its address.
let CHUNK = 100
// An entity's whole history: a space renamed weekly for a year is a few
// hundred rows.
let HISTORY = 5000
let GROUPS = 100

let chunks = <T>(all: T[]) =>
  Array.from(
    { length: Math.ceil(all.length / CHUNK) },
    (_, i) => all.slice(i * CHUNK, (i + 1) * CHUNK),
  )

let changeOf = (b: Bundle): Change => ({
  eid: b.entity.eid,
  ...(b._change as Omit<Change, 'eid'>),
})

// A journal record's eid leads with its row id as at least eight hex digits
// (@yaks/sql derived.ts), so the longer is the later.
let byRow = (a: { eid: string }, b: { eid: string }) =>
  a.eid.length - b.eid.length || (a.eid < b.eid ? -1 : a.eid > b.eid ? 1 : 0)

/** What an entity held just before its last death, folding its changes oldest
 * first: an after-image merges onto what the component held, and a change
 * without one removes the component. */
export let heldBefore = (
  changes: Pick<Change, 'component' | 'value'>[],
) => {
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

// The newest copy the trash retained of each eid, every group read.
let retained = async (trash: Reads['trash'], eids: string[]) => {
  let kept = new Map<string, Bundle>()
  let after: string | undefined
  for (;;) {
    let groups = await trash(eids, { limit: GROUPS, after })
    for (let group of groups) {
      for (let b of group.bundles) {
        if (eids.includes(b.entity.eid) && !kept.has(b.entity.eid)) {
          kept.set(b.entity.eid, b)
        }
      }
    }
    if (groups.length < GROUPS) return kept
    after = groups.at(-1)!.id
  }
}

// Each eid's journal, oldest first, and the transactions of its deaths.
let journaled = async (query: Reads['query'], eids: string[]) => {
  let changes = (await query(
    line`._change.target=${eids}&.limit=${HISTORY}`,
  )).map(changeOf).sort(byRow)
  let deaths = [
    ...new Set(changes.filter((c) => c.component == 'entity').map((c) => c.tx)),
  ]
  let txs = deaths.length ? await query(line`.entity.eid=${deaths}&._tx`) : []
  return {
    history: Map.groupBy(changes, (c) => c.target),
    tx: new Map(txs.map((b) => [b.entity.eid, b._tx as Tx])),
  }
}

let windowed = (w: Window): Window => {
  let since = Date.parse(w.since), until = Date.parse(w.until)
  if (!Number.isFinite(since) || !Number.isFinite(until) || since >= until) {
    throw new RangeError('graves needs since < until, each a time')
  }
  if (w.after != null && !(Number.isSafeInteger(w.after) && w.after >= 0)) {
    throw new RangeError('graves continues after a page’s next')
  }
  return {
    since: new Date(since).toISOString(),
    until: new Date(until).toISOString(),
    after: w.after,
  }
}

/** A page of the graves laid in [since, until), read through the directory's
 * own store. Continue with `next` as `after` until it is null. */
export let graves = async (reads: Reads, w: Window): Promise<Graves> => {
  let page = await reads.buried(windowed(w))
  let laid = page.graves ?? []
  let told = await Promise.all(
    chunks(laid.map((g) => g.eid)).map(async (eids) => {
      let [journal, kept] = await Promise.all([
        journaled(reads.query, eids),
        retained(reads.trash, eids),
      ])
      return { ...journal, kept }
    }),
  )
  let history = new Map(told.flatMap((t) => [...t.history]))
  let tx = new Map(told.flatMap((t) => [...t.tx]))
  let kept = new Map(told.flatMap((t) => [...t.kept]))
  return {
    graves: laid.map(({ eid, at }) => {
      let past = history.get(eid) ?? []
      let death = past.findLastIndex((c) => c.component == 'entity')
      let by = death < 0 ? undefined : tx.get(past[death].tx)
      return {
        eid,
        at,
        by: by?.by ?? null,
        via: by?.via ?? null,
        held: death < 0 ? {} : heldBefore(past.slice(0, death + 1)),
        kept: kept.get(eid) ?? null,
      }
    }),
    next: page.next,
  }
}
