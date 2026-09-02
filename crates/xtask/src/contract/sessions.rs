// The sessions plugin (D-22530 §8): session identity + lifecycle, the
// graph-native Session-log vocabulary (log = true comps → sessionComps),
// claims/resume, spawn, and the session capability lists.

use yak_vocab::{Body, Bool, Number, Query, Ref, Sel, Text, Time, Url};
use yak_vocab_derive::Comp;

// A managed session is still going in exactly these statuses; the capability
// tokens the server advertises; and the spawn-twin window's facets.
inventory::submit! {
    yak_vocab::SessionListsDef {
        plugin: "sessions",
        session_active: &["starting", "running", "stopping"],
        capabilities: &["spawn", "session-facets"],
        session_facets: &["spawn", "worktree", "runtime", "run", "settled", "yield"],
    }
}

venum!("sessions", "turnStates", 20, ["idle", "busy"]);
venum!("sessions", "messageRoles", 30, ["user", "agent"]);
venum!("sessions", "httpMethods", 40, ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

// A session's identity and configuration. The tail launch/worktree/runtime
// columns are rolling aliases apply() mirrors into the canonical facets; the
// lifecycle columns in stamped are server-owned.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 240, kind_rank = 150, prefix = "S", stamped_rank = 260)]
struct Session {
    id: Text,
    cwd: Text,
    pid: Number,
    pane: Text,
    #[col(sel = "turnStates")]
    turn: Sel,
    transcript: Text,
    agent_type: Text,
    source: Text,
    operator: Bool,
    provider: Text,
    model: Text,
    effort: Text,
    #[col(eid = "entity", death = "detach")]
    requested_task: Ref,
    #[col(eid = "role", death = "keep")]
    role: Ref,
    #[col(eid = "entity", death = "detach")]
    persona: Ref,
    #[col(eid = "entity", death = "detach")]
    actor: Ref,
    #[col(eid = "session", death = "detach")]
    parent: Ref,
    #[stamped]
    notice_at: Time,
    #[stamped]
    notice_accepted_at: Time,
    #[stamped]
    notice_token: Text,
    #[stamped]
    #[col(sel(external, managed))]
    origin: Sel,
    #[stamped]
    branch: Text,
    #[stamped]
    base_revision: Text,
    #[stamped]
    status: Text,
    #[stamped]
    provider_session_id: Text,
    #[stamped]
    serving_model: Text,
    #[stamped]
    latest_seq: Number,
    #[stamped]
    standing: Text,
    #[stamped]
    started_at: Time,
    #[stamped]
    stop_requested_at: Time,
    #[stamped]
    input_at: Time,
    #[stamped]
    finished_at: Time,
    #[stamped]
    exit_code: Number,
    #[stamped]
    stop_reason: Text,
    #[stamped]
    final_text: Body,
    #[stamped]
    usage_json: Text,
    #[stamped]
    stderr: Body,
}

// The handoff a session leaves for its successor (D-19459). Not in kindOrder.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 250)]
struct Brief {
    text: Body,
}

// Where code work happens, independently of how the model runs. Branch facts
// are server-stamped.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 260, stamped_rank = 270)]
struct Worktree {
    cwd: Text,
    #[stamped]
    branch: Text,
    #[stamped]
    base_revision: Text,
}

// A provider process binding, independently of whether code needs a checkout.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 270, stamped_rank = 280)]
struct Runtime {
    pid: Number,
    pane: Text,
    transcript: Text,
    #[stamped]
    provider_session_id: Text,
    #[stamped]
    serving_model: Text,
}

// The live half of a provider interaction. Presence means the Session can
// still advance; terminal state moves atomically to `settled` instead.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 271, stamped_rank = 281)]
struct Run {
    #[stamped]
    #[col(sel(starting, running, stopping))]
    status: Sel,
    #[stamped]
    started_at: Time,
    #[stamped]
    stop_requested_at: Time,
    #[stamped]
    input_at: Time,
}

// How a provider interaction ended. `at` is the one Session-end clock; this is
// deliberately distinct from a frame's semantic outcome.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 272, stamped_rank = 282)]
struct Settled {
    #[stamped]
    at: Time,
    #[stamped]
    #[col(sel(completed, failed, interrupted, lost))]
    status: Sel,
    #[stamped]
    exit_code: Number,
    #[stamped]
    stop_reason: Text,
}

// What a provider interaction produced, independently of how it ended.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 273, stamped_rank = 283)]
struct Yield {
    #[stamped]
    final_text: Body,
    #[stamped]
    usage_json: Text,
    #[stamped]
    stderr: Body,
}

// --- The Session-log vocabulary (log = true → sessionComps) ---------------

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 280, log, lazy, kind_rank = 160, stamped_rank = 290)]
#[index(cols(session, seq), unique)]
struct Entry {
    #[col(eid = "session", death = "cascade")]
    session: Ref,
    #[stamped]
    seq: Number,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 290, log)]
struct Content {
    body: Body,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 300, log)]
struct Message {
    #[col(sel = "messageRoles")]
    role: Sel,
}

// The always-first user entry is session context, not conversation.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 310, log)]
struct Prompt {}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 320, log)]
struct Attention {}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 330, log, stamped_rank = 300)]
#[index(cols(through), unique)]
struct Generation {
    #[col(eid = "entry", death = "keep")]
    through: Ref,
    provider: Text,
    model: Text,
    effort: Text,
    #[stamped]
    serving_model: Text,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 340, log)]
#[index(cols(source, key), unique, filter = "key is not null")]
struct Output {
    #[col(eid = "generation", death = "keep")]
    source: Ref,
    key: Text,
    phase: Text,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 350, log)]
struct Call {
    key: Text,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 360, log)]
struct Bash {
    command: Body,
    cwd: Text,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 370, log)]
struct Fetch {
    url: Url,
    #[col(sel = "httpMethods")]
    method: Sel,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 380, log)]
struct Patch {
    path: Text,
    diff: Body,
}

// Provider-neutral named-tool facet (D-16704).
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 390, log)]
struct Tool {
    name: Text,
    detail: Text,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 400, log)]
struct TaskContext {}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 410, log)]
struct GraphQuery {
    query: Query,
}

// A graph Change[] batch, serialized — one mutation facet, atomic apply.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 420, log)]
struct Apply {
    changes: Body,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 430, log)]
#[index(cols(call), unique)]
struct Result {
    #[col(eid = "call", death = "keep")]
    call: Ref,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 440, log)]
struct Exit {
    code: Number,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 450, log)]
struct Response {
    status: Number,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 460, log)]
struct Headers {
    data: Body,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 470, log)]
struct Stderr {
    text: Body,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 480, log)]
struct Timeout {
    ms: Number,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 490, log)]
struct Checkpoint {
    #[col(eid = "entry", death = "keep")]
    through: Ref,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 500, log)]
struct Cancel {
    #[col(eid = "entity", death = "keep")]
    target: Ref,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 510, log)]
struct Reasoning {}

// Memory auto-recall (T-17306), worn twice. On the recall ENTRY it is the
// marker with `source`: the message whose thinking surfaced these memories (no
// message facet, so recall cannot recall itself). On an EDGE entity it is the
// NATURE — `edge{from: entry, to: memory}` + `recalled{at}`, the recall of one
// memory with its own clock (T-32471). That is the case D-23820 names: a
// relation with a time is the edge carrying an event comp, not the time forced
// onto either end. `at` is wire-writable the way `decided.at` is, so history
// can carry the moment it happened; a stored recall has no other clock, so the
// backfill reads the entry's `created.at`.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 520, log)]
struct Recalled {
    #[col(eid = "entry", death = "keep")]
    source: Ref,
    at: Time,
}

// Same-provider replay evidence only.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 530, log)]
struct Opaque {
    format: Text,
    data: Body,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 540, log, kind_rank = 170)]
struct Runner {
    name: Text,
}

// Whole components are server-owned (empty writable half).
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 550, log, stamped_rank = 320)]
struct Lease {
    #[stamped]
    #[col(eid = "runner", death = "keep")]
    holder: Ref,
    #[stamped]
    at: Time,
    #[stamped]
    until: Time,
}

#[derive(Comp)]
#[comp(plugin = "sessions", rank = 560, log, stamped_rank = 330)]
struct Usage {
    #[stamped]
    input: Number,
    #[stamped]
    cached: Number,
    #[stamped]
    output: Number,
    #[stamped]
    reasoning: Number,
}

// The ingest coordinate (D-16704): where an imported entry came from.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 570, log, stamped_rank = 310)]
struct Imported {
    #[stamped]
    source: Text,
    #[stamped]
    line: Number,
}

// --- launch + leases -------------------------------------------------------

// One launch vocabulary, worn two ways: a session's launch request, a task's
// next-run hint.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 580)]
struct Spawn {
    provider: Text,
    model: Text,
    effort: Text,
    #[col(eid = "entity", death = "detach")]
    persona: Ref,
}

// The session's lease on an entity: when the session dies the LEASE vanishes
// but the claimed entity survives, freed. claimed_at server-stamped.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 590, kind_rank = 180, stamped_rank = 130)]
struct Claim {
    #[col(eid = "session", death = "release")]
    session: Ref,
    #[stamped]
    claimed_at: Time,
}

// An operator's interrupted work stack, server-owned.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 600, stamped_rank = 140)]
struct Resume {
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    actor: Ref,
    #[stamped]
    at: Time,
    #[stamped]
    rank: Number,
}

// The selected conversational session for one actor looking at one entity.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 620)]
#[index(cols(actor, target), unique)]
struct Chat {
    #[col(eid = "entity", death = "detach")]
    actor: Ref,
    #[col(eid = "entity", death = "detach")]
    target: Ref,
}

// The brake, pulled as data: creating one asks the server to stop the session
// it targets. The row stays as audit and wears `delivered`.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 630, kind_rank = 200)]
struct StopRequest {
    #[col(eid = "session", death = "cascade")]
    target: Ref,
}

// A branching session (D-23845 §v0.1, D-23985): a fork carries `from`, the
// fork-point ENTRY it forked at. The parent session's entries up to that point
// are the shared prefix, read back BY REFERENCE (never copied) — a reader walks
// `from` up for the shared history, then the fork's own entry rows. This is the
// coarse, additive session-level primitive: `entry{session, seq}` is untouched
// and stays the linear fallback, so unforked sessions render unchanged.
// Death: detach — deleting the source entry frees the fork (from goes null),
// never nukes it. Rank 631 keeps it beside stop_request in the sessions block.
#[derive(Comp)]
#[comp(plugin = "sessions", rank = 631)]
struct Fork {
    #[col(eid = "entry", death = "detach")]
    from: Ref,
}
