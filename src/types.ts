// Shared FE/BE vocabulary: entity components, edges, and the sync unit.
// No imports; the only runtime here is the vocabulary itself — safe on
// both sides of the wire.

// What a prop IS — the detection layer editors and docs read. The
// vocabulary stays deliberately tiny:
//   'text'            one line (sometimes more)
//   'body'            long markdown
//   'number' 'bool'   what they say
//   'query'           a line of the filter grammar (query.ts) — text
//                     whose editor knows the vocabulary
//   {enum: [...]}     a closed set — the values ARE the doc
//   {eid: 'project',  an association; the name says which component the
//    death: …}        target carries ('' = any entity), the death word
//                     what the reference means when the target dies
//   {text: 'domains'} open text, suggestions from a named WELL the
//                     browser registers (the schema stays declarative —
//                     it can't reach a live cache from here)

// Every reference declares what the reaper does when its TARGET dies —
// db.ts derives the cascade from these words, so a reference without one
// doesn't typecheck and an undeclared behavior can't exist:
//   'cascade'  the row's whole entity dies with the target (a card
//              viewing it, a comment aimed at it)
//   'detach'   the column lets go — set null, and the wire hears it
//              (a task's dead project or assignee)
//   'release'  the ROW dies but its entity lives — for tag comps whose
//              existence is the reference (a claim: the lease vanishes,
//              the claimed task survives)
//   'keep'     the reference stands as history — the target's tombstone
//              is the only mark (a comment's dead author, a memory's
//              dead source session)
export type Death = 'cascade' | 'detach' | 'release' | 'keep'

export type PropType =
  | 'text'
  | 'body'
  | 'number'
  | 'bool'
  | 'query'
  | { enum: string[] }
  | { eid: string; death: Death }
  | { text: string }

// The status vocabulary, in board-column order. 'cancelled' is authored,
// not derived — nobody can derive "we changed our minds" — and not
// deletion: deletion tombstones mistakes, cancellation preserves a
// decision about real work, trail intact.
export let statuses = ['open', 'wip', 'done', 'cancelled']

// Settled = no longer open work, whether it finished or was called off.
// Gating, board defaults, and lease-lapse audits all key off this
// instead of 'done' alone, so a cancelled blocker releases its gate too.
export let settled = (status?: string | null) =>
  status == 'done' || status == 'cancelled'

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
    project_eid: { eid: 'project', death: 'detach' },
    // Whose PLATE this is — durable routing to any entity (a person, a
    // project standing in for its operator). Orthogonal to claim, which
    // is who holds it NOW; a dead assignee detaches, never takes the task.
    assignee_eid: { eid: '', death: 'detach' },
    domain: { text: 'domains' }, // free text; the graph suggests
  },
  // retired_at: the project is over, not erased. Wire-writable — stamping
  // it IS the retirement (like acked_at, no effect needed); everything
  // filed under it stays referenceable but sinks (search, .order=hot).
  project: { retired_at: 'text' },
  repo: { path: 'text', base_branch: 'text' }, // the project's checkout
  board: { query: 'query' }, // saved filter (query.ts grammar); '' = all
  canvas: {},
  web: { url: 'text' }, // frozen_at is server-stamped, never wire-writable
  card: { target_eid: { eid: '', death: 'cascade' }, view: 'text' },
  pin: {
    canvas_eid: { eid: '', death: 'cascade' },
    x: 'number',
    y: 'number',
    w: 'number',
    h: 'number',
    z: 'number',
  },
  // actor_eid is the identity CHAIN: a client is one browser's presence,
  // a session one agent's run — instruments, not identities — and the
  // actor is who the instrument acts for (a person, or a project standing
  // in for its operator; {eid: ''} because the pool is shared). Authorship
  // stays on the instrument; identity is one hop away, and the hop is
  // queryable (.author.actor=jeff). An assertion, not authentication —
  // forging it only garbles your own attribution, like acked_at.
  client: { user_agent: 'text', actor_eid: { eid: '', death: 'detach' } }, // ip is server-stamped too
  camera: {
    client_eid: { eid: 'client', death: 'cascade' },
    canvas_eid: { eid: '', death: 'cascade' },
    x: 'number',
    y: 'number',
    zoom: 'number',
    w: 'number',
    h: 'number',
  },
  fold: {
    client_eid: { eid: 'client', death: 'cascade' },
    board_eid: { eid: 'board', death: 'cascade' },
    statuses: 'text',
  },
  // Binds a client to their tray canvas. 'release' on purpose: a dead
  // client's shelf sheds the tag, the canvas (and whatever it holds)
  // survives as a plain canvas — the binding was the client's, the
  // contents aren't.
  shelf: { client_eid: { eid: 'client', death: 'release' } },
  // acked_at is the session's OWN "seen up to here" cursor for the
  // while-you-were-away digest — wire-writable because forging it only
  // deafens yourself. The REQUEST columns (provider, model, effort, the
  // task and persona) are wire-writable too: a session created carrying a
  // provider IS a spawn request — the server's created(session) effect
  // validates and launches it, and everything it learns (status, branch,
  // exit…) stays server-stamped.
  session: {
    id: 'text',
    cwd: 'text',
    acked_at: 'text',
    provider: 'text',
    model: 'text',
    effort: 'text',
    requested_task_eid: { eid: '', death: 'detach' },
    persona_eid: { eid: '', death: 'detach' },
    actor_eid: { eid: '', death: 'detach' }, // who this run acts for — see client above
  },
  // 'release' is the claim's word exactly: when the session dies the
  // LEASE vanishes (row deleted, claim-null on the wire) but the claimed
  // entity — somebody's task — survives, freed. claimed_at server-stamped.
  claim: { session_eid: { eid: 'session', death: 'release' } },
  // The brake, pulled as data: creating one asks the server to stop the
  // session it targets. Valid only against an ACTIVE managed session
  // (apply() refuses the rest); acted_at is server-stamped and the row
  // stays as audit, like conflict.
  stop_request: { target_eid: { eid: 'session', death: 'cascade' } },
  // A knock: bring THIS entity to THAT actor's attention, NOW. The
  // artifact of an attention ask (always minted, GC-able later — the
  // record is what makes delivery debuggable); words ride as a plain
  // comment on the target in the same batch, never in the knock. The
  // resolver effect (knock.ts) walks the ladder — running session hears
  // the cast (the channel plugin), a project with nobody running spawns
  // onto the target, a person gets mail — and stamps what it did.
  knock: {
    target_eid: { eid: '', death: 'cascade' }, // what to look at
    to_eid: { eid: '', death: 'cascade' }, // who should look
  },
  // Outbound mail, asked for as data: creating one requests delivery (the
  // mailer effect sends and stamps the outcome — acted_at/error/to_addr,
  // all server-side; the row stays as the audit envelope). Subject rides
  // doc.title, the body doc.body — a mail is a document that travels.
  // `to` is a raw address (has an @) or a graph reference — alias slug,
  // human id, eid — resolved against the address book at delivery.
  mail: {
    to: 'text',
    from: 'text',
    // What the mail is ABOUT. A sent mail is history — its subject's
    // death doesn't unsend it (the byline rule, comment.author_eid).
    target_eid: { eid: '', death: 'keep' },
  },
  conflict: {}, // server-minted audit rows — nothing is wire-writable
  // A webhook delivery, derived from the edge's raw request spool
  // (inbound.ts): the edge captures requests without opinions, the graph
  // pulls them apart. Tag-style like conflict — every column is
  // server-stamped; a webhook was never mail, so it never wears the
  // mail comp.
  hook: {},
  comment: {
    target_eid: { eid: '', death: 'cascade' },
    // A byline survives its instrument: the words remain attributed to a
    // session that ended long ago — history, not a dangle.
    author_eid: { eid: '', death: 'keep' },
  },
  alias: { slug: 'text' },
  // A durable identity — the owner, an operator. The doc carries the
  // name, an alias the handle (jeff), and tasks point at it through
  // assignee_eid; sessions stay what they are (one run), a person is who
  // they run FOR.
  person: {},
  // A voice a session can wear: the doc is its irreducible core text,
  // and its TIERS are edges — persona `contains` X preloads X's whole
  // body, persona `reads` X carries only X's index line; everything else
  // in scope stays searchable. home_eid is its home project (the
  // project's baseline persona is the one the project `contains`);
  // null = fleet-shared (graybeard reviews every venture). NOT
  // project_eid, same reason as memory.scope_eid: bare '.project_eid'
  // must keep routing to task. Worn ≠ speaking-for: persona_eid names
  // the voice, actor_eid who it acts for.
  persona: { home_eid: { eid: 'project', death: 'detach' } },
  // An address is a FACET, not a person-column: any entity may wear one —
  // a person, a project (its operator's inbox), someday a webhook source.
  // The whole address book is this comp; send-resolution is one rule:
  // reference → the entity's email.address, absent = a stamped error.
  email: { address: 'text' },
  // A distilled fact worth keeping — content rides the doc (title = the
  // index line, body = the fact), provenance rides source_eid. The scope
  // column is scope_eid, NOT project_eid: bare '.project_eid' must keep
  // routing to task (live board queries depend on it), and a collision
  // would make it ambiguous. last_confirmed_at is server-stamped by the
  // confirm door, never wire-set.
  memory: {
    type: { enum: ['user', 'feedback', 'project', 'reference'] },
    // Provenance and scope are history — a fact outlives the session
    // that learned it and the project it was learned for.
    source_eid: { eid: 'session', death: 'keep' },
    scope_eid: { eid: 'project', death: 'keep' },
  },
  // Server-minted recall aggregates — count·first_at·last_at is the
  // decay model's whole memory (query.ts hot() derives rank at read).
  // Nothing is wire-writable; db.ts touch() is the one writer. Keyed by
  // eid like any comp, so ANY entity can grow warm — rank is graph-wide.
  recall: {},
}

// Server-stamped columns — never wire-writable (cols() reads `comps`
// alone, so these never join the apply allowlist), but part of the
// SCHEMA: backlinks and any reader of associations take the union, so an
// edge the server wrote still reads as an edge, and the Schema view can
// say what every column is. The values here DECLARE; the stamping itself
// lives in server code (db.ts, sessions.ts, freeze.ts), each write beside
// its why.
export let stamped: Record<string, Record<string, PropType>> = {
  entity: { num: 'number', created_at: 'text', modified_at: 'text' },
  web: { frozen_at: 'text' }, // the freeze finished (freeze.ts)
  client: { ip: 'text' },
  claim: { claimed_at: 'text' },
  stop_request: { acted_at: 'text' }, // signals sent — the relay's sweep key
  // Delivery outcome (knock.ts): acted_at = the resolver ran, delivery =
  // what it did (cast S-9 / spawned S-9 / mailed U-2 / held), error = why
  // it couldn't.
  knock: { acted_at: 'text', delivery: 'text', error: 'text' },
  // Delivery outcome (mail.ts): acted_at = the effect ran, error = how it
  // went wrong, to_addr = the RESOLVED envelope address — denormalized on
  // purpose, so later edits to the address book never rewrite what a
  // delivery actually used.
  // Inbound provenance (inbound.ts): message_id is the fleet spool's id —
  // the idempotency key AND the inbound mark (delivery skips rows that
  // carry it, or arrival would echo back out as a send); received_at when
  // the edge landed it; verified the edge's DKIM verdict. Unverified
  // content is DATA — it lands verbatim, nothing executes on it.
  mail: {
    acted_at: 'text',
    error: 'text',
    to_addr: 'text',
    message_id: 'text',
    received_at: 'text',
    verified: 'bool',
  },
  // Webhook provenance (inbound.ts): source names the edge route the
  // request hit, event the parser's one-line verdict, payload the raw
  // body verbatim, spool_id the edge's row id — (source, spool_id) is
  // the idempotency key — received_at when the edge captured it.
  hook: {
    source: 'text',
    event: 'text',
    payload: 'body',
    spool_id: 'text',
    received_at: 'text',
  },
  memory: { last_confirmed_at: 'text' },
  recall: { count: 'number', first_at: 'text', last_at: 'text' },
  // Audit rows outlive everything they mention: loser/holder are display
  // strings by design (db.ts says why), and the target reference stands
  // even after the target dies — contention history keeps its subject.
  conflict: {
    target_eid: { eid: '', death: 'keep' },
    loser: 'text',
    holder: 'text',
    at: 'text',
  },
  // The managed-session lifecycle (sessions.ts owns every write; the
  // wire-writable REQUEST columns live in comps.session above).
  session: {
    origin: { enum: ['external', 'managed'] },
    branch: 'text',
    base_revision: 'text',
    status: 'text', // starting|running|stopping, then how it ended
    provider_session_id: 'text',
    serving_model: 'text',
    latest_seq: 'number',
    started_at: 'text',
    stop_requested_at: 'text',
    finished_at: 'text',
    exit_code: 'number',
    stop_reason: 'text',
    final_text: 'body',
    usage_json: 'text',
    error: 'text',
  },
}

// A component's wire-writable column names — what most consumers of the
// old flat list actually want.
export let cols = (comp: string) => Object.keys(comps[comp] ?? {})

// The reaper's worklists, derived: every wire-writable reference wearing
// the given death word, as (comp, column) pairs. db.ts walks these when
// an entity dies — the declarations above ARE the cascade, so a new
// reference can't dodge the reaper by forgetting a hand-kept list.
// (`stamped` refs stay out on purpose: server-owned rows die by server
// code, not by the wire's cascade.)
export let deaths = (word: Death): [string, string][] =>
  Object.entries(comps).flatMap(([name, props]) =>
    Object.entries(props).flatMap(([col, t]) =>
      typeof t == 'object' && 'eid' in t && t.death == word
        ? [[name, col] as [string, string]]
        : []
    )
  )

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

// One log line, in the vocabulary the RENDERER speaks — flat and small, the
// same six shapes whatever provider wrote it. Adapters own the dialects
// (adapters.ts, server-only) and normalize each event down to one of these
// before it reaches a browser, so the Session view never learns a vendor:
//   say    what the agent (or the human, resuming) actually said
//   reason the model thinking out loud — dim, skippable
//   tool   a tool call as a chip: name + ok/✗, its detail, its error
//   exec   a shell command it ran — desc says what for, in its own words
//   turn   a turn closing, with usage — a thin divider, not content
//   error  the run itself went wrong
//   sys    provider housekeeping worth a dim chip: the tag names the
//          family (thinking, hook, task, …), the text carries the gist.
//          A view may squeeze a run of same-tag frames into one line.
export type LogRow =
  | { kind: 'say'; role: 'agent' | 'user'; text: string }
  | { kind: 'reason'; text: string }
  | {
    kind: 'tool'
    name: string
    detail?: string
    ok?: boolean
    error?: string
  }
  | { kind: 'exec'; command: string; desc?: string; exit?: number }
  | { kind: 'turn'; usage?: string }
  | { kind: 'error'; text: string }
  | { kind: 'sys'; tag: string; text?: string }

// Token counts the way a human reads them: 831, 12k, 1.2M.
export let kilo = (n: number): string =>
  n < 1000
    ? String(n)
    : n < 1e6
    ? `${+(n / 1e3).toFixed(n < 10_000 ? 1 : 0)}k`
    : `${+(n / 1e6).toFixed(1)}M`

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
  'stop_request',
  'knock',
  'mail',
  'hook',
  'conflict',
  'comment',
  'memory',
  'person',
  'persona',
  'doc',
  // An address is a facet like a handle: it names an entity only when
  // nothing else does (a bare address-book entry), same reasoning as
  // alias below — an addressed person stays a person.
  'email',
  // A slug is a handle, not an identity — alias names an entity only
  // when nothing else does (Jeff is a person who HAS an alias, not an
  // alias; the same held the Vocabulary doc hostage as A-3xxx).
  'alias',
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
  memory: 'M',
  person: 'U', // U-ser: P is the projects'
  mail: 'E', // E-mail: S is the sessions'
  email: 'A', // A-ddress: E is the mails'
  persona: 'N', // N for the name it wears: P is the projects'
  hook: 'H',
  knock: 'K',
}
export let idOf = (e: { kind: string; num: number }) =>
  `${prefix[e.kind] ?? e.kind[0].toUpperCase()}-${e.num}`

// A model's short name — 'claude-fable-5' is fable, 'gpt-5.6-sol' is sol:
// drop the vendor word and anything wearing a digit, keep what's left.
// The composer greets an agent by it; a persona's name outranks it once
// personas exist.
export let nick = (model?: string | null) => {
  let words = (model ?? '').split('-')
    .filter((w) => w && !/\d/.test(w) && w != 'claude' && w != 'gpt')
  return words.join('-') || null
}

// The edge vocabulary — every edge reads as a sentence, parent first:
// parent requires child (hard gate) · parent contains child (decomposition,
// children roll up) · parent reads child (read-first, never gates) ·
// parent about child (subject reference — a task about a session, a note
// about anything; never gates).
// The LIST is the source of truth: db.ts bakes it into the dependency
// table's check constraint (and rebuilds a live table whose baked list
// has fallen behind), so a new verb here is a new verb everywhere.
export let edges = ['requires', 'contains', 'reads', 'about'] as const
export type Edge = (typeof edges)[number]

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
  assignee_eid?: string | null // whose plate — durable; claim is who's on it now
  domain?: string | null // cross-project facet (Eng, Legal, Ops, …) — free
  // text by convention; a picker derives its options from distinct values
}

// A tag: "this doc fronts a project" (a venture, a workstream). Its name
// is its doc.title — one naming mechanism, no drift. retired_at set means
// the venture is over — kept, referenceable, sunk in every ranking.
export type ProjectTag = { eid: string; retired_at?: string | null }

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
  actor_eid?: string | null // who this browser acts for (comps comment)
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

// The Shelf: a per-client scratch canvas the Tray hangs cards on. A tag
// like repo — it binds a client to their one shelf without naming the
// entity (the entity stays a canvas), so it stays out of kindOrder.
export type Shelf = { eid: string; client_eid: string }

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
  actor_eid?: string | null // who this run acts for (comps comment)
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

// A request to stop the session it targets — the graph-native stop
// button. Created over the wire, acted on by the server's effect, kept
// as audit; acted_at is stamped when the signals have been sent.
export type StopRequest = { eid: string; target_eid: string; acted_at?: string }

// An entity's mail address — the address-book facet, one comp for all.
export type Email = { eid: string; address: string }

// Mail, either direction: the request columns are the ask, the stamped
// trio the receipt; to_addr is the envelope copy — what delivery
// resolved and used. An INBOUND mail carries message_id (the fleet
// spool's id, also the never-send mark), received_at, and the edge's
// verified verdict.
export type Knock = {
  eid: string
  target_eid: string
  to_eid: string
  acted_at?: string | null
  delivery?: string | null
  error?: string | null
}

export type Mail = {
  eid: string
  to: string
  from?: string | null
  target_eid?: string | null
  acted_at?: string | null
  error?: string | null
  to_addr?: string | null
  message_id?: string | null
  received_at?: string | null
  verified?: number | null
}

// A webhook delivery, pulled apart from the edge's raw request spool —
// all server-stamped (see `stamped`), payload kept verbatim.
export type Hook = {
  eid: string
  source?: string | null
  event?: string | null
  payload?: string | null
  spool_id?: string | null
  received_at?: string | null
}

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

// A wearable voice: core text in the doc, tiers in the edges, home in
// home_eid (null = fleet-shared).
export type Persona = { eid: string; home_eid?: string | null }

// A distilled fact the fleet keeps: content in the doc, provenance in
// source_eid (the session that learned it), scope in scope_eid (the
// project it belongs to). last_confirmed_at is the last explicit
// re-confirmation — server-stamped, like every recall statistic.
export type Memory = {
  eid: string
  type: string // user | feedback | project | reference
  source_eid?: string | null
  scope_eid?: string | null
  last_confirmed_at?: string | null
}

// Recall aggregates, server-minted on every activation (db.ts touch()).
// Three numbers are the whole model: query.ts hot() derives stability
// (count and spacing) and decays against last_at at read time — no
// stored score anywhere, nothing to sweep.
export type Recall = {
  eid: string
  count: number
  first_at: string
  last_at: string
}

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
  retired?: boolean // its project is over — the hit sank to the tail
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
  created_at?: string // server-stamped, when the cache carries them
  modified_at?: string
  kind: string
  doc?: Doc
  task?: Task
  project?: ProjectTag
  person?: { eid: string }
  repo?: Repo
  canvas?: { eid: string }
  board?: BoardTag
  web?: Web
  card?: CardComp
  pin?: Pin
  client?: Client
  camera?: Camera
  fold?: Fold
  shelf?: Shelf
  session?: Session
  claim?: Claim
  stop_request?: StopRequest
  knock?: Knock
  mail?: Mail
  hook?: Hook
  email?: Email
  conflict?: Conflict
  comment?: Comment
  alias?: Alias
  memory?: Memory
  persona?: Persona
  recall?: Recall
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
