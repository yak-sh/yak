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

// A role is desired capacity. Native owns an interactive provider TUI;
// managed owns a resumable Tasks session.
export let roleStates = ['running', 'stopped'] as const
export let roleSurfaces = ['native', 'managed'] as const

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
    priority: 'priority',
    project_eid: { eid: 'project', death: 'detach' },
    // Whose PLATE this is — durable routing to any entity (a person, a
    // project standing in for its operator). Orthogonal to claim, which
    // is who holds it NOW; a dead assignee detaches, never takes the task.
    assignee_eid: { eid: '', death: 'detach' },
    domain: { text: 'domains' }, // free text; the graph suggests
  },
  // retired_at: the project is over, not erased. Wire-writable — stamping
  // it IS the retirement (like the `opened` stamp, no effect needed);
  // everything filed under it stays referenceable but sinks (search,
  // .order=hot).
  // color: the venture's tmux window colour, and whatever else comes to want
  // one. Any tmux colour spelling (`cyan`, `brightblue`, `colour45`,
  // `#5fafd7`). Empty means DERIVE it — roles.ts hashes the venture id over
  // the fleet palette, so a venture that never sets one still gets a stable
  // colour of its own rather than the default.
  project: { retired_at: 'time', color: 'text' },
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
  role: {
    state: { enum: roleStates },
    surface: { enum: roleSurfaces },
    scope_eid: { eid: 'project', death: 'detach' },
  },
  board: { query: 'query' }, // saved filter (query.ts grammar); '' = all
  canvas: {},
  web: { url: 'url' }, // frozen_at is server-stamped, never wire-writable
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
  // in for its operator; {eid: ''} because the pool is shared). The
  // universal provenance stamp keeps both levels directly queryable
  // (`.created.by=jeff`, `.created.via=S-31`). An assertion, not
  // authentication — forging it only garbles your own attribution.
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
  // What a session may say about ITSELF — wire-writable because forging any
  // of it only misdirects your own session. What it has SEEN is not here: it
  // is the per-item `notified` stamp, so no cursor can sweep past an item
  // that was never actually served. The four launch aliases stay writable
  // during the spawn compatibility window; apply() mirrors them into the
  // canonical spawn comp before effects run.
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
    requested_task_eid: { eid: '', death: 'detach' },
    // Role membership is launch history. A deleted role closes its process,
    // but the sessions that served it keep saying which role they served.
    role_eid: { eid: 'role', death: 'keep' },
    persona_eid: { eid: '', death: 'detach' },
    actor_eid: { eid: '', death: 'detach' }, // who this run acts for — see client above
  },
  // One launch vocabulary, worn two ways: on a session it records the
  // request that launched it; on a task it is the hint for its next run.
  // Partial on purpose — doors fill the gaps from their caller and the
  // provider table. apply() mirrors session facets into the legacy aliases
  // above; a task facet stays spawn-only.
  spawn: {
    provider: 'text',
    model: 'text',
    effort: 'text',
    persona_eid: { eid: '', death: 'detach' },
  },
  // 'release' is the claim's word exactly: when the session dies the
  // LEASE vanishes (row deleted, claim-null on the wire) but the claimed
  // entity — somebody's task — survives, freed. claimed_at server-stamped.
  claim: { session_eid: { eid: 'session', death: 'release' } },
  // An actor's standing instruction about ONE entity: watch it even
  // though nothing is aimed at me, or mute it though something is. Read
  // as an override on the item's TARGET — a subscription is aimed at the
  // task or venture, the inbox items are the letters and comments ABOUT
  // it. Both ends cascade: a muted thread's subscription dies with it.
  subscription: {
    actor_eid: { eid: '', death: 'cascade' },
    target_eid: { eid: '', death: 'cascade' },
    mode: { enum: subModes },
  },
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
  // A wake is a knock with a clock: the same sentence, said LATER. `at`
  // is absolute — the caller writes a phrase ('in 60m', '9am tomorrow')
  // and it resolves once, at mint (query.ts instant), because a row that
  // still holds a phrase would mean something different every time it is
  // read. The server keeps one timer at the earliest pending wake and
  // reconciles at boot, so an hour of downtime delays a wake instead of
  // eating it (wake.ts) — then mints the knock and lets that ladder
  // deliver. No repeats: `every` waits for something that needs it.
  wake: {
    at: 'time',
    to_eid: { eid: '', death: 'cascade' }, // who to wake
    // What to look at on waking — absent means the wake itself, so the
    // words in its doc are what arrives.
    target_eid: { eid: '', death: 'cascade' },
  },
  // Outbound mail, asked for as data: creating one requests delivery (the
  // mailer effect sends and stamps the outcome — acted_at/error/to_addr,
  // all server-side; the row stays as the audit envelope). Subject rides
  // doc.title, the body doc.body — a mail is a document that travels.
  // `to` is a raw address (has an @) or a graph reference — alias slug,
  // human id, eid — resolved against the address book at delivery.
  // `from` is NOT here on purpose: the sender is who WROTE the mail, and
  // that is the server's fact, not the caller's claim. apply() stamps it
  // from the writing actor's address — the same resolution behind
  // created.by — so no door can assert someone else's identity, and the
  // trust tier operators key on that byline cannot be forged.
  mail: {
    to: 'text',
    // What the mail is ABOUT. A sent mail is history — its subject's
    // death doesn't unsend it (the provenance byline rule).
    target_eid: { eid: '', death: 'keep' },
    // The mail this one ANSWERS — reference at authoring, resolved to an
    // RFC Message-ID at delivery (mail.ts). History like target_eid: a
    // reply outlives the mail it answered.
    reply_to_eid: { eid: 'mail', death: 'keep' },
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
    target_eid: { eid: '', death: 'cascade' },
  },
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
  // project's common persona is the one the project `contains`);
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
  // index line, body = the fact), provenance the universal created stamp.
  // The scope column is scope_eid, NOT project_eid: bare '.project_eid'
  // must keep routing to task (live board queries depend on it), and a
  // collision would make it ambiguous. last_confirmed_at is server-stamped
  // by the confirm door, never wire-set.
  //
  // There is no `type` column (T-12585). It was a kind column hiding inside
  // a component, in a graph whose whole premise is that an entity IS what
  // its components make it — and the four values said nothing the graph did
  // not already hold: `project` restated `scope_eid`, `user` had zero rows
  // in 222, `reference` was what remained when nothing was said, and
  // `feedback` is now the tag below, which records WHO gave it.
  memory: {
    // Scope is history — a fact outlives the project it was learned for.
    scope_eid: { eid: 'project', death: 'keep' },
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
  feedback: { by: { eid: '', death: 'keep' } },
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
  created: { by: { eid: '', death: 'keep' } },
  updated: { by: { eid: '', death: 'keep' } },
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
  archived: {}, // the operator is done — the ONE stamp that hides an item
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
  decided: { at: 'time', by: { eid: '', death: 'keep' } },
  // An idea from the fleet awaiting acceptance. It mirrors `decided`: the
  // proposer and proposal date may be recorded after the fact, while the
  // instrument stays server-owned. Absence is self-authorizing work.
  proposed: { at: 'time', by: { eid: '', death: 'keep' } },
}

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
  created: { at: 'time', via: { eid: '', death: 'keep' } },
  updated: { at: 'time', via: { eid: '', death: 'keep' } },
  // The frozen twins of the notification-lifecycle presence comps (above):
  // `at` when the moment happened (default-stamped, then frozen in apply()),
  // `by` the resolved writing actor and `via` its instrument — the SAME
  // resolutions + death 'keep' as created/updated, but server-only (in
  // stamped, not comps). The bare-{} presence write rides apply()'s
  // stampedPresence loop, which re-reads the whole stamp onto the return.
  notified: {
    at: 'time',
    by: { eid: '', death: 'keep' },
    via: { eid: '', death: 'keep' },
  },
  opened: {
    at: 'time',
    by: { eid: '', death: 'keep' },
    via: { eid: '', death: 'keep' },
  },
  archived: {
    at: 'time',
    by: { eid: '', death: 'keep' },
    via: { eid: '', death: 'keep' },
  },
  // `decided`'s server half is the instrument ALONE — its `at` and `by` ride
  // the wire (comps above), which is why this stamp is the one that is split.
  // A caller may say when a decision was taken and who took it; nothing may
  // say what wrote it down.
  decided: { via: { eid: '', death: 'keep' } },
  proposed: { via: { eid: '', death: 'keep' } },
  web: { frozen_at: 'time' }, // the freeze finished (freeze.ts)
  client: { ip: 'text' },
  claim: { claimed_at: 'time' },
  stop_request: { acted_at: 'time' }, // signals sent — the relay's sweep key
  // Delivery outcome (knock.ts): acted_at = the resolver ran, delivery =
  // what it did (cast S-9 / spawned S-9 / mailed U-2 / held), error = why
  // it couldn't.
  knock: { acted_at: 'time', delivery: 'text', error: 'text' },
  // The wake's own receipt (wake.ts): acted_at = the timer fired and the
  // knock was minted (also the pending mark — a stamped wake never fires
  // again), error = why it couldn't (an unreadable `at`, a dead door).
  wake: { acted_at: 'time', error: 'text' },
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
    acted_at: 'time',
    error: 'text',
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
    // thread: reply_to_eid resolves to message_id (inbound) or this.
    sent_id: 'text',
    // The inbound RFC header, preserved even when its named mail has not
    // reached this graph. inbound.ts derives reply_to_eid when it has.
    in_reply_to: 'text',
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
    target_eid: { eid: '', death: 'keep' },
    loser: 'text',
    holder: 'text',
    at: 'time',
  },
  role: {
    applied_hash: 'text',
    applied_at: 'time',
    stopped_at: 'time',
    error: 'text',
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
    started_at: 'time',
    stop_requested_at: 'time',
    finished_at: 'time',
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

// `spawn` means a server accepts the canonical spawn component. Its absence
// tells a client to send only legacy session aliases. The token survives
// alias retirement: those aliases may leave only after every writer gates
// canonical frames on this signal and the rollout has soaked.
export let capabilities = ['spawn']

// One log line, in the vocabulary the RENDERER speaks — flat and small, the
// same six shapes whatever provider wrote it. Adapters own the dialects
// (adapters.ts, server-only) and normalize each event down to one of these
// before it reaches a browser, so the Session view never learns a vendor:
//   say    what the agent (or the human, resuming) actually said — `at`
//          is its clock, when the dialect (or our own writer) carries one
//   reason the model thinking out loud — dim, skippable
//   tool   a tool call as a chip: name + ok/✗, its detail, its error
//   exec   a shell command it ran — desc says what for, in its own words
//   turn   a turn closing, with usage and duration — a divider, not content
//   error  the run itself went wrong
//   sys    provider housekeeping worth a dim chip: the tag names the
//          family (thinking, hook, task, …), the text carries the gist.
//          A view may squeeze a run of same-tag frames into one line.
export type LogRow =
  | { kind: 'say'; role: 'agent' | 'user'; text: string; at?: string }
  | { kind: 'reason'; text: string }
  | {
    kind: 'tool'
    name: string
    detail?: string
    ok?: boolean
    error?: string
  }
  | { kind: 'exec'; command: string; desc?: string; exit?: number }
  | { kind: 'turn'; usage?: string; ms?: number }
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
  'role',
  'session',
  'claim',
  'subscription',
  'stop_request',
  'knock',
  'wake',
  'mail',
  'hook',
  'conflict',
  'review',
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
  'board',
  'person',
  'persona',
  'role',
  'canvas',
])

// The human id: prefix-num (T-7, P-2). Curated prefixes for the kinds
// people type daily; everything else leads with its capitalized initial.
export let prefix: Record<string, string> = {
  task: 'T',
  project: 'P',
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
export let edges = ['requires', 'contains', 'reads', 'about'] as const
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
  project_eid?: string | null // the project (venture) this task belongs to
  assignee_eid?: string | null // whose plate — durable; claim is who's on it now
  // Cross-project facet (Eng, Legal, Ops, …), free text by convention; a
  // picker derives its options from distinct values.
  domain?: string | null
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
// session id, an operator name) and `cwd` where it runs — what a session
// may say about itself. What it has seen lives on the items, not here.
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
  persona_eid?: string | null
  actor_eid?: string | null // who this run acts for (comps comment)
  requested_task_eid?: string | null // provenance: what it was started on
  role_eid?: string | null // persistent role this run serves
  branch?: string | null
  base_revision?: string | null
  status?: string | null // starting|running|stopping|completed|failed|interrupted|lost
  provider_session_id?: string | null // the provider's own id, from its init event
  serving_model?: string | null // what the provider says it's actually serving
  latest_seq?: number // lines of log so far
  started_at?: string | null
  stop_requested_at?: string | null
  input_at?: string | null // a live managed turn is yielding to new words
  finished_at?: string | null
  exit_code?: number | null // null when the child outlived us — unknowable
  stop_reason?: string | null
  final_text?: string | null
  usage_json?: string | null
  error?: string | null // diagnostics: malformed frames, spawn failures
}

// A launch request on a session, or its reusable hint on a task.
export type Spawn = {
  eid: string
  provider?: string | null // adapters.ts key
  model?: string | null
  effort?: string | null
  persona_eid?: string | null
}

// Desired fleet capacity. Runtime facts are server-stamped on the same row;
// sessions point back through role_eid instead of a mutable current pointer.
export type Role = {
  eid: string
  state: string
  surface: string
  scope_eid: string | null
  applied_hash?: string | null
  applied_at?: string | null
  stopped_at?: string | null
  error?: string | null
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

// The word a session's pip and label wear. A session we spawned has a
// lifecycle to say it with; an external one has none, so its liveness IS
// its status — a live one is running, a settled one keeps the dim default.
export let standing = (s: Session) => s.status || (awake(s) ? 'running' : '')

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

// A knock waiting on the clock: `at` absolute (resolved at mint), the
// stamps its receipt — acted_at once the knock is minted, error when the
// timer could not read the hour or the knock would not mint.
export type Wake = {
  eid: string
  at: string
  to_eid: string
  target_eid?: string | null
  acted_at?: string | null
  error?: string | null
}

export type Mail = {
  eid: string
  to: string
  from?: string | null
  target_eid?: string | null
  reply_to_eid?: string | null
  acted_at?: string | null
  error?: string | null
  to_addr?: string | null
  message_id?: string | null
  received_at?: string | null
  verified?: number | null
  sent_id?: string | null
  in_reply_to?: string | null
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

// A comment is a doc AIMED at something — and since target_eid is any
// entity, ANYTHING is commentable: tasks, boards, frozen pages, other
// comments. Its actor and instrument ride the universal created stamp.
export type Comment = {
  eid: string
  target_eid: string
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
// created, scope in scope_eid (the project it belongs to; absent = a
// principle every operator carries). last_confirmed_at is the last explicit
// re-confirmation — server-stamped, like every recall statistic.
export type Memory = {
  eid: string
  scope_eid?: string | null
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
  open_id?: string // open_eid spoken (T-7) — only when it isn't the hit
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
  kind: string
  doc?: Doc
  task?: Task
  project?: ProjectTag
  role?: Role
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
  spawn?: Spawn
  claim?: Claim
  stop_request?: StopRequest
  knock?: Knock
  wake?: Wake
  mail?: Mail
  hook?: Hook
  email?: Email
  conflict?: Conflict
  comment?: Comment
  review?: Review
  alias?: Alias
  memory?: Memory
  feedback?: Feedback
  persona?: Persona
  recall?: Recall
  created?: Created
  updated?: Updated
  notified?: Stamp
  opened?: Stamp
  archived?: Stamp
  decided?: Stamp
  proposed?: Stamp
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
