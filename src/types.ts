// Shared FE/BE vocabulary: entity components, edges, and the sync unit.
// No imports; the only runtime here is the vocabulary itself — safe on
// both sides of the wire.

// What a prop IS — the detection layer editors and docs read. The
// vocabulary stays deliberately tiny:
//   'text'            one line (sometimes more)
//   'body'            long markdown
//   'number' 'bool'   what they say
//   {enum: [...]}     a closed set — the values ARE the doc
//   {eid: 'project'}  an association; the name says which component the
//                     target carries ('' = any entity)
//   {text: 'domains'} open text, suggestions from a named WELL the
//                     browser registers (the schema stays declarative —
//                     it can't reach a live cache from here)
export type PropType =
  | 'text'
  | 'body'
  | 'number'
  | 'bool'
  | { enum: string[] }
  | { eid: string }
  | { text: string }

// The status vocabulary, in board-column order.
export let statuses = ['open', 'wip', 'done']

// The component tables, their wire-writable columns AND what each column
// is — THE one list, now with a type dimension. The db derives its
// allowlist (and delete order) from the keys (cols()); the CLI and MCP
// route dot-params (.title= → doc) through them; editors and tool docs
// read the types. A prop unique to one component routes bare, a
// collision (pin/camera geometry) needs the explicit .comp.prop
// spelling. No served schema anywhere: this module rides to every side
// of the wire as-is — the module IS the schema.
export let comps: Record<string, Record<string, PropType>> = {
  doc: { title: 'text', body: 'body' },
  task: {
    status: { enum: statuses },
    priority: 'number',
    project_eid: { eid: 'project' },
    domain: { text: 'domains' }, // free text; the graph suggests
  },
  project: {},
  repo: { path: 'text', base_branch: 'text' }, // the project's checkout
  board: { query: 'text' }, // filter over tasks (query.ts grammar); '' = all
  canvas: {},
  web: { url: 'text' }, // frozen_at is server-stamped, never wire-writable
  card: { target_eid: { eid: '' }, view: 'text' },
  pin: {
    canvas_eid: { eid: '' },
    x: 'number',
    y: 'number',
    w: 'number',
    h: 'number',
    z: 'number',
  },
  client: { user_agent: 'text' }, // ip is server-stamped too
  camera: {
    client_eid: { eid: 'client' },
    canvas_eid: { eid: '' },
    x: 'number',
    y: 'number',
    zoom: 'number',
    w: 'number',
    h: 'number',
  },
  fold: {
    client_eid: { eid: 'client' },
    board_eid: { eid: 'board' },
    statuses: 'text',
  },
  // acked_at is the session's OWN "seen up to here" cursor for the
  // while-you-were-away digest — wire-writable because forging it only
  // deafens yourself.
  session: { id: 'text', cwd: 'text', acked_at: 'text' },
  claim: { session_eid: { eid: 'session' } }, // claimed_at server-stamped
  conflict: {}, // server-minted audit rows — nothing is wire-writable
  comment: { target_eid: { eid: '' }, author_eid: { eid: '' } },
  alias: { slug: 'text' },
}

// A component's wire-writable column names — what most consumers of the
// old flat list actually want.
export let cols = (comp: string) => Object.keys(comps[comp] ?? {})

// The eid minter. Both sides of the wire mint them (clients name their own
// entities), so it must work on both: crypto.randomUUID is gated to secure
// contexts and this page is served over plain http on the tailnet, while
// getRandomValues is gated nowhere.
export let uuid = () => {
  let b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  let h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${
    h.slice(16, 20)
  }-${h.slice(20)}`
}

// A managed session is still going in exactly these statuses; every other
// one is an ending (see Session below). One list: the server decides what
// may be stopped by it, the browser decides what to keep polling by it.
export let sessionActive = ['starting', 'running', 'stopping']

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
  'fold',
  'session',
  'claim',
  'conflict',
  'comment',
  'alias',
  'doc',
]
export let kindOf = (has: Record<string, unknown>) =>
  kindOrder.find((k) => has[k]) ?? 'entity'

// The human id: prefix-num (T-7, P-2). Curated prefixes for the kinds
// people type daily; everything else leads with its capitalized initial.
export let prefix: Record<string, string> = {
  task: 'T',
  project: 'P',
  board: 'B',
  session: 'S',
}
export let idOf = (e: { kind: string; num: number }) =>
  `${prefix[e.kind] ?? e.kind[0].toUpperCase()}-${e.num}`

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
  domain?: string | null // cross-project facet (Eng, Legal, Ops, …) — free
  // text by convention; a picker derives its options from distinct values
}

// A tag: "this doc fronts a project" (a venture, a workstream). Its name
// is its doc.title — one naming mechanism, no drift.
export type ProjectTag = { eid: string }

// Where a project's code lives: a checkout on this box and the branch a
// session's worktree grows from. A tag like project — it never names an
// entity alone (doc+project+repo is still a project), so it stays out of
// kindOrder. Wire-writable, because the owner points a project at a
// checkout from the UI or the CLI like any other data; spawning only
// READS it, so a browser can never hand the server a path to run in.
export type Repo = { eid: string; path: string; base_branch: string }

// A board is a saved filter over tasks: `query` speaks the query.ts
// grammar ('.project_eid=…&.status=open,wip'); empty/null means every task.
export type BoardTag = { eid: string; query?: string | null }
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

// A client's folded columns on one board — per-client UI state IN the
// graph (like camera), so it syncs across tabs and agents can see it.
// statuses is a comma-joined list of folded column names.
export type Fold = {
  eid: string
  client_eid: string
  board_eid: string
  statuses: string
}

// An agent session, reified: `id` is its external identity (a Claude
// session id, an operator name), `cwd` where it runs, `acked_at` its own
// comms-bus cursor — the three things a session may say about itself.
//
// Everything below is the LIFECYCLE of a session we spawned (origin
// 'managed'; an 'external' session just announces itself and carries
// none of it). Those columns are server-owned — absent from comps.session,
// so no client can fake a status, a branch, or a final answer, same as
// frozen_at/claimed_at. They ride the snapshot (it selects whole rows), so
// the live cache gets the summary for free. latest_seq is the line count
// of the log FILE, which is the durable log (src/sessions.ts).
export type Session = {
  eid: string
  id: string
  cwd?: string | null
  acked_at?: string | null
  origin?: string // 'external' (announced) | 'managed' (we spawned it)
  provider?: string | null // adapters.ts key
  model?: string | null
  effort?: string | null
  persona_eid?: string | null
  requested_task_eid?: string | null // provenance: what it was started on
  branch?: string | null
  base_revision?: string | null
  status?: string | null // starting|running|stopping|completed|failed|interrupted|lost
  provider_session_id?: string | null // the provider's own id, from its init event
  serving_model?: string | null // what the provider says it's actually serving
  latest_seq?: number // lines of log so far
  started_at?: string | null
  stop_requested_at?: string | null
  finished_at?: string | null
  exit_code?: number | null // null when the child outlived us — unknowable
  stop_reason?: string | null
  final_text?: string | null
  usage_json?: string | null
  error?: string | null // diagnostics: malformed frames, spawn failures
}

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

// A claim that BOUNCED, kept as an entity: who tried (loser), who held
// (holder) — resolved to session-id strings at rejection time, because
// the loser's session entity may have been minted in the very batch
// that rolled back. Server-minted only; audit contention with
// graph_query kind=conflict.
export type Conflict = {
  eid: string
  target_eid: string
  loser: string
  holder: string
  at?: string
}

// A stable external name for an entity — a slug from a previous system, a
// human handle. find() resolves it like any id; unique graph-wide.
export type Alias = { eid: string; slug: string }

// A full-text search hit. snip marks matches with \x01…\x02 (renderers
// highlight without trusting HTML); open_eid is what to OPEN — the entity
// itself, or a comment's target.
export type Hit = {
  eid: string
  num: number
  kind: string
  title: string
  snip: string
  open_eid: string
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
  created_at?: string // server-stamped birth, when the cache carries it
  kind: string
  doc?: Doc
  task?: Task
  project?: ProjectTag
  repo?: Repo
  canvas?: { eid: string }
  board?: BoardTag
  web?: Web
  card?: CardComp
  pin?: Pin
  client?: Client
  camera?: Camera
  fold?: Fold
  session?: Session
  claim?: Claim
  conflict?: Conflict
  comment?: Comment
  alias?: Alias
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
//
// Edges ride the same shape with name 'dependency', but a triple has no
// row key, so the comp names the WHOLE sentence: {type, child_eid} links
// eid→child, and the same sentence with gone: true unlinks it (comp: null
// could never say which edge). Both endpoints must exist.
export type Change = {
  eid: string
  name: string
  comp: Record<string, unknown> | null
}

// The whole graph in one gulp — a batch that fills an empty cache, plus the
// edges (edges aren't components; they ride alongside).
export type Snapshot = { changes: Change[]; deps: Dep[] }
