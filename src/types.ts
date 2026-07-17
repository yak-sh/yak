// Shared FE/BE vocabulary: entity components, edges, and the sync unit.
// No imports; the only runtime here is the vocabulary itself — safe on
// both sides of the wire.

// The component tables and their wire-writable columns — THE one list.
// The db derives its allowlist (and delete order) from it; the CLI and
// MCP route dot-params (.title= → doc) through it; a prop unique to one
// component routes bare, a collision (pin/camera geometry) needs the
// explicit .comp.prop spelling.
export let comps: Record<string, string[]> = {
  doc: ['title', 'body'],
  task: ['status', 'priority', 'project_eid'],
  project: [],
  board: [],
  canvas: [],
  web: ['url'], // frozen_at is server-stamped, never writable over the wire
  card: ['target_eid', 'view'],
  pin: ['canvas_eid', 'x', 'y', 'w', 'h', 'z'],
  client: ['user_agent'], // ip is server-stamped too
  camera: ['client_eid', 'canvas_eid', 'x', 'y', 'zoom', 'w', 'h'],
  session: ['id'],
  claim: ['session_eid'], // claimed_at is server-stamped
  comment: ['target_eid', 'author_eid'],
}

// The status vocabulary, in board-column order.
export let statuses = ['open', 'wip', 'done']

// kind is DERIVED — an entity is what its components make it, and really
// the beholder decides (renderers match on components, scored by
// specificity). This order is only the display/id convention: the most
// specific component an entity carries names it.
export let kindOrder = [
  'task',
  'project',
  'board',
  'canvas',
  'web',
  'card',
  'client',
  'camera',
  'session',
  'claim',
  'comment',
  'doc',
]
export let kindOf = (has: Record<string, unknown>) =>
  kindOrder.find((k) => has[k]) ?? 'entity'

// The edge vocabulary — every edge reads as a sentence, parent first:
// parent requires child (hard gate) · parent contains child (decomposition,
// children roll up) · parent reads child (read-first, never gates).
export type Edge = 'requires' | 'contains' | 'reads'

// The written face of an entity — title and markdown body. Anything can
// carry one: tasks and boards do; notes, comments, and future kinds get
// rendering/editing/files for free by carrying it too.
export type Doc = { eid: string; title: string; body: string }

// Workflow state only — a task is a doc with task-management added.
export type Task = {
  eid: string
  status: string
  priority: number // board order within a status column; lower sorts first
  project_eid?: string | null // the project (venture) this task belongs to
}

// A tag: "this doc fronts a project" (a venture, a workstream). Its name
// is its doc.title — one naming mechanism, no drift.
export type ProjectTag = { eid: string }

export type BoardTag = { eid: string } // a tag: "this doc fronts a board"
// An external page. The URL is what was pasted; the rendered thing is the
// server's frozen archive of it (one self-contained HTML file on disk),
// stamped frozen_at when ready — frozen_at is server-owned, never wire-set.
export type Web = { eid: string; url: string; frozen_at?: string | null }
export type CardComp = { eid: string; target_eid: string; view: string }
export type Pin = {
  eid: string
  canvas_eid: string
  x: number
  y: number
  w: number
  h: number
  z: number // stacking order; dragging a card raises it to top
}

// A browser identity: its uuid is minted client-side into localStorage on
// first visit. ip is server-stamped (a client can't self-report one).
export type Client = {
  eid: string
  user_agent: string
  ip: string
}

// A camera joins a client to a canvas: per-client pan/zoom, one row per
// (client, canvas) pair — canvases nest, so this is NOT keyed by the client.
// x/y is the viewport CENTER in plane coords; w/h is the viewport size in
// screen px, stored so other clients can render each other's viewports.
export type Camera = {
  eid: string
  client_eid: string
  canvas_eid: string
  x: number
  y: number
  zoom: number
  w: number
  h: number
}

// An agent session, reified: `id` is its external identity (a Claude
// session id, an operator name). For now that's all it carries; when we
// start SPAWNING sessions it grows model, persona, provider, ….
export type Session = { eid: string; id: string }

// A session's lease on an entity — claims point at the session ENTITY.
// One claim per entity; taking one over another session's is a CONFLICT
// the server rejects — release first (comp: null), then claim.
export type Claim = { eid: string; session_eid: string; claimed_at?: string }

// A comment is a doc AIMED at something — and since target_eid is any
// entity, ANYTHING is commentable: tasks, boards, frozen pages, other
// comments. author_eid points at a session or client entity (or null).
export type Comment = {
  eid: string
  target_eid: string
  author_eid?: string | null
}

export type Dep = { parent: string; type: Edge; child: string }

// An outgoing edge, verb + child — the Dependency view resolves the name.
export type Ref = { type: Edge; child: string }

// The bundle a renderer pattern-matches on: the entity plus whichever
// components it carries, its edge sentences, and the entities it
// contains. kind is derived (kindOf) — display convention, not data.
export type Ent = {
  eid: string
  num: number
  kind: string
  doc?: Doc
  task?: Task
  project?: ProjectTag
  canvas?: { eid: string }
  board?: BoardTag
  web?: Web
  card?: CardComp
  pin?: Pin
  client?: Client
  camera?: Camera
  session?: Session
  claim?: Claim
  comment?: Comment
  refs: Ref[]
  kids: Ent[]
}

// A pin row joined to its card: where the card sits and what it shows.
export type Pinned = Pin & { target_eid: string; view: string }

// The sync unit — one component patch landing on (or leaving) an entity. A
// batch is a flat array; a comp is a PATCH: omitted columns are untouched
// (a single prop change sends a single prop), `prop: null` clears that
// column, comp: null deletes the component, and {name: 'entity', comp: null}
// deletes the entity, its components, and every edge touching it. Deleting a
// bunch is just a long batch. Client-minted UUID eids are welcome — the
// spine (and its num) appears on first touch.
export type Change = {
  eid: string
  name: string
  comp: Record<string, unknown> | null
}

// The whole graph in one gulp — a batch that fills an empty cache, plus the
// edges (edges aren't components; they ride alongside).
export type Snapshot = { changes: Change[]; deps: Dep[] }
