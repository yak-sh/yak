// Payloads live ONLY in RAM. This policy keeps ids/order/ownership, not a
// parallel query cache. A release retains; an authoritative absence forgets.
import type { Bundle, Eid, Graph } from '@yaks/graph'
import { comps, dead, then, transient } from '@yaks/graph'
import type { Store } from '@yaks/ram'
import {
  type Ask,
  echoed,
  land,
  type Replica,
  snapshot,
  type SubscribeOpts,
  tierOf,
} from '@yaks/sync'
import type { Watches } from './watch.ts'
import type { Saved } from './vault.ts'
import type { WireVault } from './wire-vault.ts'

/** Default number of inactive server rows retained in memory and disk. */
export const RETENTION_ROWS = 20_000

/** The client's working set policy and epoch-scoped paint floor. */
export type Retained = Replica & {
  /** Whether this remote answer owns a row (or it has a pending local write). */
  includes: (id: string, eid: Eid) => boolean
  /** Current server members in delivery order, with payloads from RAM. No
   * local matcher, no speculative inclusion of unrelated pending writes. */
  answer: (id: string) => Bundle[]
  /** Payload changes, including storage-only eviction. Read the current row
   * from the client; absence here is eviction, not proof of graph deletion. */
  onRows: (fn: (eids: Eid[]) => void) => () => void
  /** Membership can change without the shared payload changing. */
  onMembership: (fn: (id: string) => void) => () => void
  /** Stop late hydration and persistence observation when the client closes. */
  close: () => void
  /** Touch payloads without changing graph/query order. */
  touch: (eids: Eid[]) => void
  /** Validate a server epoch; restores only a bounded, non-authoritative floor. */
  epoch: (epoch: string) => Promise<void>
  /** Wait for queued persistence. */
  idle: () => Promise<void>
  /** Number of inactive payloads (active/pending rows are not in the budget). */
  size: () => number
}

/** Assemble retention around the client's existing graph, store and watches. */
export let retention = (
  graph: Graph,
  store: Store,
  watches: Watches,
  opts: {
    limit?: number
    vault?: WireVault
    localOnly?: boolean
    report?: (error: unknown) => void
  } = {},
): Retained => {
  let limit = opts.limit ?? RETENTION_ROWS
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error('invalid retention limit')
  }
  let subscriptions = new Map<
    string,
    { query: Ask; members: Set<Eid>; prime: boolean }
  >()
  let rowListeners = new Set<(eids: Eid[]) => void>()
  let changedRows = (eids: Eid[]) => {
    for (let fn of rowListeners) fn(eids)
  }
  let listeners = new Set<(id: string) => void>()
  let notify = (id: string) => {
    for (let fn of listeners) fn(id)
  }
  let owners = new Map<Eid, Set<string>>()
  let pins = new Map<Eid, number>()
  let known = new Set<Eid>()
  let inactive = new Set<Eid>() // insertion order = least recently used first
  let invalid = new Set<Eid>() // gone, but a pending write still needs it
  let closed = false
  let current: string | undefined
  let generation = 0
  let frames = 0
  let loading: Set<Eid> | undefined
  let queued = Promise.resolve()
  let report = opts.report ??
    ((error) => console.warn('@yaks/client retention', error))
  let enqueue = (fn: () => Promise<void>) => {
    queued = queued.then(fn).catch(report)
  }
  let held = (eid: Eid) => store.tx((tx) => tx.get([eid]))[0]
  let protectedByOwner = (eid: Eid) => !!owners.get(eid)?.size
  let protectedRow = (eid: Eid) => protectedByOwner(eid) || pins.has(eid)
  let touch = (eids: Eid[]) => {
    for (let eid of eids) if (inactive.delete(eid)) inactive.add(eid)
  }
  let diskDrop = (eids: Eid[]) => {
    let epoch = current
    if (epoch && opts.vault) enqueue(() => opts.vault!.drop(epoch, eids))
  }
  // Storage-only eviction: no tombstone, cascade, outbound post, or local-vault
  // deletion. Watch invalidation sees the physically absent payload too.
  let forget = (eids: Eid[], stale = false) => {
    let changed: Eid[] = []
    for (let eid of eids) {
      if (protectedRow(eid)) {
        if (stale && !protectedByOwner(eid)) invalid.add(eid)
        continue
      }
      invalid.delete(eid)
      inactive.delete(eid)
      known.delete(eid)
      transient(graph).forget([eid])
      let row = held(eid)
      if (!row || dead(row)) continue
      let patch: Bundle = { entity: row.entity }
      for (let [name] of comps(row)) {
        if (tierOf(graph.vocab, name) == 'wire') patch[name] = null
      }
      store.tx((tx) => {
        tx.patch([patch])
        let rest = tx.get([eid])[0]
        if (rest && !comps(rest).length) tx.evict([eid])
      })
      changed.push(eid)
    }
    if (stale) diskDrop(eids)
    if (changed.length) {
      changedRows(changed)
      void watches.invalidate(changed)
    }
  }
  let sweep = () => {
    while (inactive.size > limit) forget([inactive.values().next().value!])
  }
  let retain = (eid: Eid) => {
    if (!known.has(eid) || protectedRow(eid)) return
    inactive.delete(eid)
    inactive.add(eid)
  }
  let own = (id: string, eid: Eid) => {
    let set = owners.get(eid) ?? new Set<string>()
    set.add(id)
    owners.set(eid, set)
    inactive.delete(eid)
    invalid.delete(eid)
  }
  let disown = (id: string, eid: Eid) => {
    let set = owners.get(eid)
    set?.delete(id)
    if (!set?.size) owners.delete(eid)
  }
  let unsubscribe = (id: string) => {
    let sub = subscriptions.get(id)
    subscriptions.delete(id)
    for (let eid of sub?.members ?? []) {
      disown(id, eid)
      retain(eid)
    }
    sweep()
  }
  let save = (eids: Eid[]) => {
    let epoch = current
    if (!epoch || !opts.vault) return
    let saved: Saved[] = []
    let gone: Eid[] = []
    for (let eid of eids) {
      let b = held(eid)
      let wire = b && !dead(b)
        ? Object.fromEntries(
          comps(b).filter(([name]) => tierOf(graph.vocab, name) == 'wire'),
        )
        : {}
      if (Object.keys(wire).length) {
        saved.push({ eid, num: b!.entity.num, comps: wire as Saved['comps'] })
      } else gone.push(eid)
    }
    enqueue(async () => {
      if (saved.length) await opts.vault!.save(epoch, saved, limit)
      if (gone.length) await opts.vault!.drop(epoch, gone)
    })
  }
  graph.use({
    name: '@yaks/client/retention',
    hooks: {
      effect: (bundles) => {
        if (closed) return bundles
        let eids = [...new Set(bundles.map((b) => b.entity.eid))]
        changedRows(eids)
        if (opts.localOnly && !bundles.some(echoed)) return bundles
        for (let eid of eids) {
          loading?.add(eid)
          if (
            comps(held(eid) ?? { entity: { eid } }).some(([name]) =>
              tierOf(graph.vocab, name) == 'wire'
            )
          ) known.add(eid)
          if (!comps(held(eid) ?? { entity: { eid } }).length) known.add(eid)
          retain(eid)
        }
        save(eids)
        // Sync's effect installs optimistic pins in the same commit turn.
        queueMicrotask(sweep)
        return bundles
      },
    },
  })
  return {
    touch,
    close: () => {
      closed = true
      generation++
      loading = undefined
      listeners.clear()
      rowListeners.clear()
    },
    answer: (id) =>
      transient(graph).project(
        store.tx((tx) => tx.get([...(subscriptions.get(id)?.members ?? [])]))
          .filter((b) => !dead(b)),
      ),
    onRows: (fn) => {
      rowListeners.add(fn)
      return () => {
        rowListeners.delete(fn)
      }
    },
    includes: (id, eid) =>
      !!subscriptions.get(id)?.members.has(eid) || pins.has(eid),
    onMembership: (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    unsubscribe,
    subscribe: (id, query, subOpts: SubscribeOpts = {}) => {
      // Re-pointing the same id must not drop the old floor before new pins.
      let old = subscriptions.get(id)
      let prime = subOpts.prime !== false
      let members = new Set(
        query === true || !prime
          ? []
          : store.read(query).map((b) => b.entity.eid),
      )
      subscriptions.set(id, { query, members, prime })
      for (let eid of members) own(id, eid)
      for (let eid of old?.members ?? []) {
        if (!members.has(eid)) {
          disown(id, eid)
          retain(eid)
        }
      }
      sweep()
    },
    land: (frame) => {
      frames++ // even an empty authoritative answer defeats late disk data
      let sub = subscriptions.get(frame.id)
      if (!sub) return []
      transient(graph).forget(frame.transientReset ?? [])
      let arrived = new Set((frame.bundles ?? []).map((b) => b.entity.eid))
      let gone = new Set(frame.gone ?? [])
      if (frame.reset) {
        for (let eid of sub.members) if (!arrived.has(eid)) gone.add(eid)
        // A replacement also replaces ranking; retaining Set insertion order
        // would keep the previous ranking when the same members move.
        sub.members.clear()
      }
      for (let eid of arrived) {
        sub.members.add(eid)
        known.add(eid)
        own(frame.id, eid)
      }
      for (let eid of gone) {
        sub.members.delete(eid)
        disown(frame.id, eid)
      }
      forget([...gone], true)
      // Pending optimistic state beats subscription snapshots. The post reply
      // reconciles it; a query snapshot must not roll it backwards meanwhile.
      let bundles = (frame.bundles ?? []).filter((b) => !pins.has(b.entity.eid))
      return then(
        sub.query === true
          ? land(graph, { ...frame, bundles, gone: [] })
          : snapshot(graph, bundles),
        (out) => {
          if (sub.query !== true) {
            for (const update of frame.transient ?? []) {
              if (
                sub.members.has(update.entity) && !pins.has(update.entity)
              ) transient(graph).receive(update)
            }
          }
          sweep()
          notify(frame.id)
          return out
        },
      )
    },
    protect: (eids) => {
      eids = [...new Set(eids)]
      for (let eid of eids) {
        pins.set(eid, (pins.get(eid) ?? 0) + 1)
        inactive.delete(eid)
      }
      for (let id of subscriptions.keys()) notify(id)
      let active = true
      return () => {
        if (!active || closed) return
        active = false
        for (let eid of eids) {
          let n = pins.get(eid)! - 1
          if (n) pins.set(eid, n)
          else pins.delete(eid)
          if (invalid.has(eid)) forget([eid], true)
          else retain(eid)
        }
        sweep()
        for (let id of subscriptions.keys()) notify(id)
      }
    },
    epoch: async (epoch) => {
      if (closed) throw new Error('client cache is closed')
      if (!epoch) throw new Error('an authoritative nonempty epoch is required')
      let turn = ++generation
      let beforeFrames = frames
      let touched = new Set<Eid>()
      loading = touched
      if (current !== undefined && current !== epoch) {
        owners.clear()
        for (let sub of subscriptions.values()) sub.members.clear()
        forget([...known], true)
        for (let id of subscriptions.keys()) notify(id)
      }
      current = epoch
      if (!opts.vault) {
        loading = undefined
        return
      }
      // Order epoch validation after previous writes; future writes queue behind
      // it. A stale tab's save/drop is independently guarded by the vault.
      let read = queued.then(() => opts.vault!.load(epoch, limit))
      queued = read.then(() => undefined, report)
      let rows = await read
      if (generation !== turn) return
      loading = undefined
      if (frames !== beforeFrames) return
      let bundles = rows.filter((r) =>
        !touched.has(r.eid) && !pins.has(r.eid) && !known.has(r.eid)
      )
        .map((r) => ({ entity: { eid: r.eid, num: r.num }, ...r.comps }))
      // A reopened watch owns its cached hits BEFORE the first frame. Hydration
      // must add late hits to that same ownership set, not invent another watch.
      await then(snapshot(graph, bundles), () => {
        for (let [id, sub] of subscriptions) {
          if (sub.query === true || !sub.prime) continue
          for (let b of store.read(sub.query)) {
            sub.members.add(b.entity.eid)
            own(id, b.entity.eid)
          }
          notify(id)
        }
        sweep()
      })
    },
    idle: async () => {
      await queued
    },
    size: () => inactive.size,
  }
}
