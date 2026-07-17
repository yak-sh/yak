// The browser half: one entity cache, one socket, one identity, one camera.
// The cache is the client's whole world — a snapshot fills it, ws patches
// keep it current, and every component renders straight out of it.
import { signal } from '@preact/signals'
import {
  type BoardTag,
  type Camera,
  type CardComp,
  type Change,
  type Claim,
  type Client,
  type Dep,
  type Doc,
  type Ent,
  type Pin,
  type Pinned,
  type Session,
  type Task,
  type Web,
} from './types.ts'

type Comps = {
  entity?: { eid: string; num: number; created_at: string }
  doc?: Doc
  task?: Task
  canvas?: { eid: string }
  board?: BoardTag
  web?: Web
  card?: CardComp
  pin?: Pin
  client?: Client
  camera?: Camera
  session?: Session
  claim?: Claim
}

export let cache = signal<Record<string, Comps>>({})
export let deps = signal<Dep[]>([])

// Where the server lives and what a code reload means. The browser answers
// both from its location; other hosts (the TUI) configure these before
// boot() — a terminal process can't "reload the page".
let loc = (globalThis as {
  location?: { host: string; reload(): void }
}).location
export let config = {
  host: loc?.host ?? '127.0.0.1:5173',
  reload: () => loc?.reload(),
}

// The column sort: priority first (lower sorts higher), num as tiebreak.
export { statuses } from './types.ts'
import { kindOf } from './types.ts'
export let byPriority = (a: Ent, b: Ent) =>
  (a.task!.priority - b.task!.priority) || (a.num - b.num)

// Land a batch in the cache with the same patch semantics the db uses:
// comps merge per-column, comp: null deletes the component, entity: null
// deletes the entity and every edge touching it.
export let applyLocal = (changes: Change[]) => {
  let next = { ...cache.value }
  for (let { eid, name, comp } of changes) {
    if (name == 'entity' && comp == null) {
      delete next[eid]
      deps.value = deps.value.filter((d) => d.parent != eid && d.child != eid)
      continue
    }
    let row = { ...next[eid] } as Record<string, unknown>
    if (comp == null) delete row[name]
    else row[name] = { ...(row[name] as object), ...comp }
    next[eid] = row as Comps
  }
  cache.value = next
}

// Land a local edit: cache first (instant render), then the wire.
export let mutate = (...changes: Change[]) => {
  applyLocal(changes)
  send(...changes)
}

// One socket per tab, lazily opened; sends queue behind the handshake.
// Array frames are sync batches; 'reload' is the server's file watcher.
// A dropped socket means the server restarted — poll until it's back, then
// reload for a fresh snapshot (state lives in the db, so nothing is lost).
// One poller, ever: while the server is down every send() mints another
// doomed socket, and without the guard each one would stack another
// interval — all firing reload together when the server returns.
let ws: WebSocket | null = null
let polling = false
export let sock = () => {
  if (ws && ws.readyState <= WebSocket.OPEN) return ws
  ws = new WebSocket(`ws://${config.host}/ws`)
  ws.onmessage = (m) => {
    let data = JSON.parse(String(m.data))
    if (Array.isArray(data)) applyLocal(data)
    else if (data == 'reload') config.reload()
  }
  ws.onclose = () => {
    if (polling) return
    polling = true
    let poll = setInterval(async () => {
      try {
        await fetch(`http://${config.host}/snapshot`, { method: 'HEAD' })
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

// Fill the cache and open the socket — main.tsx awaits this before render.
// (Changes landing between the fetch and the open are missed; fine for now.)
export let boot = async () => {
  let snap = await (await fetch(`http://${config.host}/snapshot`)).json()
  deps.value = snap.deps
  applyLocal(snap.changes)
  sock()
}

// The whole entity, assembled for a renderer: spine, components present,
// outgoing edge sentences, contained children (recursive — graphs stay
// small; a view reads as deep as it wants).
export let ent = (eid: string): Ent => {
  let r = cache.value[eid] ?? {}
  return {
    eid,
    num: r.entity?.num ?? 0,
    kind: kindOf(r), // derived — the display convention, not data
    doc: r.doc,
    task: r.task,
    canvas: r.canvas,
    board: r.board,
    web: r.web,
    card: r.card,
    pin: r.pin,
    client: r.client,
    camera: r.camera,
    session: r.session,
    claim: r.claim,
    refs: deps.value
      .filter((d) => d.parent == eid && d.type != 'contains')
      .map((d) => ({ type: d.type, child: d.child })),
    kids: deps.value
      .filter((d) => d.parent == eid && d.type == 'contains')
      .map((d) => ent(d.child)),
  }
}

// The root canvas (first canvas-tagged entity) and its pinned cards.
export let rootCanvas = () =>
  Object.entries(cache.value)
    .filter(([, r]) => r.canvas)
    .sort(([, a], [, b]) => (a.entity?.num ?? 0) - (b.entity?.num ?? 0))[0]
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

// The highest stacking order on a canvas — a raised card gets topZ + 1.
export let topZ = (canvas: string) =>
  Math.max(
    0,
    ...Object.values(cache.value)
      .filter((r) => r.pin?.canvas_eid == canvas)
      .map((r) => r.pin!.z),
  )

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

// crypto.randomUUID is gated to secure contexts, and this page is reached
// over plain http on the tailnet — so mint v4 uuids from getRandomValues,
// which isn't gated.
export let uuid = () => {
  let b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  let h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${
    h.slice(16, 20)
  }-${h.slice(20)}`
}

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
