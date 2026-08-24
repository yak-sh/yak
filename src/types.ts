// Shared FE/BE vocabulary: entity components, edges, and the sync unit.
// No imports; the only runtime here is the vocabulary itself — safe on
// both sides of the wire.

// What a prop IS — the detection layer editors and docs read. The
// vocabulary stays deliberately tiny:
//   'text'            one line (sometimes more)
//   'body'            long markdown
//   'number' 'bool'   what they say
//   'priority'        a number operators spell with an optional P
//   'query'           a line of the filter grammar (query.ts) — text
//                     whose editor knows the vocabulary
//   'time'            an ISO timestamp — a text column whose face is
//                     relative words (full stamp on hover)
//   'url'             an address out on the web — a text column whose
//                     face is a link
//   {enum: [...]}     a closed set; aliases are input spellings only
//   {eid: 'project',  an association; the name says which component the
//    death: …}        target carries ('entity' = any entity — the spine is
//                     a real component, so 'entity' names it like any
//                     other, never a falsy '' that truthiness misreads),
//                     the death word what the reference means when the
//                     target dies
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
//              is the only mark (dead provenance)
export type Death = 'cascade' | 'detach' | 'release' | 'keep'

export type PropType =
  | 'text'
  | 'body'
  | 'number'
  | 'priority'
  | 'bool'
  | 'query'
  | 'time'
  | 'url'
  | { enum: readonly string[]; aliases?: Record<string, string> }
  | { eid: string; death: Death }
  | { text: string }

// The status vocabulary, in board-column order. 'cancelled' is authored,
// not derived — nobody can derive "we changed our minds" — and not
// deletion: deletion tombstones mistakes, cancellation preserves a
// decision about real work, trail intact.
export let statuses = ['open', 'wip', 'done', 'cancelled'] as const

// A provider hook says whether its composer is between turns. Delivery uses
// this positive boundary instead of guessing from terminal animation.
export let turnStates = ['idle', 'busy'] as const

// Session-log messages and provider HTTP calls each keep one canonical
// spelling. These lists feed the graph schema, editors, and MCP grammar.
export let messageRoles = ['user', 'agent'] as const
export let httpMethods = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const

// A role is desired capacity. Native owns an interactive provider TUI;
// managed owns a resumable Tasks session. `held` is the crash-loop breaker's
// verdict — the reconciler stopped relaunching a burning role and waits for an
// owner `task role start`. Distinct from `stopped` (an owner's off switch) so
// the two read apart and `held` keeps its error component across every tick.
export let roleStates = [
  'running',
  'stopped',
  'paused',
  'disabled',
  'retired',
  'held',
] as const
export let roleSurfaces = ['native', 'managed'] as const
export let wakePolicies = [
  'always',
  'attention',
  'scheduled',
  'manual',
] as const

// A venture's lifecycle, from a glimmer to its end. `hold` and `paused` are
// reversible stops — the venture remembers where it came from (hold_from,
// paused_from) so unhold/unpause restores the phase; `shuttered` and `killed`
// are terminal. Two verbs because a hold is operational (wait for a blocker)
// and a pause is a deliberate rest of the work.
export let ventureStates = [
  'incubating',
  'idea',
  'building',
  'launching',
  'live',
  'hold',
  'paused',
  'shuttered',
  'killed',
] as const

// How a venture is run: long-loop keeps a session alive across turns, cold
// spawns fresh each time, cron wakes it on a schedule.
export let ventureModes = ['long-loop', 'cold', 'cron'] as const

// A container pane lays its children along this axis: h = side by side,
// v = stacked.
export let dirs = ['h', 'v'] as const

// What an actor has said about a thread, overriding the addressed-to
// default. There is no 'auto': absent IS auto, because auto is exactly
// what addressed() already does — a stored default is a row that means
// nothing and can drift out of step with the rule it duplicates.
export let subModes = ['watch', 'mute'] as const

// A review is a comment with one of these verdicts. Input aliases keep
// the operator verbs short; the graph stores only the settled words.
export let verdicts = [
  'approved',
  'rejected',
  'changes_requested',
] as const
export let verdictName = (verdict?: string | null) =>
  String(verdict ?? '').replaceAll('_', ' ')

// A model's capability tier (supply book D-21285) — what the clearing
// house matches a task's minimum-capability ask against. Coarse on
// purpose: grades are DISCOVERED from per-grade P&L, not asserted finely.
export let grades = ['frontier', 'mid', 'small'] as const

// The graph-native Session-log vocabulary. Grouping it here keeps its column
// declarations in the one schema while letting the ordinary dot-param door
// require explicit `.component.prop` spellings for this lazy partition.
export let sessionComps: Record<string, Record<string, PropType>> = {
  entry: { session: { eid: 'session', death: 'cascade' } },
  content: { body: 'body' },
  message: { role: { enum: messageRoles } },
  // The always-first user entry is session context, not conversation. Its
  // own facet lets every transcript face fold it without inferring from seq.
  instruction: {},
  attention: {},
  generation: {
    through: { eid: 'entry', death: 'keep' },
    provider: 'text',
    model: 'text',
    effort: 'text',
  },
  output: {
    source: { eid: 'generation', death: 'keep' },
    key: 'text',
    phase: 'text',
  },
  call: { key: 'text' },
  bash: { command: 'body', cwd: 'text' },
  fetch: { url: 'url', method: { enum: httpMethods } },
  patch: { path: 'text', diff: 'body' },
  // Provider-neutral named-tool facet (D-16704): an imported tool call with no
  // first-class facet (bash/patch/fetch/task_context/graph_query/apply) keeps
  // its real `name` and a one-line arg `detail` here, so entry_log renders it
  // through the ordinary call path. Wire-writable — an importer names the tool.
  tool: { name: 'text', detail: 'text' },
  task_context: {},
  graph_query: { query: 'query' },
  // A graph Change[] batch, serialized. One mutation facet preserves the
  // graph's existing vocabulary instead of cloning every task_* verb here, and
  // holding the whole array keeps the hosted apply atomic — two dependent
  // patches ride one write, not two (T-16716).
  apply: { changes: 'body' },
  result: { call: { eid: 'call', death: 'keep' } },
  exit: { code: 'number' },
  response: { status: 'number' },
  headers: { data: 'body' },
  stderr: { text: 'body' },
  timeout: { ms: 'number' },
  checkpoint: { through: { eid: 'entry', death: 'keep' } },
  cancel: { target: { eid: 'entity', death: 'keep' } },
  reasoning: {},
  // Memory auto-recall (T-17306): a recall-floater entry — the memories the
  // graph surfaced for the message named by `source`. It carries no `message`
  // facet, so the recall effect (which fires on message) never fires on a
  // recall entry: recall cannot recall itself. The floated memories ride
  // `recalled`-type dependency edges off this entry, so a session's earlier
  // floaters stay queryable for per-session dedup.
  recalled: { source: { eid: 'entry', death: 'keep' } },
  // Same-provider replay evidence only: encrypted reasoning and provider
  // shapes the typed vocabulary does not yet know.
  opaque: { format: 'text', data: 'body' },
  runner: { name: 'text' },
  // Whole components are server-owned. Their empty writable declarations
  // keep generic graph deletion/read machinery complete; apply() refuses
  // clients at the component boundary.
  lease: {},
  usage: {},
  // The ingest coordinate (D-16704): where an imported entry came from —
  // {source, line} in `stamped` below. Server-owned like lease/usage: the
  // trusted append path stamps it in the same transaction as the entry, and
  // apply() refuses it from the wire, so no client can pre-stamp a coordinate
  // to make the ingester skip a real line. The set of (session, source, line)
  // present IS the durable cursor — there is no mutable cursor row.
  imported: {},
}

// Settled = no longer open work, whether it finished or was called off.
// Gating, board defaults, and lease-lapse audits all key off this
// instead of 'done' alone, so a cancelled blocker releases its gate too.
export let settled = (status?: string | null) =>
  status == 'done' || status == 'cancelled'

// What a notice records — the kinds of thing that happened but nobody
// said (D-13858). `lapse` a session's lease went unreleased at wrap,
// `sweep` a background sweep found something, `scene` a `:fix` capture.
// A closed set like statuses: the mint sites (T-11046) name one of these.
export let noticeKinds = ['lapse', 'sweep', 'scene'] as const

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
    priority: 'priority',
    project: { eid: 'project', death: 'detach' },
    // Whose PLATE this is — durable routing to any entity (a person, a
    // project standing in for its operator). Orthogonal to claim, which
    // is who holds it NOW; a dead assignee detaches, never takes the task.
    assignee: { eid: 'entity', death: 'detach' },
    domain: { text: 'domains' }, // free text; the graph suggests
  },
  // color: the venture's tmux window colour, and whatever else comes to want
  // one. Any tmux colour spelling (`cyan`, `brightblue`, `colour45`,
  // `#5fafd7`). Empty means DERIVE it — roles.ts hashes the venture id over
  // the fleet palette, so a venture that never sets one still gets a stable
  // colour of its own rather than the default.
  project: { color: 'text' },
  // the project's checkout and public repository URL. `gate` names its one
  // complete test command;
  // `push` is the venture's standing permission for the projection to push
  // what it commits — OFF by default, and off for every repo the graph doesn't
  // know, because a push to main deploys in some ventures and an unknown repo
  // must land on the harmless side.
  repo: {
    path: 'text',
    url: 'url',
    base_branch: 'text',
    gate: 'text',
    push: 'bool',
  },
  // A project's venture facet: lifecycle phase + operating config. A facet,
  // not an identity — a doc+project+venture is still a project (kindOf stays
  // 'project'), so it stays out of kindOrder. Every column is wire-writable;
  // the owner sets phase and config from the UI or CLI. The four names dodge
  // bare dot-param collisions (phase↚state, run_mode↚mode, agent_model↚model,
  // operated_by↚operator, site↚url) — venture access is always qualified
  // `.venture.<col>`, so nothing bare had to move. `paused_from`/`hold_from`
  // remember the phase a reversible stop came from, restored on unpause/unhold.
  // `run_mode`/`agent_model`/`operated_by` are an interim operator↔venture
  // binding — orchestration topology (T-8855/T-3906) subsumes them later.
  venture: {
    phase: { enum: ventureStates },
    paused_from: { enum: ventureStates },
    hold_from: { enum: ventureStates },
    run_mode: { enum: ventureModes },
    agent_model: 'text',
    operated_by: 'text',
    tagline: 'text',
    site: 'url',
  },
  role: {
    state: { enum: roleStates },
    surface: { enum: roleSurfaces },
    // Scope is attachment, not execution ground: a role may serve any graph
    // entity. checkout names the repo-bearing entity when scope is not one.
    scope: { eid: 'entity', death: 'detach' },
    checkout: { eid: 'entity', death: 'detach' },
    schedule: 'text',
    wake_policy: { enum: wakePolicies },
    wake_target: { eid: 'entity', death: 'detach' },
    // The crash-loop breaker's fresh-start boundary: `task role start` stamps
    // it, and the breaker counts only deaths after it (roles.ts). Set by the
    // owner's retry so a fixed role's stale burst can't re-trip it; the
    // reconciler never writes it, so a successful launch can't wipe the fence.
    retry_at: 'time',
  },
  board: { query: 'query' }, // saved filter (query.ts grammar); '' = all
  // A tiling layout (D-14718): the doc names it, root its top pane.
  // Shared like a board — fork is an explicit gesture, never copy-on-write.
  // death 'detach' on purpose: deleting the root pane directly orphans the
  // layout to an empty state instead of chaining a second cascade back
  // through it (gestures never do this — close() on the last pane clears).
  layout: { root: { eid: 'pane', death: 'detach' } },
  // One pane of a layout: a CONTAINER when dir is set (children are the
  // panes whose parent names it, ordered by `order`), a LEAF otherwise
  // (content + view, card's pair; both absent = empty → the palette).
  // size is a WEIGHT among siblings — renderers divide by the siblings'
  // sum, so closing a pane renormalizes the rest with no array to splice.
  // content is a SOFT ref: the shown entity's death empties the pane.
  pane: {
    layout: { eid: 'layout', death: 'cascade' },
    parent: { eid: 'pane', death: 'cascade' },
    size: 'number',
    order: 'number',
    dir: { enum: dirs },
    content: { eid: 'entity', death: 'detach' },
    view: 'text',
  },
  // The thinking that precedes a build. A tag, because the doc already
  // carries the writing and the `proposed`/`decided` stamps below already
  // carry its life — awaiting acceptance, then settled, with the date on
  // the wire. A state enum here would be a second vocabulary for a fact
  // the graph holds, and the two would drift.
  design: {},
  // Marks a doc as architecture documentation — the graph's self-description
  // of what the system IS (root D-18438 + leaves, linked by `contains`). A
  // presence-only tag like `design`, but NOT in kindOrder: a design outranks
  // task because it is a proposal, whereas an architecture doc is still a
  // plain doc — the tag only lets `task docs` and filters find them as a class.
  architecture: {},
  canvas: {},
  web: { url: 'url' }, // frozen_at is server-stamped, never wire-writable
  // An attached file (T-12781). The entity carries only the METADATA — the
  // file's mime, name, sha, byte size, and (for an image) w/h; the BYTES live
  // beside the db at ~/.tasks/blobs/<sha>, content-addressed so the same file
  // attached twice costs once. Never base64 in a column, never in snapshot(),
  // never in a client cache — served at GET /blob/<sha> the way freeze.ts
  // serves archives, so the db and every backup stay lean (the row-bytes
  // lesson the backup doc paid for). One aspect — "this entity has a file"
  // (M-14942) — worn by ANY entity: a bare blob IS a file, a task+blob a task
  // with an attachment. Wire-writable: the upload door (POST /blob) stores the
  // bytes and stamps this through apply() like any write, and a client may
  // re-point name; a forged sha only aims a card at bytes that aren't there.
  blob: {
    mime: 'text',
    name: 'text',
    sha: 'text',
    bytes: 'number',
    w: 'number',
    h: 'number',
  },
  card: { target: { eid: 'entity', death: 'cascade' }, view: 'text' },
  pin: {
    canvas: { eid: 'entity', death: 'cascade' },
    x: 'number',
    y: 'number',
    w: 'number',
    h: 'number',
    z: 'number',
  },
  // actor is the identity CHAIN: a client is one browser's presence,
  // a session one agent's run — instruments, not identities — and the
  // actor is who the instrument acts for (a person, or a project standing
  // in for its operator; {eid: 'entity'} because the pool is shared). The
  // universal provenance stamp keeps both levels directly queryable
  // (`.created.by=jeff`, `.created.via=S-31`). An assertion, not
  // authentication — forging it only garbles your own attribution.
  client: { user_agent: 'text', actor: { eid: 'entity', death: 'detach' } }, // ip is server-stamped too
  camera: {
    client: { eid: 'client', death: 'cascade' },
    canvas: { eid: 'entity', death: 'cascade' },
    x: 'number',
    y: 'number',
    zoom: 'number',
    w: 'number',
    h: 'number',
  },
  fold: {
    client: { eid: 'client', death: 'cascade' },
    board: { eid: 'board', death: 'cascade' },
    statuses: 'text',
  },
  // Binds a client to their tray canvas. 'release' on purpose: a dead
  // client's shelf sheds the tag, the canvas (and whatever it holds)
  // survives as a plain canvas — the binding was the client's, the
  // contents aren't.
  shelf: { client: { eid: 'client', death: 'release' } },
  // WHERE a client is LOOKING — navigation as graph data (T-12788), the last
  // piece of screen state that wasn't. One row per client (indexes below),
  // written by nav.tsx on navigate the way camera writes on pan, and cascading
  // with the client the same way. `target` is the entity fullscreened (the URL
  // is still the position; this mirrors it into the graph), `view` its ?v= tab.
  // Two directions ride one row: the browser WRITES it to publish where it is,
  // and an AGENT writes it to MOVE the human's open tab — the "show you
  // something" the knock's first consumer wants, the same door camera/card_*
  // prove the UI is data. death 'keep' on target on purpose: a cursor aimed at
  // a dead entity keeps the tombstone and the reader derives a nearest-live
  // fallback at READ time — never a self-healing repair write (the reviewer's
  // #1 correction). Movement is not membership: back-navigation MOVES the
  // cursor, it never removes it.
  cursor: {
    client: { eid: 'client', death: 'cascade' },
    target: { eid: 'entity', death: 'keep' },
    view: 'text',
  },
  // Shared navigation is a graph fact, not one client's chrome. A favorite
  // remains whatever kind it already was, so this facet stays out of
  // kindOrder. Its server-frozen `at` below records when it joined navigation;
  // removing and re-adding it starts a new tenure.
  favorite: {},
  // A non-secret runtime override, keyed by a catalog entry (config.ts). The
  // code catalog owns what a setting IS — label, type, default, validation,
  // sensitivity; this component holds only the OVERRIDE for a known key, unique
  // by key (indexes below). Ordinary values are graph data (D-18092): they ride
  // the normal mutation + broadcast path so a save reaches web and TUI and takes
  // effect at the next use without a tasksd restart. apply() validates the value
  // against the catalog and refuses an unknown key or a malformed one — SECRETS
  // never wear this component; those stay server-only (credentials.ts). NOT in
  // kindOrder: a setting is keyed by its catalog key, never addressed by num.
  setting: { key: 'text', value: 'text' },
  // A session's identity and configuration. The launch/worktree/runtime
  // columns below are rolling aliases: old doors may still write them while
  // apply() mirrors them into their canonical optional facets. Keeping the
  // aliases here admits old clients without making them the read model.
  session: {
    id: 'text',
    cwd: 'text',
    // The provider process this session runs in — the SessionStart hook walks
    // /proc and stamps it. Claude's channel binds by it; Codex's log follower
    // uses it as liveness.
    // Wire-writable like id/cwd: forging it only misroutes your own mail.
    pid: 'number',
    // The native terminal surface inherited by a provider hook. It is an
    // address, not authority: the server revalidates its process tree before
    // using it.
    pane: 'text',
    turn: { enum: turnStates },
    // The provider's own transcript JSONL — the SessionStart payload names
    // it, and it is an EXTERNAL session's durable log the way
    // ~/.tasks/logs/<eid>.jsonl is a managed run's. Wire-writable like the
    // rest of this block, and therefore a REFERENCE, not a capability: the
    // server confines it to the provider-owned stores (sessions.ts).
    transcript: 'text',
    // What KIND of session this is, self-reported at SessionStart: `agent_type`
    // is set when launched `claude --agent <name>`; `source` is the boot mode
    // (startup|resume|clear|compact|fork). Wire-writable like id/cwd/pid —
    // a forged value only mislabels your own row.
    agent_type: 'text',
    source: 'text',
    // Positive capability granted by a provider launcher's `--operator`.
    // It gates project-wide attention, never ordinary graph participation.
    operator: 'bool',
    provider: 'text',
    model: 'text',
    effort: 'text',
    requested_task: { eid: 'entity', death: 'detach' },
    // Role membership is launch history. A deleted role closes its process,
    // but the sessions that served it keep saying which role they served.
    role: { eid: 'role', death: 'keep' },
    persona: { eid: 'entity', death: 'detach' },
    actor: { eid: 'entity', death: 'detach' }, // who this run acts for — see client above
    // The session that spawned this one: a delegated agent shares its
    // operator's inherited session id but is its OWN context in its own
    // worktree (client.ts me()), so it reifies as a CHILD of the operator
    // rather than a second writer on one row. Lineage, not capability — the
    // link is what makes the board legible about who spawned whom; a dead
    // parent detaches it, the child lives on.
    parent: { eid: 'session', death: 'detach' },
  },
  // The handoff a session leaves for its successor (D-19459): a distinct
  // ASPECT (M-14942) — "what the next run needs to know", NOT this session's
  // own record (that is doc, free for the scribe/narrative). Written
  // deliberately via `task session brief`, or captured from the session's
  // final message at wrap; shown IN FULL under `## previously` in the
  // successor's digest. Not on kindOrder — a brief names no entity of its own.
  brief: { text: 'body' },
  // Where code work happens, independently of how the model runs. A coding
  // session wears this; chat may omit it. Branch facts are server-stamped.
  worktree: { cwd: 'text' },
  // A provider process binding, independently of whether code needs a
  // checkout. Graph-native sessions omit it; process-backed sessions wear it.
  runtime: {
    pid: 'number',
    pane: 'text',
    transcript: 'text',
  },
  // A Session's ordered log composes these independent facets; entry.seq and
  // lease/usage columns join through stamped below.
  ...sessionComps,
  // One launch vocabulary, worn two ways: on a session it records the
  // request that launched it; on a task it is the hint for its next run.
  // Partial on purpose — doors fill the gaps from their caller and the
  // provider table. apply() mirrors session facets into the legacy aliases
  // above; a task facet stays spawn-only.
  spawn: {
    provider: 'text',
    model: 'text',
    effort: 'text',
    persona: { eid: 'entity', death: 'detach' },
  },
  // 'release' is the claim's word exactly: when the session dies the
  // LEASE vanishes (row deleted, claim-null on the wire) but the claimed
  // entity — somebody's task — survives, freed. claimed_at server-stamped.
  claim: { session: { eid: 'session', death: 'release' } },
  // An operator's interrupted work stack is server-owned. Claim release
  // pushes; another claim or a settled task pops. The empty writable half
  // only puts the component in the graph vocabulary — apply() refuses it.
  resume: {},
  // An actor's standing instruction about ONE entity: watch it even
  // though nothing is aimed at me, or mute it though something is. Read
  // as an override on the item's TARGET — a subscription is aimed at the
  // task or venture, the inbox items are the letters and comments ABOUT
  // it. Both ends cascade: a muted thread's subscription dies with it.
  subscription: {
    actor: { eid: 'entity', death: 'cascade' },
    target: { eid: 'entity', death: 'cascade' },
    mode: { enum: subModes },
  },
  // The brake, pulled as data: creating one asks the server to stop the
  // session it targets. Valid only against an ACTIVE managed session
  // (apply() refuses the rest); the row stays as audit, like conflict, and
  // wears `delivered` once the signals are sent (deliver.ts).
  stop_request: { target: { eid: 'session', death: 'cascade' } },
  // A knock: bring THIS entity to THAT actor's attention, NOW. The
  // artifact of an attention ask (always minted, GC-able later — the
  // record is what makes delivery debuggable); words ride as a plain
  // comment on the target in the same batch, never in the knock. The
  // resolver effect (knock.ts) walks the ladder — running session hears
  // the cast (the channel plugin), a project with nobody running spawns
  // onto the target, a person gets mail — and stamps what it did. WHO
  // should look is the `deliver {to}` facet below, not a column here.
  knock: {
    target: { eid: 'entity', death: 'cascade' }, // what to look at
  },
  // A wake is a knock with a clock: the same sentence, said LATER. `at`
  // is absolute — the caller writes a phrase ('in 60m', '9am tomorrow')
  // and it resolves once, at mint (query.ts instant), because a row that
  // still holds a phrase would mean something different every time it is
  // read. The server keeps one timer at the earliest pending wake and
  // reconciles at boot, so an hour of downtime delays a wake instead of
  // eating it (wake.ts) — then mints the knock and lets that ladder
  // deliver. No repeats: `every` waits for something that needs it. WHO
  // to wake is the `deliver {to}` facet below.
  wake: {
    at: 'time',
    // What to look at on waking — absent means the wake itself.
    target: { eid: 'entity', death: 'cascade' },
    // A note written when the wake was set — what the setter was mid-doing,
    // why it will return. It rides through to the delivered knock's words (the
    // same comment-on-target seam a :knock's words use), so a resumed session
    // reconstitutes instead of guessing.
    note: 'text',
  },
  // A dream: a venture's consolidation cursor (T-12800, D-17362). One per
  // venture, its own entity rather than a mark on the project, so its cadence
  // clock (a self-armed wake) and its cursor are the venture's alone — a
  // venture can pause or retune its dream without touching the project.
  // `scope` names the venture project the comb consolidates; `floor` is the
  // sliding cursor over sessions finished since, advanced one calendar day per
  // run and clamped to a max(20 entries, 7 days) window (dream.ts). The comb
  // itself is a post-commit effect fired by the cadence wake's knock. A
  // distinct kind (kindOrder), so `graph_query kind=dream` lists them.
  dream: {
    scope: { eid: 'project', death: 'cascade' },
    floor: 'time',
  },
  // Outbound mail, asked for as data: creating one requests delivery (the
  // mailer effect sends and settles the outcome as the shared `delivered`/
  // `error` components — see deliver.ts — and denormalizes the resolved
  // envelope onto the row as DATA: to_addr, sent_id, received_at. The row
  // stays the audit envelope). Subject rides
  // doc.title, the body doc.body — a mail is a document that travels.
  // WHERE it goes is the `deliver {to}` facet below (an outbound mail wears
  // one; an INBOUND arrival does not — its recipient is `to_addr` DATA).
  // `from` is NOT here on purpose: the sender is who WROTE the mail, and
  // that is the server's fact, not the caller's claim. apply() stamps it
  // from the writing actor's address — the same resolution behind
  // created.by — so no door can assert someone else's identity, and the
  // trust tier operators key on that byline cannot be forged.
  mail: {
    // What the mail is ABOUT. A sent mail is history — its subject's
    // death doesn't unsend it (the provenance byline rule).
    target: { eid: 'entity', death: 'keep' },
    // The mail this one ANSWERS — reference at authoring, resolved to an
    // RFC Message-ID at delivery (mail.ts). History like target: a
    // reply outlives the mail it answered.
    reply_to: { eid: 'mail', death: 'keep' },
    // Read-state is the `opened` stamp (T-7006), not a column here: one
    // vocabulary for every item the inbox carries. Unread still derives —
    // message_id set (it arrived) and no `opened` — so outbound is born read.
  },
  conflict: {}, // server-minted audit rows — nothing is wire-writable
  // A webhook delivery, derived from the edge's raw request spool
  // (inbound.ts): the edge captures requests without opinions, the graph
  // pulls them apart. Tag-style like conflict — every column is
  // server-stamped; a webhook was never mail, so it never wears the
  // mail comp.
  hook: {},
  comment: {
    target: { eid: 'entity', death: 'cascade' },
  },
  // A notice: something happened ABOUT this entity that nobody said
  // (D-13858). Not a comment — it was emitted, so it is not in the
  // conversation, is not counted as one, and never reaches the mail relay
  // (fanout only ever looked at comments). The bus and the inbox deliver
  // it beside comments, keyed the same way — `target` is what it is about
  // (a session, a claimed task), the doc body says it in words, and `event`
  // is what happened. `event`, not `kind`: `.kind` is the universal listing
  // scope (query.ts), so a component column of that name would shadow it —
  // `event` is the graph's existing word for "what happened" (hook.event).
  // Wire-writable (the mint sites are headless doors), so it rides comps;
  // death 'cascade' like comment.target — a notice about a dead entity dies
  // with it. Same shape as comment, so it DERIVES its table (db.ts `derived`).
  notice: {
    target: { eid: 'entity', death: 'cascade' },
    event: { enum: noticeKinds },
  },
  // A quiet transcript memo (T-17319): a bare tag a comment wears to say
  // "harvest at consolidation, never inject live". channel.ts excludes a
  // meta-tagged comment from live delivery, so the note reaches the dream
  // (T-12800) combing the session — never the doer mid-task. A marker like
  // `design`: the doc carries the words, the tag carries the intent. Not in
  // kindOrder — a comment that carries meta is still a comment.
  meta: {},
  review: {
    verdict: {
      enum: verdicts,
      aliases: {
        approve: 'approved',
        reject: 'rejected',
        changes: 'changes_requested',
      },
    },
  },
  alias: { slug: 'text', slugs: 'text' },
  // A durable identity — the owner, an operator. The doc carries the
  // name, an alias the handle (jeff), and tasks point at it through
  // assignee; sessions stay what they are (one run), a person is who
  // they run FOR.
  person: {},
  // A voice a session can wear: the doc is its irreducible core text,
  // and its TIERS are edges — persona `contains` X preloads X's whole
  // body, persona `reads` X carries only X's index line; everything else
  // in scope stays searchable. home is its home project (the
  // project's common persona is the one the project `contains`);
  // null = fleet-shared (graybeard reviews every venture). NOT
  // project, same reason as memory.scope: bare '.project'
  // must keep routing to task. Worn ≠ speaking-for: persona names
  // the voice, actor who it acts for.
  persona: { home: { eid: 'project', death: 'detach' } },
  // A model as an entity (D-21308): the attribution cascade's terminal —
  // specialized persona → project base → model — so a projectless run
  // still names the program that ran, and unconfigured contexts cluster
  // visibly under their model. Rate cards and the supply book's grade
  // attach here rather than to a string. `name` is the wire spelling
  // ('claude-fable-5') the session/generation string columns keep
  // speaking — resolution is a lookup by it, never a break. `vendor` is
  // who MAKES the model (anthropic, openai) — deliberately not
  // `provider`, which already means the runner (claude, codex, ollama):
  // one vendor's model reaches us through several providers.
  model: { name: 'text', vendor: 'text', grade: { enum: grades } },
  // An address is a FACET, not a person-column: any entity may wear one —
  // a person, a project (its operator's inbox), someday a webhook source.
  // The whole address book is this comp; send-resolution is one rule:
  // reference → the entity's email.address, absent = a stamped error.
  email: { address: 'text' },
  // A distilled fact worth keeping — content rides the doc (title = the
  // index line, body = the fact), provenance the universal created stamp.
  // The scope column is scope, NOT project: bare '.project'
  // must keep routing to task (live board queries depend on it), and a
  // collision would make it ambiguous. last_confirmed_at is server-stamped
  // by the confirm door, never wire-set.
  //
  // There is no `type` column (T-12585). It was a kind column hiding inside
  // a component, in a graph whose whole premise is that an entity IS what
  // its components make it — and the four values said nothing the graph did
  // not already hold: `project` restated `scope`, `user` had zero rows
  // in 222, `reference` was what remained when nothing was said, and
  // `feedback` is now the tag below, which records WHO gave it.
  memory: {
    // Scope is history — a fact outlives the project it was learned for.
    scope: { eid: 'project', death: 'keep' },
  },
  // This entity records feedback, and `by` is who GAVE it. A facet like the
  // stamps: a memory usually wears it, but a comment or a doc may. Not in
  // kindOrder — a memory that carries feedback is still a memory.
  //
  // `by` is wire-only, deliberately NOT defaulted to the writing actor: the
  // recorder is almost never the source. Of the 87 rows the retired enum
  // called feedback, `created.by` named a VENTURE in 81 (the repo an agent
  // stood in) and a person in 6 — so a default would have asserted, 81
  // times, that a project said something a person said. Absent means the
  // source was not recorded, which is true; it is never a claim about
  // anyone. Death 'keep': the source outlives their tombstone, like a byline.
  feedback: { by: { eid: 'entity', death: 'keep' } },
  // Server-minted recall aggregates — count·first_at·last_at is the
  // decay model's whole memory (query.ts hot() derives rank at read).
  // Nothing is wire-writable; db.ts touch() is the one writer. Keyed by
  // eid like any comp, so ANY entity can grow warm — rank is graph-wide.
  recall: {},
  // Provenance, when+who+how paired (T-6670/T-7113): `created` set once at
  // write, `updated` the LAST edit — ABSENT until the first real
  // modification (absence = never edited, so there's no 'mostly-null'
  // problem, and the Stamp's edited-check is component presence). `at` is
  // server-stamped/frozen (in `stamped` below, like the spine timestamps
  // it replaced); `by` is wire-writable — the server defaults it to the
  // writing instrument's actor (db.ts writerActor), and the wire may
  // override it (an agent stamping Jeff as the author). `via` is the
  // server-stamped instrument: claiming another instrument is only spoofing.
  // Both are death 'keep' — provenance outlives the actor's or instrument's
  // tombstone. NOT in kindOrder: a facet every entity wears, never its
  // identity (like recall).
  created: { by: { eid: 'entity', death: 'keep' } },
  updated: { by: { eid: 'entity', death: 'keep' } },
  // Notification lifecycle — the inbox's read-state, denormalized into the
  // same register as created/updated (T-7006). Each is a PRESENCE stamp: the
  // wire writes the bare component to REQUEST the act, the server freezes the
  // clock (`at`) and the actor (`by`) — both in `stamped` below, so the wire
  // can set NEITHER. Monotonic and independent: an item can be `opened`
  // without `notified`, `archived` without `opened`. Only `archived` hides an
  // item from the inbox, which is what makes it drain-proof. NOT in kindOrder:
  // facets any entity wears (a comment, a knock, a mail), never its identity.
  notified: {}, // the operator has been told (inject or sweep) — never hides
  opened: {}, //   the operator has looked — NOT opened == unread; never hides
  archived: {}, // the operator is done — hides an inbox item
  // A safety boundary over ANY entity. Presence hides it from every list and
  // replaces direct rendering with an explicit reveal; the server signs the
  // whole stamp so graph content cannot forge who quarantined it or when.
  // NOT in kindOrder: quarantine never changes what the entity is.
  quarantined: {},
  // Addressing as a facet (D-14945): WHERE a deliverable goes. `to` names a
  // graph ENTITY — a session or actor (knock/wake), an address-book entity
  // (mail) — never a raw string: an external address IS an `email` entity, so
  // local-vs-external falls out of `homeOf`, and a raw @-address written here
  // is find-or-minted into one at the door (db.ts mintAddresses). One aspect,
  // one component, worn by knock/wake/outbound-mail in place of the per-type
  // to_eid/to (M-14942); `deliver`→`delivered`→`error` is intent→success→
  // failure, one letter apart because the tense is the state. death 'keep'
  // (NOT knock/wake's old cascade): a deliverable is a debuggable record —
  // mail history and a knock's audit outlive their recipient's tombstone, and
  // the effects stay inert on a dead `to`. Wire-writable (unlike delivered/
  // error): naming the recipient IS the ask. NOT in kindOrder — a facet.
  deliver: { to: { eid: 'entity', death: 'keep' } },
  // Outcome and health (D-14945): `delivered` says an entity reached its
  // destination; `error` says an effect failed. Deliverables are tri-state —
  // delivered, error, or neither (pending) — while role/session/freeze wear
  // the same error facet, making `.error` the fleet health query. Both are
  // server-owned and EFFECT-written: like conflict/hook, the wire may write
  // neither column (their whole shape is in `stamped` below), so comps carries
  // only the empty presence. NOT in kindOrder: these are facets, never an
  // entity's identity.
  delivered: {}, // reached its destination — {at, via} in stamped
  // `error` is a KNOWN/expected failure state (bad address, unavailable
  // dependency, rate-limit) — worth surfacing, NOT a bug — so it does not
  // trigger self-healing. The BREAK facet is `exception` below; the T-17081
  // audit sorts each current error writer into one or the other.
  error: {}, //     an attempt failed — {at, message} in stamped
  // The BREAK facet (D-17077): our code/process hit something UNEXPECTED — a
  // thrown exception, exit 127, a died process, a violated invariant. This is
  // the self-healing trigger (heal.ts). `stack` optional (a JS throw carries
  // one; a died process may not) and rides ON the facet — it describes this
  // same fault, the same aspect as message (M-14942), never its own comp.
  // Server-owned/effect-written, mirroring error: {at, message, stack} in
  // stamped, only the empty presence here. NOT in kindOrder — a facet.
  exception: {},
  // Self-healing's diagnosis facet (D-17077): a task wearing `bug` was
  // auto-filed about an `exception` somewhere in the graph. `fault` is the
  // stable dedup key (kind + normalized message + stack head) so a storm of
  // the same break finds its one open ticket by query, not scan; `hits`/`last`
  // tally recurrences in place. Column names are unique on purpose — dot-param
  // routing keys on them (a plain `count`/`key` would collide with recall/call
  // and make `.count` ambiguous). Wire-writable — the effect (heal.ts)
  // populates it through apply() like any other write, and forging a bug tally
  // harms nobody. NOT in kindOrder: a bug IS a task, this only says the task is
  // a filed break.
  bug: { fault: 'text', hits: 'number', last: 'time' },
  // The dream's dedup marker (T-17407), the consolidation twin of `bug`: an
  // artifact the dream FILED wears it so the next run's 7-day re-comb finds
  // the same drift already tracked and hit-counts instead of re-filing. `key`
  // is the finding's stable shape (kind + normalized title, dream.ts
  // findingKey); `hits`/`last` count recurrence. Rides on whatever the finding
  // became — a consider TASK or a MEMORY — so one keyed lookup dedups across
  // both (M-14942: its one aspect is "this artifact is a deduped dream
  // finding"). NOT in kindOrder — a task/memory carrying it is still a
  // task/memory. All wire-writable; dream.ts writes it through apply().
  finding: { key: 'text', hits: 'number', last: 'time' },
  // Self-healing phase 2 (D-17077): `fixer` marks a session AUTO-spawned to
  // fix a bug ticket — presence alone, the way `design` tags a doc. The cap
  // counts active fixers and the cooldown reaches the fault it heals through
  // the session's requested_task → bug.fault, so nothing is duplicated here
  // (M-14942: the fixer's one aspect is "this run is an auto-fixer"). Wire-
  // writable presence, minted by heal.ts through apply(). NOT in kindOrder —
  // a fixer IS a session; this only says the graph spawned it to heal.
  fixer: {},
  // The auto-spawn mute (D-17077): `nofix` on a PROJECT silences fixer spawns
  // for that venture's bugs; on the self-healing HOME project (P-19, heal.ts
  // home()) it is the GLOBAL switch. The break still files a ticket — this
  // suppresses only the agent, and the boot sweep re-drives once it clears. A
  // pure-presence marker a human sets/clears (graph_apply / the card menu).
  // NOT in kindOrder — a lever, not an identity.
  nofix: {},
  // The BLOCK facet (D-17094): this task is stuck on something EXTERNAL — a
  // vendor, an owner decision, a registration — that has no entity, so a
  // `requires` edge can't name it. `on` is that free-text reason and rides
  // the WIRE (`task block <id> "<reason>"` writes it); `since` is server-
  // stamped (in `stamped`). Orthogonal to status — a task is blocked AND
  // open/wip — so it is a facet, NOT a status and NOT in kindOrder. This is
  // the ONLY thing that reddens the Dot now (live.ts `blocked()`); open
  // `requires` edges are normal decomposition, a calm affordance. `.blocked`
  // is the fleet query for what is actually stuck, and on what.
  blocked: { on: 'text' },
  // The git revision an entity was VERIFIED against (D-18378): one aspect —
  // "this prose was true as of this commit" — so its own component (M-14942),
  // worn by ANY git-tied entity (a doc, a memory, a persona, a task). `paths`
  // are the repo-relative paths/globs whose code the entity describes
  // (newline- or comma-separated); `sha` the commit the caller last verified
  // against. Both wire-writable: naming the sha they checked IS the anchor, so
  // nothing here is server-stamped (a forged sha only misleads its own author,
  // and `task stale` re-derives the truth from git at read time). Staleness is
  // never stored — a commit newer than `sha` touching `paths` makes the entity
  // stale (src/anchor.ts), the freshness backbone for architecture docs,
  // memories and personas (M-14370: pointers over copies). NOT in kindOrder —
  // an anchored doc is still a doc.
  anchor: { paths: 'text', sha: 'text' },
  // A decision was TAKEN about this entity — a task, a memory, a doc,
  // anything; like its three neighbours a facet, never an identity. It is
  // the same {at, by, via} stamp, split differently: `at` and `by` are
  // WIRE-writable here, because a decision is routinely written up long
  // after it was made (PrintBound's first 22 came out of old letters), and
  // dating them all "today" throws away the one fact the component exists to
  // carry — created is when it was filed, `decided` when it was settled.
  // Defaults are the honest ones: `at` now (the column default), `by` the
  // writing actor. That is `created.by`'s asymmetry taken one step further —
  // there the wire may name the author but not the hour, here it may name
  // both — and `via` stays server-only (in `stamped`), so the INSTRUMENT
  // cannot be claimed even when the date is asserted.
  //
  // Deliberately NOT decay-exempt: recall is keyed by eid for any entity, so
  // heat and decidedness are two facts about one row. The hot index and the
  // ordered `## decided` digest section are two queries, not a special case.
  //
  // `verdict` (D-21212): which way it went. A declined thing is decided-
  // against, not un-decided — the verdict rides ON the stamp so the two
  // outcomes can never be worn at once. Tri-state: no component = still
  // proposed; present = settled either way. Absent verdict reads as
  // approved — what every row stamped before the column meant.
  decided: {
    at: 'time',
    by: { eid: 'entity', death: 'keep' },
    verdict: { enum: ['approved', 'declined'] },
  },
  // An idea from the fleet awaiting acceptance. It mirrors `decided`: the
  // proposer and proposal date may be recorded after the fact, while the
  // instrument stays server-owned. Absence is self-authorizing work.
  proposed: { at: 'time', by: { eid: 'entity', death: 'keep' } },
}

// Old spellings that still resolve — one declared table beside `comps`, the
// compatibility promise in data. A rename ADDS a row here and NEVER removes
// it: that is the whole guarantee, so a stored value, an old `?v=` URL, or a
// third-party fragment written a year ago keeps answering. (Zed's extension
// host keeps every historical binding generation compiled in and dispatches
// by an embedded version; we get the same strength — "the old name works
// forever" — for ~1% of the cost, because our vocabulary is a flat name→name
// map, not a compiled interface, so it is a lookup, not code generation.)
//
// A key is namespaced by what it renames: `view:Old` for a renderer view
// name (registry.ts resolve, bin/sweep-view-names), `comp.col` (or bare
// `comp` for a whole component) for a graph name whose VALUE is its new
// `comp.col`/`comp` (db.ts admitted rewrites the write, query.ts route
// rewrites the filter). schema.ts publishes this table into the boot
// Vocabulary doc, so the rename history IS the graph's own changelog — the
// documentation Zed's mechanism lacks.
//
// NOT here: a REMOVAL (a breaking change; that is the deprecation-window
// mechanism, and this table only ever adds), and a bidirectional
// deprecation WINDOW that keeps BOTH homes live for old READERS
// (session.{provider,model,effort,persona} ↔ spawn.*, mirrored by apply()'s
// dualSpawn). Those keep old readers alive; this only redirects old writers
// and stored data forward.
export let renames: Record<string, string> = {
  'view:Show': 'Full',
  'view:Id': 'Inline',
  'view:List.Item': 'List.Tile',
  'view:Task.Row': 'Board.List.Tile',
  'view:Debug.ListItem': 'Debug.Tile',
}

// The two doors read two projections of the one table, split by the `view:`
// namespace so a new row lands at the right door by its key alone: view names
// for the renderer/sweep, graph names for the write/filter rewrite.
export let viewRenames: Record<string, string> = Object.fromEntries(
  Object.entries(renames)
    .filter(([k]) => k.startsWith('view:'))
    .map(([k, v]) => [k.slice('view:'.length), v]),
)
export let propRenames: Record<string, string> = Object.fromEntries(
  Object.entries(renames).filter(([k]) => !k.startsWith('view:')),
)

// The other half of "the vocabulary is one list": what to INDEX, not what a
// column IS. An index is a component's ACCESS PATTERN, not a field's aspect
// (M-14942 cohesion), so it rides its own map beside `comps`, never a `PropType`
// marker. Listed here is ONLY what the {eid} derivation can't reach: composite
// indexes, and the uniqueness/partiality a lone ref column wants — a
// single-column entry OVERRIDES its auto-derived plain index (shelf.client,
// result.call, generation.through earn `unique` this way). Every other {eid}
// reference gets its single-column index for free from `refCols`; `indexesFor`
// (index.ts) merges the two into the ONE set the cache, SQL DDL (T-12764) and
// IDB stores (T-17125) all read. This re-expresses the hand-written
// `create index` + inline `unique(...)` in db.ts exactly; single-column uniques
// on NON-reference columns (session.id, alias.slug, entity.num) stay hand-DDL
// exceptions, out of this map. Inert until a backend generates from it.
export type Idx = { cols: string[]; unique?: boolean; where?: string }
export let indexes: Record<string, Idx[]> = {
  camera: [{ cols: ['client', 'canvas'], unique: true }],
  fold: [{ cols: ['client', 'board'], unique: true }],
  shelf: [{ cols: ['client'], unique: true }],
  cursor: [{ cols: ['client'], unique: true }],
  entry: [{ cols: ['session', 'seq'], unique: true }],
  generation: [{ cols: ['through'], unique: true }],
  output: [{ cols: ['source', 'key'], unique: true, where: 'key is not null' }],
  result: [{ cols: ['call'], unique: true }],
  subscription: [{ cols: ['actor', 'target'], unique: true }],
}

// Snapshot partition (T-18093, D-18092). A comp is `eager` — its entities
// ride the boot snapshot every client mirrors — or `lazy` — never in it,
// hydrated only on subscription (the working-set boot, T-18059). Default is
// eager; only lazy comps are listed, so the same one-list that already drives
// the db allowlist and MCP grammar now also drives sync partitioning:
// snapshot() (db.ts) omits every entity carrying a lazy comp. `entry` is the
// log partition — 110k+ rows no browser boots with. `wake` is deliberately
// NOT lazy: it rides the snapshot today, so flipping it is a real behavior
// change gated on the whole-graph-scan audit (T-18094), not this migration.
// (Distinct from `unnumbered` in db.ts, the NUMBERING aspect, which does hold
// wake — different concern, M-14942.)
export let partition: Record<string, 'eager' | 'lazy'> = { entry: 'lazy' }
export let lazy = (name: string) => partition[name] === 'lazy'

// Server-stamped columns — never wire-writable (cols() reads `comps`
// alone, so these never join the apply allowlist), but part of the
// SCHEMA: backlinks and any reader of associations take the union, so an
// edge the server wrote still reads as an edge, and the Schema view can
// say what every column is. The values here DECLARE; the stamping itself
// lives in server code (db.ts, sessions.ts, freeze.ts), each write beside
// its why.
export let stamped: Record<string, Record<string, PropType>> = {
  // entity === eid: the spine keeps identity and nothing else — birth and
  // last-edit are the `created`/`updated` components (T-6670), columns and
  // all.
  entity: { num: 'number' },
  // The frozen twins of each provenance component's wire-writable `by`
  // (comps above) — stamped in apply(), never on the wire.
  created: { at: 'time', via: { eid: 'entity', death: 'keep' } },
  updated: { at: 'time', via: { eid: 'entity', death: 'keep' } },
  // The frozen twins of the notification-lifecycle presence comps (above):
  // `at` when the moment happened (default-stamped, then frozen in apply()),
  // `by` the resolved writing actor and `via` its instrument — the SAME
  // resolutions + death 'keep' as created/updated, but server-only (in
  // stamped, not comps). The bare-{} presence write rides apply()'s
  // stampedPresence loop, which re-reads the whole stamp onto the return.
  notified: {
    at: 'time',
    by: { eid: 'entity', death: 'keep' },
    via: { eid: 'entity', death: 'keep' },
  },
  opened: {
    at: 'time',
    by: { eid: 'entity', death: 'keep' },
    via: { eid: 'entity', death: 'keep' },
  },
  archived: {
    at: 'time',
    by: { eid: 'entity', death: 'keep' },
    via: { eid: 'entity', death: 'keep' },
  },
  quarantined: {
    at: 'time',
    by: { eid: 'entity', death: 'keep' },
    via: { eid: 'entity', death: 'keep' },
  },
  // A favorite's one clock is enough to order shared navigation by when each
  // entity joined it. The wire requests presence; apply() freezes the time.
  favorite: { at: 'time' },
  // `decided`'s server half is the instrument ALONE — its `at` and `by` ride
  // the wire (comps above), which is why this stamp is the one that is split.
  // A caller may say when a decision was taken and who took it; nothing may
  // say what wrote it down.
  decided: { via: { eid: 'entity', death: 'keep' } },
  proposed: { via: { eid: 'entity', death: 'keep' } },
  web: { frozen_at: 'time' }, // the freeze finished (freeze.ts)
  client: { ip: 'text' },
  claim: { claimed_at: 'time' },
  resume: {
    actor: { eid: 'entity', death: 'keep' },
    at: 'time',
    rank: 'number',
  },
  // Shared outcome and health (D-14945, deliver.ts): `delivered.at` = reached
  // its destination, `via` = how it went out (cast S-9 / spawned S-9 /
  // local / a mail's Message-ID) — descriptive text, not an eid. `error.at`
  // = an effect failed, `message` = why. Both are server-owned and
  // effect-written (out of comps, so the wire writes neither), the same
  // register as frozen_at/claimed_at. Deliverables use both as their outcome;
  // roles, sessions, and freezes use error as their common health facet.
  delivered: { at: 'time', via: 'text' },
  error: { at: 'time', message: 'text' },
  // The break facet's server half (D-17077): `at` when it broke, `message`
  // the fault, `stack` the optional trace. Same register as error — the wire
  // writes none of them, the break-site stamps them through excepted().
  exception: { at: 'time', message: 'text', stack: 'text' },
  // The block facet's server half (D-17094): `since` is when the task became
  // blocked — the wire writes `blocked.on`, apply() stamps `since` from the
  // column's clock default and freezes it on re-word (unblock+reblock resets
  // it, since the row is deleted and reborn). Server-owned, so out of comps.
  blocked: { since: 'time' },
  // The resolved envelope, denormalized onto the mail row as DATA (mail.ts):
  // to_addr = the address the delivery actually used (so later address-book
  // edits never rewrite it), sent_id = the Message-ID our native send was
  // assigned. The send OUTCOME is the shared delivered/error above, never a
  // column here.
  // Inbound provenance (inbound.ts): message_id is the fleet spool's id —
  // the idempotency key AND the inbound mark (delivery skips rows that
  // carry it, or arrival would echo back out as a send); received_at when
  // the edge landed it; verified the edge's DKIM verdict. Unverified
  // content is DATA — it lands verbatim, nothing executes on it.
  mail: {
    // WHO SIGNED IT. Server-owned because a session that could name its
    // own sender could sign as anyone (T-9511) — apply() derives it from
    // the authoring actor. Readable because a letter nobody can see the
    // sender of is a letter nobody can answer: `reply` aims here.
    from: 'text',
    to_addr: 'text',
    message_id: 'text',
    received_at: 'time',
    verified: 'bool',
    // The Message-ID the SENDER assigned to an outbound mail — stamped by
    // the delivery effect when it can know one (the native sender; a
    // $TASKS_MAIL_CMD mailer's output names none), so replies-to-replies
    // thread: reply_to resolves to message_id (inbound) or this.
    sent_id: 'text',
    // The inbound RFC header, preserved even when its named mail has not
    // reached this graph. inbound.ts derives reply_to when it has.
    in_reply_to: 'text',
    // A SMALL FIXED set of non-content routing headers off an inbound letter,
    // as a JSON object (canonical-cased keys), or null (T-14133). NOT raw MIME
    // retention — T-11903 settled that hoarding whole letters inverts the
    // privacy trade; these five (List-Unsubscribe/-Post, Reply-To,
    // Return-Path, Auto-Submitted) are the narrow version, the last inch of
    // CrayonBloom's delivery-proof loop (T-13875): the graph now reads whether
    // RFC 8058 one-click headers survived the last hop. `text`, not `body`:
    // five short values ride the snapshot, never a lazy trip. inbound.ts
    // `routingHeaders` filters them from what the fleet edge forwards.
    headers: 'text',
  },
  // Webhook provenance (inbound.ts): source names the edge route;
  // method/path/headers/payload/sig_ok are its captured request,
  // unchanged. Event is the graph's one-line derivation, spool_id the
  // edge row — (source, spool_id) is the idempotency key — and received_at
  // says when the edge captured it.
  hook: {
    source: 'text',
    event: 'text',
    payload: 'body',
    spool_id: 'text',
    received_at: 'time',
    method: 'text',
    path: 'text',
    headers: 'body',
    sig_ok: 'bool',
  },
  memory: { last_confirmed_at: 'time' },
  recall: { count: 'number', first_at: 'time', last_at: 'time' },
  // Audit rows outlive everything they mention: loser/holder are display
  // strings by design (db.ts says why), and the target reference stands
  // even after the target dies — contention history keeps its subject.
  conflict: {
    target: { eid: 'entity', death: 'keep' },
    loser: 'text',
    holder: 'text',
    at: 'time',
  },
  role: {
    applied_hash: 'text',
    applied_at: 'time',
    stopped_at: 'time',
    decision: 'text',
    reason: 'text',
    observed: { eid: 'entity', death: 'keep' },
    decided_at: 'time',
  },
  // The managed-session lifecycle (sessions.ts owns every write; the
  // wire-writable launch spec lives in comps.spawn, with session aliases
  // admitted only for compatibility).
  session: {
    // Content-free wake-up audit. A submitted notice carries no graph content:
    // token is an opaque attempt id and notice_at is when the door accepted
    // it. For a native TUI, notice_accepted_at is the later busy-turn hook
    // proving the provider consumed Enter. Server-only so a session cannot
    // forge delivery.
    notice_at: 'time',
    notice_accepted_at: 'time',
    notice_token: 'text',
    origin: { enum: ['external', 'managed'] },
    branch: 'text',
    base_revision: 'text',
    status: 'text', // starting|running|stopping, then how it ended
    provider_session_id: 'text',
    serving_model: 'text',
    latest_seq: 'number',
    // A native (managed-codex) session's log-derived standing —
    // 'busy'|'terminal'|'idle', the entry_log standingOf() fact — MATERIALIZED
    // here so SessionDot reads it O(1) instead of scanning the whole entry log
    // per render (157ms/dot). Server-owned like latest_seq; maintained at the
    // codex write edge (sessions.ts), null until first stamped.
    standing: 'text',
    started_at: 'time',
    stop_requested_at: 'time',
    // A steer arrived mid-turn: a managed print run is yielding its current
    // provider turn to new words, then continuing the same thread (sessions.ts
    // steer/finish/recover). Server-set via stamp(), never wire-writable — a
    // lifecycle peer of stop_requested_at, so it rides the snapshot out to
    // clients the same way the rest of the ending does.
    input_at: 'time',
    finished_at: 'time',
    exit_code: 'number',
    stop_reason: 'text',
    final_text: 'body',
    usage_json: 'text',
    // The process's stderr tail — the bounded, unordered diagnostic that rides
    // BESIDE the transcript (D-16704), never inside it: a launcher's refusal, a
    // provider's dying words. Imported into the graph so every reader shows it
    // without a file-read side-channel (T-16798, replacing the old /logs
    // stderr): the follow loop and finish() stamp errTail() here, capped at 8KB.
    // Empty for a graph-native run (no .err file; its context lives in usage
    // entries). Token `context` needs no twin — it derives from usage_json's
    // input_tokens (entry_log contextOf), which the graph already holds.
    stderr: 'body',
  },
  worktree: { branch: 'text', base_revision: 'text' },
  runtime: { provider_session_id: 'text', serving_model: 'text' },
  entry: { seq: 'number' },
  generation: { serving_model: 'text' },
  // The ingest coordinate's server half (D-16704): `source` the stable stream
  // key (managed/native/an archive key — never a filesystem path), `line` the
  // 1-based source line this entry came from. Both server-owned — the wire
  // writes neither; the ingester stamps them through the trusted append path.
  // `imported.line` is the SOURCE line, not entry.seq (seq is apply()-minted
  // per session). Immutable, like every entry fact.
  imported: { source: 'text', line: 'number' },
  lease: {
    holder: { eid: 'runner', death: 'keep' },
    at: 'time',
    until: 'time',
  },
  usage: {
    input: 'number',
    cached: 'number',
    output: 'number',
    reasoning: 'number',
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

// `spawn` means a server accepts the canonical spawn component. Its absence
// tells a client to send only legacy session aliases. The token survives
// alias retirement: those aliases may leave only after every writer gates
// canonical frames on this signal and the rollout has soaked.
export let capabilities = ['spawn', 'session-facets']
export let sessionFacetNames = ['spawn', 'worktree', 'runtime'] as const

// One log line, in the vocabulary the RENDERER speaks — flat and small, the
// same six shapes whatever provider wrote it. Adapters own the dialects
// (adapters.ts, server-only) and normalize each event down to one of these
// before it reaches a browser, so the Session view never learns a vendor:
//   say    what the agent (or the human, resuming) actually said
//   reason the model thinking out loud — dim, skippable
//   tool   a tool call as a chip: name + ok/✗, its detail, its error
//   exec   a shell command it ran — desc says what for, in its own words
//   turn   a turn closing, with usage and duration — a divider, not content
//   error  the run itself went wrong
//   sys    provider housekeeping worth a dim chip: the tag names the
//          family (thinking, hook, task, …), the text carries the gist.
//          A view may squeeze a run of same-tag frames into one line.
// `at` is the event's clock when the dialect (or our own writer) carries one.
export type LogRow =
  & { at?: string; context?: number }
  & (
    | { kind: 'say'; role: 'agent' | 'user'; text: string }
    | { kind: 'reason'; text: string }
    | {
      kind: 'tool'
      name: string
      detail?: string
      ok?: boolean
      error?: string
    }
    | {
      kind: 'exec'
      command: string
      desc?: string
      exit?: number
      status?: string
    }
    | { kind: 'turn'; model?: string; usage?: string; ms?: number }
    | { kind: 'error'; text: string }
    | { kind: 'sys'; tag: string; text?: string }
  )

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
  // Ahead of task: a design is a PROPOSAL, and may carry the same task facet
  // (`.project`, `.priority`) the standard property grammar routes there — yet
  // it stays a design until decided, so it outranks task and never lands on a
  // kind=task board.
  'design',
  'task',
  'project',
  'layout',
  'board',
  'canvas',
  'web',
  'card',
  'pane',
  'client',
  'camera',
  'fold',
  'cursor',
  'role',
  'session',
  'entry',
  'runner',
  'claim',
  'subscription',
  'stop_request',
  'knock',
  'wake',
  'dream',
  'mail',
  'hook',
  'conflict',
  'review',
  'notice',
  'comment',
  'memory',
  'person',
  'persona',
  'model',
  // A bare file entity is a blob — ahead of doc so a file that also carries a
  // doc (its name) still reads as a blob, while a task/session that merely
  // wears an attachment keeps its own richer kind (all listed earlier).
  'blob',
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

// Kinds are singular in the graph and plural in the mouth — a listing is
// asked for `projects`, never `project`. Derived, so a new kind gets its
// listing word the moment it joins kindOrder.
let irregular: Record<string, string> = { person: 'people' }
export let plural = (kind: string) =>
  irregular[kind] ??
    (kind.endsWith('y')
      ? `${kind.slice(0, -1)}ies`
      : /(?:s|x|ch|sh)$/.test(kind)
      ? `${kind}es`
      : `${kind}s`)
// Every plural spelling — the naive one rides along so whatever a listing
// accepts as a word, the bare verb accepts too.
export let plurals = new Set(kindOrder.flatMap((k) => [plural(k), `${k}s`]))

// The word a caller types for a kind, in either number — the naive plural
// too, so `persons` still lands where `people` does.
export let kindWord = (word: string) =>
  kindOrder.find((k) => k == word || plural(k) == word || `${k}s` == word)

// Kinds whose doc title is a NAME — something a caller can type to
// address the thing. Everywhere else the title is a description: a task
// reads "Tasks: add cancelled state + per-task timeline history", which
// is a sentence about work, and its address is its num. The distinction
// is what keeps a bare handle from being answered with a ticket that
// merely opens with the word (near.ts). An alias is a typed handle
// whatever wears it, so aliases ride for every kind.
export let byName = new Set([
  'project',
  'layout',
  'board',
  'person',
  'persona',
  'role',
  'canvas',
  'model',
])

// The human id: prefix-num (T-7, P-2). Curated prefixes for the kinds
// people type daily; everything else leads with its capitalized initial.
export let prefix: Record<string, string> = {
  task: 'T',
  project: 'P',
  layout: 'L',
  board: 'B',
  role: 'R',
  session: 'S',
  memory: 'M',
  person: 'U', // U-ser: P is the projects'
  mail: 'E', // E-mail: S is the sessions'
  email: 'A', // A-ddress: E is the mails'
  persona: 'N', // N for the name it wears: P is the projects'
  hook: 'H',
  knock: 'K',
  wake: 'W',
  dream: 'Z', // Z for sleep — the venture's consolidation cursor
  model: 'O', // O for the m-O-del: M is the memories'
}
// The short handle a NUM-LESS entity wears: the uuid's leading 8 hex — its
// first group, already dashless. Honest that there is no human number, and
// still RESOLVABLE: the id doors prefix-match it back to the eid (db.ts
// resolveId, nav eidOf, client find). A tombstone with no live kind wears it
// too. `human()` (server) renders the same handle.
export let shortId = (eid: string) => eid.slice(0, 8)
// A short-eid TOKEN: 6–8 hex, dashless. Its own prefix of the uuid's first
// group, so a case-folded string prefix-match (or a sargable PK range) finds
// the entity. Min 6 so a stray one- or two-char token doesn't "resolve".
export let SHORT = /^[0-9a-f]{6,8}$/i
export let idOf = (e: { eid: string; kind: string; num?: number | null }) =>
  e.num
    ? `${prefix[e.kind] ?? e.kind[0].toUpperCase()}-${e.num}`
    : shortId(e.eid)

// A model's short name — 'claude-fable-5' is fable, 'gpt-5.6-sol' is sol:
// drop the vendor word and anything wearing a digit, keep what's left.
// The composer greets an agent by it; a persona's name outranks it once
// personas exist.
export let nick = (model?: string | null) => {
  let words = (model ?? '').split('-')
    .filter((w) => w && !/\d/.test(w) && w != 'claude' && w != 'gpt')
  return words.join('-') || null
}

// A model id worn friendly — nick's display face: the vendor prefix and
// date pin drop, version digits regain their dots, words their caps.
// 'claude-opus-4-8' → 'Opus 4.8', 'gpt-5.6-sol' → 'GPT 5.6 Sol'.
export let friendly = (model?: string | null) => {
  let words: string[] = []
  for (
    let w of (model ?? '').replace(/-\d{8}$/, '').split('-').filter(Boolean)
  ) {
    if (/^[\d.]+$/.test(w) && /\d$/.test(words.at(-1) ?? '')) {
      words[words.length - 1] += `.${w}`
    } else if (w != 'claude') {
      words.push(w == 'gpt' ? 'GPT' : w[0].toUpperCase() + w.slice(1))
    }
  }
  return words.join(' ') || null
}

// The edge vocabulary — every edge reads as a sentence, parent first:
// parent requires child (hard gate) · parent contains child (decomposition,
// children roll up) · parent reads child (read-first, never gates) ·
// parent about child (subject reference — a task about a session, a note
// about anything; never gates).
// The LIST is the source of truth: db.ts bakes it into the dependency
// table's check constraint (and rebuilds a live table whose baked list
// has fallen behind), so a new verb here is a new verb everywhere.
// parent recalled child (a recall-floater entry names the memories it
// surfaced — the per-session dedup ledger; never gates).
// parent supersedes child (the current entity replaces an older one — a
// reshaped ticket, a redecided memory; the superseded end stays visible and
// marked with what replaced it, never hidden or aged out; never gates).
// parent worked child (a session once held the task's claim — durable after
// the lease leaves, so session history is an indexed graph read; never gates).
// parent referenced child (an entry's mechanical citation — the entity ids and
// page urls its text names, minted post-commit by referenced.ts; distinct from
// recalled, which is deliberate surfacing; never gates).
export let edges = [
  'requires',
  'contains',
  'reads',
  'about',
  'supervises',
  'delegates',
  'recalled',
  'supersedes',
  'worked',
  'referenced',
] as const
export type Edge = (typeof edges)[number]

// The written face of an entity — title and markdown body. Anything can
// carry one: tasks and boards do; notes, comments, and future kinds get
// rendering/editing/files for free by carrying it too.
// `body` is optional because a payload may DEFER it (subs.ts `bodyless`):
// undefined means unloaded, '' means empty, and the column defaults to ''
// so the two can never be confused. Every reader must tell them apart —
// paint a placeholder and ask (live.ts `pending`), never treat a missing
// body as an empty one, which is how an editor clobbers a stored body.
export type Doc = { eid: string; title: string; body?: string }

// Workflow state only — a task is a doc with task-management added.
export type Task = {
  eid: string
  status: string
  priority: number // board order within a status column; lower sorts first
  project?: string | null // the project (venture) this task belongs to
  assignee?: string | null // whose plate — durable; claim is who's on it now
  // Cross-project facet (Eng, Legal, Ops, …), free text by convention; a
  // picker derives its options from distinct values.
  domain?: string | null
}

// A tag: "this doc fronts a project" (a venture, a workstream). Its name
// is its doc.title — one naming mechanism, no drift. An archived project is
// over — kept, referenceable, sunk in every ranking.
export type ProjectTag = { eid: string }

// Where a project's code lives: a checkout on this box and the branch a
// session's worktree grows from. A tag like project — it never names an
// entity alone (doc+project+repo is still a project), so it stays out of
// kindOrder. Wire-writable, because the owner points a project at a
// checkout from the UI or the CLI like any other data; spawning only
// READS it, so a browser can never hand the server a path to run in.
// `push` is that same owner saying the projection's commits may leave the
// box for this venture — a per-venture permission because in some of them
// a push to main deploys.
export type Repo = {
  eid: string
  path: string
  url?: string | null
  base_branch: string
  gate?: string | null
  push?: boolean
}

// A project's venture facet: where it sits in its lifecycle and how it's run.
// A tag like project/repo — it never names an entity alone, so it stays out
// of kindOrder. paused_from/hold_from carry the phase a reversible stop will
// restore; run_mode/agent_model/operated_by are the interim operator binding.
export type Venture = {
  eid: string
  phase?: string | null
  paused_from?: string | null
  hold_from?: string | null
  run_mode?: string | null
  agent_model?: string | null
  operated_by?: string | null
  tagline?: string | null
  site?: string | null
}

// A board is a saved filter over tasks: `query` speaks the query.ts
// grammar ('.project=…&.status=open,wip'); empty/null means every task.
export type BoardTag = { eid: string; query?: string | null }

// A tiling layout (D-14718): the doc names it, root its top pane.
export type LayoutTag = { eid: string; root?: string | null }

// One pane: container (dir set, children point here via parent) or
// leaf (content + view). size is its weight among siblings.
export type Pane = {
  eid: string
  layout?: string | null
  parent?: string | null
  size?: number
  order?: number
  dir?: string | null
  content?: string | null
  view?: string | null
}
// An external page. The URL is what was pasted; the rendered thing is the
// server's frozen archive of it (one self-contained HTML file on disk),
// stamped frozen_at when ready — frozen_at is server-owned, never wire-set.
export type Web = { eid: string; url: string; frozen_at?: string | null }
// An attached file's metadata (T-12781) — the bytes live at ~/.tasks/blobs/
// <sha>, served at GET /blob/<sha>; this is all that rides the graph.
export type BlobComp = {
  eid: string
  mime?: string | null
  name?: string | null
  sha?: string | null
  bytes?: number | null
  w?: number | null
  h?: number | null
}
export type CardComp = { eid: string; target: string; view: string }
export type Pin = {
  eid: string
  canvas: string
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
  actor?: string | null // who this browser acts for (comps comment)
}

// A camera joins a client to a canvas: per-client pan/zoom, one row per
// (client, canvas) pair — canvases nest, so this is NOT keyed by the client.
// x/y is the viewport CENTER in plane coords; w/h is the viewport size in
// screen px, stored so other clients can render each other's viewports.
export type Camera = {
  eid: string
  client: string
  canvas: string
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
  client: string
  board: string
  statuses: string
}

// The Shelf: a per-client scratch canvas the Tray hangs cards on. A tag
// like repo — it binds a client to their one shelf without naming the
// entity (the entity stays a canvas), so it stays out of kindOrder.
export type Shelf = { eid: string; client: string }

// A cursor joins a client to where it is LOOKING — one row per client, the
// per-client twin of camera (which is per client+canvas). target is the
// fullscreened entity, view its ?v= tab. Navigation as graph data: the
// browser writes it on navigate, an agent writes it to move the human's tab.
export type Cursor = {
  eid: string
  client: string
  target?: string | null
  view?: string | null
}

export type Favorite = { eid: string; at?: string | null }
export type Setting = {
  eid: string
  key?: string | null
  value?: string | null
}

// An agent session's identity and the aspects whose later splits are owned by
// T-16410/T-16411/T-16412. The launch/worktree/runtime fields at the tail are
// rolling aliases: sessionOf() overlays their canonical facets for readers.
//
// Everything below is the LIFECYCLE of a session we spawned (origin
// 'managed'; an 'external' session just announces itself and carries
// none of it). Those columns are server-owned — absent from comps.session,
// so no client can fake a status, a branch, or a final answer, same as
// frozen_at/claimed_at. They ride the snapshot (it selects whole rows), so
// the live cache gets the summary for free. latest_seq is the log's latest
// sequence: the file's line count for a process-backed session (the tailer,
// src/sessions.ts), the top entry seq for a graph-native one (advanced in
// db.ts apply() as entries append).
export type Session = {
  eid: string
  id: string
  cwd?: string | null
  pid?: number | null // the provider process it runs in (hook-stamped)
  pane?: string | null // native terminal address, revalidated before use
  turn?: string | null // idle|busy, announced by provider lifecycle hooks
  notice_at?: string | null // server-submitted native-TUI wake-up
  notice_accepted_at?: string | null // later busy hook accepted it
  notice_token?: string | null // opaque attempt id, never message content
  transcript?: string | null // provider-owned JSONL — an external log
  agent_type?: string | null // set when launched `claude --agent <name>`
  source?: string | null // boot mode: startup|resume|clear|compact|fork
  operator?: boolean | null // receives project-wide attention
  origin?: string // 'external' (announced) | 'managed' (we spawned it)
  provider?: string | null // adapters.ts key
  model?: string | null
  effort?: string | null
  persona?: string | null
  actor?: string | null // who this run acts for (comps comment)
  requested_task?: string | null // provenance: what it was started on
  role?: string | null // persistent role this run serves
  parent?: string | null // the session that spawned this one
  branch?: string | null
  base_revision?: string | null
  status?: string | null // starting|running|stopping|completed|failed|interrupted|lost
  provider_session_id?: string | null // the provider's own id, from its init event
  serving_model?: string | null // what the provider says it's actually serving
  latest_seq?: number // lines of log so far
  standing?: string | null // native log-derived standing: busy|terminal|idle
  started_at?: string | null
  stop_requested_at?: string | null
  input_at?: string | null // a live managed turn is yielding to new words
  finished_at?: string | null
  exit_code?: number | null // null when the child outlived us — unknowable
  stop_reason?: string | null
  final_text?: string | null
  usage_json?: string | null
  stderr?: string | null // the process stderr tail, bounded — a graph facet now
}

// Token counts a provider self-reported for a settled session, normalized to
// ONE vocabulary (Anthropic's field names) at the adapter — the browser and CLI
// read this shape, never a vendor's. Distinct from the per-entry `Usage`
// component below: this splits cache reads from cache writes (their prices
// differ 12×), which cost needs and `Usage.cached` conflates. Every field is
// optional ON PURPOSE: a count a provider never reported stays ABSENT, it never
// folds to 0 (absent beats zero — a missing number is not a free one). `input`
// is FRESH input only, cache reads/writes split out, so the four are comparable
// across providers even though each vendor slices its bill differently.
export type Tokens = {
  input?: number // fresh (uncached) input tokens
  cache_read?: number // input served from cache (Anthropic's discount tier)
  cache_creation?: number // input written to cache (Anthropic's premium tier)
  output?: number // generated tokens (reasoning included, as the bill counts it)
}

export type Worktree = {
  eid: string
  cwd?: string | null
  branch?: string | null
  base_revision?: string | null
}

export type Runtime = {
  eid: string
  pid?: number | null
  pane?: string | null
  transcript?: string | null
  provider_session_id?: string | null
  serving_model?: string | null
}

// One ordered Session-log entity. Every other log shape is a facet on this
// entity; seq is minted by the server within the Session partition.
export type Entry = { eid: string; session: string; seq: number }
// The ingest coordinate (D-16704): where an imported entry came from. `line`
// is the 1-based SOURCE line, distinct from entry.seq. Server-owned/immutable.
export type Imported = { eid: string; source: string; line: number }
export type Content = { eid: string; body: string }
export type Message = { eid: string; role: typeof messageRoles[number] }
export type Generation = {
  eid: string
  through: string
  provider: string
  model: string
  effort?: string | null
  serving_model?: string | null
}
export type Output = {
  eid: string
  source: string
  key?: string | null
  phase?: string | null
}
export type Call = { eid: string; key: string }
// Provider-neutral named tool (D-16704): an imported tool call with no
// first-class facet keeps its real name and a one-line arg preview.
export type Tool = { eid: string; name: string; detail?: string | null }
export type Bash = { eid: string; command: string; cwd?: string | null }
export type Fetch = {
  eid: string
  url: string
  method: typeof httpMethods[number]
}
export type Patch = { eid: string; path: string; diff: string }
export type GraphQuery = { eid: string; query?: string | null }
export type ApplyComp = { eid: string; changes: string }
export type Result = { eid: string; call: string }
export type Exit = { eid: string; code: number }
export type ResponseComp = { eid: string; status: number }
export type Headers = { eid: string; data: string }
export type Stderr = { eid: string; text: string }
export type Brief = { eid: string; text: string }
export type Timeout = { eid: string; ms: number }
export type Checkpoint = { eid: string; through: string }
export type Recalled = { eid: string; source: string }
export type Cancel = { eid: string; target: string }
export type Opaque = { eid: string; format: string; data: string }
export type Runner = { eid: string; name: string }
export type Lease = {
  eid: string
  holder: string
  at: string
  until: string
}
export type Usage = {
  eid: string
  input: number
  cached: number
  output: number
  reasoning: number
}

// A launch request on a session, or its reusable hint on a task.
export type Spawn = {
  eid: string
  provider?: string | null // adapters.ts key
  model?: string | null
  effort?: string | null
  persona?: string | null
}

// Rolling compatibility is a projection, never a second source of truth.
// Start with legacy aliases, then spread each canonical component: presence
// and explicit null both win, so a cleared canonical value cannot revive from
// a stale session column.
export let sessionOf = (e: {
  session?: Session
  spawn?: Spawn
  worktree?: Worktree
  runtime?: Runtime
}): Session | undefined =>
  e.session && {
    ...e.session,
    ...e.spawn,
    ...e.worktree,
    ...e.runtime,
  }

// Desired fleet capacity. Runtime facts are server-stamped on the same row;
// sessions point back through role instead of a mutable current pointer.
export type Role = {
  eid: string
  state: string
  surface: string
  scope: string | null
  checkout?: string | null
  schedule?: string | null
  wake_policy?: string | null
  wake_target?: string | null
  applied_hash?: string | null
  applied_at?: string | null
  stopped_at?: string | null
  retry_at?: string | null
  decision?: string | null
  reason?: string | null
  observed?: string | null
  decided_at?: string | null
}

// Is anybody home? The client's half of door.ts `present()`, from
// wire-visible columns alone: a session we spawned says it in its status,
// and one that only announced itself is awake while it holds a provider
// process the server hasn't watched shut (sessions.ts watched() stamps
// finished_at the moment that door closes). Origin never enters it —
// origin says who STARTED a session, never whether anybody is home, and
// asking it here is what hid every operator's terminal from the tray.
export let awake = (s: Session) =>
  sessionActive.includes(String(s.status)) || (!!s.pid && !s.finished_at)

// The word a session's pip and label wear. Between turns an awake session is
// idle; otherwise a session we spawned says its lifecycle, while an external
// one borrows `running` from its open door. A settled one keeps its ending.
export let standing = (s: Session) =>
  awake(s) && s.turn == 'idle'
    ? 'idle'
    : s.status || (awake(s) ? 'running' : '')

// A session's lease on an entity — claims point at the session ENTITY.
// One claim per entity; taking one over another session's is a CONFLICT
// the server rejects — release first (comp: null), then claim.
export type Claim = { eid: string; session: string; claimed_at?: string }

// One task parked on one actor's interruption stack. rank preserves the
// nested claim order when one wrap releases several leases at the same time.
export type Resume = {
  eid: string
  actor: string
  at: string
  rank: number
}

// A request to stop the session it targets — the graph-native stop
// button. Created over the wire, acted on by the server's effect, kept
// as audit; acted_at is stamped when the signals have been sent.
// A stop signal, sent. It settles into `delivered` once the signals leave
// (deliver.ts) — no receipt column of its own; the audit row is the request.
export type StopRequest = { eid: string; target: string }

// An entity's mail address — the address-book facet, one comp for all.
export type Email = { eid: string; address: string }

// Addressing (D-14945): WHERE a deliverable goes. `to` names a graph
// entity — the recipient a knock/wake/outbound-mail is aimed at. Shared
// across the deliverable kinds, the intent half of the deliver/delivered/
// error triad.
export type Deliver = { eid: string; to: string }

// A knock: the request column is the ask (what to look at); WHO looks is
// the `deliver {to}` facet, and the outcome the shared `delivered`/`error`
// facet (deliver.ts) — neither a column here.
export type Knock = {
  eid: string
  target: string
}

// A knock waiting on the clock: `at` absolute (resolved at mint). WHO to
// wake is the `deliver {to}` facet; the outcome — the timer fired and
// minted the knock, or why it couldn't — is the shared `delivered`/`error`
// facet. Neither a column here.
export type Wake = {
  eid: string
  at: string
  target?: string | null
  note?: string | null
}

// A dream: a venture's consolidation cursor (dream.ts). `scope` is the
// venture project it combs; `floor` the sliding cursor over sessions
// finished since. Both wire-writable — `task dream <project>` mints the
// entity; the comb advances the floor.
export type Dream = {
  eid: string
  scope?: string | null
  floor?: string | null
}

// Mail, either direction: the request columns are the ask; the send
// outcome is the shared `delivered`/`error` facet (deliver.ts). to_addr is
// the envelope copy — what delivery resolved and used. An INBOUND mail
// carries message_id (the fleet spool's id, also the never-send mark),
// received_at, and the edge's verified verdict.
export type Mail = {
  eid: string
  from?: string | null
  target?: string | null
  reply_to?: string | null
  to_addr?: string | null
  message_id?: string | null
  received_at?: string | null
  verified?: number | null
  sent_id?: string | null
  in_reply_to?: string | null
}

// The shared outcome and health facets (D-14945): `delivered` reached its
// destination (`via` says how — cast S-9 / spawned S-9 / local / a
// Message-ID), `error` says an effect failed (`message` says why).
// Server-owned and effect-written; `.error` is the fleet health query.
export type Delivered = { eid: string; at?: string | null; via?: string | null }
export type Failure = {
  eid: string
  at?: string | null
  message?: string | null
}

// The break facet (D-17077): an unexpected fault, the self-healing trigger.
// `stack` optional — a JS throw carries one, a died process may not.
export type Exception = {
  eid: string
  at?: string | null
  message?: string | null
  stack?: string | null
}

// The self-healing diagnosis facet (D-17077): a task auto-filed about an
// error, keyed for dedup and tallying its recurrences in place.
export type Bug = {
  eid: string
  fault?: string | null
  hits?: number | null
  last?: string | null
}

// The dream's dedup marker (T-17407): the shape key of a filed finding and its
// recurrence tally, riding on the consider-task or memory the finding became.
export type Finding = {
  eid: string
  key?: string | null
  hits?: number | null
  last?: string | null
}

// The block facet (D-17094): this task is stuck on an EXTERNAL thing with no
// entity. `on` is that free-text reason (wire-written); `since` is when it
// became blocked (server-stamped). The only thing that reddens the Dot.
export type Blocked = {
  eid: string
  on?: string | null
  since?: string | null
}

// The git-anchor facet (D-18378): the revision an entity was verified against.
// `paths` are repo-relative paths/globs (newline- or comma-separated); `sha`
// the commit last verified against. Both wire-written; staleness is derived at
// read time by asking git (src/anchor.ts), never stored.
export type Anchor = {
  eid: string
  paths?: string | null
  sha?: string | null
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
  method?: string | null
  path?: string | null
  headers?: string | null
  sig_ok?: number | null
}

// A comment is a doc AIMED at something — and since target is any
// entity, ANYTHING is commentable: tasks, boards, frozen pages, other
// comments. Its actor and instrument ride the universal created stamp.
export type Comment = {
  eid: string
  target: string
}

// A notice: a doc EMITTED about its target, not said (D-13858). Same aim
// column as comment, and `event` names what happened; the words ride the
// doc. Delivered by the bus and inbox beside comments, but never a comment
// — off the mail relay, out of the conversation thread.
export type Notice = {
  eid: string
  target: string
  event: string
}

// A verdict-bearing comment. The aim, rationale, and authorship stay on
// comment + doc + created; this component contributes only judgment.
export type Review = {
  eid: string
  verdict: string
}

// A claim that BOUNCED, kept as an entity: who tried (loser), who held
// (holder) — resolved to session-id strings at rejection time, because
// the loser's session entity may have been minted in the very batch
// that rolled back. Server-minted only; audit contention with
// graph_query kind=conflict.
export type Conflict = {
  eid: string
  target: string
  loser: string
  holder: string
  at?: string
}

// A stable external name for an entity — a slug from a previous system, a
// human handle. An entity may wear several: `slug` is the PRIMARY handle
// (the display name, db.ts human()), `slugs` a space-delimited set of
// additional resolvable-only names. find() resolves any of them like an id;
// every member is unique graph-wide, enforced at write in apply().
export type Alias = { eid: string; slug: string; slugs?: string | null }

// The names an alias resolves by, primary first: `slug` then each word of
// `slugs`. One reading for every resolution door (client.ts find, live.ts
// cache, db.ts resolveId) and the write-time uniqueness rule — display
// still reads `slug` alone, so the primary is never ambiguous.
export let slugsOf = (a?: { slug?: string | null; slugs?: string | null }) =>
  a?.slug ? [a.slug, ...(a.slugs?.split(/\s+/).filter(Boolean) ?? [])] : []

// A wearable voice: core text in the doc, tiers in the edges, home in
// home (null = fleet-shared).
export type Persona = { eid: string; home?: string | null }

// A model reified (D-21308): name is the wire spelling the session and
// generation string columns speak, vendor its maker, grade its tier.
export type Model = {
  eid: string
  name?: string | null
  vendor?: string | null
  grade?: string | null
}

// A distilled fact the fleet keeps: content in the doc, provenance in
// created, scope in scope (the project it belongs to; absent = a
// principle every operator carries). last_confirmed_at is the last explicit
// re-confirmation — server-stamped, like every recall statistic.
export type Memory = {
  eid: string
  scope?: string | null
  last_confirmed_at?: string | null
}

// This entity records feedback; `by` is who gave it, absent when nobody
// wrote the source down. A facet — any entity may wear it.
export type Feedback = { eid: string; by?: string | null }

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

// Provenance, paired when+who+how (T-6670/T-7113). `at` is server-frozen,
// `by` the actor (wire-writable for attribution), and `via` the server-stamped
// instrument. `created` is set once; `updated` is the last edit and is absent
// until the first modification after birth (absence = never edited).
export type Created = {
  eid: string
  at?: string
  by?: string | null
  via?: string | null
}
export type Updated = Created

// A moment stamped on an entity — the notification lifecycle (T-7006:
// presence records it, the whole stamp is server-frozen), `decided`, and
// `proposed` (the wire dates and signs them, the server names the instrument).
// Same shape as Created/Updated; absence is the earlier state (no `opened`
// row == unread, no `decided` row == nothing settled, no `proposed` row ==
// self-authorizing work). Read as pure Row-predicates, like unreadMail today.
export type Stamp = Created

// `decided` alone carries which way it went; absent verdict reads as
// approved (what pre-verdict rows meant when stamped).
export type Decided = Stamp & { verdict?: string | null }

// A full-text search hit. snip marks matches with \x01…\x02 (renderers
// highlight without trusting HTML); open is what to OPEN — the entity
// itself, or a comment's target.
export type Hit = {
  eid: string
  num: number
  kind: string
  title: string
  title_hit?: string
  snip: string
  open: string
  open_id?: string // open spoken (T-7) — only when it isn't the hit
  retired?: boolean // its project is over — the hit sank to the tail
}

// `ord` is an optional, editable listing order for the edge — a tie-break
// among members of one (parent, type) that share a rank. Only persona
// materialization reads it today (equal-warmth tier members list in a
// declared order, stable across databases and rewrites); every other edge
// leaves it null and behaves exactly as before. Lower sorts first.
export type Dep = { parent: string; type: Edge; child: string; ord?: number }

// An outgoing edge, verb + child — the Dependency view resolves the name.
export type Ref = { type: Edge; child: string }

// The bundle a renderer pattern-matches on: the entity plus whichever
// components it carries, its edge sentences, and the entities it
// contains. kind is derived (kindOf) — display convention, not data.
// EntCore is the CLOSED, precise face: one field per known component, each its
// exact type, plus the scalar spine (eid/num/kind) and edges (refs/kids). Ent
// (below) is the OPEN face the renderers see — a plugin's own component has no
// core field, so the index signature admits it (as `unknown`, the only element
// type that also tolerates the scalar spine in an object literal), enough to
// pattern-match with has() while every known comp keeps its precise type
// (intersection: T & unknown = T). The split is load-bearing: a bare index
// signature INSIDE this literal would collapse `keyof Ent` to `string`, so
// `Comps = Omit<Ent, …>` (live.ts) would lose every precise type. Applying the
// index signature by intersection over a closed core keeps both faces honest
// (D-18663 seam 2, T-12765 option 1). The richer option — derive EntCore from
// `comps` — is deferred to T-18672.
export type EntCore = {
  eid: string
  num: number
  kind: string
  doc?: Doc
  design?: { eid: string }
  architecture?: { eid: string }
  task?: Task
  project?: ProjectTag
  venture?: Venture
  role?: Role
  person?: { eid: string }
  repo?: Repo
  canvas?: { eid: string }
  board?: BoardTag
  layout?: LayoutTag
  pane?: Pane
  web?: Web
  blob?: BlobComp
  card?: CardComp
  pin?: Pin
  client?: Client
  camera?: Camera
  fold?: Fold
  shelf?: Shelf
  cursor?: Cursor
  favorite?: Favorite
  setting?: Setting
  subscription?: {
    eid: string
    actor?: string | null
    target?: string | null
    mode?: (typeof subModes)[number]
  }
  session?: Session
  brief?: Brief
  worktree?: Worktree
  runtime?: Runtime
  entry?: Entry
  imported?: Imported
  content?: Content
  message?: Message
  attention?: { eid: string }
  generation?: Generation
  output?: Output
  call?: Call
  tool?: Tool
  bash?: Bash
  fetch?: Fetch
  patch?: Patch
  task_context?: { eid: string }
  graph_query?: GraphQuery
  apply?: ApplyComp
  result?: Result
  exit?: Exit
  response?: ResponseComp
  headers?: Headers
  stderr?: Stderr
  timeout?: Timeout
  checkpoint?: Checkpoint
  cancel?: Cancel
  reasoning?: { eid: string }
  recalled?: Recalled
  opaque?: Opaque
  runner?: Runner
  lease?: Lease
  usage?: Usage
  spawn?: Spawn
  claim?: Claim
  resume?: Resume
  stop_request?: StopRequest
  knock?: Knock
  wake?: Wake
  dream?: Dream
  mail?: Mail
  deliver?: Deliver
  hook?: Hook
  email?: Email
  conflict?: Conflict
  comment?: Comment
  notice?: Notice
  meta?: { eid: string }
  review?: Review
  alias?: Alias
  memory?: Memory
  feedback?: Feedback
  persona?: Persona
  model?: Model
  recall?: Recall
  created?: Created
  updated?: Updated
  notified?: Stamp
  opened?: Stamp
  archived?: Stamp
  quarantined?: Stamp
  decided?: Decided
  proposed?: Stamp
  delivered?: Delivered
  error?: Failure
  exception?: Exception
  bug?: Bug
  finding?: Finding
  blocked?: Blocked
  anchor?: Anchor
  refs: Ref[]
  kids: Ent[]
}

// The open face: EntCore plus an index signature that admits a plugin's own
// components. `e.doc` stays precise; `e.invoice` (a plugin comp) typechecks as
// `unknown` — enough for has('invoice') to be a valid matcher; a plugin's own
// renderer narrows it. This is what widening has() to `string[]` relies on.
export type Ent = EntCore & { [comp: string]: unknown }

// A pin row joined to its card: where the card sits and what it shows.
export type Pinned = Pin & { target: string; view: string }

// The sync unit — one component patch landing on (or leaving) an entity. A
// batch is a flat array; a comp is a PATCH: omitted columns are untouched
// (a single prop change sends a single prop), `prop: null` clears that
// column, comp: null deletes the component, and {name: 'entity', comp: null}
// deletes the entity, its components, and every edge touching it. Deleting a
// bunch is just a long batch. Client-minted UUID eids are welcome — the
// spine (and its num) appears on first touch.
//
// Edges ride the same shape with name 'dependency', but a triple has no
// row key, so the comp names the WHOLE sentence: {type, child} links
// eid→child, and the same sentence with gone: true unlinks it (comp: null
// could never say which edge). Both endpoints must exist. An optional
// `ord` on the comp is the edge's listing order (types.ts Dep) — carrying
// it re-links the same sentence to set it (an editable patch, not a second
// edge); omitting it leaves an existing edge's ord untouched.
// `was` is a PRECONDITION — the graph's --ff-only. It names the value the
// caller read, column by column (SHA-256 of it, or null for "I read no
// value"), and apply() refuses the whole batch if any guarded column has
// moved since. Per column, so a title edit never refuses an unrelated body
// write; a column absent from `was` is simply unguarded, which is every
// caller's behavior today. It rides BESIDE comp, never inside it: comp
// admits only real columns, so `doc.was` would be refused as alien.
//
// Riding beside comp is also why every hop from a client to apply() must
// SPREAD a change rather than rebuild it. Rewrite one as `{eid, name, comp}`
// and nothing breaks loudly — the guard just stops guarding, and the write
// lands unguarded while the caller believes it was protected. That is worse
// than never having had it, so precondition_test.ts drives each door and
// refuses the shape.
export type Change = {
  eid: string
  name: string
  comp: Record<string, unknown> | null
  was?: Record<string, string | null>
}

// A negotiated committed batch. The cursor makes the frame a complete
// IndexedDB checkpoint: a sole writer can land changes + cursor atomically.
export type Live = { live: Change[]; cursor: number }

// The whole graph in one gulp — a batch that fills an empty cache, plus the
// edges (edges aren't components; they ride alongside).
// `cursor` = the journal rowid this snapshot is current as of (a returning
// client's next delta `since`); `epoch`/`vocabHash` = the server-boot and
// vocabulary stamps a delta is validated against (db.ts). OPTIONAL so the
// additions stay additive: snapshot() fills every field, but the many
// consumers that only read `changes`/`deps` (and build a bare {changes, deps}
// to feed notices/edgesOf/digests) stay valid Snapshots untouched.
export type Snapshot = {
  changes: Change[]
  deps: Dep[]
  cursor?: number
  epoch?: string
  vocabHash?: string
  capabilities?: string[]
}
