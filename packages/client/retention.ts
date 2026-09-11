// Payloads live ONLY in RAM. This policy keeps ids/order/ownership, not a
// parallel query cache. A release retains; an authoritative absence forgets.
import type { Bundle, Eid, Graph } from '@yaks/graph'
import { comps, dead, then, transient } from '@yaks/graph'
import type { Store } from '@yaks/ram'
import {
  type Ask,
  type Coverage,
  covers,
  delivered,
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
import { ANSWER_BYTES, answerCache, type SavedAnswer } from './answers.ts'

/** Default number of inactive server rows retained in memory and disk. */
export const RETENTION_ROWS = 20_000

/** The client's working set policy and epoch-scoped paint floor. */
export type Retained = Replica & {
  /** Active coverage (including riders). False means unloaded, NOT deleted.
   * Unready restored owners cover only the columns actually present in RAM. */
  loaded: (eid: Eid, component: string, property?: string) => boolean
  /** Encoded bytes of retained answer metadata, independent of payload budget. */
  answerBytes: () => number
  /** Whether this remote answer includes a row (or it has a pending local write). */
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
    answerBytes?: number
    vault?: WireVault
    localOnly?: boolean
    report?: (error: unknown) => void
  } = {},
): Retained => {
  let limit = opts.limit ?? RETENTION_ROWS
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error('invalid retention limit')
  }
  let answerLimit = opts.answerBytes ?? ANSWER_BYTES
  let answers = answerCache(answerLimit)
  type Sub = {
    query: Ask
    members: Map<Eid, Coverage>
    peers: Map<Eid, Coverage>
    prime: boolean
    key?: string
    confirmed: boolean
  }
  let subscriptions = new Map<
    string,
    Sub
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
  let payloads = (sub: Sub) =>
    new Set([...sub.members.keys(), ...sub.peers.keys()])
  let covered = (
    eid: Eid,
    name: string,
    prop?: string,
    except?: Map<Eid, Coverage>,
  ) => {
    for (let id of owners.get(eid) ?? []) {
      let sub = subscriptions.get(id)!
      for (let role of [sub.members, sub.peers]) {
        let scope = role.get(eid)
        if (
          role !== except && scope !== undefined && covers(scope, name, prop)
        ) return true
      }
    }
    return false
  }
  let savingAnswers: string | undefined
  let saveAnswers = () => {
    let epoch = current
    if (!epoch || !opts.vault?.saveAnswers) return
    if (savingAnswers === epoch) return
    savingAnswers = epoch
    enqueue(async () => {
      if (savingAnswers === epoch) savingAnswers = undefined
      if (current === epoch) {
        await opts.vault!.saveAnswers!(epoch, answers.values(), answerLimit)
      }
    })
  }
  let remember = (sub: Sub) => {
    if (!sub.key || !sub.confirmed) return
    answers.put({
      key: sub.key,
      members: [...sub.members],
      peers: [...sub.peers],
    })
    saveAnswers()
  }
  // Restored memberships are paint, not fresh field knowledge. Intersect them
  // with RAM; never re-run the server query, nor claim evicted fields loaded.
  let floor = (entries: SavedAnswer['members']) =>
    new Map(entries.flatMap(([eid, scope]) => {
      let row = held(eid)
      return known.has(eid) && row && !dead(row)
        ? [
          [
            eid,
            Object.fromEntries(
              comps(row).filter(([name]) => covers(scope, name)).map((
                [name, comp],
              ) => [
                name,
                Object.keys(comp ?? {}).filter((p) => covers(scope, name, p)),
              ]),
            ),
          ] as [Eid, Coverage],
        ]
        : []
    }))
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
    let dropped: Eid[] = []
    for (let eid of eids) {
      if (stale && !protectedByOwner(eid)) dropped.push(eid)
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
    if (dropped.length) diskDrop(dropped)
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
  // Relinquishing a role can unload columns while another role still pins the
  // row. This is storage maintenance, never a graph deletion or outbound write.
  let trim = (eids: Eid[]) => {
    let changed: Eid[] = []
    for (let eid of eids) {
      if (!protectedByOwner(eid) || pins.has(eid)) continue
      let b = held(eid)
      if (!b || dead(b)) continue
      let cuts: Bundle = { entity: b.entity }
      let rest: Bundle = { entity: b.entity }
      for (let [name, comp] of comps(b)) {
        if (tierOf(graph.vocab, name) !== 'wire') continue
        if (!covered(eid, name)) {
          cuts[name] = null
          continue
        }
        let kept = Object.fromEntries(
          Object.entries(comp ?? {}).filter(([p]) => covered(eid, name, p)),
        )
        if (Object.keys(kept).length !== Object.keys(comp ?? {}).length) {
          cuts[name] = null
          rest[name] = kept
        }
      }
      if (!comps(cuts).length) continue
      store.tx((tx) => tx.patch([cuts, rest]))
      changed.push(eid)
    }
    if (changed.length) {
      save(changed)
      changedRows(changed)
      void watches.invalidate(changed)
    }
  }
  let unsubscribe = (id: string) => {
    let sub = subscriptions.get(id)
    subscriptions.delete(id)
    let eids = sub ? [...payloads(sub)] : []
    for (let eid of eids) {
      disown(id, eid)
      retain(eid)
    }
    trim(eids)
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
      if (b && !dead(b) && (Object.keys(wire).length || known.has(eid))) {
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
    loaded: (eid, name, prop) => !!held(eid) && covered(eid, name, prop),
    answerBytes: answers.bytes,
    close: () => {
      closed = true
      generation++
      loading = undefined
      listeners.clear()
      rowListeners.clear()
    },
    answer: (id) =>
      transient(graph).project(
        store.tx((tx) =>
          tx.get([...(subscriptions.get(id)?.members.keys() ?? [])])
        )
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
      let cached = subOpts.answerKey
        ? answers.get(subOpts.answerKey)
        : undefined
      let members = cached ? floor(cached.members) : new Map<Eid, Coverage>(
        query === true || !prime
          ? []
          : store.read(query).map((b) => [b.entity.eid, delivered(b)]),
      )
      let peers = cached ? floor(cached.peers) : new Map<Eid, Coverage>()
      let sub: Sub = {
        query,
        members,
        peers,
        prime,
        key: subOpts.answerKey,
        confirmed: false,
      }
      subscriptions.set(id, sub)
      let next = payloads(sub)
      for (let eid of next) own(id, eid)
      for (let eid of old ? payloads(old) : []) {
        if (!next.has(eid)) {
          disown(id, eid)
          retain(eid)
        }
      }
      trim(old ? [...payloads(old)] : [])
      sweep()
    },
    land: (frame) => {
      let sub = subscriptions.get(frame.id)
      if (!sub || frame.refused) return []
      if (
        sub.query === true &&
        (frame.coverage || frame.peerCoverage || frame.peers || frame.peerGone)
      ) {
        throw new Error(
          'coverage/rider delivery is a query snapshot, not a raw feed',
        )
      }
      frames++ // even an empty authoritative answer defeats late disk data
      transient(graph).forget(frame.transientReset ?? [])
      let bundles = frame.bundles ?? []
      let peers = frame.peers ?? []
      // A content delta must not re-pin/trim every row in a large answer.
      let affected = new Set([
        ...bundles.map((b) => b.entity.eid),
        ...peers.map((b) => b.entity.eid),
        ...frame.gone ?? [],
        ...frame.peerGone ?? [],
        ...frame.reset ? payloads(sub) : [],
      ])
      let owns = (eid: Eid) => sub.members.has(eid) || sub.peers.has(eid)
      let before = new Set([...affected].filter(owns))
      let changed = !!frame.reset || !sub.confirmed
      if (frame.reset) {
        sub.members.clear()
        sub.peers.clear()
      }
      let add = (role: Map<Eid, Coverage>, eid: Eid, scope: Coverage) => {
        let was = role.get(eid)
        if (was !== scope && JSON.stringify(was) !== JSON.stringify(scope)) {
          changed = true
        }
        role.set(eid, scope)
      }
      for (let b of bundles) {
        add(sub.members, b.entity.eid, frame.coverage?.[b.entity.eid] ?? true)
      }
      for (let b of peers) {
        add(
          sub.peers,
          b.entity.eid,
          frame.peerCoverage?.[b.entity.eid] ?? delivered(b),
        )
      }
      for (let eid of frame.gone ?? []) {
        if (sub.members.delete(eid)) changed = true
      }
      for (let eid of frame.peerGone ?? []) {
        if (sub.peers.delete(eid)) changed = true
      }
      for (let eid of affected) {
        if (owns(eid)) {
          known.add(eid)
          own(frame.id, eid)
        }
      }
      let gone = [...before].filter((eid) => !owns(eid))
      for (let eid of gone) disown(frame.id, eid)
      forget(gone, true)
      // Pending optimistic state beats subscription snapshots. The post reply
      // reconciles it; a query snapshot must not roll it backwards meanwhile.
      let receive = (rows: Bundle[], role: Map<Eid, Coverage>) =>
        snapshot(
          graph,
          rows.filter((b) => role.has(b.entity.eid) && !pins.has(b.entity.eid)),
          {
            coverage: Object.fromEntries(
              rows.map((b) => [b.entity.eid, role.get(b.entity.eid)!]),
            ),
            preserve: (eid, name, prop) => covered(eid, name, prop, role),
          },
        )
      return then(
        sub.query === true
          ? land(graph, {
            ...frame,
            bundles: bundles.filter((b) => !pins.has(b.entity.eid)),
            gone: [],
          })
          : then(
            receive(bundles, sub.members),
            (out) =>
              then(receive(peers, sub.peers), (rode) => [...out, ...rode]),
          ),
        (out) => {
          if (sub.query !== true) {
            for (const update of frame.transient ?? []) {
              if (owns(update.entity) && !pins.has(update.entity)) {
                transient(graph).receive(update)
              }
            }
          }
          trim([...affected])
          sub.confirmed = true
          if (changed) remember(sub)
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
          else {
            trim([eid])
            retain(eid)
          }
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
        answers.clear()
        owners.clear()
        for (let sub of subscriptions.values()) {
          sub.members.clear()
          sub.peers.clear()
          sub.confirmed = false
        }
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
      let read = queued.then(async () => {
        let rows = await opts.vault!.load(epoch, limit)
        let saved = await opts.vault!.loadAnswers?.(epoch, answerLimit) ?? []
        return { rows, saved }
      })
      queued = read.then(() => undefined, report)
      let { rows, saved } = await read
      if (generation !== turn) return
      loading = undefined
      if (frames !== beforeFrames) return
      let bundles = rows.filter((r) =>
        !touched.has(r.eid) && !pins.has(r.eid) && !known.has(r.eid)
      )
        .map((r) => ({ entity: { eid: r.eid, num: r.num }, ...r.comps }))
      for (let answer of saved) {
        if (!answers.get(answer.key)) answers.put(answer)
      }
      // A reopened watch owns its cached hits BEFORE the first frame. Hydration
      // must add late hits to that same ownership set, not invent another watch.
      await then(snapshot(graph, bundles), () => {
        for (let [id, sub] of subscriptions) {
          if (sub.confirmed) continue
          let cached = sub.key ? answers.get(sub.key) : undefined
          if (cached) {
            sub.members = floor(cached.members)
            sub.peers = floor(cached.peers)
          } else if (sub.query !== true && sub.prime) {
            for (let b of store.read(sub.query)) {
              sub.members.set(b.entity.eid, delivered(b))
            }
          }
          for (let eid of payloads(sub)) own(id, eid)
          trim([...payloads(sub)])
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
