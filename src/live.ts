// The browser half: one entity cache, one socket, one identity, one camera.
// The cache is the client's whole world — a snapshot fills it, ws patches
// keep it current, and every component renders straight out of it.
import { computed, signal } from '@preact/signals'
import {
  type Change,
  comps as vocab,
  type Dep,
  type Ent,
  type Pinned,
  settled,
  type Snapshot,
  stamped,
} from './types.ts'
import { type Row } from './client.ts'
import { matchQuery, parseQuery, resolveRefs, warm } from './query.ts'
import * as idb from './idb.ts'

// A cache row: the spine plus whichever components the entity carries.
// Derived from Ent so a new component (types.ts) threads through here —
// and through ent() below — with zero edits. Exported so idb.ts persists
// and hydrates the exact shape the signal holds (T-6823).
export type Comps =
  & { entity?: { eid: string; num: number } }
  & Omit<Ent, 'eid' | 'num' | 'kind' | 'refs' | 'kids'>

export let cache = signal<Record<string, Comps>>({})
export let deps = signal<Dep[]>([])

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
  reload: () => void
  swap?: (gen: number) => void
  css?: (gen: number) => void
} = {
  host: loc?.host ?? '127.0.0.1:5173',
  // Behind an https front door the page's scheme must carry through to
  // the socket and fetches — a hardcoded http:// is mixed content there.
  secure: loc?.protocol == 'https:',
  reload: () => loc?.reload(),
}
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
  let next = { ...cache.value }
  let eids = new Set<string>()
  let edges: Dep[] = []
  for (let { eid, name, comp } of changes) {
    if (name == 'entity' && comp == null) {
      delete next[eid]
      eids.add(eid)
      // The cascade: every edge touching the dead eid leaves deps too —
      // record them so the IDB shadow drops the same rows the signal does.
      for (let d of deps.value) {
        if (d.parent == eid || d.child == eid) edges.push(d)
      }
      deps.value = deps.value.filter((d) => d.parent != eid && d.child != eid)
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
      deps.value = comp.gone
        ? deps.value.filter((x) => !same(x))
        : deps.value.some(same)
        ? deps.value
        : [...deps.value, d]
      continue
    }
    let row = { ...next[eid] } as Record<string, unknown>
    if (comp == null) delete row[name]
    else row[name] = { ...(row[name] as object), ...comp }
    next[eid] = row as Comps
    eids.add(eid)
  }
  cache.value = next
  // Live-frame IDB persist is deferred: multi-writer drop-op race — boot-only
  // for now (T-6823/T-6829). Live frames update the signal only; IDB is
  // written solely at boot, through idb's forward-only guarded commit. The
  // returned touched keys feed that boot write (the delta persist below); a
  // sole-writer leader (2.2/T-6883) is where this tail persists live frames.
  return { eids: [...eids], edges }
}

// The cursor/epoch/vocab this tab holds — sent on socket open as the {since}
// catch-up handshake (below). The catch-up rides the SAME ordered socket as
// live frames now, so the server (single-threaded) sends it BEFORE joining
// this socket to the broadcast: catch-up then live, in journal order, no
// client-side reordering to undo (T-6829). seedFrom/boot set it.
let held: idb.Meta = {}

// Land a local edit: cache first (instant render), then the wire.
export let mutate = (...changes: Change[]) => {
  applyLocal(changes)
  send(...changes)
}

// One socket per tab, lazily opened; sends queue behind the handshake.
// On OPEN it declares the cursor it holds — `{since, epoch, vocab}` — and the
// server replays the journal since it (catch-up), or a full reset if the
// cursor is void, BEFORE adding this socket to the live broadcast. So the
// server-side ordering is catch-up then live, on one channel, and the client
// just applies frames as they arrive — array batches are sync patches; the
// catch-up/reset objects fill the cache; the rest is the file watcher
// ({hmr}/{css} hot-swap through the config doors, 'reload' means the swap
// boundary itself changed).
// A dropped socket means the server restarted — poll until it's back, then
// reload for a fresh snapshot (state lives in the db, so nothing is lost).
// One poller, ever: while the server is down every send() mints another
// doomed socket, and without the guard each one would stack another
// interval — all firing reload together when the server returns.
let ws: WebSocket | null = null
let polling = false
export let sock = () => {
  if (ws && ws.readyState <= WebSocket.OPEN) return ws
  ws = new WebSocket(
    `ws${config.secure ? 's' : ''}://${config.host}/ws${
      config.client ? `?client=${config.client}` : ''
    }`,
  )
  // The catch-up handshake: send the held cursor first, so every later live
  // frame the server broadcasts arrives AFTER the catch-up it just sent.
  ws.onopen = () =>
    ws!.send(JSON.stringify({
      since: held.cursor ?? 0,
      epoch: held.epoch,
      vocab: held.vocabHash,
    }))
  ws.onmessage = (m) => {
    let data = JSON.parse(String(m.data))
    if (Array.isArray(data)) applyLocal(data)
    else if (data?.catchup !== undefined) onCatchup(data)
    else if (data?.reset) onReset(data)
    else if (typeof data?.sub == 'string') onSub(data)
    else if (data == 'reload') config.reload()
    else if (data?.hmr) config.swap ? config.swap(data.hmr) : config.reload()
    else if (data?.css) config.css?.(data.css)
  }
  ws.onclose = () => {
    if (polling) return
    polling = true
    let poll = setInterval(async () => {
      try {
        await fetch(`${base()}/snapshot`, { method: 'HEAD' })
        clearInterval(poll)
        polling = false
        config.reload()
      } catch { /* still down */ }
    }, 500)
  }
  return ws
}

export let send = (...changes: unknown[]) => {
  let s = sock()
  let msg = JSON.stringify(changes)
  if (s.readyState == WebSocket.OPEN) s.send(msg)
  else s.addEventListener('open', () => s.send(msg), { once: true })
}

// Query subscriptions (T-3683), the client half. The cache becomes a UNION of
// subscription result sets: `subMembers` refcounts which eids each sub holds,
// so an eid that leaves EVERY subscription is evicted — the one new cache
// mechanic (design §4). A legacy full-broadcast client never subscribes, so
// this map stays empty and nothing is ever evicted; boot and applyLocal are
// untouched. Stage 1 only ADDS this capability (boards/boot convert in stage 2).
let subMembers = new Map<string, Set<string>>()

// A subscription frame: land its changes like any batch (adds + updates flow
// through the unchanged applyLocal), then track membership. A death rides in
// `changes` as an entity-null (gone for everyone — applyLocal already removed
// it); a `drop` eid left THIS query but still exists (gone for this query
// only). Either way it leaves the sub's set, and an eid now in no set is
// evicted from the cache.
let onSub = (f: { sub: string; changes: Change[]; drop?: string[] }) => {
  applyLocal(f.changes)
  let mine = subMembers.get(f.sub) ?? new Set<string>()
  subMembers.set(f.sub, mine)
  let leaving: string[] = f.drop ? [...f.drop] : []
  for (let c of f.changes) {
    if (c.name == 'entity' && c.comp == null) {
      mine.delete(c.eid)
      leaving.push(c.eid)
    } else mine.add(c.eid)
  }
  for (let eid of f.drop ?? []) mine.delete(eid)
  evict(leaving)
}

// Drop from the cache any eid held by no remaining subscription — a death
// already removed itself via applyLocal (harmless to revisit), a drop is the
// live "you no longer see this" that only this layer expresses.
let evict = (eids: string[]) => {
  let held = (eid: string) => [...subMembers.values()].some((s) => s.has(eid))
  let next = { ...cache.value }
  let changed = false
  for (let eid of eids) {
    if (!held(eid) && next[eid]) {
      delete next[eid]
      changed = true
    }
  }
  if (changed) cache.value = next
}

// A control frame is an OBJECT (design §1), distinct from the array batches
// send() ships — a subscribe/replace or an unsubscribe.
let control = (frame: object) => {
  let s = sock()
  let msg = JSON.stringify(frame)
  if (s.readyState == WebSocket.OPEN) s.send(msg)
  else s.addEventListener('open', () => s.send(msg), { once: true })
}
export let subscribe = (sub: string, q: string) => control({ sub, q })
export let unsubscribe = (sub: string) => {
  subMembers.delete(sub)
  control({ unsub: sub })
}

// Fetch the whole graph, fill the signals, seed IDB — the first-visit path
// and the 409 fallback share it (a stale cursor just means "do what a new
// visitor does"). Replace the cache wholesale (clear then apply), stamp the
// held cursor, and seed IDB — seed() is a `full` forward-only commit that
// wins across a changed epoch and clears the stale rows in the same txn.
let seedFrom = (snap: Snapshot) => {
  cache.value = {}
  deps.value = snap.deps
  applyLocal(snap.changes)
  held = { cursor: snap.cursor, epoch: snap.epoch, vocabHash: snap.vocabHash }
  return idb.seed(
    cache.value,
    deps.value,
    snap.cursor ?? 0,
    snap.epoch ?? '',
    snap.vocabHash ?? '',
  )
}

// First-visit / no-IDB fill: the whole graph over HTTP (the TUI and a fresh
// browser have nothing to hydrate, and a full snapshot can't reorder — it is
// a complete prefix). The socket's {since} handshake that follows just joins
// the broadcast and closes the fetch→open gap with a tiny catch-up.
let fromSnapshot = async () =>
  seedFrom(await (await fetch(`${base()}/snapshot`)).json())

// The catch-up frame, over the socket: the journal since the cursor we sent.
// It arrives BEFORE any live frame (the server sends it before joining this
// socket to the broadcast), so applying it in arrival order is already the
// right order — no buffering. Persist the touched keys + new cursor in one
// forward-only guarded commit against the epoch we hydrated under (a peer tab
// already ahead is never regressed; IDB never advances past unstored change).
let onCatchup = (d: { catchup: Change[]; cursor: number }) => {
  let { eids, edges } = applyLocal(d.catchup)
  idb.persist(eids, edges, cache.value, deps.value, {
    epoch: held.epoch ?? '',
    vocabHash: held.vocabHash ?? '',
    cursor: d.cursor,
  })
}

// The reset frame, the socket's equivalent of the HTTP 409 + first-visit: the
// held cursor was void or its epoch/vocab moved (db restore, shape change), so
// the server sent a whole snapshot — reseed from it.
let onReset = (d: { snapshot: Snapshot }) => {
  mark('reset')
  seedFrom(d.snapshot)
}

// Fill the cache and open the socket — main.tsx awaits this before render.
// First visit / no IDB: fetch the whole snapshot over HTTP, seed, render;
// the socket then joins and catches the fetch→open gap. Returning visit:
// hydrate from IDB (local, fast) and render immediately; the socket sends
// {since:C} and the catch-up rides back on that SAME ordered channel ahead of
// any live frame — no HTTP /delta, no reorder to undo. Either way sock() is
// opened with `held` already set, so its onopen handshake declares the right
// cursor.
// [2.2 — T-6883: sock() ownership moves to the leader tab; here every tab
//  opens its own — intentional per-tab redundancy for slice 2.1.]
export let boot = async () => {
  let m = await idb.meta()
  if (m.cursor === undefined) {
    mark('snapshot')
    await fromSnapshot() // sets held from the snapshot
    sock()
  } else {
    mark('hydrate+delta')
    let { ents, deps: d } = await idb.hydrate()
    cache.value = ents
    deps.value = d
    held = m // send this cursor on socket open; the catch-up rides back
    sock()
  }
}

// Edges grouped by parent, one pass over deps. ent() partitions its own
// slice into refs/kids instead of rescanning all 751 edges twice per call —
// without this the initial canvas (hundreds of ents × the edge list, called
// recursively) spent its whole render budget here (T-6772). A computed off
// the deps signal, so it rebuilds only when deps changes; applyLocal always
// assigns a fresh array, so the memo invalidates. Insertion order is
// preserved per parent, keeping refs/kids order identical to the old scan.
let byParent = computed(() => {
  let m = new Map<string, Dep[]>()
  for (let d of deps.value) {
    let mine = m.get(d.parent)
    if (mine) mine.push(d)
    else m.set(d.parent, [d])
  }
  return m
})

// The whole entity, assembled for a renderer: spine, components present,
// outgoing edge sentences, contained children (recursive — graphs stay
// small; a view reads as deep as it wants).
export let ent = (eid: string): Ent => {
  let { entity, ...comps } = cache.value[eid] ?? {}
  let mine = byParent.value.get(eid) ?? []
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

// A board's tasks: its saved query evaluated against the live cache.
// Membership is never stored — a task is on a board because it matches,
// so it appears the moment it's born and leaves the moment it stops
// matching. Throws on a malformed query; the Board view shows the error.
// The stored query may carry sugar values ('.assignee=jeff') and path
// preds ('.assignee.title~=j') — the cache is the graph they resolve
// and deref against.
export let findEid = (id: string): string | undefined => {
  let num = id.match(/^[A-Za-z]+-(\d+)$/)?.[1] ?? id.match(/^(\d+)$/)?.[1]
  for (let [eid, r] of Object.entries(cache.value)) {
    if (num ? r.entity?.num == +num : r.alias?.slug == id) return eid
  }
}
export let boardTasks = (e: Ent): Ent[] => {
  let preds = resolveRefs(
    parseQuery(String(e.board?.query ?? '')),
    findEid,
  )
  return Object.entries(cache.value)
    .filter(([, r]) => r.task && matchQuery(r, preds, (t) => cache.value[t]))
    .map(([eid]) => ent(eid))
}

// The same query over the WHOLE graph — the board's List face. No task
// gate: sessions, memories, docs, web, people — anything that matches.
// Chrome stays out (a camera's updated.at churns with every pan and
// would drown any hot feed; cards/folds/shelves/clients are presence,
// not content), comments surface through their targets (the lately
// digest's rule), and a board is not news to itself.
let CHROME = new Set(['card', 'camera', 'fold', 'shelf', 'client', 'comment'])
export let boardAll = (e: Ent): Ent[] => {
  let preds = resolveRefs(
    parseQuery(String(e.board?.query ?? '')),
    findEid,
  )
  return Object.entries(cache.value)
    .filter(([eid, r]) =>
      eid != e.eid && !CHROME.has(kindOf(r)) &&
      matchQuery(r, preds, (t) => cache.value[t])
    )
    .map(([eid]) => ent(eid))
}

// The ephemeral filter's evaluator: a bar's line parsed and ref-resolved
// ONCE, returned as a per-row test — Board and the Lists AND it into
// whatever they already show. Throws like a saved query does; the bar
// catches (mid-keystroke is no place to error) where a board would show.
export let sieve = (line: string): (eid: string) => boolean => {
  let preds = resolveRefs(parseQuery(line), findEid)
  return (eid) =>
    matchQuery(cache.value[eid] ?? {}, preds, (t) => cache.value[t])
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

// The domains in use, distinct and sorted — what the domain picker
// suggests. domain is free text by convention (types.ts): the vocabulary
// is whatever the graph already says, never a table to keep in step.
export let domains = computed(() =>
  [...new Set(Object.values(cache.value).flatMap((r) => r.task?.domain || []))]
    .sort()
)

// Every project, oldest first — what the project picker lists. A project
// is a doc + project tag and its name IS its doc.title (types.ts), so
// there's nothing to resolve but the entity.
export let projects = (): Ent[] =>
  Object.entries(cache.value)
    .filter(([, r]) => r.project)
    .map(([eid]) => ent(eid))
    .sort((a, b) => a.num - b.num)

// Everything said ABOUT an entity, oldest first — comments are entities
// whose comment.target_eid points here.
export let commentsOn = (eid: string): Ent[] =>
  Object.entries(cache.value)
    .filter(([, r]) => r.comment?.target_eid == eid)
    .map(([id]) => ent(id))
    .sort((a, b) => a.num - b.num)

// Comment tallies for every entity in ONE cache pass — a board of
// hundreds of rows reads this map instead of each scanning the cache.
export let commentCount = computed(() => {
  let n: Record<string, number> = {}
  for (let r of Object.values(cache.value)) {
    let t = r.comment?.target_eid
    if (t) n[String(t)] = (n[String(t)] ?? 0) + 1
  }
  return n
})

// The root canvas (first canvas-tagged entity) and its pinned cards.
// A canvas whose num hasn't arrived yet can't be "first" — sorting the
// unknown to the front would yank every tab sitting on `/` to it.
export let rootCanvas = () =>
  Object.entries(cache.value)
    .filter(([, r]) => r.canvas)
    .sort(([, a], [, b]) =>
      (a.entity?.num ?? Infinity) - (b.entity?.num ?? Infinity)
    )[0]
    ?.[0]

export let pinned = (canvas: string): Pinned[] =>
  Object.entries(cache.value)
    .filter(([, r]) => r.pin?.canvas_eid == canvas && r.card)
    .map(([, r]) => ({
      ...r.pin!,
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
export let backlinks = (eid: string) =>
  Object.entries(cache.value).flatMap(([from, r]) =>
    eidProps
      .filter(([c, p]) =>
        (r[c as keyof typeof r] as Record<string, unknown>)?.[p] == eid
      )
      .map(([c, p]) => ({ from, via: `${c}.${p}` }))
  )

// The task a session is ON: the newest task it holds a claim over (a
// claim lives on the claimed entity, pointing back at the session), else
// its managed request — the claim is the live lease, the request the
// birth spec that outlives release. Null between jobs.
export let jobOf = (e: Ent): string | null =>
  Object.entries(cache.value)
    .filter(([, r]) => r.task && r.claim?.session_eid == e.eid)
    .toSorted(([, a], [, b]) =>
      String(b.claim?.claimed_at ?? '').localeCompare(
        String(a.claim?.claimed_at ?? ''),
      )
    )[0]?.[0] ??
    e.session?.requested_task_eid ?? null

// The edges that hold an entity FROM ABOVE — every dependency whose child
// is this eid. refs/kids read downward; this is the climb back up, how a
// task names the parents that contain or require it.
export let parents = (eid: string) => deps.value.filter((d) => d.child == eid)

// The saved boards that WATCH an entity — a board's reference lives
// inside its query string ('.project_eid=<eid>&…'), not in an eid-typed
// column, so backlinks can't see it. Eids are uuids: a substring hit IS
// a reference — no parse needed, no false positives possible.
export let boardsOver = (eid: string) =>
  Object.keys(cache.value).filter((b) =>
    cache.value[b].board?.query?.includes(eid)
  )

// The highest stacking order on a canvas — a raised card gets topZ + 1.
export let topZ = (canvas: string) =>
  Math.max(
    0,
    ...Object.values(cache.value)
      .filter((r) => r.pin?.canvas_eid == canvas)
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
