// Shared FE/BE vocabulary: entity components, edges, and the sync unit.
// No imports, no runtime code — safe on both sides of the wire.

// The edge vocabulary — every edge reads as a sentence, parent first:
// parent requires child (hard gate) · parent contains child (decomposition,
// children roll up) · parent reads child (read-first, never gates).
export type Edge = 'requires' | 'contains' | 'reads'

// The written face of an entity — title and markdown body. Anything can
// carry one: tasks and projects do; notes, comments, and future kinds get
// rendering/editing/files for free by carrying it too.
export type Doc = { eid: string; title: string; body: string }

// Workflow state only — a task is a doc with task-management added.
export type Task = {
  eid: string
  status: string
  priority: number // board order within a status column; lower sorts first
}

export type Proj = { eid: string } // a tag: "this doc fronts a board"
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

export type Dep = { parent: string; type: Edge; child: string }

// An outgoing edge, verb + child — the Dependency view resolves the name.
export type Ref = { type: Edge; child: string }

// The bundle a renderer pattern-matches on: the entity plus whichever
// components it carries, its edge sentences, and the entities it contains.
export type Ent = {
  eid: string
  num: number
  kind: string
  doc?: Doc
  task?: Task
  project?: Proj
  web?: Web
  card?: CardComp
  pin?: Pin
  client?: Client
  camera?: Camera
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
