// The browser half: one graph cache, narrow render signals, one socket,
// one identity, one camera. A snapshot fills the cache; patches publish
// only the rows and relationships their renderers hold.
import {
  batch,
  computed,
  type Signal,
  signal,
  untracked,
} from '@preact/signals'
import {
  awake,
  type Change,
  comps as vocab,
  type Dep,
  type Ent,
  type Live,
  type Pinned,
  type Session,
  settled,
  type Snapshot,
  stamped,
} from './types.ts'
import { type Row } from './client.ts'
import { matchQuery, orderOf, parseQuery, resolveRefs, warm } from './query.ts'
import { normalizeChanges } from './props.ts'
import * as idb from './idb.ts'
import { topology } from './leader.ts'
import { liveChanges } from './wire.ts'
import { diff, gaps } from './subs.ts'

// A cache row: the spine plus whichever components the entity carries.
// Derived from Ent so a new component (types.ts) threads through here —
// and through ent() below — with zero edits. Exported so idb.ts persists
// and hydrates the exact shape the signal holds (T-6823).
export type Comps =
  & { entity?: { eid: string; num: number } }
  & Omit<Ent, 'eid' | 'num' | 'kind' | 'refs' | 'kids'>

export let cache = signal<Record<string, Comps>>({})
export let deps = signal<Dep[]>([])
export let problem = signal('')
let pinZs = new Map<string, Signal<number>>()
let rowSignals = new Map<string, Signal<Comps | undefined>>()
let relationSignals = new Map<string, Signal<Dep[]>>()
let childSignals = new Map<string, Signal<Dep[]>>()
export let census = signal<string[]>([])
let canvasVersion = signal(0)
let noRelations: Dep[] = []
let refreshBoards = (_eids: Set<string>) => {}
let refreshPins = (_eids: Set<string>) => {}
let refreshComments = (_eids: Set<string>) => {}
let refreshFolds = (_eids: Set<string>) => {}
let refreshBacklinks = (_eids: Set<string>) => {}
let refreshJobs = (_eids: Set<string>) => {}
let refreshBoardLinks = (_eids: Set<string>) => {}
let refreshFacets = (_eids: Set<string>) => {}

// One pass over deps gives every parent a stable seed. The narrow signals
// below own render invalidation; this computed only avoids an edge-list scan
// for every entity mounted during first render.
let relationIndex = computed(() => {
  let found = new Map<string, Dep[]>()
  for (let d of deps.value) {
    let mine = found.get(d.parent)
    if (mine) mine.push(d)
    else found.set(d.parent, [d])
  }
  return found
})
let childIndex = computed(() => {
  let found = new Map<string, Dep[]>()
  for (let d of deps.value) {
    let mine = found.get(d.child)
    if (mine) mine.push(d)
    else found.set(d.child, [d])
  }
  return found
})

// Renderers hold these narrow signals; the complete cache remains the
// persistence and query door. A signal is minted once per eid so a patch
// cannot wake an unrelated entity.
export let row = (eid: string) => {
  let current = untracked(() => cache.value[eid])
  let found = rowSignals.get(eid)
  if (!found) {
    rowSignals.set(eid, found = signal(current))
  } else if (found.peek() !== current) found.value = current
  return found
}

export let relations = (eid: string) => {
  let current = untracked(() => relationIndex.value.get(eid)) ?? noRelations
  let found = relationSignals.get(eid)
  if (!found) {
    relationSignals.set(eid, found = signal(current))
  } else if (found.peek() !== current) found.value = current
  return found
}

let childRelations = (eid: string) => {
  let current = untracked(() => childIndex.value.get(eid)) ?? noRelations
  let found = childSignals.get(eid)
  if (!found) {
    childSignals.set(eid, found = signal(current))
  } else if (found.peek() !== current) found.value = current
  return found
}

let publish = (
  eids: Set<string>,
  parentEids: Set<string>,
  childEids: Set<string>,
) =>
  batch(() => {
    for (let eid of eids) {
      let found = rowSignals.get(eid)
      if (found) found.value = cache.value[eid]
    }
    for (let eid of parentEids) {
      let found = relationSignals.get(eid)
      if (found) {
        found.value = relationIndex.value.get(eid) ?? noRelations
      }
    }
    for (let eid of childEids) {
      let found = childSignals.get(eid)
      if (found) found.value = childIndex.value.get(eid) ?? noRelations
    }
  })

let resetSignals = () =>
  batch(() => {
    let touched = new Set([...census.peek(), ...Object.keys(cache.value)])
    census.value = Object.keys(cache.value)
    canvasVersion.value++
    for (let [eid, found] of rowSignals) found.value = cache.value[eid]
    for (let [eid, found] of relationSignals) {
      found.value = relationIndex.value.get(eid) ?? noRelations
    }
    for (let [eid, found] of childSignals) {
      found.value = childIndex.value.get(eid) ?? noRelations
    }
    refreshBoards(touched)
    refreshPins(touched)
    refreshComments(touched)
    refreshFolds(touched)
    refreshBacklinks(touched)
    refreshJobs(touched)
    refreshBoardLinks(touched)
    refreshFacets(touched)
  })

// A z-only pin patch binds straight to its one DOM attribute. The fallback
// seeds cards mounted after the patch without making this signal map a cache.
export let pinZ = (eid: string, fallback: number) => {
  let z = pinZs.get(eid)
  if (!z) pinZs.set(eid, z = signal(fallback))
  return z
}

let sameProps = (
  a: Record<string, unknown>,
  b: Record<string, unknown>,
) => {
  let keys = Object.keys(a)
  return keys.length == Object.keys(b).length &&
    keys.every((k) => Object.is(a[k], b[k]))
}

// Where the server lives and what a code reload means. The browser answers
// both from its location; other hosts (the TUI) configure these before
// boot() — a terminal process can't "reload the page". swap/css are the
// hot doors: main.tsx installs them at boot, and a host that doesn't
// (the TUI) just falls back to reload — a no-op without a location.
let loc = (globalThis as {
  location?: { host: string; protocol?: string; reload(): void }
}).location
export let config: {
  host: string
  secure: boolean
  // This tab's client eid, ridden on the /ws URL so its writes journal a
  // resolved actor (T-6669). The browser sets it (clientId); the TUI
  // leaves it unset — localStorage is a browser thing — and its writes
  // resolve to the box owner.
  client?: string
  // One switch restores 2.1's per-tab socket + boot-only IDB writes.
  shared: boolean
  // Stage-2 migration probes compare shadow sets to scans. Deployed clients
  // maintain the shadow without carrying agreement telemetry.
  agreement: boolean
  reload: () => void
  swap?: (gen: number) => void
  css?: (gen: number) => void
} = {
  host: loc?.host ?? '127.0.0.1:5173',
  // Behind an https front door the page's scheme must carry through to
  // the socket and fetches — a hardcoded http:// is mixed content there.
  secure: loc?.protocol == 'https:',
  shared: true,
  agreement: false,
  reload: () => loc?.reload(),
}
export let agreementProbe = (search: string) =>
  new URLSearchParams(search).get('probe') == 'subscriptions'
export let base = () => `http${config.secure ? 's' : ''}://${config.host}`

// The column sort: priority first (lower sorts higher), num as tiebreak.
export { settled, statuses, uuid } from './types.ts'
import { kindOf, uuid } from './types.ts'
export let byPriority = (a: Ent, b: Ent) =>
  (a.task!.priority - b.task!.priority) || (a.num - b.num)

// An Ent's warmth — the cache-side face of query.ts warm(), for boards
// that say .order=hot. The Ent flattens the spine, so re-nest what the
// scorer reads (project/task ride along so retirement can sink it);
// ties break to the newer num, like byPriority.
export let warmth = (e: Ent, now: number) =>
  warm(
    {
      recall: e.recall as Record<string, unknown> | undefined,
      updated: e.updated as Record<string, unknown> | undefined,
      created: e.created as Record<string, unknown> | undefined,
      project: e.project as Record<string, unknown> | undefined,
      task: e.task as unknown as Record<string, unknown> | undefined,
    },
    now,
    (eid) => cache.value[eid],
  )
export let byWarmth = (now: number) => (a: Ent, b: Ent) =>
  (warmth(b, now) - warmth(a, now)) || (b.num - a.num)

// Gated = any `requires` edge whose child is an unsettled task. Blocked is
// this FACT about the edges — there is no 'blocked' status to maintain. A
// cancelled blocker settles the gate too: it either releases the parent or
// the parent's own status is the thing that needs rethinking, and the red
// dot can't tell which.
export let gated = (e: Ent) =>
  e.refs.some((r) => {
    let c = ent(r.child)
    return r.type == 'requires' && c.task && !settled(c.task.status)
  })

// A live hand on the entity: its claim's session is awake — a managed
// run still going, or an external door still open. The wip pip pulses
// on this instead of sitting half-filled; a stale claim doesn't count.
export let crewed = (e: Ent) => {
  let s = e.claim && ent(e.claim.session_eid).session
  return !!s && awake(s)
}

// Which door boot took, plus a cache peek — exposed for eyes (a CDP probe,
// the console) to verify properties invisible from the DOM (the reload win,
// live-only columns that never touch IDB). Not load-bearing.
let mark = (path: string) => ((globalThis as { __boot?: string }).__boot = path)
;(globalThis as { __peek?: (eid: string) => unknown }).__peek = (eid) =>
  cache.value[eid]

// Land a batch in the cache with the same patch semantics the db uses:
// comps merge per-column, comp: null deletes the component, entity: null
// deletes the entity and every edge touching it. Returns the eids and edges
// it touched (an entity death touches the eid AND every edge it swept) so the
// persist tail — and boot's explicit delta write — mirror exactly those keys
// into IDB, no diff of the whole cache.
export let applyLocal = (changes: Change[]) => {
  let eids = new Set<string>()
  let edges: Dep[] = []
  let changedRows = new Set<string>()
  let changedParents = new Set<string>()
  let changedChildren = new Set<string>()
  let changedPins = new Set<string>()
  let changedCanvas = false
  let changedCensus = false
  let changed = false
  // Camera motion renders from camera.value + hear(), not the graph cache.
  // Keep its durable row current without publishing a whole-graph signal.
  let motion = ({ eid, name, comp }: Change) =>
    !!cache.value[eid]?.camera && comp != null &&
    (name == 'camera' || name == 'updated')
  // Stacking is its own live partition too: raising one card must repaint
  // pins, not every entity and board mounted around them.
  let stacking = ({ eid, name, comp }: Change) =>
    !!cache.value[eid]?.pin && comp != null &&
    (name == 'updated' ||
      (name == 'pin' && Object.keys(comp).every((p) => p == 'z')))
  let quiet = changes.length > 0 &&
    changes.every((c) => motion(c) || stacking(c))
  let next = quiet ? cache.value : { ...cache.value }
  let zs = new Map<string, number>()
  for (let { eid, name, comp } of changes) {
    if (name == 'entity' && comp == null) {
      let before = next[eid]
      let lived = !!before
      eids.add(eid)
      if (lived) {
        delete next[eid]
        pinZs.delete(eid)
        changed = true
        changedCensus = true
        changedRows.add(eid)
        changedPins.add(eid)
        if (before.canvas) changedCanvas = true
      }
      // The cascade: every edge touching the dead eid leaves deps too —
      // record them so the IDB shadow drops the same rows the signal does.
      for (let d of deps.value) {
        if (d.parent == eid || d.child == eid) {
          edges.push(d)
          changedParents.add(d.parent)
          changedChildren.add(d.child)
        }
      }
      if (edges.length) {
        deps.value = deps.value.filter((d) => d.parent != eid && d.child != eid)
      }
      continue
    }
    // An edge change names its whole triple (see db.ts): gone removes it,
    // otherwise it joins the edge list once.
    if (name == 'dependency') {
      if (!comp) continue
      let d = {
        parent: eid,
        type: comp.type as Dep['type'],
        child: String(comp.child_eid),
      }
      edges.push(d)
      let same = (x: Dep) =>
        x.parent == d.parent && x.type == d.type && x.child == d.child
      let nextDeps = comp.gone
        ? deps.value.filter((x) => !same(x))
        : deps.value.some(same)
        ? deps.value
        : [...deps.value, d]
      if (nextDeps != deps.value) {
        deps.value = nextDeps
        changedParents.add(eid)
        changedChildren.add(d.child)
      }
      continue
    }
    eids.add(eid)
    let before = next[eid] as Record<string, unknown> | undefined
    if (comp == null) {
      if (!before || !(name in before)) continue
      let row = { ...before }
      delete row[name]
      next[eid] = row as Comps
      changed = true
      changedRows.add(eid)
      if (name == 'card' || name == 'pin') changedPins.add(eid)
      if (name == 'canvas' || (name == 'entity' && before?.canvas)) {
        changedCanvas = true
      }
      continue
    }
    let prior = before?.[name] as Record<string, unknown> | undefined
    let after = { ...prior, ...comp }
    if (prior && sameProps(prior, after)) continue
    next[eid] = { ...before, [name]: after } as Comps
    if (!before) changedCensus = true
    if (name == 'pin' && after.z != null) zs.set(eid, Number(after.z))
    if (
      name == 'card' ||
      (name == 'pin' && Object.keys(comp).some((p) => p != 'z'))
    ) changedPins.add(eid)
    if (name == 'canvas' || (name == 'entity' && before?.canvas)) {
      changedCanvas = true
    }
    changed = true
    changedRows.add(eid)
  }
  if (changed && !quiet) cache.value = next
  batch(() => {
    if (changedCensus) census.value = Object.keys(next)
    if (changedCanvas) canvasVersion.value++
    publish(changedRows, changedParents, changedChildren)
    refreshBoards(changedRows)
    refreshPins(changedPins)
    refreshComments(changedRows)
    refreshFolds(changedRows)
    refreshBacklinks(changedRows)
    refreshJobs(changedRows)
    refreshBoardLinks(changedRows)
    refreshFacets(changedRows)
    for (let [eid, z] of zs) {
      let live = pinZs.get(eid)
      if (live) live.value = z
    }
  })
  // The touched keys feed either the boot catch-up write, or the Web-Lock
  // leader's live persist. Followers and 2.1 fallback tabs never persist a
  // live frame.
  return { eids: [...eids], edges }
}

// The cursor/epoch/vocab this tab holds. A promoted follower opens its socket
// from this cursor; the server replays the handoff gap before joining it to
// live broadcast.
let held: idb.Meta = {}
export let capable = (name: string) => !!held.capabilities?.includes(name)

// Consumers that care about canonical live edits subscribe here. WebSocket is
// an implementation detail now that follower tabs have none.
let listeners = new Set<(changes: Change[]) => void>()
export let hear = (fn: (changes: Change[]) => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
let tell = (changes: Change[]) => {
  for (let fn of listeners) fn(changes)
}

// Land a local edit: cache first (instant render), then the wire.
export let mutate = (...changes: Change[]) => {
  problem.value = ''
  let parsed = normalizeChanges(changes, { resolve: findEid })
  applyLocal(parsed)
  send(...parsed)
}

type Catchup = { catchup: Change[]; cursor: number }
type Reset = { reset?: boolean; snapshot: Snapshot; error?: string }
export type Sub = {
  sub: string
  changes: Change[]
  drop?: string[]
  replace?: boolean
  cursor?: number
  shadow?: boolean
}
type Hot = 'reload' | { hmr: number } | { css: number }

let owner: ReturnType<typeof topology<unknown>> | null = null
let ws: WebSocket | null = null
let polling = false
let serial = Promise.resolve()

let hot = (data: unknown): data is Hot => {
  if (data == 'reload') return true
  if (!data || typeof data != 'object') return false
  return 'hmr' in data || 'css' in data
}

// One physical socket. Only the lock holder calls this in shared mode; the
// fallback calls it per tab. Incoming JSON is parsed once here, serialized
// through IDB, then fanned as structured-clone data.
let connect = () => {
  if (ws && ws.readyState <= WebSocket.OPEN) return ws
  let socket = new WebSocket(
    `ws${config.secure ? 's' : ''}://${config.host}/ws${
      config.client ? `?client=${config.client}` : ''
    }`,
  )
  ws = socket
  // The catch-up handshake: send the held cursor first, so every later live
  // frame the server broadcasts arrives AFTER the catch-up it just sent.
  socket.onopen = () =>
    socket.send(JSON.stringify({
      since: held.cursor ?? 0,
      epoch: held.epoch,
      vocab: held.vocabHash,
      live: 1,
    }))
  socket.onmessage = (m) => {
    let data = JSON.parse(String(m.data)) as unknown
    serial = serial.then(async () => {
      // Reload must leave the leader before its own page disappears.
      let share = owner
      let leader = share?.isLeader() ?? false
      if (leader && hot(data)) share?.fan(data)
      await land(data, leader ? 'leader' : 'solo')
      if (leader && !hot(data)) share?.fan(data)
    }).catch((e) => {
      problem.value = String(e)
    })
  }
  socket.onclose = () => {
    if (ws == socket) ws = null
    if (polling) return
    polling = true
    let poll = setInterval(async () => {
      try {
        await fetch(`${base()}/snapshot`, { method: 'HEAD' })
        clearInterval(poll)
        polling = false
        owner?.fan('reload')
        setTimeout(config.reload)
      } catch { /* still down */ }
    }, 500)
  }
  return socket
}

let wire = (frame: unknown) => {
  let s = connect()
  let msg = JSON.stringify(frame)
  if (s.readyState == WebSocket.OPEN) s.send(msg)
  else s.addEventListener('open', () => s.send(msg), { once: true })
}

let route = (frame: unknown) => owner ? owner.route(frame) : wire(frame)
export let send = (...changes: unknown[]) => route(changes)

// Query subscriptions (T-3683), the client half. The cache becomes a UNION of
// subscription result sets: `subMembers` refcounts which eids each sub holds,
// so an eid that leaves EVERY subscription is evicted — the one new cache
// mechanic (design §4). A legacy full-broadcast client never subscribes, so
// this map stays empty and nothing is ever evicted. A shadow sub tracks the set
// without eviction while the complete stream remains the cache owner.
let subMembers = new Map<string, Set<string>>()
let subVersion = signal(0)
let shadows = new Set<string>()

// A subscription frame: land its changes like any batch (adds + updates flow
// through the unchanged applyLocal), then track membership. A death rides in
// `changes` as an entity-null (gone for everyone — applyLocal already removed
// it); a `drop` eid left THIS query but still exists (gone for this query
// only). Either way it leaves the sub's set, and an eid now in no set is
// evicted from the cache. A control reply replaces the prior set wholesale;
// maintenance frames patch it.
export let landSub = (f: Sub) => {
  let touched = applyLocal(f.changes)
  // The server marks shadow-ness on every frame it sends, so believe the
  // frame: the local `shadows` set only knows what THIS client asked for,
  // and the two must not be able to disagree about who owns the cache.
  if (f.shadow) shadows.add(f.sub)
  let old = subMembers.get(f.sub) ?? new Set<string>()
  let mine = f.replace ? new Set<string>() : old
  subMembers.set(f.sub, mine)
  let leaving: string[] = f.replace ? [...old] : [...(f.drop ?? [])]
  for (let c of f.changes) {
    if (c.name == 'entity' && c.comp == null) {
      mine.delete(c.eid)
      leaving.push(c.eid)
    } else mine.add(c.eid)
  }
  for (let eid of f.drop ?? []) mine.delete(eid)
  if (f.replace) leaving = leaving.filter((eid) => !mine.has(eid))
  if (!f.shadow && !shadows.has(f.sub)) evict(leaving)
  subVersion.value++
  return {
    eids: [...new Set([...touched.eids, ...(f.drop ?? [])])],
    edges: touched.edges,
  }
}

// Drop from the cache any eid held by no remaining subscription — a death
// already removed itself via applyLocal (harmless to revisit), a drop is the
// live "you no longer see this" that only this layer expresses.
let evict = (eids: string[]) => {
  let held = (eid: string) => [...subMembers.values()].some((s) => s.has(eid))
  let next = { ...cache.value }
  let changed = false
  let changedCanvas = false
  let gone = new Set<string>()
  for (let eid of eids) {
    if (!held(eid) && next[eid]) {
      if (next[eid].canvas) changedCanvas = true
      delete next[eid]
      pinZs.delete(eid)
      changed = true
      gone.add(eid)
    }
  }
  if (changed) {
    cache.value = next
    batch(() => {
      census.value = Object.keys(next)
      if (changedCanvas) canvasVersion.value++
      publish(gone, new Set(), new Set())
      refreshBoards(gone)
      refreshPins(gone)
      refreshComments(gone)
      refreshFolds(gone)
      refreshBacklinks(gone)
      refreshJobs(gone)
      refreshBoardLinks(gone)
      refreshFacets(gone)
    })
  }
}

// A control frame is an OBJECT (design §1), distinct from the array batches
// send() ships — a subscribe/replace or an unsubscribe.
let control = (frame: object) => {
  route(frame)
}
export let subscribe = (sub: string, q: string) => control({ sub, q })
let shadow = (sub: string, q: string) => {
  shadows.add(sub)
  control({ sub, q, shadow: true })
}
// Closing a subscription hands its members back. Both orderings matter and
// they pull opposite ways: the departing set must be read BEFORE the
// subscription goes (deleting it first loses the list), and evict() must run
// AFTER, because it asks the REMAINING subscriptions whether anyone still
// holds each eid — an eid two boards share survives the first close and
// leaves on the second. A shadow sub never owned the cache (the complete
// stream did), so it takes nothing with it.
let forget = (sub: string) => {
  let leaving = shadows.has(sub) ? [] : [...(subMembers.get(sub) ?? [])]
  shadows.delete(sub)
  subMembers.delete(sub)
  agreement?.checked.delete(sub)
  if (leaving.length) evict(leaving)
  subVersion.value++
}
export let unsubscribe = (sub: string) => {
  forget(sub)
  control({ unsub: sub })
}

// The subscription result is separate from the cache: undefined means the
// initial frame has not landed; an empty Set is a ready, empty result.
export let subEids = (sub: string): Set<string> | undefined => {
  subVersion.value
  let found = subMembers.get(sub)
  return found && new Set(found)
}

type Agreement = {
  checked: Map<string, string>
  counts: { agreements: number; divergences: number; annotated: number }
}
let agreement: Agreement | undefined
export let subscriptionChecks = () =>
  agreement ? { ...agreement.counts } : undefined

// Compare after adjacent full/sub frames have both had a turn. The scan stays
// the caller's render source; this is only a diagnostic and probe counter.
export let assertAgree = (
  sub: string,
  q: string,
  scan: Iterable<string>,
  members: Iterable<string>,
) => {
  if (!config.agreement) return
  let state = agreement ??= {
    checked: new Map(),
    counts: { agreements: 0, divergences: 0, annotated: 0 },
  }
  let expected = [...new Set(scan)].sort()
  let received = [...new Set(members)].sort()
  let signature = JSON.stringify([q, expected, received])
  if (state.checked.get(sub) == signature) return
  state.checked.set(sub, signature)
  setTimeout(() => {
    if (
      boardUses.get(sub)?.q != q || state.checked.get(sub) != signature
    ) return
    state.counts.agreements++
    let d = diff(expected, received)
    if (!d.scanOnly.length && !d.subOnly.length) return
    state.counts.divergences++
    let unsupported = gaps(parseQuery(q))
    let note = {
      sub,
      query: q,
      scanOnly: d.scanOnly,
      subOnly: d.subOnly,
      unsupported,
    }
    if (unsupported.length) {
      state.counts.annotated++
      console.warn('subscription agreement deferred —', note)
    } else {
      console.assert(false, 'subscription divergence', note)
    }
  }, 20)
}

let boardUses = new Map<string, { n: number; q: string }>()

let ownBoard = (sub: string, q: string) =>
  owner ? owner.use(sub, q) : shadow(sub, q)
let dropBoard = (sub: string) => owner ? owner.drop(sub) : unsubscribe(sub)

// Several views in one tab share one ownership entry. Cross-tab references
// reduce in leader.ts before the one logical board name reaches the socket.
export let boardSub = (e: Ent) => {
  let sub = `board:${e.eid}`
  let q = String(e.board?.query ?? '')
  let use = boardUses.get(sub)
  if (use) use.n++
  else {
    boardUses.set(sub, { n: 1, q })
    ownBoard(sub, q)
  }
  return () => {
    let held = boardUses.get(sub)
    if (!held || --held.n > 0) return
    boardUses.delete(sub)
    dropBoard(sub)
  }
}

// Query edits replace the installed name without tearing down its ownership.
export let boardQuery = (e: Ent) => {
  let sub = `board:${e.eid}`
  let q = String(e.board?.query ?? '')
  let use = boardUses.get(sub)
  if (!use || use.q == q) return
  use.q = q
  ownBoard(sub, q)
}

// Fetch the whole graph, fill the signals, seed IDB — the first-visit path
// and the 409 fallback share it (a stale cursor just means "do what a new
// visitor does"). Replace the cache wholesale (clear then apply), stamp the
// held cursor, and seed IDB — seed() is a `full` forward-only commit that
// wins across a changed epoch and clears the stale rows in the same txn.
let seedFrom = (snap: Snapshot, write = true) => {
  pinZs.clear()
  cache.value = {}
  deps.value = snap.deps
  applyLocal(snap.changes)
  resetSignals()
  held = {
    cursor: snap.cursor,
    epoch: snap.epoch,
    vocabHash: snap.vocabHash,
    capabilities: snap.capabilities,
  }
  if (write) {
    return idb.seed(
      cache.value,
      deps.value,
      snap.cursor ?? 0,
      snap.epoch ?? '',
      snap.vocabHash ?? '',
      snap.capabilities ?? [],
    )
  }
  return Promise.resolve(false)
}

// First-visit / no-IDB fill: the whole graph over HTTP (the TUI and a fresh
// browser have nothing to hydrate, and a full snapshot can't reorder — it is
// a complete prefix). The socket's {since} handshake that follows just joins
// the broadcast and closes the fetch→open gap with a tiny catch-up.
let fromSnapshot = async (write = true) =>
  seedFrom(await (await fetch(`${base()}/snapshot`)).json(), write)

let persist = (
  touched: { eids: string[]; edges: Dep[] },
  cursor: number,
) =>
  idb.persist(touched.eids, touched.edges, cache.value, deps.value, {
    epoch: held.epoch ?? '',
    vocabHash: held.vocabHash ?? '',
    cursor,
    capabilities: held.capabilities ?? [],
  })

type Land = 'leader' | 'follower' | 'solo'

// Every incoming shape has one landing door. A leader durably lands a
// cursor-stamped live frame before fan-out; followers land only in memory.
// Catch-up/reset still persist in solo mode — the 2.1 boot write.
let land = async (data: unknown, mode: Land) => {
  if (hot(data)) {
    if (data == 'reload') setTimeout(config.reload)
    else if ('hmr' in data) {
      config.swap ? config.swap(data.hmr) : config.reload()
    } else config.css?.(data.css)
    return
  }
  let changes = liveChanges(data)
  if (changes) {
    let touched = applyLocal(changes)
    let cursor = Array.isArray(data)
      ? undefined
      : (data as Partial<Live>).cursor
    if (cursor !== undefined) {
      held = { ...held, cursor }
      if (mode == 'leader') await persist(touched, cursor)
    }
    tell(changes)
    return
  }
  if (!data || typeof data != 'object') return
  let frame = data as Partial<Live & Catchup & Reset & Sub>
  if (frame.error) problem.value = String(frame.error)
  if (frame.catchup !== undefined) {
    let touched = applyLocal(frame.catchup)
    if (frame.cursor !== undefined) {
      held = { ...held, cursor: frame.cursor }
      if (mode != 'follower') await persist(touched, frame.cursor)
    }
  } else if (frame.snapshot) {
    mark('reset')
    await seedFrom(frame.snapshot, mode != 'follower')
  } else if (typeof frame.sub == 'string') {
    let touched = landSub(frame as Sub)
    if (frame.cursor !== undefined) {
      held = { ...held, cursor: frame.cursor }
      if (mode == 'leader') await persist(touched, frame.cursor)
    }
  }
}

let local = async (write: boolean) => {
  let stored = await idb.hydrate()
  if (stored.meta.cursor === undefined) {
    mark('snapshot')
    await fromSnapshot(write)
  } else {
    mark('hydrate+delta')
    pinZs.clear()
    cache.value = stored.ents
    deps.value = stored.deps
    resetSignals()
    held = stored.meta
  }
}

let booted = false
let once = async (write: boolean) => {
  if (booted) return
  await local(write)
  booted = true
}

let canShare = () => {
  let nav = (globalThis as { navigator?: Navigator }).navigator
  return config.shared && !!config.client && !!nav?.locks &&
    typeof globalThis.BroadcastChannel != 'undefined'
}

// Open BroadcastChannel + queue for the lock before touching IDB. Thus a
// follower cannot miss a leader frame during hydration. The gate's fallback
// is exactly slice 2.1: boot locally and open this tab's socket.
export let boot = async () => {
  if (!canShare()) {
    await once(true)
    connect()
    return
  }
  let nav = (globalThis as { navigator: Navigator }).navigator
  let bus = new BroadcastChannel('tasks-sync')
  let channel: import('./leader.ts').Channel<unknown> = {
    onmessage: null,
    postMessage: (message) => bus.postMessage(message),
  }
  bus.onmessage = ({ data }) => channel.onmessage?.({ data })
  owner = topology(
    {
      request: (name, hold) => nav.locks.request(name, hold),
    },
    channel,
    {
      lead: async () => {
        await once(true)
        connect()
      },
      follow: () => once(false),
      solo: async () => {
        await once(true)
        connect()
      },
      receive: (frame) => {
        serial = serial.then(() => land(frame, 'follower'))
      },
      send: wire,
      subscribe: (sub, q) => {
        shadows.add(sub)
        wire({ sub, q, shadow: true })
      },
      unsubscribe: (sub) => wire({ unsub: sub }),
      forget,
    },
  )
  addEventListener('pagehide', owner.leave)
  await owner.start()
}
;(globalThis as {
  __sync?: () => {
    shared: boolean
    leader: boolean
    socket: number | null
    cursor?: number
  }
}).__sync = () => ({
  shared: !!owner && !owner.isSolo(),
  leader: owner?.isLeader() ?? false,
  socket: ws?.readyState ?? null,
  cursor: held.cursor,
})

// The whole entity, assembled for a renderer: spine, components present,
// outgoing edge sentences, contained children (recursive — graphs stay
// small; a view reads as deep as it wants).
export let ent = (eid: string): Ent => {
  let { entity, ...comps } = row(eid).value ?? {}
  if (comps.pin) comps.pin = { ...comps.pin, z: pinZ(eid, comps.pin.z).value }
  let mine = relations(eid).value
  return {
    ...comps, // whatever components the entity carries, verbatim —
    // created/updated (provenance) ride here like any other component now
    eid,
    num: entity?.num ?? 0,
    kind: kindOf(comps), // derived — the display convention, not data
    refs: mine
      .filter((d) => d.type != 'contains')
      .map((d) => ({ type: d.type, child: d.child })),
    kids: mine
      .filter((d) => d.type == 'contains')
      .map((d) => ent(d.child)),
  }
}

export let findEid = (id: string): string | undefined => {
  let num = id.match(/^[A-Za-z]+-(\d+)$/)?.[1] ?? id.match(/^(\d+)$/)?.[1]
  for (let [eid, r] of Object.entries(cache.value)) {
    if (num ? r.entity?.num == +num : r.alias?.slug == id) return eid
  }
}
// The same query over the WHOLE graph — the board's List face. No task
// gate: sessions, memories, docs, web, people — anything that matches.
// Chrome stays out (a camera's updated.at churns with every pan and
// would drown any hot feed; cards/folds/shelves/clients are presence,
// not content), comments surface through their targets (the lately
// digest's rule), and a board is not news to itself.
let CHROME = new Set(['card', 'camera', 'fold', 'shelf', 'client', 'comment'])
let chrome = (r: Comps) => [...CHROME].some((name) => r[name as keyof Comps])
export let boardPost = (
  e: Ent,
  tasks: boolean,
  eids: Iterable<string>,
): string[] =>
  [...eids].filter((eid) => {
    let r = cache.value[eid]
    // Facets are the truth: a shelf is also a canvas, so kindOf cannot name
    // the chrome component that keeps it out of the feed.
    return !!r && (tasks ? !!r.task : eid != e.eid && !chrome(r))
  })

type BoardSet = {
  eid: string
  tasks: boolean
  q: string
  preds: ReturnType<typeof parseQuery>
  complex: boolean
  graph: Record<string, Comps>
  ids: Signal<string[]>
  error?: unknown
}
let boardSets = new Map<string, BoardSet>()
let boardKey = (eid: string, tasks: boolean) =>
  `${eid}:${tasks ? 'tasks' : 'all'}`
let boardHits = (
  e: Ent,
  tasks: boolean,
  preds: ReturnType<typeof parseQuery>,
) =>
  boardPost(e, tasks, Object.keys(cache.value))
    .filter((eid) => matchQuery(cache.value[eid], preds, (t) => cache.value[t]))

let scanBoard = (set: BoardSet, e: Ent) => {
  let q = String(e.board?.query ?? '')
  let parsed = parseQuery(q)
  let preds = resolveRefs(parsed, findEid)
  let hits = boardHits(e, set.tasks, preds)
  set.q = q
  set.preds = preds
  set.complex = preds.some((p) => !!p.at) || orderOf(parsed) == 'hot'
  set.graph = cache.value
  set.error = undefined
  if (config.agreement) {
    let members = subEids(`board:${e.eid}`)
    if (members) {
      assertAgree(
        `board:${e.eid}`,
        q,
        hits,
        boardPost(e, set.tasks, members),
      )
    }
  }
  return hits
}

// Board membership is a local derived index, not a server subscription.
// A graph patch tests only its touched rows; stable membership keeps a
// parent Board asleep while an unrelated entity changes.
let boardSet = (e: Ent, tasks: boolean) => {
  let key = boardKey(e.eid, tasks)
  let q = String(e.board?.query ?? '')
  let found = boardSets.get(key)
  if (!found) {
    found = {
      eid: e.eid,
      tasks,
      q: '\0',
      preds: [],
      complex: false,
      graph: cache.peek(),
      ids: signal<string[]>([]),
    }
    boardSets.set(key, found)
  }
  if (found.q != q || found.graph != cache.peek()) {
    try {
      found.ids.value = untracked(() => scanBoard(found!, e))
    } catch (error) {
      found.q = q
      found.graph = cache.peek()
      found.error = error
    }
  }
  if (found.error) throw found.error
  return found
}

refreshBoards = (eids: Set<string>) => {
  for (let set of boardSets.values()) {
    let board = ent(set.eid)
    let q = String(board.board?.query ?? '')
    if (set.q != q || set.complex) {
      try {
        set.ids.value = untracked(() => scanBoard(set, board))
      } catch (error) {
        set.q = q
        set.graph = cache.peek()
        set.error = error
      }
      continue
    }
    let ids = set.ids.peek()
    let next = ids
    for (let eid of eids) {
      let had = next.includes(eid)
      let row = cache.peek()[eid]
      let candidate = !!row &&
        (set.tasks ? !!row.task : eid != set.eid && !chrome(row))
      let wants = candidate &&
        matchQuery(row, set.preds, (t) => cache.peek()[t])
      if (had != wants) {
        next = wants ? [...next, eid] : next.filter((x) => x != eid)
      } else if (had) next = [...next]
    }
    set.graph = cache.peek()
    if (next != ids) set.ids.value = next
  }
}

let boardScan = (e: Ent, tasks: boolean): Ent[] =>
  boardSet(e, tasks).ids.value.map(ent)

export let boardTasks = (e: Ent): Ent[] => boardScan(e, true)
export let boardAll = (e: Ent): Ent[] => boardScan(e, false)

// The ephemeral filter's evaluator: a bar's line parsed and ref-resolved
// ONCE, returned as a per-row test — Board and the Lists AND it into
// whatever they already show. Throws like a saved query does; the bar
// catches (mid-keystroke is no place to error) where a board would show.
export let sieve = (line: string): (eid: string) => boolean => {
  let preds = resolveRefs(parseQuery(line), findEid)
  if (!preds.length) return () => true
  return (eid) =>
    matchQuery(cache.peek()[eid] ?? {}, preds, (t) => cache.peek()[t])
}

// The cache as client Rows — the shape the headless half's helpers speak
// (find, the change builders, the command line's Ctx), so an id lookup or
// a claim batch is written once and serves the CLI, the web and the TUI.
export let rows = (): Row[] =>
  Object.entries(cache.value).map(([eid, r]) => ({
    eid,
    num: r.entity?.num ?? 0,
    kind: kindOf(r),
    comps: r as Record<string, Record<string, unknown>>,
  }))

let facetGraph = cache.peek()
let facetVersion = signal(0)
let domainList: string[] = []
let projectIds: string[] = []
let sessionIds: string[] = []
let shelfIds: string[] = []
let scanFacets = () => {
  domainList = [
    ...new Set(
      Object.values(cache.peek()).flatMap((r) => r.task?.domain || []),
    ),
  ].sort()
  projectIds = Object.entries(cache.peek())
    .filter(([, r]) => r.project)
    .sort(([, a], [, b]) =>
      (a.entity?.num ?? Infinity) - (b.entity?.num ?? Infinity)
    )
    .map(([eid]) => eid)
  sessionIds = Object.entries(cache.peek())
    .filter(([, r]) => r.session)
    .map(([eid]) => eid)
  shelfIds = Object.entries(cache.peek())
    .filter(([, r]) => r.shelf)
    .map(([eid]) => eid)
  facetGraph = cache.peek()
}
let facets = () => {
  facetVersion.value
  if (facetGraph != cache.peek()) scanFacets()
}

// Pickers watch the domain/project census, then each returned project row.
// An unrelated patch changes neither and leaves an open editor asleep.
export let domains = {
  get value() {
    facets()
    return domainList
  },
}
export let projects = (): Ent[] => {
  facets()
  return projectIds.map(ent)
}
export let sessionRows = (): [string, Session][] => {
  facets()
  return sessionIds.flatMap((eid) => {
    let s = row(eid).value?.session
    return s ? [[eid, s]] : []
  })
}
export let shelfFor = (client: string) => {
  facets()
  return shelfIds.find((eid) => cache.peek()[eid]?.shelf?.client_eid == client)
}

refreshFacets = (eids: Set<string>) => {
  let changed = [...eids].some((eid) => {
    let before = facetGraph[eid]
    let after = cache.peek()[eid]
    return before?.task?.domain != after?.task?.domain ||
      !!before?.project != !!after?.project ||
      ((!!before?.project || !!after?.project) &&
        before?.entity?.num != after?.entity?.num) ||
      !!before?.session != !!after?.session ||
      before?.shelf?.client_eid != after?.shelf?.client_eid
  })
  facetGraph = cache.peek()
  if (!changed) return
  scanFacets()
  facetVersion.value++
}

type CommentSet = {
  graph: Record<string, Comps>
  ids: Set<string>
  talk: Set<string>
  list: Signal<string[]>
  count: Signal<number>
}
type CommentIds = { ids: Set<string>; talk: Set<string> }
let commentSets = new Map<string, CommentSet>()
// One pass seeds every cold face. Per-target sets below own later live
// invalidation, so mounting a board never turns into one graph scan per tile.
let commentIndex = computed(() => {
  let found = new Map<string, CommentIds>()
  for (let [eid, r] of Object.entries(cache.value)) {
    let target = r.comment?.target_eid
    if (!target) continue
    let ids = found.get(target)
    if (!ids) found.set(target, ids = { ids: new Set(), talk: new Set() })
    ids.ids.add(eid)
    if (!r.comment?.event) ids.talk.add(eid)
  }
  return found
})
let commentIds = (target: string) => {
  let found = commentIndex.value.get(target)
  return {
    ids: new Set(found?.ids),
    talk: new Set(found?.talk),
  }
}

let commentSet = (target: string) => {
  let found = commentSets.get(target)
  if (!found) {
    let { ids, talk } = untracked(() => commentIds(target))
    found = {
      graph: cache.peek(),
      ids,
      talk,
      list: signal([...ids]),
      count: signal(talk.size),
    }
    commentSets.set(target, found)
  } else if (found.graph != cache.peek()) {
    let { ids, talk } = untracked(() => commentIds(target))
    found.ids = ids
    found.talk = talk
    found.graph = cache.peek()
    found.list.value = [...ids]
    found.count.value = talk.size
  }
  return found
}

// A face subscribes to its own comment list and tally. Birth, death,
// retargeting, and event changes update only the targets they affect.
export let commentsOn = (target: string): Ent[] =>
  commentSet(target).list.value.map(ent).sort((a, b) => a.num - b.num)
export let commentCount = (target: string) => commentSet(target).count

refreshComments = (eids: Set<string>) => {
  for (let [target, set] of commentSets) {
    let listed = false
    let counted = false
    for (let eid of eids) {
      let had = set.ids.has(eid)
      let spoke = set.talk.has(eid)
      let c = cache.peek()[eid]?.comment
      let wants = c?.target_eid == target
      let talks = wants && !c?.event
      if (had != wants) {
        wants ? set.ids.add(eid) : set.ids.delete(eid)
        listed = true
      }
      if (spoke != talks) {
        talks ? set.talk.add(eid) : set.talk.delete(eid)
        counted = true
      }
    }
    set.graph = cache.peek()
    if (listed) set.list.value = [...set.ids]
    if (counted) set.count.value = set.talk.size
  }
}

type Folded = { eid: string; statuses: string }
type FoldSet = {
  graph: Record<string, Comps>
  value: Signal<Folded | undefined>
}
let foldSets = new Map<string, FoldSet>()
let foldKey = (client: string, board: string) => `${client}:${board}`
let scanFold = (client: string, board: string): Folded | undefined => {
  let found = Object.entries(cache.value).find(([, r]) =>
    r.fold?.client_eid == client && r.fold.board_eid == board
  )
  return found && {
    eid: found[0],
    statuses: String(found[1].fold?.statuses ?? ''),
  }
}

export let foldFor = (client: string, board: string) => {
  let key = foldKey(client, board)
  let found = foldSets.get(key)
  if (!found) {
    found = {
      graph: cache.peek(),
      value: signal(untracked(() => scanFold(client, board))),
    }
    foldSets.set(key, found)
  } else if (found.graph != cache.peek()) {
    found.graph = cache.peek()
    found.value.value = untracked(() => scanFold(client, board))
  }
  return found.value.value
}

refreshFolds = (eids: Set<string>) => {
  for (let [key, set] of foldSets) {
    let [client, board] = key.split(':')
    let current = set.value.peek()
    let relevant = [...eids].some((eid) =>
      eid == current?.eid || !!cache.peek()[eid]?.fold
    )
    set.graph = cache.peek()
    if (relevant) set.value.value = scanFold(client, board)
  }
}

// The root canvas (first canvas-tagged entity) and its pinned cards.
// A canvas whose num hasn't arrived yet can't be "first" — sorting the
// unknown to the front would yank every tab sitting on `/` to it.
export let rootCanvas = () => {
  canvasVersion.value
  return Object.entries(cache.peek())
    .filter(([, r]) => r.canvas)
    .sort(([, a], [, b]) =>
      (a.entity?.num ?? Infinity) - (b.entity?.num ?? Infinity)
    )[0]
    ?.[0]
}

type PinSet = {
  graph: Record<string, Comps>
  ids: Signal<string[]>
}
let pinSets = new Map<string, PinSet>()
let scanPins = (canvas: string) =>
  Object.entries(cache.value)
    .filter(([, r]) => r.pin?.canvas_eid == canvas && r.card)
    .map(([eid]) => eid)

let pinSet = (canvas: string) => {
  let found = pinSets.get(canvas)
  if (!found) {
    found = {
      graph: cache.peek(),
      ids: signal(untracked(() => scanPins(canvas))),
    }
    pinSets.set(canvas, found)
  } else if (found.graph != cache.peek()) {
    found.graph = cache.peek()
    found.ids.value = untracked(() => scanPins(canvas))
  }
  return found
}

refreshPins = (eids: Set<string>) => {
  for (let [canvas, set] of pinSets) {
    let ids = set.ids.peek()
    let next = ids
    for (let eid of eids) {
      let had = next.includes(eid)
      let r = cache.peek()[eid]
      let wants = !!r?.card && r.pin?.canvas_eid == canvas
      if (had != wants) {
        next = wants ? [...next, eid] : next.filter((x) => x != eid)
      } else if (had) next = [...next]
    }
    set.graph = cache.peek()
    if (next != ids) set.ids.value = next
  }
}

export let pinned = (canvas: string): Pinned[] =>
  pinSet(canvas).ids.value
    .map((eid) => [eid, cache.peek()[eid]] as const)
    .filter((x): x is readonly [string, Comps] => !!x[1]?.pin && !!x[1].card)
    .map(([eid, r]) => ({
      ...r.pin!,
      // The cache key IS the identity: a pin cast from another client
      // carries no eid inside its comp, and a Pinned without one aims
      // every raise/drag write at eid undefined (T-7437).
      eid,
      target_eid: r.card!.target_eid,
      view: r.card!.view,
    }))
    .sort((a, b) => (a.z - b.z) || (a.eid < b.eid ? -1 : 1))

// Who points HERE, and via what: every eid-typed prop in the SCHEMA —
// the wire-writable vocabulary UNION the server-stamped columns (a
// session's requested_task_eid is an edge even though no client may
// write it) — scanned over the cache. A new association shows up in
// backlinks with no second edit: this is how a task finds its sessions
// and Debug lists whatever holds a reference to the entity on screen.
let eidProps = [...new Set([...Object.keys(vocab), ...Object.keys(stamped)])]
  .flatMap((c) =>
    Object.entries({ ...vocab[c], ...stamped[c] })
      .filter(([, t]) => typeof t == 'object' && 'eid' in t)
      .map(([p]) => [c, p] as [string, string])
  )
type Backlink = { from: string; via: string }
type BacklinkSet = {
  graph: Record<string, Comps>
  value: Signal<Backlink[]>
}
let backlinkSets = new Map<string, BacklinkSet>()
let linksFrom = (from: string, r: Comps | undefined, target: string) =>
  !r ? [] : eidProps
    .filter(([c, p]) =>
      (r[c as keyof typeof r] as Record<string, unknown>)?.[p] == target
    )
    .map(([c, p]) => ({ from, via: `${c}.${p}` }))
let scanBacklinks = (target: string) =>
  Object.entries(cache.value).flatMap(([from, r]) => linksFrom(from, r, target))

export let backlinks = (target: string) => {
  let found = backlinkSets.get(target)
  if (!found) {
    found = {
      graph: cache.peek(),
      value: signal(untracked(() => scanBacklinks(target))),
    }
    backlinkSets.set(target, found)
  } else if (found.graph != cache.peek()) {
    found.graph = cache.peek()
    found.value.value = untracked(() => scanBacklinks(target))
  }
  return found.value.value
}

refreshBacklinks = (eids: Set<string>) => {
  for (let [target, set] of backlinkSets) {
    let changed = [...eids].some((eid) =>
      JSON.stringify(linksFrom(eid, set.graph[eid], target)) !=
        JSON.stringify(linksFrom(eid, cache.peek()[eid], target))
    )
    set.graph = cache.peek()
    if (changed) set.value.value = scanBacklinks(target)
  }
}

let scanJob = (session: string): string | null =>
  Object.entries(cache.value)
    .filter(([, r]) => r.task && r.claim?.session_eid == session)
    .toSorted(([, a], [, b]) =>
      String(b.claim?.claimed_at ?? '').localeCompare(
        String(a.claim?.claimed_at ?? ''),
      )
    )[0]?.[0] ?? null

type JobSet = {
  graph: Record<string, Comps>
  value: Signal<string | null>
}
let jobSets = new Map<string, JobSet>()

// The task a session is ON: the newest task it holds a claim over, else
// its managed request. Each session watches only claim-bearing rows.
export let jobOf = (e: Ent): string | null => {
  let found = jobSets.get(e.eid)
  if (!found) {
    found = {
      graph: cache.peek(),
      value: signal(untracked(() => scanJob(e.eid))),
    }
    jobSets.set(e.eid, found)
  } else if (found.graph != cache.peek()) {
    found.graph = cache.peek()
    found.value.value = untracked(() => scanJob(e.eid))
  }
  return found.value.value ?? e.session?.requested_task_eid ?? null
}

refreshJobs = (eids: Set<string>) => {
  for (let [session, set] of jobSets) {
    let changed = [...eids].some((eid) => {
      let before = set.graph[eid]
      let after = cache.peek()[eid]
      let mine = before?.claim?.session_eid == session ||
        after?.claim?.session_eid == session
      return mine &&
        (before?.claim !== after?.claim || !!before?.task != !!after?.task)
    })
    set.graph = cache.peek()
    if (changed) set.value.value = scanJob(session)
  }
}

// The edges that hold an entity FROM ABOVE — every dependency whose child
// is this eid. refs/kids read downward; this is the climb back up, how a
// task names the parents that contain or require it.
export let parents = (eid: string) => childRelations(eid).value

type BoardLinks = {
  graph: Record<string, Comps>
  value: Signal<string[]>
}
let boardLinks = new Map<string, BoardLinks>()
let scanBoardLinks = (target: string) =>
  Object.keys(cache.value).filter((eid) =>
    cache.value[eid].board?.query?.includes(target)
  )

// A board query carries refs as text, outside the schema's eid columns.
// The target face watches only board query rows that gain or lose its eid.
export let boardsOver = (target: string) => {
  let found = boardLinks.get(target)
  if (!found) {
    found = {
      graph: cache.peek(),
      value: signal(untracked(() => scanBoardLinks(target))),
    }
    boardLinks.set(target, found)
  } else if (found.graph != cache.peek()) {
    found.graph = cache.peek()
    found.value.value = untracked(() => scanBoardLinks(target))
  }
  return found.value.value
}

refreshBoardLinks = (eids: Set<string>) => {
  for (let [target, set] of boardLinks) {
    let changed = [...eids].some((eid) =>
      !!set.graph[eid]?.board?.query?.includes(target) !=
        !!cache.peek()[eid]?.board?.query?.includes(target)
    )
    set.graph = cache.peek()
    if (changed) set.value.value = scanBoardLinks(target)
  }
}

// The highest stacking order on a canvas — a raised card gets topZ + 1.
// The pin presence test is load-bearing: with `?.` alone a nullish canvas
// matches every PINLESS row too (undefined == null) and the map crashes.
export let topZ = (canvas: string) =>
  Math.max(
    0,
    ...Object.values(cache.value)
      .filter((r) => r.pin && r.pin.canvas_eid == canvas)
      .map((r) => r.pin!.z),
  )

// Any interaction pulls a card to the front. Reads the pin fresh from the
// cache, so a burst of events (a scroll's worth of wheels) raises once.
// The card must clear every OTHER pin, not merely match the canvas top —
// a tie at the top (fresh pins all land at 0) still raises.
export let toFront = (pin: string) => {
  let p = cache.value[pin]?.pin
  if (!p) return
  let top = Math.max(
    -1,
    ...Object.entries(cache.value)
      .filter(([eid, r]) => eid != pin && r.pin?.canvas_eid == p.canvas_eid)
      .map(([, r]) => r.pin!.z),
  )
  if (p.z <= top) mutate({ eid: pin, name: 'pin', comp: { z: top + 1 } })
}

// Screen px → plane coords, through the camera over the given canvas rect.
export let toPlane = (clientX: number, clientY: number, rect: DOMRect) => {
  let { x, y, zoom, w, h } = camera.value
  return {
    x: (clientX - rect.left - (w / 2 - x * zoom)) / zoom,
    y: (clientY - rect.top - (h / 2 - y * zoom)) / zoom,
  }
}

// This client's camera over one canvas, if it exists yet.
export let myCamera = (client: string, canvas: string) =>
  Object.values(cache.value).find((r) =>
    r.camera?.client_eid == client && r.camera?.canvas_eid == canvas
  )?.camera

// Who this browser is: a client entity, its uuid minted into localStorage on
// first visit. The db rows appear when the camera first persists.
export let clientId = () => {
  let id = localStorage.getItem('tasks-client')
  if (!id) {
    id = uuid()
    localStorage.setItem('tasks-client', id)
  }
  return id
}

// This tab's camera over the canvas it's viewing: x/y is the viewport CENTER
// in plane coords, w/h the viewport size in screen px. Shared so drags can
// convert screen px into plane px.
export let camera = signal({ x: 0, y: 0, zoom: 1, w: 0, h: 0 })

// The vim mode this tab is in — per-tab UI state, never synced. Hotkeys
// (space, 0, …) only fire in normal mode; the statusbar owns transitions.
// visual is derived: a live selection outside a text input.
export let mode = signal<'normal' | 'insert' | 'command' | 'visual'>('normal')

// Whether the search palette is up. Shell state so a hot swap of the
// component graph can't shut it mid-search (Search.tsx owns the rest).
export let searchOpen = signal(false)

// Desktop opens entity links as a floating card at the pointer. This is
// shell state: a component hot swap replaces nav.tsx, but the card the
// operator is reading must stay open. view is its own optional tab choice.
export let peek = signal<
  { eid: string; x: number; y: number; view?: string; from?: Element } | null
>(null)

// The roots passed through, oldest first — the App bar wears the last few
// as breadcrumbs. Shell state for the same reason as peek: where the
// operator has BEEN outlives any hot swap of the components that got them
// there. nav.tsx owns how it is written (track()).
export let trail = signal<string[]>([])
