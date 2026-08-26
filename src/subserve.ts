// One socket's serving half — the subscription registry, the live stream, and
// the catch-up handshake for a SINGLE client, parameterized by the db it reads
// and the send that reaches its socket. server.ts holds one instance per
// inline connection; a per-connection worker (wsworker.ts, D-22388 step 4)
// holds exactly one — same code, so the delegator split cannot fork frame
// semantics. This module depends on nothing in server.ts: everything it reads
// is a db-parameterized function, so a read-only connection serves as well as
// the writer's.
import type { DatabaseSync } from './sqlite.ts'
import type { Change } from './types.ts'
import {
  aggOf,
  listed,
  matchQuery,
  parseQuery,
  type Pred,
  predComps,
  resolveRefs,
} from './query.ts'
import {
  cursorOf,
  cursorStale,
  delta,
  eager,
  locate,
  referrersOf,
  refValuesOf,
  rootChanges,
} from './db.ts'
import { evalAgg, evalSub, workingSet } from './graph_query.ts'
import { liveFrame } from './wire.ts'
import { bodied, bodyless, gaps, spread, type Step, step } from './subs.ts'

// A Sub is this socket's saved query + the eids currently in its set. Shadow
// subs hear both streams for prove-before-flip; the later migration switch is
// still one boolean.
type Sub = {
  preds: Pred[]
  members: Set<string>
  shadow: boolean
  moving: boolean
  bodies: boolean
  details: boolean
  // A ROUTE sub (`route:<eid>`) names one entity by id, not a query — the
  // fullscreen root a client reaches by direct URL, which the query grammar
  // can't express (`.eid=` is refused, query.ts) and which no defining set
  // holds. `only` short-circuits the matcher to this fixed id: membership is
  // "this eid, while it's alive", so the entity loads whole (details), updates
  // live, and dies with the row. Empty/absent for every query sub.
  only?: Set<string>
  // An AGGREGATE sub (T-21283, D-22567 §1): a query carrying `.count!` /
  // `.tally=comp.prop` / `.distinct=col` answers a VALUE→COUNT map, not a member
  // list — one sub serves every tile's badge and every board tile's stats, so
  // neither a page of per-row reverse-lookups nor a board's whole membership
  // ever rides the wire. Nothing here is keyed by MEMBER: `counts` is the
  // standing answer (bounded by DISTINCT VALUES, not rows) and `line` re-answers
  // it with one indexed statement. `watch` is the dirty test — the components
  // the line reads, or null for "every batch dirties it". maintain() recomputes
  // a dirty aggregate and sends the DIFF (n=0 deletes a key).
  agg?: {
    line: string
    watch: Set<string> | null
    counts: Map<string, number>
  }
}

// What a subscription frame has to CARRY. A live subscription owns its
// client's view of these rows, so it ships the components. A SHADOW one does
// not: the client still hears the complete broadcast, and landSub() reads a
// shadow frame's changes for the eids only. Doc bodies ride only the subs that
// exist to show one entity whole (subs.ts bodied).
// The universal half of an aggregate's dirty test: whatever a line's preds
// name, EVERY query also reads the spine (a birth or a death moves any answer)
// and the quarantine facet (listed() screens on it). predComps names the rest.
let aggDirty = (watch: Set<string>, name: string) =>
  name == 'entity' || name == 'quarantined' || watch.has(name)

let carry = (sub: Sub, changes: Change[]) =>
  sub.bodies ? changes : bodyless(changes)

let payload = (
  sub: Sub,
  eid: string,
  comps: Record<string, Record<string, unknown>>,
): Change[] =>
  sub.shadow && !sub.details
    ? [{ eid, name: 'entity', comp: comps.entity as Change['comp'] }]
    : carry(sub, spread(eid, comps))

// A path member can move when any row along its reference chain changes, not
// only when the source itself changes. Walk each possible touched rung back to
// the source through the predicate's own columns. The reverse queries are
// component-keyed; ordinary subscriptions keep the touched-eid fast path.
let pathSources = (db: DatabaseSync, preds: Pred[], touched: string[]) => {
  let out = new Set(touched)
  for (let p of preds) {
    // A reverse hop: a touched CHILD moves its PARENT — read the child's ref
    // column back to the entity it points at. The sub-filter's own hops are
    // recomputed from the parent by matchQuery, so they need no separate
    // invalidation here.
    if (p.rev) {
      for (
        let eid of refValuesOf(db, touched, {
          comp: p.rev.comp,
          prop: p.rev.prop,
        })
      ) out.add(eid)
      continue
    }
    if (!p.at) continue
    let refs = [{ comp: p.comp, prop: p.prop }, ...p.at.slice(0, -1)]
    for (let depth = 1; depth <= refs.length; depth++) {
      let found = touched
      for (let at = depth - 1; at >= 0 && found.length; at--) {
        found = referrersOf(db, found, refs[at])
      }
      for (let eid of found) out.add(eid)
    }
  }
  return [...out]
}

// A reverse hop's Kids over the db: the children referring at `eid` through
// `comp.prop` (referrersOf), each hydrated to its eager bag by `read`, bound
// per pass to that pass's memoised fetcher.
export let dbKids = (
  db: DatabaseSync,
  read: (eid: string) => Record<string, Record<string, unknown>>,
) =>
(eid: string, comp: string, prop: string) =>
  referrersOf(db, [eid], { comp, prop }).map((k) => read(k))

// One entity as a subscription hit — its eager comps, or nothing if the id
// names no live entity yet (a route sub opened before its target is minted, or
// on a tombstone). Shaped like an evalFast/evalQuery hit so control() ships it
// through the one payload path.
let rowsFor = (
  db: DatabaseSync,
  eid: string,
): { eid: string; comps: Record<string, Record<string, unknown>> }[] => {
  let comps = eager(db, eid)
  return comps.entity ? [{ eid, comps }] : []
}

export type Subserve = ReturnType<typeof subserve>

export let subserve = (db: DatabaseSync, send: (json: string) => void) => {
  let map = new Map<string, Sub>()
  // `joined` = the {since} handshake ran, so the live stream may reach this
  // socket; `filtered` = a non-shadow sub owns the socket's cache, so the
  // complete stream must NOT. A socket that declared neither hears nothing.
  let joined = false
  let filtered = false
  let envelope = false

  // A socket's control frame: `{sub, q}` subscribes or replaces (the initial
  // frame is the query's current matches as one batch, and seeds the member
  // set, marked `replace` for the client); `{unsub}` forgets one.
  let control = (
    f: { sub?: string; q?: string; unsub?: string; shadow?: boolean },
  ) => {
    // A shadow subscription proves its set beside the complete stream. It must
    // not flip the socket into partial-cache delivery before stage 2c.
    if (typeof f.sub == 'string' && !f.shadow) filtered = true
    if (typeof f.unsub == 'string') return void map.delete(f.unsub)
    if (typeof f.sub != 'string') return
    try {
      // A route sub names one entity by id in its own name — no query to eval;
      // its hits are that entity's current comps (empty if it isn't minted
      // yet, so a later create ADDs it). A query sub evaluates its filter.
      let route = f.sub.startsWith('route:')
        ? f.sub.slice('route:'.length)
        : null
      let details = route != null || f.sub.startsWith('entries:')
      // An aggregate sub answers a VALUE, so it never enumerates members — not
      // even once, at subscribe. Parse the line, and if it carries an AGG
      // projection let evalAgg answer it with one indexed statement; only a
      // membership sub pays evalSub's row set.
      let line = f.q ?? ''
      let asked = route != null
        ? []
        : resolveRefs(parseQuery(line), (id) => locate(db, id))
      if (aggOf(asked)) {
        let counts = evalAgg(db, line)?.values ?? new Map<string, number>()
        map.set(f.sub, {
          preds: [],
          members: new Set(),
          shadow: !!f.shadow,
          moving: false,
          bodies: false,
          details: false,
          agg: { line, watch: predComps(asked), counts },
        })
        send(JSON.stringify({
          sub: f.sub,
          agg: Object.fromEntries(counts),
          replace: true,
          cursor: cursorOf(db),
          shadow: !!f.shadow,
        }))
        return
      }
      // An empty query SELECTS NOTHING (query.ts parseQuery mints the
      // never-pred), so an empty sub legitimately answers the empty set —
      // cheap, no error. Only a route sub carries meaning with no query: its
      // name scopes it to one entity.
      let { preds, hits } = route != null
        ? { preds: [], hits: rowsFor(db, route) }
        : evalSub(db, line, details)
      map.set(f.sub, {
        preds,
        members: new Set(hits.map((r) => r.eid)),
        shadow: !!f.shadow,
        moving: gaps(preds).includes('moving-time'),
        bodies: bodied(f.sub),
        // Entry partitions and route entities are absent from both the root
        // snapshot and root live stream, so their shadow owns bodies and
        // standing-match updates too.
        details,
        ...(route != null ? { only: new Set([route]) } : {}),
      })
      let sub = map.get(f.sub)!
      let changes = hits.flatMap((r) => payload(sub, r.eid, r.comps))
      send(
        JSON.stringify({
          sub: f.sub,
          changes,
          drop: [],
          replace: true,
          cursor: cursorOf(db),
          shadow: !!f.shadow,
        }),
      )
    } catch (e) {
      console.warn('sub: bad query —', e)
    }
  }

  // The catch-up handshake (T-6829): the client declares the cursor+epoch+
  // vocab it holds; this side replays the journal since it — or a full reset
  // if the cursor is void or its epoch/vocab moved — and only THEN opens the
  // live stream, so every later commit reaches it AFTER its catch-up, in
  // journal order. `drain` is the caller's chance to settle its feed first so
  // an unsettled foreign commit can't arrive twice (inline mode); a worker
  // needs none, because its casts arrive through the same serialized message
  // queue as this frame — a commit racing the join lands in the delta AND as a
  // later cast, a dup the wire contract absorbs, never a gap.
  let join = (
    f: { since?: number; epoch?: string; vocab?: string; live?: number },
    drain?: () => void,
  ) => {
    drain?.()
    envelope = f.live == 1
    if (f.since == null || cursorStale(db, f.epoch, f.vocab, f.since)) {
      // A cold or stale client seeds the WORKING SET — never the whole graph
      // (M-21143); its subscriptions stream the rest on demand.
      send(JSON.stringify({ reset: true, snapshot: workingSet(db) }))
    } else {
      let d = delta(db, f.since)
      send(JSON.stringify({ catchup: d.changes, cursor: d.cursor }))
    }
    joined = true
  }

  // Route a parsed control-object frame ({since} vs {sub}/{unsub}). Write
  // batches never reach here — the delegator applies them in the writer
  // process.
  let frame = (f: Record<string, unknown>, drain?: () => void) =>
    'since' in f ? join(f, drain) : control(f)

  // The live stream: one committed batch, root-projected, in the shape this
  // socket negotiated — skipped entirely once a non-shadow sub owns the cache.
  let live = (changes: Change[], cursor: number) => {
    if (!joined || filtered) return
    let rooted = rootChanges(db, changes)
    if (!rooted.length) return
    send(JSON.stringify(liveFrame(rooted, cursor, envelope)))
  }

  // Fold a committed batch into every subscription, synchronously — no await
  // between the caller's commit knowledge and these frames. Per candidate eid
  // × sub: one eager keyed read (batch-cached), then the transition — ADD
  // queues full comps, UPDATE queues the batch's own patches, REMOVE pushes a
  // drop, a death forwards entity-null.
  let maintain = (batch: Change[], cur = cursorOf(db)) => {
    if (!map.size) return
    let gone = new Set(
      batch.filter((c) => c.name == 'entity' && c.comp == null).map((c) =>
        c.eid
      ),
    )
    let touched = [...new Set(batch.map((c) => c.eid))]
    let reads = new Map<string, Record<string, Record<string, unknown>>>()
    let comps = (eid: string) => {
      let hit = reads.get(eid)
      if (!hit) reads.set(eid, hit = eager(db, eid))
      return hit
    }
    let patch = new Map<string, Change[]>()
    for (let c of batch) patch.set(c.eid, [...(patch.get(c.eid) ?? []), c])
    for (let [id, sub] of map) {
      // An aggregate sub speaks value→count deltas. The batch DIRTIES it only
      // if it touches a component the line reads (D-22567 §1) — an unrelated
      // write costs one Set lookup per changed component and nothing else. A
      // dirty aggregate re-answers from the INDEX (evalAgg: count/group-by over
      // indexed columns, µs) and ships the DIFF against the standing answer, so
      // a birth, a death and a moved value all fall out of one recompute
      // without a per-member map to keep honest. n=0 tells the client to drop
      // the key.
      if (sub.agg) {
        let { line, watch, counts } = sub.agg
        if (watch && !batch.some((c) => aggDirty(watch, c.name))) continue
        let next = evalAgg(db, line)?.values ?? new Map<string, number>()
        let delta = new Map<string, number>()
        for (let [v, n] of next) if (counts.get(v) != n) delta.set(v, n)
        for (let v of counts.keys()) if (!next.has(v)) delta.set(v, 0)
        sub.agg.counts = next
        if (delta.size) {
          send(JSON.stringify({
            sub: id,
            agg: Object.fromEntries(delta),
            cursor: cur,
            shadow: sub.shadow,
          }))
        }
        continue
      }
      let changes: Change[] = []
      let drop: string[] = []
      let candidates = sub.preds.some((p) => p.at || p.rev)
        ? pathSources(db, sub.preds, touched)
        : touched
      for (let eid of candidates) {
        let c = gone.has(eid) ? {} : comps(eid)
        let alive = !gone.has(eid) && !!c.entity
        // A route sub matches its fixed id; a query sub runs the matcher.
        let hit = alive &&
          (sub.only ? sub.only.has(eid) : listed(c, sub.preds) &&
            matchQuery(c, sub.preds, comps, undefined, dbKids(db, comps)))
        let s: Step = step(sub.members, eid, alive, hit)
        if (s == 'add') changes.push(...payload(sub, eid, c))
        // A standing match tells a shadow sub nothing: membership did not
        // move, and the client heard the patch on the complete stream.
        else if (s == 'update' && (!sub.shadow || sub.details)) {
          changes.push(...carry(sub, patch.get(eid) ?? []))
        } else if (s == 'remove') drop.push(eid)
        else if (s == 'dead') changes.push({ eid, name: 'entity', comp: null })
      }
      if (changes.length || drop.length) {
        send(JSON.stringify({
          sub: id,
          changes,
          drop,
          cursor: cur,
          shadow: sub.shadow,
        }))
      }
    }
  }

  // One committed batch, both halves in the maintained order: the live stream
  // reaches complete-broadcast clients BEFORE maintain() runs, so a client
  // always holds an entity's components before a shadow frame mentions its eid.
  let cast = (changes: Change[], cursor: number) => {
    live(changes, cursor)
    maintain(changes, cursor)
  }

  // A moving time phrase names a window the CLOCK moves, not the data — so a
  // member ages out of it with nobody writing anything, and maintain() only
  // ever re-tests what a batch touched. On each tick, every moving-time
  // subscription re-tests its OWN members against the clock and drops the ones
  // that have fallen out (drop-only is exact for past-facing windows; a
  // future-facing gain still classifies as a gap in subs.ts).
  let aged = (now = Date.now()) => {
    let cur = cursorOf(db)
    let reads = new Map<string, Record<string, Record<string, unknown>>>()
    let comps = (eid: string) => {
      let hit = reads.get(eid)
      if (!hit) reads.set(eid, hit = eager(db, eid))
      return hit
    }
    for (let [id, sub] of map) {
      if (!sub.moving) continue
      let changes: Change[] = []
      let drop: string[] = []
      for (let eid of [...sub.members]) {
        let c = comps(eid)
        let alive = !!c.entity
        let hit = alive && listed(c, sub.preds) &&
          matchQuery(c, sub.preds, comps, now, dbKids(db, comps))
        let s: Step = step(sub.members, eid, alive, hit)
        if (s == 'remove') drop.push(eid)
        else if (s == 'dead') changes.push({ eid, name: 'entity', comp: null })
      }
      if (changes.length || drop.length) {
        send(JSON.stringify({
          sub: id,
          changes,
          drop,
          cursor: cur,
          shadow: sub.shadow,
        }))
      }
    }
  }

  // A session observation reaches only the sockets holding that session's
  // entries partition open. Returns whether this one sent.
  let observe = (frame: string, session: string) => {
    if (!map.has(`entries:${session}`)) return false
    send(frame)
    return true
  }

  return { frame, cast, maintain, aged, observe }
}
