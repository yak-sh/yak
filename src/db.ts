// The fleet entity graph, in one SQLite file. Star ECS: `entity` holds the
// shared primary key (`eid`); component tables (`task`, `board`, `card`, …)
// hang off it by that same id; `dependency` rows are typed eid↔eid edges that
// read as sentences. This module owns the file, the seed, and the two wire
// operations: apply (patch batches in) and snapshot (the whole graph out).
// SERVER-ONLY — the browser reads the graph from its cache in live.ts.
//
// Ids: `eid` is a UUID so ANY side (client included) can mint entities;
// `num` is the server-minted human number (T-7 in the UI, one global counter).
import { DatabaseSync, type StatementSync } from './sqlite.ts'
import { initVector, loadVector } from './vector.ts'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { sha } from './sha.ts'
import {
  capabilities,
  type Change,
  comps,
  deaths,
  type Dep,
  edges,
  governed,
  type Hit,
  idOf,
  kindOrder,
  lazy,
  propRenames,
  sessionActive,
  sessionComps,
  SHORT,
  shortId,
  slugsOf,
  type Snapshot,
  stamped,
  uuid,
} from './types.ts'
import type { Mutation, MutationOutput } from './mutation.ts'
import { type Trace } from './effects.ts'
import { ancestorAt, normalizeLiterals } from './client.ts'
import { editHunks, isEditOp, isFieldOp, patchText } from './edit.ts'
import { homeReads } from './persona.ts'
import {
  type EdgeSelector,
  ftsQuery,
  ftsTerm,
  leafOf,
  matchQuery,
  parseQuery,
  type Pred,
  resolveRefs,
  TEXT,
} from './query.ts'
import { where } from './sql.ts'
import {
  Invalid,
  spec as configSpec,
  validate as validateSetting,
} from './config.ts'
import { derivedCols, indexDdlOne, tableDdl } from './ddl.ts'
import { indexesFor } from './index.ts'
import {
  bodyCols,
  isRef,
  normalizeChanges,
  parseProp,
  propAt,
  propOwners,
} from './props.ts'
import { canon, fleetLocal } from './mailaddr.ts'
import {
  type DocColumn,
  docColumns,
  REDACTED,
  scrubbable,
  scrubBatch,
} from './redaction.ts'
import {
  compsOf,
  hasSources,
  sourceEntries,
  sourceList,
  sourceResolve,
} from './source.ts'

// Prepared-statement cache, per db handle. SQLite recompiles the SQL on
// every prepare(); apply() alone recompiles ~35 statements per call (~318µs
// measured), which is the bulk of its cost. Caching per handle means each
// distinct SQL string compiles ONCE and the whole cache dies with the handle
// (WeakMap → GC): the long-lived server handle stays hot for the process, and a
// test's throwaway db carries its own cache that vanishes with it. Safe because
// no caller ever holds a statement open across other work — every use is
// get/all/run, which step to completion and reset (there is no .iterate() caller
// in this file), and no call site configures a statement after preparing it.
// prep() is the ONE door; a `db.prepare(` anywhere else defeats the cache.
let stmtCache = new WeakMap<DatabaseSync, Map<string, StatementSync>>()
// Off during open(): migrations ALTER tables, so a statement cached against an
// intermediate schema would strand. With caching off, prep() is exactly
// db.prepare() — open()'s migrations behave identically to before — and only the
// post-open runtime populates the cache.
let caching = true
let prep = (db: DatabaseSync, sql: string): StatementSync => {
  if (!caching) return db.prepare(sql)
  let m = stmtCache.get(db)
  if (!m) stmtCache.set(db, m = new Map())
  let s = m.get(sql)
  if (!s) m.set(sql, s = db.prepare(sql))
  return s
}

// Roll back only what actually began. A `begin`/`begin immediate` that fails
// on SQLITE_BUSY opens no transaction, so an unconditional `rollback` in the
// catch throws "no transaction is active" and MASKS the real BUSY that
// sessionFault then bricks the session on. Every catch that rolls back a
// begin it may not have reached calls this instead (T-19044).
let rollback = (db: DatabaseSync) => {
  if (db.inTransaction) db.exec('rollback')
}

let savepoint = 0
// Migrations compose: the outer BEGIN IMMEDIATE is the SQLite-owned schema
// lock, while older focused migrations keep their all-or-nothing boundary as
// savepoints. No process-level lock participates in database correctness.
let atomic = <T>(
  db: DatabaseSync,
  run: () => T,
  immediate = false,
): T => {
  let nested = db.inTransaction
  let name = `tasks_${++savepoint}`
  db.exec(
    nested ? `savepoint ${name}` : immediate ? 'begin immediate' : 'begin',
  )
  try {
    let value = run()
    db.exec(nested ? `release ${name}` : 'commit')
    return value
  } catch (e) {
    if (nested) {
      db.exec(`rollback to ${name}`)
      db.exec(`release ${name}`)
    } else rollback(db)
    throw e
  }
}

// The owner's live graph — the one path a test must never open (open() below
// refuses it under `deno test`). A function, not a constant, so it re-reads
// HOME and the guard that holds this can't drift from a stale literal.
export let liveDb = () => `${Deno.env.get('HOME')}/.tasks/tasks.db`

// Same database by canonical path when it exists, normalized spelling when it
// does not. Service-plane guards use this so a symlink cannot disguise owner
// data as a disposable parity copy.
export let sameGraphFile = (a: string, b: string) => {
  let canonical = (path: string) => {
    try {
      return Deno.realPathSync(path)
    } catch {
      return resolve(path)
    }
  }
  return canonical(a) == canonical(b)
}

// The db lives outside the repo (this is open source): a home-dir dotpath by
// default, overridable with DB_PATH.
// Exported because it is this process's IDENTITY on a shared port: which
// graph it serves is what a joining peer must check (src/bind.ts).
export let file = Deno.env.get('DB_PATH') ?? liveDb()

// The edge table's check derives from the vocabulary (types.ts `edges`),
// so a new verb there is a new verb here with no second edit. Named apart
// from `schema` because open() also needs it to REBUILD a live table
// whose baked check has fallen behind — a check can't be widened in place.
let depDdl = `create table if not exists dependency (
    parent integer not null references entity(id),
    type       text not null check (type in (${
  edges.map((e) => `'${e}'`).join(',')
})),
    child  integer not null references entity(id),
    ord    integer,
    primary key (parent, type, child)
  )`

// The primary key begins with parent; the reverse endpoint needs its own
// index so backlinks and endpoint deletion never walk every edge. Dependency
// is the graph's non-component table, so its access pattern stays beside its
// hand-written DDL rather than pretending to be an IDB component store.
let depIndex = { cols: ['child'] }

// The edge read carries `ord` so persona materialization can order tied tier
// members; null is the common case (every edge that never declared one), so
// drop the key rather than ride `ord: null` on every Dep — an edge without a
// listing order reads exactly as it always has.
let shedOrd = (d: Dep): Dep =>
  d.ord == null ? { parent: d.parent, type: d.type, child: d.child } : d

// Outbound mail. "to"/"from" are SQL keywords — quoted here and by the
// generic builders in apply(), which quote every column so the vocabulary
// never bends to SQL's reserved words. target deliberately wears NO
// FK: it is a death-'keep' column (types.ts) and tombstoning deletes the
// spine row, so a reference to entity(eid) would veto the delete. Named
// apart from `schema` because open() must REBUILD a live table that
// shipped with that FK baked in — a constraint can't be dropped in place.
// The send OUTCOME moved off the row to the shared delivered/error
// components (D-14945), and WHERE it goes to the shared `deliver {to}` — an
// outbound mail wears one, an inbound arrival keeps its recipient in to_addr.
// to_addr/sent_id/received_at stay as envelope DATA. mendMail's rebuild copies
// by column NAME over the shape common to the FK-era table and this ddl, so a
// column added here (or dropped by migrateDelivery()/migrateDeliver()) no
// longer has to line up positionally (T-18475).
let mailDdl = `create table if not exists mail (
    entity         integer primary key references entity(id),
    "from"      text,
    target  integer,
    to_addr     text,
    message_id  text,
    received_at text,
    verified    integer,
    reply_to integer,
    sent_id     text,
    in_reply_to text,
    headers text
  )`

// Named apart from `schema` for the same reason mail is: the sources are a
// baked CHECK, and a live db that shipped with the narrower list must be
// rebuilt around this one or record() drops every row it doesn't know —
// which would be exactly the rows nobody else reports (telemetry.ts `srv`).
let callDdl = `create table if not exists tool_call (
    ts         text not null
               default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    source     text not null check (source in ('mcp','http','web','srv','cli')),
    name       text not null,
    session_id text,
    ok         integer not null,
    ms         integer,
    error      text,
    detail     text
  )`

// The star: an entity spine plus one component table per kind, plus the edge
// table. `if not exists` makes this idempotent — safe to run every boot.
// A canvas is an entity with no component (yet) — its geometry lives in `pin`.
// This holds the HAND-written tables: the spine, the non-component logs (journal,
// tool_call, embedding), the FTS/gram virtual tables, and every component whose
// shape exceeds PropType (a NOT NULL, a default, a CHECK, a non-entity key). The
// plain per-component tables are DERIVED from the vocabulary instead — see
// `derived` below, generated in open() beside this string.
let schema = `
  create table if not exists entity (
    id          integer primary key,
    eid         text not null unique,
    num         integer unique
  );
  create table if not exists doc (
    entity   integer primary key references entity(id),
    title text not null,
    body  integer not null references blob(entity)
  );
  -- Canonical in-db bytes for text content. Identity and length live on the
  -- blob entity; this is one storage backend attached to that identity, not a
  -- second CAS. doc_value is the direct-SQL projection of component values.
  create table if not exists blob_text (
    entity integer primary key references blob(entity),
    value text not null
  );
  create view if not exists doc_value as
    select d.entity as rowid, d.entity, d.title, b.value as body
    from doc d join blob_text b on b.entity = d.body;
  create table if not exists task (
    entity    integer primary key references entity(id),
    priority real not null default 0
  );
  create table if not exists repo (
    entity  integer primary key references entity(id),
    path text not null,
    url text,
    base_branch text not null default 'main',
    gate text,
    push integer not null default 0
  );
  create table if not exists role (
    entity          integer primary key references entity(id),
    state        text not null default 'stopped',
    surface      text not null default 'native',
    scope    integer references entity(id),
    checkout integer references entity(id),
    schedule text,
    wake_policy text not null default 'always',
    wake_target integer references entity(id),
    applied_hash text,
    applied_at   text,
    stopped_at   text,
    retry_at     text,
    quiet        integer,
    cooldown     integer,
    cap          integer,
    decision     text,
    reason       text,
    observed     text,
    decided_at   text
  );
  -- One pane: container (dir) or leaf (content/view). size is a
  -- weight among siblings; "order" quoted — an SQL keyword, like "to".
  create table if not exists pane (
    entity         integer primary key references entity(id),
    layout  integer references entity(id),
    parent  integer references entity(id),
    size        real not null default 1,
    "order"     real not null default 0,
    dir         text,
    content integer references entity(id),
    view        text
  );
  create table if not exists web (
    entity integer primary key references entity(id),
    url text not null,
    frozen_at text
  );
  -- Immutable content. Its entity eid is the SHA-256; external bytes live at
  -- ~/.tasks/blobs/<eid>. Attachments point here, so dedup is structural.
  create table if not exists blob (
    entity   integer primary key references entity(id),
    bytes integer
  );
  create table if not exists attachment (
    entity integer primary key references entity(id),
    blob   integer not null references entity(id),
    mime   text,
    name   text
  );
  create index if not exists attachment_blob on attachment(blob);
  create table if not exists image (
    entity integer primary key references blob(entity),
    w     integer,
    h     integer
  );
  create table if not exists card (
    entity        integer primary key references entity(id),
    target integer not null references entity(id),
    view       text not null
  );
  create table if not exists pin (
    entity        integer primary key references card(entity),
    canvas integer not null references entity(id),
    x integer not null,
    y integer not null,
    w integer not null,
    h integer not null,
    z integer not null default 0
  );
  create table if not exists client (
    entity        integer primary key references entity(id),
    user_agent text not null default '',
    ip         text not null default ''
  );
  create table if not exists camera (
    entity        integer primary key references entity(id),
    client integer not null references entity(id),
    canvas integer not null references entity(id),
    x    real not null default 0,
    y    real not null default 0,
    zoom real not null default 1,
    w    real not null default 0,
    h    real not null default 0,
    unique (client, canvas)
  );
  create table if not exists fold (
    entity        integer primary key references entity(id),
    client integer not null references entity(id),
    board  integer not null references entity(id),
    statuses   text not null default '',
    unique (client, board)
  );
  create table if not exists shelf (
    entity        integer primary key references entity(id),
    client integer not null references entity(id),
    unique (client)
  );
  create table if not exists cursor (
    entity    integer primary key references entity(id),
    client integer not null references entity(id),
    target integer references entity(id),
    view   text,
    unique (client)
  );
  create table if not exists session (
    entity integer primary key references entity(id),
    id  text not null unique,
    cwd text
  );
  -- The handoff a session leaves for its successor (D-19459), its own
  -- component so it never contends with the session doc's narrative.
  create table if not exists brief (
    entity  integer primary key references entity(id),
    text text not null
  );
  create table if not exists runtime (
    entity                 integer primary key references entity(id),
    pid                 integer,
    pane                text,
    transcript          text,
    provider_session_id text,
    serving_model       text
  );
  -- A Session's provider lifecycle is three cohesive, server-owned facets.
  -- run and settled are mutually exclusive; yield is independent of
  -- either because a failed interaction may still produce diagnostics.
  create table if not exists run (
    entity            integer primary key references entity(id),
    status             text,
    started_at         text,
    stop_requested_at  text,
    input_at           text
  );
  create table if not exists settled (
    entity       integer primary key references entity(id),
    at           text,
    status       text,
    exit_code    integer,
    stop_reason  text
  );
  create table if not exists "yield" (
    entity      integer primary key references entity(id),
    final_text  text,
    usage_json  text,
    stderr      text
  );
  -- A Session's ordered graph-native log (D-15656). seq is assigned inside
  -- apply()'s write transaction; every other table below is an independent
  -- facet worn by the same entry entity.
  create table if not exists entry (
    entity     integer primary key references entity(id),
    session integer not null references entity(id),
    seq     integer not null,
    unique (session, seq)
  );
  -- The ingest coordinate (D-16704): where an imported entry came from. Both
  -- columns are server-owned (stamped through the trusted append path, refused
  -- from the wire) and immutable. source is a stable stream key (managed/
  -- native/an archive key, never a filesystem path); line is the 1-based
  -- SOURCE line, distinct from entry.seq. The set of (entry.session, source,
  -- line) present IS the durable ingest cursor — no mutable cursor row. A
  -- wholly new table, so create-if-not-exists is the additive add.
  create table if not exists imported (
    entity    integer primary key references entity(id),
    source text not null,
    line   integer not null
  );
  create table if not exists content (
    entity  integer primary key references entity(id),
    body text not null default ''
  );
  create table if not exists message (
    entity  integer primary key references entity(id),
    role text not null
  );
  create table if not exists generation (
    entity      integer primary key references entity(id),
    through  integer not null,
    provider text not null,
    model    text not null,
    effort   text,
    serving_model text
  );
  create table if not exists output (
    entity    integer primary key references entity(id),
    source integer not null,
    key    text,
    phase  text
  );
  create table if not exists call (
    entity integer primary key references entity(id),
    key text not null
  );
  create table if not exists bash (
    entity     integer primary key references entity(id),
    command text not null,
    cwd     text
  );
  create table if not exists fetch (
    entity    integer primary key references entity(id),
    url    text not null,
    method text not null
  );
  create table if not exists patch (
    entity  integer primary key references entity(id),
    path text not null,
    diff text not null
  );
  -- Provider-neutral named-tool facet (D-16704): an imported tool call with no
  -- first-class facet (bash/patch/fetch/task_context/graph_query/apply) keeps
  -- its real name and a one-line arg detail here. Wire-writable like the
  -- other tool facets; a wholly new table = create-if-not-exists.
  create table if not exists tool (
    entity    integer primary key references entity(id),
    name   text not null,
    detail text
  );
  create table if not exists graph_query (
    entity   integer primary key references entity(id),
    query text not null default ''
  );
  create table if not exists "apply" (
    entity     integer primary key references entity(id),
    changes text not null
  );
  create table if not exists result (
    entity  integer primary key references entity(id),
    call integer not null
  );
  create table if not exists exit (
    entity  integer primary key references entity(id),
    code integer not null
  );
  create table if not exists response (
    entity    integer primary key references entity(id),
    status integer not null
  );
  create table if not exists headers (
    entity  integer primary key references entity(id),
    data text not null
  );
  create table if not exists stderr (
    entity  integer primary key references entity(id),
    text text not null
  );
  create table if not exists timeout (
    entity integer primary key references entity(id),
    ms  integer not null
  );
  create table if not exists checkpoint (
    entity     integer primary key references entity(id),
    through integer not null
  );
  create table if not exists cancel (
    entity    integer primary key references entity(id),
    target integer not null
  );
  create table if not exists opaque (
    entity    integer primary key references entity(id),
    format text not null,
    data   text not null
  );
  create table if not exists runner (
    entity  integer primary key references entity(id),
    name text not null
  );
  -- Runtime ownership and usage are server-only outcome facets. Their refs
  -- deliberately carry no FK: runner/generation history survives a target's
  -- tombstone, like every death:'keep' association.
  create table if not exists lease (
    entity    integer primary key references entity(id),
    holder integer not null,
    at     text not null,
    until  text not null
  );
  create table if not exists usage (
    entity       integer primary key references entity(id),
    input     integer not null,
    cached    integer not null,
    output    integer not null,
    reasoning integer not null
  );
  create table if not exists claim (
    entity         integer primary key references entity(id),
    session integer not null references entity(id),
    claimed_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  -- An actor's standing instruction about one entity (watch / mute).
  -- One row per (actor, target); the derived unique index
  -- (subscription_actor_target, from the indexes map in types.ts) is what
  -- makes setting it twice idempotent rather than a pile.
  create table if not exists subscription (
    entity        integer primary key references entity(id),
    actor  integer not null references entity(id),
    target integer not null references entity(id),
    mode       text not null
  );
  create table if not exists stop_request (
    entity        integer primary key references entity(id),
    target integer not null references entity(id)
  );
  -- A knock: bring target to the recipient's attention now (knock.ts
  -- resolves; WHO looks is the shared deliver.to below, the outcome the
  -- shared delivered/error facet — neither a column here).
  create table if not exists knock (
    entity        integer primary key references entity(id),
    target integer not null references entity(id)
  );
  -- A wake: mint that knock at 'at' (absolute, resolved at mint).
  -- wake.ts arms one timer at the earliest UNACTED row (no delivered/error)
  -- and reconciles at boot; WHO to wake is the shared deliver.to, the outcome
  -- the shared facet. target is nullable — absent means the wake is its
  -- own subject.
  create table if not exists wake (
    entity        integer primary key references entity(id),
    at         text not null,
    target integer references entity(id),
    note   text
  );
  -- Self-healing's diagnosis facet (D-17077, heal.ts): a task auto-filed
  -- about a break. fault (kind + normalized message + stack head) is the dedup
  -- key a storm keys to; hits/last tally its recurrences in place. Column names
  -- are unique so dot-param routing stays unambiguous. Wire-writable, so it
  -- rides the ordinary apply() insert path like task/doc.
  create table if not exists bug (
    entity   integer primary key references entity(id),
    fault text,
    hits  integer,
    last  text
  );
  -- The dream's dedup marker (T-17407), bug's consolidation twin: a filed
  -- finding's shape key + recurrence, riding on the consider-task or memory it
  -- became so one keyed lookup dedups across both.
  create table if not exists finding (
    entity  integer primary key references entity(id),
    key  text,
    hits integer,
    last text
  );
  -- The BLOCK facet (D-17094): this task is stuck on something EXTERNAL — no
  -- entity, so a requires edge can't name it. "on" (a SQL keyword, so quoted)
  -- is the free-text reason and rides the wire; "since" is server-owned — the
  -- clock default stamps it on insert and it stays put on a re-word, so it
  -- reads as when the block began. A wholly new table = create-if-not-exists
  -- is the additive add; the entity-death cascade takes the row.
  create table if not exists blocked (
    entity    integer primary key references entity(id),
    "on"   text,
    since  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  ${mailDdl};
  create table if not exists email (
    entity     integer primary key references entity(id),
    address text not null
  );
  create table if not exists conflict (
    entity        integer primary key references entity(id),
    target integer not null,
    loser      text not null,
    holder     text not null,
    at         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  -- A value deliberately forgotten. The removed bytes never land here:
  -- target + column identify the slot and hash proves which value; the
  -- universal created component carries when/by/via. Server-owned and
  -- permanent — redact() below is the only writer, and entity deletion
  -- refuses an audit row.
  create table if not exists redaction (
    entity integer primary key references entity(id),
    target integer not null,
    "column" text not null check ("column" in ('title', 'body')),
    hash text not null
  );
  create table if not exists comment (
    entity        integer primary key references entity(id),
    target integer not null references entity(id)
  );
  create table if not exists review (
    entity     integer primary key references entity(id),
    verdict text not null
  );
  create table if not exists alias (
    entity   integer primary key references entity(id),
    slug  text not null unique,
    slugs text
  );
  -- A non-secret runtime override (D-18092, config.ts): one row per catalog
  -- key, with key unique so a second override of the same key bounces the batch
  -- (concurrent-write safety) rather than shadowing the first. Hand-DDL like
  -- alias, its keyed-handle twin: the single-column unique on a NON-reference
  -- column is what keeps this table out of the derived set. apply() validates
  -- the value against the catalog and refuses an unknown key. No secrets here.
  create table if not exists setting (
    entity   integer primary key references entity(id),
    key   text not null unique,
    value text
  );
  -- recall's not-null columns have no defaults ON PURPOSE: they refuse
  -- even apply()'s bare {} touch, so touch() below stays the one writer.
  create table if not exists recall (
    entity      integer primary key references entity(id),
    count    integer not null default 1,
    first_at text not null,
    last_at  text not null
  );
  -- Provenance, paired when+who+how (types.ts, T-6670/T-7113): "at" is
  -- server-frozen
  -- (default now on insert, overwritten by apply()'s stamp); "by" is the
  -- actor eid — wire-writable, NO FK (death 'keep': a tombstoned spine
  -- would veto an FK'd reference). "by" is quoted because
  -- BY is a SQLite keyword. created is set once at birth; updated appears
  -- on the first edit after it.
  create table if not exists created (
    entity integer primary key references entity(id),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" integer,
    via integer
  );
  create table if not exists updated (
    entity integer primary key references entity(id),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" integer,
    via integer
  );
  -- Notification lifecycle (T-7006): presence IS the fact. Same shape as
  -- created/updated — "at" default-stamped then frozen, "by" the writing
  -- actor and "via" its instrument (no FKs; provenance outlives them). All
  -- are server-only (out of comps): the wire writes a bare row and apply()'s
  -- stampedPresence loop fills and returns the stamp.
  create table if not exists notified (
    entity integer primary key references entity(id),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" integer,
    via integer
  );
  create table if not exists opened (
    entity integer primary key references entity(id),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" integer,
    via integer
  );
  create table if not exists archived (
    entity integer primary key references entity(id),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" integer,
    via integer
  );
  create table if not exists quarantined (
    entity integer primary key references entity(id),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" integer,
    via integer
  );
  -- A fleet proposal awaiting a decision: like decided, its authored time
  -- and byline ride the wire while the server alone names the instrument.
  create table if not exists proposed (
    entity integer primary key references entity(id),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" integer,
    via integer
  );
  -- A decision taken (T-12574): the same three columns, but "at" and "by"
  -- arrive on the WIRE — a decision is often written up after the fact, so
  -- the default clock is only the fallback. Only "via" is stamped.
  -- verdict (D-21212): approved | declined; null reads as approved — what
  -- every row stamped before the column meant.
  create table if not exists decided (
    entity integer primary key references entity(id),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" integer,
    via integer,
    verdict text
  );
  -- A durable per-effect claim (D-23772, docs/EFFECT_CLAIMS.md): the SQLite
  -- coordination that replaces the effects-lock dispatcher election, so one or
  -- one thousand effects workers are equivalent. Identity is (jrow, handler) --
  -- the journal ROW that carried the change plus the HANDLER key -- unique, so
  -- the same committed effect is claimed at most once. Every column is server-
  -- owned (all stamped, so comps.effect is empty and the wire can't write it); a
  -- worker leases, settles conditionally on lease_token, and reclaims on expiry
  -- via direct SQL. A wholly new table, so create-if-not-exists is the additive
  -- add. Nothing consumes it yet -- the dispatcher is unchanged.
  create table if not exists effect (
    entity        integer primary key references entity(id),
    jrow          integer,
    handler       text,
    state         text,
    attempts      integer,
    lease_owner   text,
    lease_token   text,
    lease_expiry  text,
    unique (jrow, handler)
  );
  create table if not exists tombstone (
    eid        text primary key,
    num        integer,
    deleted_at text not null
  );
  ${depDdl};
  -- Log data, not graph (like tool_call below): the journal is the record
  -- OF the wire, never part of it — one row per applied batch, written
  -- inside apply()'s transaction. No eid of its own, never in snapshot(),
  -- never in a client cache; read it per-entity via journalOf(). The
  -- symmetry: telemetry records READS, the journal records WRITES.
  create table if not exists journal (
    ts    text not null
          default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    actor text,
    via   text,
    batch text not null
  );
  -- The journal's seek index (T-13915): one row per (batch rowid, eid) the
  -- batch touched, written beside the batch inside apply()'s transaction. It
  -- once made a per-entity read an index seek instead of a full json_each scan;
  -- since the readers moved onto the normalized journal (T-18880) they seek
  -- journal_change (eid, component) instead, so this index is still MAINTAINED
  -- but unread, kept for reversibility pending the JSON journal's retirement
  -- (T-18883). Still log data — jrow is the journal rowid, there is no eid of
  -- its own, never in snapshot() or a client cache. Backfilled once
  -- (backfillJournalTouch); the index arrives with the other seek indexes in
  -- open(). Nothing deletes journal rows, so no delete-sync is needed.
  create table if not exists journal_touch (
    jrow integer not null,
    eid  text not null
  );
  -- The NORMALIZED journal (D-18860/D-18861), written beside the JSON journal
  -- above in the SAME apply() transaction -- DUAL-WRITE (T-18878). Three
  -- append-only log tables: still log data, not graph -- no eid of their own,
  -- never in snapshot() or a client cache, not vocabulary components (so no
  -- xtask/codegen). The JSON journal stays AUTHORITATIVE and every reader still
  -- reads it; these only ADD the parallel record the next stages backfill
  -- (T-18879), switch readers onto (T-18880), and finally retire the JSON
  -- journal for (T-18883).
  --
  -- journal_tx: one row per applied batch, carrying the same provenance the JSON
  -- row keeps (ts, actor, via, trace). Its rowid is the transaction's durable
  -- total-order identity -- monotonic, so ordering never rests on ts alone.
  create table if not exists journal_tx (
    id    integer primary key,
    ts    text not null,
    actor text,
    via   text,
    trace text
  );
  -- journal_change: one ordered operation per Change in the batch. (tx, ordinal)
  -- reproduces the exact applied order within a transaction. operation is
  -- upsert (comp != null -- a present component, an empty one being an upsert
  -- with no field rows) or remove (comp == null -- a component removal, or
  -- entity death when component = 'entity'). component is the wire component
  -- name, eid its entity.
  create table if not exists journal_change (
    id        integer primary key,
    tx        integer not null references journal_tx(id),
    ordinal   integer not null,
    eid       text not null,
    component text not null,
    operation text not null
  );
  -- journal_field: ordered after-image rows, one per field an operation wrote.
  -- present = 1 records a written value (JSON-encoded in value, so a present
  -- null -- present=1, value='null' -- stays distinct from a tombstone);
  -- present = 0 is a TOMBSTONE (value null), emitted for each then-present
  -- field when its component is removed, so field history, predecessor lookup,
  -- diffs and undo stay self-contained and no value leaks across a component
  -- removal and later recreation (D-18861). An upsert with no fields (empty
  -- component presence) writes none -- its journal_change alone marks it.
  -- ordinal is the field's order within its change.
  create table if not exists journal_field (
    id       integer primary key,
    change   integer not null references journal_change(id),
    ordinal  integer not null,
    field    text not null,
    present  integer not null,
    value    text
  );
  -- Reconstruct a batch in order (by tx), per-entity history and predecessor
  -- lookup (by eid+component), and the field rows of a change (by change).
  create index if not exists journal_change_tx on journal_change(tx, ordinal);
  create index if not exists journal_change_ent on journal_change(eid, component);
  create index if not exists journal_field_change on journal_field(change, ordinal);
  -- Server-local key/value, not graph: no eid, no components, so snapshot()
  -- (which walks the comps vocabulary) never carries it, and apply() never
  -- writes it. Holds the durable sync epoch (epochOf): the cursor-lineage
  -- identity a delta client checks, minted ONCE per graph and stable across
  -- process restarts, so a plain restart/deploy/listener-handoff lets a
  -- returning client resume via a small delta instead of a full resnapshot
  -- (T-20299). A restore that rewinds this graph's own journal keeps the same
  -- epoch -- the since-past-tip guard in the join handshake reseeds any client
  -- whose frontier is now beyond the journal -- while a different graph carries
  -- its own epoch, so its rows can never be replayed against a stale cursor.
  -- (Named server_meta, not meta -- meta is already a component table.)
  create table if not exists server_meta (
    k text primary key,
    v text not null
  );
  -- Log data, not graph: no eid, no components, so snapshot() (which walks
  -- the comps vocabulary) never carries it. telemetry.ts owns the rows.
  ${callDdl};
  -- Derived data, not graph (like doc_fts): a doc's semantic vector,
  -- written only by embed.ts's sweep. hash names the exact text embedded
  -- (skip unchanged), model names the embedder (a model upgrade just
  -- re-sweeps). Never on the wire, never in snapshot(); a stale or
  -- missing row costs recall, never correctness.
  create table if not exists embedding (
    eid   text primary key,
    model text not null,
    hash  text not null,
    vec   blob not null,
    at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  -- The extension's ANN data is derived from embedding. These triggers are the
  -- crash fence: any raw-vector write dirties the persisted index in the same
  -- SQLite statement; vector.ts clears it only after a successful rebuild.
  create table if not exists embedding_index (
    id    integer primary key check (id = 1),
    dirty integer not null
  );
  create trigger if not exists embedding_index_ai after insert on embedding
  begin update embedding_index set dirty = 1 where id = 1; end;
  create trigger if not exists embedding_index_au after update on embedding
  begin update embedding_index set dirty = 1 where id = 1; end;
  create trigger if not exists embedding_index_ad after delete on embedding
  begin update embedding_index set dirty = 1 where id = 1; end;
  create virtual table if not exists doc_fts using fts5(
    title, body, content='doc_value', content_rowid='rowid'
  );
  create trigger if not exists doc_fts_ai after insert on doc begin
    insert into doc_fts (rowid, title, body)
    values (new.rowid, new.title,
      (select value from blob_text where entity = new.body));
  end;
  create trigger if not exists doc_fts_ad after delete on doc begin
    insert into doc_fts (doc_fts, rowid, title, body)
    values ('delete', old.rowid, old.title,
      (select value from blob_text where entity = old.body));
  end;
  create trigger if not exists doc_fts_au after update on doc begin
    insert into doc_fts (doc_fts, rowid, title, body)
    values ('delete', old.rowid, old.title,
      (select value from blob_text where entity = old.body));
    insert into doc_fts (rowid, title, body)
    values (new.rowid, new.title,
      (select value from blob_text where entity = new.body));
  end;
  -- The SUBSTRING index, and the reason it cannot be doc_fts: doc_fts indexes
  -- TOKENS, so a search for idget finds none of the rows holding widget — a
  -- prefix search is a strict subset of a substring one and loses rows
  -- silently. The trigram tokenizer indexes every 3-character window instead,
  -- which is what lets SQLite answer LIKE %x% from an index (sql.ts) rather
  -- than by lowercasing every body in the graph. Derived like doc_fts: never
  -- on the wire, never dumped (bin/backup), healed by the same check below.
  create virtual table if not exists doc_gram using fts5(
    title, body, content='doc_value', content_rowid='rowid', tokenize='trigram'
  );
  create trigger if not exists doc_gram_ai after insert on doc begin
    insert into doc_gram (rowid, title, body)
    values (new.rowid, new.title,
      (select value from blob_text where entity = new.body));
  end;
  create trigger if not exists doc_gram_ad after delete on doc begin
    insert into doc_gram (doc_gram, rowid, title, body)
    values ('delete', old.rowid, old.title,
      (select value from blob_text where entity = old.body));
  end;
  create trigger if not exists doc_gram_au after update on doc begin
    insert into doc_gram (doc_gram, rowid, title, body)
    values ('delete', old.rowid, old.title,
      (select value from blob_text where entity = old.body));
    insert into doc_gram (rowid, title, body)
    values (new.rowid, new.title,
      (select value from blob_text where entity = new.body));
  end;
`

// The component tables DERIVED from the vocabulary (T-12764) rather than
// hand-written in `schema` above — the last twin of `comps` closed, generated at
// open() beside it the way `cmps`/`readable` already are. A comp qualifies when
// its WHOLE shape is expressible in PropType: every column nullable, text/real/
// integer affinity, an entity-keyed spine, `{eid}` FKs by death word. The rest
// stay in `schema` because they carry a NOT NULL, a default, a CHECK, a
// non-entity key (pin→card), an integer-affine number, or a column ORDER a
// migration reads — none of which a PropType (and so no plugin comps fragment)
// can say. ddl_test.ts holds the split honest: a fresh db's table for a derived
// comp equals its vocabulary columns exactly, and every OTHER comp still carries
// every column it declares.
export let derived = [
  'project',
  'venture',
  'board',
  'layout',
  'design',
  'architecture',
  'canvas',
  'favorite',
  'worktree',
  'attention',
  'prompt',
  'task_context',
  'reasoning',
  'recalled',
  'spawn',
  'hook',
  'person',
  'persona',
  'model',
  'memory',
  'feedback',
  'meta',
  'resume',
  'chat',
  'dream',
  // A notice (D-13858): {target FK cascade, kind text} — an entity-keyed spine,
  // every column nullable, wholly PropType-expressible, so it derives.
  'notice',
  'deliver',
  'delivered',
  'error',
  'exception',
  'fixer',
  'nofix',
  // The git-anchor facet (D-18378, exact tiers D-21211): nullable text and
  // number columns, an entity-keyed spine, no FK — wholly PropType-
  // expressible, so it derives.
  'anchor',
  // The session-level fork facet (D-23845 §v0.1, D-23985): one nullable {eid}
  // reference to the fork-point entry (death 'detach'), an entity-keyed spine,
  // no NOT NULL/default/CHECK — wholly PropType-expressible, so it derives. The
  // derived DDL quotes the reserved "from" column name and plants the auto index
  // on the reference for the shared-prefix walk.
  'fork',
  // The task completion/cancellation marks (D-24102): {at, by{eid}, via{eid}}
  // and cancelled's extra {reason}, every column nullable, entity-keyed spine,
  // {eid} FKs by death word — wholly PropType-expressible, so they derive. Their
  // presence is the dissolved `task.status`: `status(task)` reads them.
  'completed',
  'cancelled',
]

// Insert a bare entity spine — the eid, and nothing else. num is NOT minted
// here (T-3684): it is a kind-driven UI label, and this fires at FIRST-TOUCH,
// before any component says what KIND the entity is. mintNum() assigns it
// once the components land (apply()'s late pass, seed(), addressEntity()), or
// leaves it NULL for a numberless kind. No kind column: an entity is what its
// components make it. Birth time is the `created` component's business
// (T-6670), stamped by apply() from the batch's one clock — not taken here.
let spine = (db: DatabaseSync, eid: string) =>
  prep(db, 'insert or ignore into entity (eid) values (?)').run(eid)

// The kinds that get a human number. Cheap/bulk/ephemeral kinds stay out:
// `entry` (log lines) and `wake` (one per pace cycle, read only by kind=wake and
// self-replaced per actor) are never typed by a human, so a num is pure overload.
// Their spines carry a NULL num; every other kind is numbered (T-3684).
let unnumbered = new Set(['entry', 'wake'])
export let numbered = (kind: string) => !unnumbered.has(kind)

// Assign the next human number to a newly-created entity — the allocator
// spine() used to run at first-touch, moved here where the entity's KIND is
// finally knowable (its component rows exist). Same max+1 over the living AND
// the graves (tombstone.num keeps a dead entity's number), so a number is
// never reused and ids stay monotonic. A no-op if the entity is already
// numbered, is gone (deleted later in the same batch), or wears an unnumbered
// kind — the kind is derived only when the exclusion is non-empty, so part 1
// pays nothing for the lookup.
let mintNum = (db: DatabaseSync, eid: string) => {
  // A content hash is already the blob's durable human identity. Numbering
  // every deduplicated body/file would create a second, meaningless name.
  if (
    prep(
      db,
      `select 1 from blob where entity = (select id from entity where eid = ?)`,
    ).get(eid)
  ) return
  if (unnumbered.size) {
    let kind = kindOrder.find((k) =>
      prep(
        db,
        `select 1 from ${sqlName(k)}
         where entity = (select id from entity where eid = ?)`,
      ).get(eid)
    ) ?? 'entity'
    if (!numbered(kind)) {
      return
    }
  }
  let { n } = prep(
    db,
    `select coalesce(max(num), 0) + 1 as n from
       (select num from entity union all select num from tombstone)`,
  ).get() as { n: number }
  prep(db, 'update entity set num = ? where eid = ? and num is null')
    .run(n, eid)
}

let utf8 = new TextEncoder()

// Land one internal text backend under the same blob identity attachments use.
// The caller stores only the returned integer id; graph-out resolves the text
// through blob_text, so the wire continues to speak the component value.
export let textBlob = (db: DatabaseSync, value: string): number => {
  let eid = sha(value)
  spine(db, eid)
  let { id } = prep(db, 'select id from entity where eid = ?').get(eid) as {
    id: number
  }
  prep(db, 'insert or ignore into blob (entity, bytes) values (?, ?)')
    .run(id, utf8.encode(value).byteLength)
  prep(db, 'insert or ignore into blob_text (entity, value) values (?, ?)')
    .run(id, value)
  return id
}

// Mint a bare entity; components hang off the returned eid.
let ent = (db: DatabaseSync) => {
  let eid = crypto.randomUUID()
  spine(db, eid)
  return eid
}

// Seed writes go straight to SQL (bypassing apply()), so they resolve their
// own eids to the int owner/reference keys the reshaped tables use (D-18866):
// `(select id from entity where eid = ?)` for every owner and every reference.
let ID = '(select id from entity where eid = ?)'
let doc = (db: DatabaseSync, eid: string, title: string, body = '') =>
  prep(db, `insert into doc (entity, title, body) values (${ID}, ?, ?)`)
    .run(eid, title, textBlob(db, body))

let addTask = (db: DatabaseSync, title: string, status: string, body = '') => {
  let eid = ent(db)
  doc(db, eid, title, body)
  prep(db, `insert into task (entity) values (${ID})`).run(eid)
  // Status is derived (D-24102): a demo task wears the mark its status names.
  // 'wip'/'open' get no mark — a seed has no live claim, so wip reads open.
  let now = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  if (status == 'done') {
    prep(db, `insert into completed (entity, at) values (${ID}, ${now})`).run(
      eid,
    )
  } else if (status == 'cancelled') {
    prep(db, `insert into cancelled (entity, at) values (${ID}, ${now})`).run(
      eid,
    )
  }
  return eid
}

let addProject = (db: DatabaseSync, title: string) => {
  let eid = ent(db)
  doc(db, eid, title)
  prep(db, `insert into project (entity) values (${ID})`).run(eid)
  return eid
}

let addBoard = (db: DatabaseSync, title: string) => {
  let eid = ent(db)
  doc(db, eid, title)
  prep(db, `insert into board (entity) values (${ID})`).run(eid)
  return eid
}

// A card views one entity through one lens; pinning places it on a canvas.
let addCard = (db: DatabaseSync, target: string, view: string) => {
  let eid = ent(db)
  prep(db, `insert into card (entity, target, view) values (${ID}, ${ID}, ?)`)
    .run(eid, target, view)
  return eid
}

let pin = (
  db: DatabaseSync,
  canvas: string,
  card: string,
  x: number,
  y: number,
  w: number,
  h: number,
) =>
  prep(
    db,
    `insert into pin (entity, canvas, x, y, w, h)
     values (${ID}, ${ID}, ?, ?, ?, ?)`,
  ).run(card, canvas, x, y, w, h)

let link = (db: DatabaseSync, parent: string, type: string, child: string) =>
  prep(
    db,
    `insert into dependency (parent, type, child) values (${ID}, ?, ${ID})`,
  ).run(parent, type, child)

// A handful of neutral demo rows — a board containing tasks, one edge of
// each type, and a root canvas showing it as a Board plus one task
// card. No fleet data in the repo.
let seed = (db: DatabaseSync) => {
  let schema = addTask(
    db,
    'Set up the database schema',
    'done',
    'Model the entities and how they relate.',
  )
  let view = addTask(
    db,
    'Build the task list view',
    'wip',
    'Render each task with its dependencies.',
  )
  let keys = addTask(
    db,
    'Add keyboard shortcuts',
    'open',
    'Navigate the list without reaching for the mouse.',
  )
  let readme = addTask(
    db,
    'Write the README',
    'open',
    'Explain the schema and how to run the app.',
  )
  link(db, view, 'requires', schema) // the view is gated by the schema
  link(db, view, 'contains', keys) // the view work decomposes into shortcuts
  link(db, readme, 'reads', schema) // read the schema before writing docs

  let board = addBoard(db, 'Walking skeleton')
  for (let t of [schema, view, keys, readme]) link(db, board, 'contains', t)

  let proj = addProject(db, 'Demo project')
  prep(db, `update task set project = ${ID}`).run(proj)

  let canvas = ent(db)
  prep(db, `insert into canvas (entity) values (${ID})`).run(canvas)
  pin(db, canvas, addCard(db, board, 'Board'), 0, 0, 640, 0)
  pin(db, canvas, addCard(db, view, 'Full'), 664, 0, 320, 0)
  // These direct inserts bypass apply()'s late mint pass, so number the demo
  // entities now their components exist — in creation (rowid) order, so the
  // ids read 1, 2, 3… exactly as spine() used to hand them out (T-3684).
  for (
    let { eid } of prep(
      db,
      'select eid from entity where num is null order by rowid',
    ).all() as { eid: string }[]
  ) mintNum(db, eid)
}

// A baked constraint can't be changed in place: rebuild the table around
// its current ddl, rows copied by NAME over the columns common to both
// shapes (see rebuild() below), so a widened or trimmed ddl never has to
// line up positionally.
// Does this table still carry that column? The one question both schema
// guards ask, and the gate on every backfill that reads a retired column:
// once the drop lands, the read that fed it must stop compiling away.
export let hasCol = (db: DatabaseSync, table: string, col: string) =>
  (prep(db, `select name from pragma_table_info('${table}')`)
    .all() as { name: string }[]).some((c) => c.name == col)

// A table's column names in declaration order — what rebuild() copies BY NAME
// rather than by position, so a shape change never relies on `select *` lining
// up value for value (T-18475).
let colNames = (db: DatabaseSync, table: string) =>
  (prep(db, 'select name from pragma_table_info(?)')
    .all(table) as { name: string }[]).map((c) => c.name)

// `instruction` used to be the empty marker on a Session's assembled prompt.
// The evaluator now needs that name for executable instructions, so migrate
// the marker TABLE before the current schema is planted. Shape is the guard:
// a future executable instruction table has contract columns and must never be
// mistaken for this retired one-column marker. The two-table arm makes an
// interrupted/rolling migration idempotent without keeping two writable names.
export let migratePrompt = (db: DatabaseSync) => {
  let legacy = colNames(db, 'instruction')
  if (legacy.length != 1 || legacy[0] != 'entity') return
  if (!colNames(db, 'prompt').length) {
    db.exec('alter table instruction rename to prompt')
    return
  }
  db.exec(`
    insert or ignore into prompt (entity) select entity from instruction;
    drop table instruction;
  `)
}

// The index twin of hasCol: is this named index already present? A bare
// `create index if not exists` on an existing index opens an empty write
// transaction that still bumps the file change counter, breaking open()'s
// byte-idempotency — so the index realization guards each create with this,
// the same shape addCol takes with hasCol.
export let hasIdx = (db: DatabaseSync, name: string) =>
  !!prep(db, `select 1 from sqlite_master where type = 'index' and name = ?`)
    .get(name)

// References used to repeat their representation in every column name. The
// PropType now carries that fact alone; this is the one cutover from the old
// spellings. A migration is history, so this list is deliberately frozen — a
// future ref must never make an unrelated old column start moving.
let refRenames = [
  { table: 'task', old: 'project_eid', col: 'project' },
  { table: 'task', old: 'assignee_eid', col: 'assignee' },
  { table: 'role', old: 'scope_eid', col: 'scope' },
  { table: 'layout', old: 'root_eid', col: 'root' },
  { table: 'pane', old: 'layout_eid', col: 'layout' },
  { table: 'pane', old: 'parent_eid', col: 'parent' },
  { table: 'pane', old: 'content_eid', col: 'content' },
  { table: 'card', old: 'target_eid', col: 'target' },
  { table: 'pin', old: 'canvas_eid', col: 'canvas' },
  { table: 'client', old: 'actor_eid', col: 'actor' },
  { table: 'camera', old: 'client_eid', col: 'client' },
  { table: 'camera', old: 'canvas_eid', col: 'canvas' },
  { table: 'fold', old: 'client_eid', col: 'client' },
  { table: 'fold', old: 'board_eid', col: 'board' },
  { table: 'shelf', old: 'client_eid', col: 'client' },
  { table: 'session', old: 'requested_task_eid', col: 'requested_task' },
  { table: 'session', old: 'role_eid', col: 'role' },
  { table: 'session', old: 'persona_eid', col: 'persona' },
  { table: 'session', old: 'actor_eid', col: 'actor' },
  { table: 'session', old: 'parent_eid', col: 'parent' },
  { table: 'spawn', old: 'persona_eid', col: 'persona' },
  { table: 'claim', old: 'session_eid', col: 'session' },
  { table: 'subscription', old: 'actor_eid', col: 'actor' },
  { table: 'subscription', old: 'target_eid', col: 'target' },
  { table: 'stop_request', old: 'target_eid', col: 'target' },
  { table: 'knock', old: 'target_eid', col: 'target' },
  { table: 'wake', old: 'target_eid', col: 'target' },
  { table: 'mail', old: 'target_eid', col: 'target' },
  { table: 'mail', old: 'reply_to_eid', col: 'reply_to' },
  { table: 'conflict', old: 'target_eid', col: 'target' },
  { table: 'comment', old: 'target_eid', col: 'target' },
  { table: 'persona', old: 'home_eid', col: 'home' },
  { table: 'memory', old: 'scope_eid', col: 'scope' },
  { table: 'dependency', old: 'parent_eid', col: 'parent' },
  { table: 'dependency', old: 'child_eid', col: 'child' },
]

let renameFilter = (query: string) => {
  let out = query
  let names = new Map(refRenames.map((r) => [r.old, r.col]))
  for (let [old, col] of names) {
    let key = new RegExp(
      `(^|[&\\s])((?:\\.[A-Za-z_]+)?\\.)${old}(?=[.!<>=~])`,
      'g',
    )
    out = (out.match(/"[^"]*"|[^"]+/g) ?? [])
      .map((part) =>
        part.startsWith('"') ? part : part.replace(key, `$1$2${col}`)
      )
      .join('')
  }
  return out
}

// Memories and personas teach the vocabulary back to every later session, so
// their prose is schema data too. Identifier-shaped keys all lose the suffix;
// standalone explanations are frozen here with the cutover they name.
let renameTeaching = (text: string) =>
  text.replace(/\b([A-Za-z][A-Za-z0-9_]*)_eid\b/g, '$1')
    .replaceAll('`eid`/`*_eid` values', '`eid` and reference values')
    .replaceAll(
      'the `_eid` sugar in `route()`',
      'the reference property in `route()`',
    )
    .replaceAll(
      'a `<name>_eid` column elsewhere',
      'a same-named reference column elsewhere',
    )

export let migrateRefs = (db: DatabaseSync) => {
  let renames = refRenames.filter((r) => hasCol(db, r.table, r.old))
  let boards = hasCol(db, 'board', 'query')
    ? prep(
      db,
      `select o.eid as eid, query from board b join entity o on o.id = b.entity
       where query is not null`,
    )
      .all() as {
        eid: string
        query: string
      }[]
    : []
  let staleBoards = boards.map((r) => ({ ...r, next: renameFilter(r.query) }))
    .filter((r) => r.next != r.query)
  let kinds = ['memory', 'persona'].filter((table) =>
    hasCol(db, table, 'entity')
  )
  let teachings = hasCol(db, 'doc', 'body') && kinds.length
    ? prep(
      db,
      `select o.eid as eid, d.title, d.body
       from doc_value d join entity o on o.id = d.entity where ${
        kinds.map((table) =>
          `exists (select 1 from ${table} where ${table}.entity = d.entity)`
        ).join(' or ')
      }`,
    ).all() as { eid: string; title: string; body: string }[]
    : []
  let staleDocs = teachings.map((r) => ({
    ...r,
    nextTitle: renameTeaching(r.title),
    nextBody: renameTeaching(r.body),
  })).filter((r) => r.nextTitle != r.title || r.nextBody != r.body)
  if (!renames.length && !staleBoards.length && !staleDocs.length) return
  atomic(db, () => {
    for (let { table, old, col } of renames) {
      if (hasCol(db, table, col)) {
        throw new Error(
          `reference migration found both ${table}.${old} and ${col}`,
        )
      }
      db.exec(
        `alter table ${sqlName(table)} rename column ${sqlName(old)} to ${
          sqlName(col)
        }`,
      )
    }
    let writeBoard = prep(
      db,
      'update board set query = ? where entity = (select id from entity where eid = ?)',
    )
    for (let r of staleBoards) writeBoard.run(r.next, r.eid)
    let writeDoc = prep(
      db,
      `update doc set title = ?, body = ?
       where entity = (select id from entity where eid = ?)`,
    )
    for (let r of staleDocs) {
      writeDoc.run(r.nextTitle, textBlob(db, r.nextBody), r.eid)
    }
  })
}

// Journal bytes are audit history, so the migration never rewrites them. A
// reader translates former active keys at the boundary, keeping history and
// replay on the vocabulary spoken by this process.
export let canonicalChanges = (changes: Change[]): Change[] => {
  let names = new Map(
    refRenames.map((r) => [`${r.table}.${r.old}`, r.col]),
  )
  let record = (name: string, value: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(value).map((
        [key, v],
      ) => [names.get(`${name}.${key}`) ?? key, v]),
    )
  return changes.map((change) => ({
    ...change,
    ...(change.comp && { comp: record(change.name, change.comp) }),
    ...(change.was &&
      { was: record(change.name, change.was) as Change['was'] }),
  }))
}

let ddlOf = (db: DatabaseSync, name: string) =>
  (prep(db, `select sql from sqlite_master where type = 'table' and name = ?`)
    .get(name) as { sql: string } | undefined)?.sql
let rebuild = (db: DatabaseSync, name: string, ddl: string) => {
  atomic(db, () => {
    db.exec(`alter table ${name} rename to ${name}_stale`)
    db.exec(ddl)
    // Copy BY NAME, over the columns common to both shapes — never `select *`.
    // A rebuild whose new ddl adds a column (T-14133 added mail's 11th) leaves
    // the fresh table wider than the stale one, so a positional `select *`
    // supplies too few values ("N columns but M values"); one that drops a
    // column supplies too many. Naming the intersection lets an added column
    // take its default and a dropped one fall away, so widening the vocabulary
    // never breaks the FK-era migration again (T-18475).
    let fresh = new Set(colNames(db, name))
    let cols = colNames(db, `${name}_stale`).filter((c) => fresh.has(c))
    let list = cols.map(sqlName).join(', ')
    db.exec(`insert into ${name} (${list}) select ${list} from ${name}_stale`)
    db.exec(`drop table ${name}_stale`)
  })
}

// The same shape for tool_call's source list: a row the CHECK doesn't know
// is dropped with a warning, and record() is by contract silent about its
// own failures — so an unwidened live table would swallow the very reports
// nobody else makes. No-ops once healed.
export let mendCalls = (db: DatabaseSync) => {
  if (!ddlOf(db, 'tool_call')?.includes("'cli'")) {
    rebuild(db, 'tool_call', callDdl)
  }
}

// The hosted graph_apply once persisted a single serialized Change; it now
// persists the whole atomic Change[] batch (T-16716). Wrap each existing
// single-object body into a one-element array and rename the column, so a
// legacy row and a batch read back under one name. Guarded on the old
// column, so it runs once and no-ops thereafter.
export let mendApply = (db: DatabaseSync) => {
  if (!hasCol(db, 'apply', 'change')) return
  atomic(db, () => {
    db.exec('update apply set change = json_array(json(change))')
    db.exec('alter table apply rename column change to changes')
  })
}

// The read→opened migration (T-7006): seed `opened` from every letter the
// old mail.read_at column already marked read. `insert or ignore` on the pk
// is idempotent, so a re-boot never moves an existing stamp. A no-op once
// the column is gone — the stamp has been the only read-state since.
export let backfillOpened = (db: DatabaseSync) => {
  if (!hasCol(db, 'mail', 'read_at')) return
  db.exec(
    `insert or ignore into opened (entity, at)
       select entity, read_at from mail where read_at is not null`,
  )
}

// Lift component-specific instruments into the universal register once
// (T-7113). Each half is guarded on its own source column: the register is
// the only home, and these reads are the last thing the columns are for.
export let backfillVia = (db: DatabaseSync) => {
  if (hasCol(db, 'comment', 'author_eid')) {
    db.exec(
      `update created set via = (
         select e.id from comment c join entity e on e.eid = c.author_eid
         where c.entity = created.entity
       )
       where via is null and exists (
         select 1 from comment
         where comment.entity = created.entity and author_eid is not null
       )`,
    )
  }
  if (hasCol(db, 'memory', 'source_eid')) {
    db.exec(
      `update created set via = (
         select e.id from memory m join entity e on e.eid = m.source_eid
         where m.entity = created.entity
       )
       where via is null and exists (
         select 1 from memory
         where memory.entity = created.entity and source_eid is not null
       )`,
    )
  }
}

// Fill journal_touch once from the existing journal (T-13915) — one row per
// (batch rowid, eid), the same (rowid, '$.eid') pairs json_each found before the
// index existed, so the reads it feeds stay behavior-identical. apply()/record()
// keep it current from here on. Difference-guarded: a populated table (any later
// boot) or an empty journal (a fresh db) is a pure read, so it is paid exactly
// once. Runs after the mend* migrations that rewrite journal batches, so it
// indexes the settled log.
export let backfillJournalTouch = (db: DatabaseSync) => {
  let touched =
    (prep(db, 'select count(*) as n from journal_touch').get() as { n: number })
      .n
  if (touched) return
  let entries = (prep(db, 'select max(rowid) as n from journal').get() as {
    n: number | null
  }).n
  if (!entries) return
  try {
    atomic(db, () => {
      db.exec(
        `insert into journal_touch (jrow, eid)
         select distinct j.rowid, json_extract(je.value, '$.eid')
         from journal j, json_each(j.batch) je
         where json_extract(je.value, '$.eid') is not null`,
      )
    })
  } catch (e) {
    console.warn('journal_touch backfill skipped —', e)
  }
}

// memory.type → the `feedback` tag (T-12585). The enum said four things the
// graph already knew: `project` restated scope, `user` had zero rows,
// `reference` was the absence of anything else. Only `feedback` carried a
// fact, so only `feedback` becomes a row — with a NULL source, because
// `created.by` names the recorder (a venture, in 81 of 87 rows), not who
// gave the feedback, and an inferred author that is wrong is worse than an
// absent one. The drop is what makes the retirement true: a column that
// lingers keeps teaching a vocabulary the code no longer has.
export let retireMemoryType = (db: DatabaseSync) => {
  if (!hasCol(db, 'memory', 'type')) return
  db.exec(
    `insert or ignore into feedback (entity)
       select entity from memory where type = 'feedback'`,
  )
  db.exec('alter table memory drop column type')
}

// task.proposal → the universal proposal stamp. The old boolean had no
// provenance of its own, so its filing stamp is the only authored fact it can
// preserve. The board rewrite is independently guarded: a database interrupted
// between old deployments may have lost the column while retaining its query.
export let retireProposal = (db: DatabaseSync) => {
  let legacy = hasCol(db, 'task', 'proposal')
  let stale = prep(
    db,
    "select 1 from board where instr(query, '.proposal=true') > 0 limit 1",
  ).get()
  if (!legacy && !stale) return
  atomic(db, () => {
    if (legacy) {
      db.exec(`
        insert or ignore into proposed (entity, at, "by", via)
        select t.entity,
          coalesce(c.at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          c."by", c.via
        from task t left join created c on c.entity = t.entity
        where t.proposal != 0
      `)
    }
    db.exec(`update board
      set query = replace(query, '.proposal=true', '.proposed~=')
      where instr(query, '.proposal=true') > 0`)
    if (legacy) db.exec('alter table task drop column proposal')
  })
}

// task.status dissolves into components (D-24102): status=done mints
// `completed`, status=cancelled mints `cancelled`, status=wip is DROPPED (wip
// is derived from a live claim — a stuck wip with no claim becomes open, the
// intended fix), status=open needs nothing. The status column then goes. Idempotent:
// the column-presence guard skips a db already past the drop, and `insert or
// ignore` heals a partial run. No board rewrite — `.status=` still parses and
// answers as the derived predicate, so saved queries keep working untouched. The
// close moment and its actor come from `updated` (the done/cancel write was the
// last edit for a settled task), falling back to `created`, then to now.
export let retireTaskStatus = (db: DatabaseSync) => {
  if (!hasCol(db, 'task', 'status')) return
  let mint = (status: string, table: string) =>
    db.exec(`
      insert or ignore into ${table} (entity, at, "by", via)
      select t.entity,
        coalesce(u.at, c.at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        coalesce(u."by", c."by"), null
      from task t
      left join updated u on u.entity = t.entity
      left join created c on c.entity = t.entity
      where t.status = '${status}'
    `)
  atomic(db, () => {
    mint('done', 'completed')
    mint('cancelled', 'cancelled')
    db.exec('alter table task drop column status')
  })
}

// A project's end is the same archived fact every entity can wear. Preserve
// its clock exactly; authorship was never recorded, so invent none. The board
// rewrite is independently guarded for a database interrupted after the drop.
let retireFilter = (query: string) => {
  let key = /(^|[&\s])\.(?:project\.)?retired_at(?=[.!<>=~])/g
  return (query.match(/"[^"]*"|[^"]+/g) ?? [])
    .map((part) =>
      part.startsWith('"') ? part : part.replace(key, '$1.archived.at')
    )
    .join('')
}

export let retireProjectRetiredAt = (db: DatabaseSync) => {
  let legacy = hasCol(db, 'project', 'retired_at')
  let boards = prep(
    db,
    `select o.eid as eid, query from board b join entity o on o.id = b.entity
     where query is not null`,
  )
    .all() as { eid: string; query: string }[]
  let stale = boards.map((r) => ({ ...r, next: retireFilter(r.query) }))
    .filter((r) => r.next != r.query)
  if (!legacy && !stale.length) return
  atomic(db, () => {
    if (legacy) {
      db.exec(`insert or ignore into archived (entity, at)
        select entity, retired_at from project where retired_at is not null`)
    }
    let write = prep(
      db,
      'update board set query = ? where entity = (select id from entity where eid = ?)',
    )
    for (let r of stale) write.run(r.next, r.eid)
    if (legacy) db.exec('alter table project drop column retired_at')
  })
}

// Give every session its canonical launch facet before graph-out can observe
// the handle, then mirror canonical values back for a rollback process. An
// existing canonical row wins — including explicit null — on every open.
export let backfillSpawn = (db: DatabaseSync) => {
  let cols = ['provider', 'model', 'effort', 'persona']
  atomic(db, () => {
    db.exec(
      `insert or ignore into spawn (entity, provider, model, effort, persona)
         select entity, provider, model, effort, persona from session`,
    )
    // Only the sessions that actually DIFFER from their spawn row — so once the
    // backfill has settled, this update matches nothing and writes nothing.
    // Without the difference guard the copy re-fires identically every open;
    // that was an invisible no-op page write until session's {eid} refs
    // (persona, …) gained indexes (T-17678), which turn each redundant UPDATE
    // into index maintenance that bumps the file change counter every boot.
    let differ = cols.map((col) =>
      `session.${sqlName(col)} is not spawn.${sqlName(col)}`
    ).join(' or ')
    db.exec(
      `update session set ${
        cols.map((col) =>
          `${sqlName(col)} = (select ${sqlName(col)} from spawn
            where spawn.entity = session.entity)`
        ).join(', ')
      } where exists (
        select 1 from spawn where spawn.entity = session.entity and (${differ})
      )`,
    )
    let different = cols.map((col) =>
      `s.${sqlName(col)} is not p.${sqlName(col)}`
    ).join(' or ')
    let missed = prep(
      db,
      `
      select 1 from session s join spawn p on p.entity = s.entity
      where ${different} limit 1
    `,
    ).get()
    if (missed) throw new Error('spawn backfill did not verify')
  })
}

// Lineage rides an edge (T-16412, D-16328): `parent delegates child` is the
// canonical form of session.parent; the column is its rolling alias. Boot
// backfills the edge from every stored column value — insert or ignore
// against the (parent, type, child) primary key, live parents only, so a
// settled backfill re-fires as a true no-op.
export let backfillLineage = (db: DatabaseSync) => {
  db.exec(`
    insert or ignore into dependency (parent, type, child)
    select s.parent, 'delegates', s.entity from session s
    join entity p on p.id = s.parent
    where s.parent is not null
  `)
}

// Lift the remaining Session aspects without inventing facets for rows that
// never carried them. An existing canonical row wins — including its nulls —
// so an interrupted rolling deploy can never revive a cleared legacy alias.
export let backfillSessionFacets = (db: DatabaseSync) => {
  atomic(db, () => {
    db.exec(`
      insert or ignore into worktree (entity, cwd, branch, base_revision)
      select entity, cwd, branch, base_revision from session
      where cwd is not null or branch is not null or base_revision is not null
    `)
    db.exec(`
      insert or ignore into runtime (
        entity, pid, pane, transcript, provider_session_id, serving_model
      )
      select entity, pid, pane, transcript, provider_session_id, serving_model
      from session
      where pid is not null or pane is not null or transcript is not null
        or provider_session_id is not null or serving_model is not null
    `)
    db.exec(`
      insert or ignore into run (
        entity, status, started_at, stop_requested_at, input_at
      )
      select entity, status, started_at, stop_requested_at, input_at
      from session
      where finished_at is null and (
        status in ('starting', 'running', 'stopping')
        or started_at is not null or stop_requested_at is not null
        or input_at is not null
      )
    `)
    db.exec(`
      insert or ignore into settled (
        entity, at, status, exit_code, stop_reason
      )
      select entity, finished_at, status, exit_code, stop_reason
      from session
      where finished_at is not null
        or status in ('completed', 'failed', 'interrupted', 'lost')
    `)
    db.exec(`
      insert or ignore into "yield" (entity, final_text, usage_json, stderr)
      select entity, final_text, usage_json, stderr from session
      where final_text is not null or usage_json is not null or stderr is not null
    `)
    let facets: Record<string, Record<string, string>> = {
      worktree: {
        cwd: 'cwd',
        branch: 'branch',
        base_revision: 'base_revision',
      },
      runtime: {
        pid: 'pid',
        pane: 'pane',
        transcript: 'transcript',
        provider_session_id: 'provider_session_id',
        serving_model: 'serving_model',
      },
      run: {
        status: 'status',
        started_at: 'started_at',
        stop_requested_at: 'stop_requested_at',
        input_at: 'input_at',
      },
      settled: {
        at: 'finished_at',
        status: 'status',
        exit_code: 'exit_code',
        stop_reason: 'stop_reason',
      },
      yield: {
        final_text: 'final_text',
        usage_json: 'usage_json',
        stderr: 'stderr',
      },
    }
    for (let [table, mapping] of Object.entries(facets)) {
      let cols = Object.keys(mapping)
      // Difference-guarded like backfillSpawn: touch only the sessions whose
      // columns still disagree with the facet, so a settled backfill re-fires as
      // a true no-op — no page write, and none of the per-boot index maintenance
      // session's {eid} refs would otherwise incur (T-17678).
      let differ = cols.map((col) =>
        `session.${sqlName(mapping[col])} is not ${sqlName(table)}.${
          sqlName(col)
        }`
      ).join(' or ')
      db.exec(
        `update session set ${
          cols.map((col) =>
            `${sqlName(mapping[col])} = (select ${sqlName(col)} from ${
              sqlName(table)
            }
            where ${sqlName(table)}.entity = session.entity)`
          ).join(', ')
        } where exists (
          select 1 from ${sqlName(table)}
          where ${sqlName(table)}.entity = session.entity and (${differ})
        )`,
      )
      let different = cols.map((col) =>
        `s.${sqlName(mapping[col])} is not f.${sqlName(col)}`
      ).join(' or ')
      let missed = prep(
        db,
        `
        select 1 from session s join ${sqlName(table)} f on f.entity = s.entity
        where ${different} limit 1
      `,
      ).get()
      if (missed) throw new Error(`${table} backfill did not verify`)
    }
  })
}

// D-14945 phase 4: role/session diagnostics become the shared error facet.
// Add every component first, verify the legacy messages all arrived, and only
// then contract the old columns. A mismatch rolls the transaction back with
// both sources intact rather than teaching two health vocabularies.
export let migrateErrors = (db: DatabaseSync) => {
  let tables = ['role', 'session'].filter((table) => hasCol(db, table, 'error'))
  if (!tables.length) return
  let at: Record<string, string> = {
    role: 'null',
    session: `case when status in
      ('completed', 'failed', 'interrupted', 'lost') then finished_at end`,
  }
  atomic(db, () => {
    for (let table of tables) {
      db.exec(
        `insert into error (entity, at, message)
           select entity, ${at[table]}, error from ${table}
           where error is not null
         on conflict(entity) do update set
           at = coalesce(excluded.at, error.at),
           message = excluded.message`,
      )
    }
    for (let table of tables) {
      let missed = prep(
        db,
        `select 1 from ${table} source
         left join error target on target.entity = source.entity
         where source.error is not null
           and target.message is not source.error limit 1`,
      ).get()
      if (missed) throw new Error(`${table} error migration did not verify`)
    }
    for (let table of tables) db.exec(`alter table ${table} drop column error`)
  })
}

// D-14945 phase 1: the per-type delivery receipts become two shared
// server-owned components. knock (acted_at/delivery/error), wake
// (acted_at/error), mail (acted_at/error) and stop_request (acted_at) carried
// the same aspects under different names — carry every settled row across to
// delivered {at, via} / error {at, message}, then drop the columns (a
// lingering column keeps teaching a mechanism the code no longer has). Runs
// BEFORE mendMail so any mail rebuild sees the already-trimmed shape.
// Idempotent: insert-or-ignore on the eid pk, each read guarded on its source
// column, so a re-open after the drop is a no-op. Success and failure split
// on an `error` value being present — the resolver's fail() always set one,
// its done() never did.
export let migrateDelivery = (db: DatabaseSync) => {
  let win = (table: string, via: string) => {
    if (!hasCol(db, table, 'acted_at')) return
    db.exec(
      `insert or ignore into delivered (entity, at, via)
         select entity, acted_at, ${via} from ${table}
         where acted_at is not null` +
        (hasCol(db, table, 'error') ? ` and error is null` : ``),
    )
    if (hasCol(db, table, 'error')) {
      db.exec(
        `insert or ignore into error (entity, at, message)
           select entity, acted_at, error from ${table} where error is not null`,
      )
    }
  }
  win('knock', 'delivery') // delivery -> delivered.via
  win('wake', 'null') //       the timer fired; no delivery detail to keep
  // a sent mail's via is the native Message-ID, or 'local' for an in-graph
  // hand-off; inbound rows never ran the send effect (acted_at null) and so
  // carry no delivered — arrival lives on as received_at DATA.
  win(
    'mail',
    `coalesce(sent_id, case when message_id like 'local:%' then 'local' end)`,
  )
  win('stop_request', `'signalled'`) // acted_at was the signal-sent receipt
  let drop = (table: string, col: string) => {
    if (hasCol(db, table, col)) {
      db.exec(`alter table ${table} drop column ${col}`)
    }
  }
  drop('knock', 'acted_at')
  drop('knock', 'delivery')
  drop('knock', 'error')
  drop('wake', 'acted_at')
  drop('wake', 'error')
  drop('mail', 'acted_at')
  drop('mail', 'error')
  drop('stop_request', 'acted_at')
}

// The one id resolver: a token → its eid, across every read door (T-3684).
// Order is deliberate. A human number FIRST (`T-3` / bare `3`), so a small
// decimal is never shadowed by a hex handle. Then a full uuid, exact. Then a
// SHORT-eid handle — a 6–8 hex PREFIX of the uuid, matched on the PK as a
// sargable range (`eid >= p and eid < succ(p)`, succ = last char bumped), so
// it's an index seek not a scan; unique resolves, ambiguous THROWS naming the
// collision (git-style). Then an alias slug. A bare all-decimal token that is
// no known num falls THROUGH to short/slug, so a num-less entity whose handle
// reads decimal still resolves. undefined names nothing; the throw is only for
// an ambiguous prefix. Defined ahead of `open()` so the boot migration may
// lean on it without a TDZ trap.
let succ = (p: string) =>
  p.slice(0, -1) + String.fromCharCode(p.charCodeAt(p.length - 1) + 1)
export let resolveId = (
  db: DatabaseSync,
  id: string,
): string | undefined => {
  let numOf = (n: number) =>
    (prep(db, 'select eid from entity where num = ?').get(n) as
      | { eid: string }
      | undefined)?.eid
  let pre = id.match(/^[A-Za-z]+-(\d+)$/)
  if (pre) return numOf(+pre[1]) // a prefixed num is num-only
  let bare = id.match(/^(\d+)$/)
  if (bare) {
    let hit = numOf(+bare[1])
    if (hit) return hit // else fall through — a bare token may be a short eid
  }
  let low = id.toLowerCase()
  if (UUIDRE.test(id)) {
    let hit = (prep(db, 'select eid from entity where eid = ?').get(low) as
      | { eid: string }
      | undefined)?.eid
    if (hit) return hit
    // else fall through — a uuid with no SQL row may be a pass-through
    // entity's own (deterministic) eid, resolvable by a source below.
  }
  if (SHORT.test(id)) {
    let hits = prep(
      db,
      'select eid from entity where eid >= ? and eid < ? limit 2',
    ).all(low, succ(low)) as { eid: string }[]
    if (hits.length > 1) {
      throw new Error(
        `${id} is an ambiguous id — matches ${
          hits.map((h) => shortId(h.eid)).join(', ')
        } and more; use more characters`,
      )
    }
    if (hits.length == 1) return hits[0].eid
  }
  // Membership, not equality: a slug matches the primary or any word of the
  // space-delimited `slugs` set. instr on a space-padded column matches whole
  // tokens only ('task' never hits inside 'tasks'); the alias table is tiny,
  // so the scan is free.
  let alias = (prep(
    db,
    `select o.eid as eid from alias a join entity o on o.id = a.entity
     where a.slug = ?
       or instr(' ' || coalesce(a.slugs, '') || ' ', ' ' || ? || ' ') > 0`,
  ).get(id, id) as
    | { eid: string }
    | undefined)?.eid
  if (alias) return alias
  // Pass-through sources: an ephemeral entity resolvable by handle (or its own
  // deterministic eid). Consulted ONLY after every SQL lookup missed, so a
  // persisted/graduated entity never reaches here.
  if (hasSources()) return sourceResolve(id)?.[0]?.eid
  return undefined
}

// The write doors' reference resolver — resolveId under its old name, kept
// because the boot migration and apply()'s normalize both reach for it.
let ident = resolveId

// ident's inverse: eid → the human id every other door speaks (T-7) — the
// raw eid when there is none to speak. Every agent-facing message owes
// this. Inputs accept both spellings; outputs speak human, or a caller
// that typed `M-10276` is handed back an identifier it has no index for,
// at the one moment (a refusal) it most wants to open the entity.
// A tombstone keeps its num on its retained spine row (D-18866 — the id
// never recycles), so it is still named BY that num; only its components
// died, so kindOrder finds none and it wears the generic prefix rather
// than a kind-specific one. The raw-eid fallback is for an entity with no
// num at all (a numless cheap/bulk entity, or a numless old grave), never
// a demotion a death itself imposes.
export let human = (db: DatabaseSync, eid: string): string => {
  let row = prep(db, 'select num from entity where eid = ?').get(eid) as
    | { num: number }
    | undefined
  if (!row?.num) return shortId(eid)
  let kind = kindOrder.find((k) =>
    prep(
      db,
      `select 1 from ${sqlName(k)}
         where entity = (select id from entity where eid = ?)`,
    ).get(eid)
  ) ?? 'entity'
  return idOf({ eid, kind, num: row.num })
}

let ADDR = /@/
let UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let CONTENT_EID = /^[0-9a-f]{64}$/i

// The entity already wearing this address: an address-book `email`, or an
// id-shaped fleet address naming one by its human id (S-31@<fleet> → that
// session). Mirrors mail.ts wearer()/named() — inlined because mail.ts imports
// db.ts, and this is the pre-mint half of the same resolution: an address the
// graph already knows must NOT get a second entity minted for it (that would
// SHADOW the real one in homeOf).
let addressed = (db: DatabaseSync, addr: string): string | undefined => {
  let a = addr.trim()
  let worn = (prep(
    db,
    `select o.eid as eid from email e join entity o on o.id = e.entity
     where e.address = ? collate nocase`,
  )
    .get(a) as { eid: string } | undefined)?.eid
  if (worn) return worn
  let m = /^([A-Za-z]+-(\d+))$/i.exec(fleetLocal(a) ?? '')
  if (!m) return undefined
  let row = prep(db, 'select eid from entity where num = ?')
    .get(Number(m[2])) as { eid: string } | undefined
  return row && human(db, row.eid).toLowerCase() == m[1].toLowerCase()
    ? row.eid
    : undefined
}

// Find-or-mint the address-book entity wearing `addr` (D-14945): an external
// address IS an `email` entity, so `deliver.to` can always name one. Find
// dominates — the ventures and the owner already wear their addresses;
// minting is only the handful of external correspondents. Case-insensitive on
// the address so one entity answers every spelling. Direct spine+row write
// (not apply()), for the migration and for a probe that never boots effects;
// the apply() door mints THROUGH a change so a send gets provenance.
export let addressEntity = (db: DatabaseSync, addr: string): string => {
  // Store the canonical, deliverable spelling — a fleet address minted here
  // rides the same underscore-shedding rule as the wire write path, so the
  // direct-SQL door (migrations, probes) can never seed an undeliverable book
  // entry either. canon() leaves an external address untouched.
  addr = canon(addr)
  let found = addressed(db, addr)
  if (found) return found
  let a = addr.trim()
  let eid = uuid()
  spine(db, eid)
  prep(
    db,
    'insert into email (entity, address) values ((select id from entity where eid = ?), ?)',
  ).run(eid, a)
  mintNum(db, eid) // spine no longer numbers at birth (T-3684); email is numbered
  return eid
}

// D-14945 phase 2: the per-type recipient columns become the shared
// `deliver {to}`. knock/wake carried an eid (`to_eid`) — carry it straight.
// mail carried a `to` that is an eid, an @-address, an alias slug, or bare
// junk ('jeff', 'holdco', 'S-11310@<fleet>'); since `deliver.to` is
// strict-{eid}, resolve EVERY row or the wire would later refuse it — never
// drop one. The ladder: a valid eid stays; an @-address find-or-mints an
// `email` entity; else `ident()` (an alias/human-id/num); else the raw string
// becomes an address, minting an `email` for it. Runs BEFORE mendMail so a
// mail rebuild sees the trimmed shape; idempotent (insert-or-ignore on the
// deliver pk, each source column guarded by hasCol, dedup by address on mint).
export let migrateDeliver = (db: DatabaseSync) => {
  // The knock/wake/mail bodies below run ONLY on a legacy db that still carries
  // the pre-facet columns (to_eid / mail.to); after the eid→id reshape those
  // columns are long gone, so every hasCol guard is false and none of this SQL
  // compiles. The eid-shaped statements are correct for that legacy shape and
  // stay as they are.
  for (let table of ['knock', 'wake']) {
    if (!hasCol(db, table, 'to_eid')) continue
    db.exec(
      `insert or ignore into deliver (eid, "to")
         select eid, to_eid from ${table} where to_eid is not null`,
    )
    db.exec(`alter table ${table} drop column to_eid`)
  }
  if (hasCol(db, 'mail', 'to')) {
    let ins = prep(
      db,
      'insert or ignore into deliver (eid, "to") values (?, ?)',
    )
    let rows = prep(
      db,
      `select eid, "to", to_addr, received_at, sent_id from mail
         where "to" is not null and "to" != ''`,
    ).all() as {
      eid: string
      to: string
      to_addr: string | null
      received_at: string | null
      sent_id: string | null
    }[]
    for (let r of rows) {
      // An INBOUND letter is a record of arrival, not an outbound ask — its
      // recipient is the address it was delivered TO (to_addr), never a
      // deliver{to}. received_at is the arrival mark; sent_id null excludes an
      // echoed outbound, which also carries a received_at. Migrating an inbound
      // recipient into deliver{to} strands it: the inbox matches inbound by
      // to_addr, so it goes invisible (T-15110). Runtime already stamps to_addr
      // with no deliver — this keeps a fresh migration matching that.
      if (r.received_at != null && r.sent_id == null) {
        if (!r.to_addr) {
          prep(db, 'update mail set to_addr = ? where eid = ?')
            .run(r.to, r.eid)
        }
        continue
      }
      let raw = String(r.to)
      let ref = UUIDRE.test(raw)
        ? raw.toLowerCase()
        : ADDR.test(raw)
        ? addressEntity(db, raw)
        : ident(db, raw) ?? addressEntity(db, raw)
      ins.run(r.eid, ref)
    }
    db.exec('alter table mail drop column "to"')
  }
}

// T-17322: a project SHOULD BE its own main board. A board whose query is
// exactly a single `.project=<uuid>` is a whole-project mirror — redundant
// with the project it names. Give that project the board comp, repoint every
// card/fold that viewed the board onto the project, then bury the board. A
// board with ANY other predicate is a real filtered view and is left alone.
// Raw SQL, not apply(): this runs from open() during module evaluation, before
// apply() is initialized (the other migrations use raw SQL for the same
// reason). Cards are repointed FIRST, so the board has no cascade victims when
// it is buried — the same reaper shape (drop every comp row, sever edges, keep
// the num in the grave). Idempotent: a project already carrying a board comp is
// skipped, so once every mirror is folded in a re-run finds nothing (this also
// skips P-19, already board+project via `.project=<own eid>`).
export let migrateBoardsToProjects = (db: DatabaseSync) => {
  let boards = prep(
    db,
    'select o.eid as eid, query from board b join entity o on o.id = b.entity',
  ).all() as {
    eid: string
    query: string | null
  }[]
  let now = new Date().toISOString()
  atomic(db, () => {
    for (let { eid, query } of boards) {
      if (!query) continue
      let preds
      try {
        preds = parseQuery(query)
      } catch {
        continue // an unparseable query is not a clean project mirror
      }
      if (preds.length != 1) continue
      let p = preds[0]
      // op '' is equality (query.ts OPS['=']); a list/range value or a deref
      // path is not a single whole-project mirror.
      if (p.comp != 'task' || p.prop != 'project' || p.op != '' || !p.value) {
        continue
      }
      if (p.at || p.value.includes(',')) continue
      let project = p.value
      let pid = toId(db, project)
      let bid = toId(db, eid)
      if (
        !pid ||
        !prep(db, 'select 1 from project where entity = ?').get(pid)
      ) {
        continue
      }
      if (prep(db, 'select 1 from board where entity = ?').get(pid)) continue
      // (1) the project becomes the board
      prep(db, 'insert into board (entity, query) values (?, ?)')
        .run(pid, query)
      // (2) repoint every view BEFORE the bury, so nothing cascades
      prep(db, 'update card set target = ? where target = ?')
        .run(pid, bid)
      prep(db, 'update fold set board = ? where board = ?').run(pid, bid)
      // (3) bury the now-unreferenced board — the reaper's shape, spine
      // RETAINED (D-18866): a tombstone marks it dead, the id never recycles.
      for (let c of Object.keys(comps)) {
        prep(db, `delete from ${sqlName(c)} where entity = ?`).run(bid)
      }
      prep(db, 'delete from dependency where parent = ? or child = ?')
        .run(bid, bid)
      prep(
        db,
        `insert or ignore into tombstone (eid, num, deleted_at)
         values (?, (select num from entity where eid = ?), ?)`,
      ).run(eid, eid, now)
    }
  })
}

// The heal for the graphs migrateDeliver already stranded before the split
// above existed (T-15110): every inbound letter migrated then wears a
// deliver{to} naming the venue it ARRIVED at, with to_addr empty — invisible
// to the inbox, which matches inbound by to_addr, while the runtime stamps
// to_addr with no deliver. So migrated history disagreed with live behaviour.
// For each such inbound mail (received_at set, sent_id null so an echo is
// excluded) whose to_addr is empty but which wears a deliver{to} resolving to
// an address, set to_addr from that address and drop the stray deliver row.
// Guarded by the data shape — no-ops the moment every stranded row is mended,
// the mendMail/backfillOpened idiom.
export let healInboundDeliver = (db: DatabaseSync) => {
  let rows = prep(
    db,
    `select mo.eid as eid, em.address as address from mail m
       join deliver d on d.entity = m.entity
       join email em on em.entity = d."to"
       join entity mo on mo.id = m.entity
     where m.received_at is not null and m.sent_id is null
       and (m.to_addr is null or m.to_addr = '')`,
  ).all() as { eid: string; address: string }[]
  for (let { eid, address } of rows) {
    prep(
      db,
      'update mail set to_addr = ? where entity = (select id from entity where eid = ?)',
    ).run(address, eid)
    prep(
      db,
      'delete from deliver where entity = (select id from entity where eid = ?)',
    ).run(eid)
  }
}

// A pre-normalize apply() rule (D-14945): a wire-written `deliver.to` bearing
// an @ is an external address, not an eid the parser would resolve — turn it
// into its address-book entity (find-or-mint) and inject that entity's mint so
// the reference lands with provenance. knock/wake never carry an @, so this
// only ever touches outbound mail. Deduped within the batch so two letters to
// one new address mint it once.
let mintAddresses = (db: DatabaseSync, changes: Change[]): Change[] => {
  let mints: Change[] = []
  let seen = new Map<string, string>()
  let resolve = (addr: string): string => {
    // Canonicalize a fleet address before the dedup lookup AND the mint, so
    // an underscore spelling finds the canonical book entry (not a shadow of
    // it) and a fresh mint is born deliverable (canon() no-ops off-domain).
    let a = canon(addr.trim())
    let key = a.toLowerCase()
    let hit = seen.get(key)
    if (hit) return hit
    let eid = addressed(db, a)
    if (!eid) {
      eid = uuid()
      mints.push({ eid, name: 'email', comp: { address: a } })
    }
    seen.set(key, eid)
    return eid
  }
  let out = changes.map((c) =>
    c.name == 'deliver' && c.comp && typeof c.comp.to == 'string' &&
      ADDR.test(c.comp.to)
      ? { ...c, comp: { ...c.comp, to: resolve(c.comp.to) } }
      : c
  )
  return mints.length ? [...mints, ...out] : out
}

// A pre-normalize apply() rule: the address book stores only the DELIVERABLE
// spelling of a fleet address. An `email.address` write is canonicalized here
// (lowercase, underscores shed) so a book entry Cloudflare would bounce at
// RCPT can never be stored in the first place — the doctor's mail check then
// has nothing to find. Off-domain addresses (the owner's own, a customer's)
// pass untouched. Complements mintAddresses, which canons the addresses it
// mints; this one covers the direct address-book write (a venture, a person).
let canonEmail = (changes: Change[]): Change[] =>
  changes.map((c) =>
    c.name == 'email' && c.comp && typeof c.comp.address == 'string'
      ? { ...c, comp: { ...c.comp, address: canon(c.comp.address) } }
      : c
  )

let sqlName = (name: string) => `"${name.replaceAll('"', '""')}"`

// Stored values pass through the same language as incoming values. Invalid
// cells stay visible for a deliberate repair; guessing would erase evidence.
export let healStored = (db: DatabaseSync) => {
  let fixes: {
    table: string
    col: string
    eid: string
    value: string | number | null
  }[] = []
  let invalid = 0
  let tables = [...new Set([...Object.keys(comps), ...Object.keys(stamped)])]
  for (let table of tables) {
    let declared = { ...comps[table], ...stamped[table] }
    let info = prep(
      db,
      'select name, "notnull" as required from pragma_table_info(?)',
    ).all(table) as { name: string; required: number }[]
    for (let [col] of Object.entries(declared)) {
      let required = info.find((c) => c.name == col)?.required
      let prop = propAt(table, col)
      if (!prop || required == null) {
        throw new Error(`declared column missing: ${table}.${col}`)
      }
      // A reference column stores an int id that is FK-valid by construction —
      // there is nothing malformed to heal, and validating an int against the
      // eid grammar would wrongly flag it. Skip references; heal only the
      // scalar vocabulary (enums, times, numbers, urls).
      if (isRef(table, col)) continue
      // The `entity` spine is eid-native (eid, num are real columns); every
      // other table owns through the int `entity` key and projects its eid.
      let rows = prep(
        db,
        table == 'entity'
          ? `select eid, ${sqlName(col)} as value from entity
             where ${sqlName(col)} is not null`
          : table == 'doc' && col == 'body'
          ? `select o.eid as eid, t.body as value from doc_value t
             join entity o on o.id = t.entity`
          : `select o.eid as eid, t.${sqlName(col)} as value from ${
            sqlName(table)
          } t
           join entity o on o.id = t.entity
           where t.${sqlName(col)} is not null`,
      ).all() as { eid: string; value: unknown }[]
      for (let { eid, value } of rows) {
        try {
          let parsed = parseProp(prop, value)
          if (parsed == null && required) {
            throw new Error(`${prop.name} is required — got '${value}'`)
          }
          if (!Object.is(parsed, value)) {
            fixes.push({ table, col, eid, value: parsed })
          }
        } catch (e) {
          invalid++
          console.warn(`heal: ${eid} ${(e as Error).message}`)
        }
      }
    }
  }
  if (!fixes.length) return { changed: 0, invalid }
  atomic(db, () => {
    for (let fix of fixes) {
      if (fix.table == 'doc' && fix.col == 'body') {
        prep(
          db,
          'update doc set body = ? where entity = (select id from entity where eid = ?)',
        ).run(textBlob(db, String(fix.value ?? '')), fix.eid)
        continue
      }
      prep(
        db,
        fix.table == 'entity'
          ? `update entity set ${sqlName(fix.col)} = ? where eid = ?`
          : `update ${sqlName(fix.table)} set ${
            sqlName(fix.col)
          } = ? where entity = (select id from entity where eid = ?)`,
      ).run(fix.value, fix.eid)
    }
  })
  return { changed: fixes.length, invalid }
}

// The eid↔id boundary (D-18866). Storage keys every entity by an internal
// integer `id`; the wire, snapshot(), apply() and every reader speak permanent
// EIDs. These resolve across the seam: an inbound eid to its spine id (null when
// unknown — a reference to an entity this graph never minted), an id back to its
// eid, and a reference VALUE (eid or null) to the int id stored for it — an
// unknown target resolves to null, which a NOT NULL / FK reference bounces on
// the same way a missing eid bounced the old text FK.
let toId = (db: DatabaseSync, eid: string): number | null =>
  (prep(db, 'select id from entity where eid = ?').get(eid) as
    | { id: number }
    | undefined)?.id ?? null
let refId = (db: DatabaseSync, v: unknown): number | null =>
  v == null ? null : toId(db, String(v))

// Resolve a wire reference's eid to the target's stored int id, REFUSING a write
// to a target that isn't there. A null passes through (a detached/absent ref).
// A non-null eid must name a LIVE entity: apply()'s pre-mint pass has already
// minted every entity this batch writes, so an eid that still has no spine is a
// genuine ghost, and a retained tombstone spine (D-18866 never deletes the row)
// is a dead target a new reference must not point at — either is the refusal the
// old entity(eid) FK gave before an unknown eid could collapse to null and land
// unnoticed. Death-time cascades (detach/release/keep) still let an EXISTING
// reference outlive its target; this guards the write, not the grave.
let refToId = (
  db: DatabaseSync,
  name: string,
  owner: string,
  col: string,
  v: unknown,
): number | null => {
  if (v == null) return null
  let eid = String(v)
  let id = toId(db, eid)
  let gone = prep(db, 'select 1 from tombstone where eid = ?').get(eid)
  if (id == null || gone) {
    throw new Error(
      `${name} ${human(db, owner)} refused: ${col} → ${human(db, eid)} (${
        gone ? 'tombstoned' : 'no such entity'
      })`,
    )
  }
  return id
}

// The WHERE fragment that matches a component row by its OWNER's eid. A
// component table is keyed by the owner's internal int id now (D-18866), so a
// consumer that used `where eid = ?` becomes `where ${byEid}`, its bound eid
// param unchanged — the correlated lookup does the eid→id hop in SQL. Only for
// the per-component tables; the `entity` spine keeps its real `eid` column.
let byEid = `entity = (select id from entity where eid = ?)`

// Project a stored REFERENCE column (an int id since D-18866) back to the eid
// its reader expects, inside a raw SELECT that can't ride select()'s projection:
// `select ${refEid('client.actor')} as actor from client`. A null id (detached
// ref) projects to null, the same absence the eid column used to carry.
let refEid = (col: string) => `(select eid from entity where id = ${col})`

let tableExists = (db: DatabaseSync, t: string) =>
  !!prep(db, `select 1 from sqlite_master where type = 'table' and name = ?`)
    .get(t)

// The graph tables the eid→id reshape reshapes (D-18866): the spine, the edge
// table, and every component table. The eid-keyed log/derived tables (journal,
// journal_touch, tool_call, embedding, the FTS shadows) and the eid-keyed
// tombstone stay as they are — D-18866 keeps the journal on eids (T-18878), and
// the rest are non-graph or rebuild themselves.
let graphTables = () => ['entity', 'dependency', ...Object.keys(comps)]

// What one table's copy CLEANED — the anomalies a real legacy graph carries
// that the eid-keyed readers tolerated but the constraint-tight id-keyed schema
// rejects (D-18866, T-18874). Each is dead or detached data, handled
// deterministically and REPORTED (never silent — M-16612):
//  - orphans: component rows whose owner eid has no spine row — already
//    unreachable, so skipped.
//  - dropped: rows with a NOT NULL reference to a deleted entity (conflict.target,
//    result.call, a dangling dependency edge) — the row is ABOUT a corpse and has
//    no valid id to carry, so the whole row goes.
//  - nulled: NULLABLE references to a deleted entity — detached to null, the same
//    absence an eid-keyed reader already saw through the missing join.
type CopyReport = {
  table: string
  orphans: number
  dropped: Record<string, number>
  nulled: Record<string, number>
}

// Does an eid-bearing legacy column resolve to a live spine id? Parenthesized so
// `not resolves(c)` reads as "does not resolve" regardless of operator precedence.
let resolves = (col: string) =>
  `((select id from entity where eid = o.${sqlName(col)}) is not null)`

// Copy one renamed-aside legacy table's rows into its fresh id-keyed twin,
// resolving every eid to its int id: the owner `eid`→`entity`, each `{eid}`
// reference (and dependency's parent/child) to the referent's id, plain scalars
// straight across. A fresh column the legacy table predates takes its default.
// Real-data anomalies are cleaned per the policy above and returned as counts;
// the INSERT only carries rows whose owner and every NOT NULL reference resolve.
let copyLegacyTable = (
  db: DatabaseSync,
  t: string,
  old: string,
): CopyReport => {
  let oldCols = new Set(colNames(db, old))
  let notnull = new Map(
    (prep(db, 'select name, "notnull" as nn from pragma_table_info(?)')
      .all(t) as { name: string; nn: number }[]).map((r) => [r.name, !!r.nn]),
  )
  let dst: string[] = []
  let src: string[] = []
  let hasOwner = false
  let refs: { col: string; required: boolean }[] = []
  for (let c of colNames(db, t)) {
    let depRef = t == 'dependency' && (c == 'parent' || c == 'child')
    if (c == 'entity') {
      if (!oldCols.has('eid')) continue
      hasOwner = true
      dst.push('entity')
      src.push('(select id from entity where eid = o.eid)')
    } else if (!oldCols.has(c)) {
      continue
    } else if (isRef(t, c) || depRef) {
      refs.push({ col: c, required: !!notnull.get(c) })
      dst.push(sqlName(c))
      src.push(`(select id from entity where eid = o.${sqlName(c)})`)
    } else {
      dst.push(sqlName(c))
      src.push(`o.${sqlName(c)}`)
    }
  }
  let count = (where: string) =>
    (prep(db, `select count(*) as n from ${sqlName(old)} o where ${where}`)
      .get() as { n: number }).n
  let report: CopyReport = { table: t, orphans: 0, dropped: {}, nulled: {} }
  // A row survives when its owner resolves AND every NOT NULL reference resolves;
  // `keep` accumulates those predicates and the INSERT filters by their AND.
  let keep: string[] = []
  if (hasOwner) {
    report.orphans = count(`not ${resolves('eid')}`)
    keep.push(resolves('eid'))
  }
  let ownerOk = hasOwner ? `${resolves('eid')} and ` : ''
  for (let { col } of refs.filter((r) => r.required)) {
    // Among owner-resolved rows (orphans already counted), a NOT NULL ref that
    // points at a corpse — drop the row.
    report.dropped[col] = count(`${ownerOk}not ${resolves(col)}`)
    keep.push(resolves(col))
  }
  for (let { col } of refs.filter((r) => !r.required)) {
    // Among rows that survive, a present nullable ref that doesn't resolve is
    // detached to null.
    let kept = keep.length ? `${keep.join(' and ')} and ` : ''
    report.nulled[col] = count(
      `${kept}o.${sqlName(col)} is not null and not ${resolves(col)}`,
    )
  }
  let where = keep.length ? ` where ${keep.join(' and ')}` : ''
  db.exec(
    `insert into ${sqlName(t)} (${dst.join(', ')})
     select ${src.join(', ')} from ${sqlName(old)} o${where}`,
  )
  return report
}

// Announce what the reshape cleaned — one stderr line per non-zero anomaly class
// per table, so the cutover operator (and the session row's stderr tail) sees
// exactly which dead or detached rows the migration removed or nulled. A clean
// graph prints nothing; silence here would be the opaque migration M-16612 forbids.
let reportMigration = (reports: CopyReport[]) => {
  let orphans = 0, dropped = 0, nulled = 0
  for (let r of reports) {
    if (r.orphans) {
      orphans += r.orphans
      console.error(
        `migrate: ${r.table} — skipped ${r.orphans} orphan row(s) (owner eid has no spine)`,
      )
    }
    for (let [col, n] of Object.entries(r.dropped)) {
      if (!n) continue
      dropped += n
      console.error(
        `migrate: ${r.table}.${col} — dropped ${n} row(s) referencing a deleted entity (NOT NULL)`,
      )
    }
    for (let [col, n] of Object.entries(r.nulled)) {
      if (!n) continue
      nulled += n
      console.error(
        `migrate: ${r.table}.${col} — nulled ${n} dangling reference(s)`,
      )
    }
  }
  if (orphans || dropped || nulled) {
    console.error(
      `migrate: eid→id reshape cleaned ${orphans} orphan row(s), ` +
        `${dropped} dropped row(s), ${nulled} nulled reference(s)`,
    )
  }
}

// The legacy eid→id migration (D-18866; the boot step the T-18883 cutover
// rehearses). A db is legacy when its spine is still keyed by eid — no `id`
// column. Reshape every graph table to the CANONICAL id-keyed shape (owner
// `entity` int, references int), preserving the wire exactly: each entity keeps
// its eid and takes a stable int id (its former rowid), every stored reference
// resolves through those eids. A fresh scratch db hands us the exact target DDL
// for each table (constraints and all), so the reshape reuses the one schema
// definition rather than reconstructing it. One transaction, FK-deferred until
// the whole graph is remapped, then foreign_key_check proves no reference was
// left dangling. Idempotent: an id-keyed (or brand-new) db returns at the door.
let migrateToIdKeys = (db: DatabaseSync) => {
  if (!tableExists(db, 'entity') || hasCol(db, 'entity', 'id')) return []
  let scratch = open(':memory:')
  let ddlOf = (t: string) =>
    (scratch.prepare(
      `select sql from sqlite_master where type = 'table' and name = ?`,
    ).get(t) as { sql: string }).sql
  let reports: CopyReport[]
  try {
    reports = atomic(db, () => {
      // The spine first, so every reference below resolves against real ids.
      db.exec('alter table entity rename to __mig_entity')
      db.exec(ddlOf('entity'))
      db.exec(
        'insert into entity (id, eid, num) select rowid, eid, num from __mig_entity',
      )
      db.exec('drop table __mig_entity')
      // D-18866 fidelity: a pre-flip death lives ONLY in `tombstone` — deletion
      // removed its `entity` row — so seeding the spine from the old entity table
      // alone leaves every old-tombstoned eid with no id. copyLegacyTable would
      // then NULL each nullable reference history still holds to such an eid, and
      // DROP the whole row for a NOT NULL one — losing journal/provenance/contention
      // records D-18866 keeps valid, and baking a two-representation split (old
      // deaths eid-only, post-cutover deaths spine-retained). Carry every tombstone
      // eid into the spine as a RETAINED row instead: a fresh id STRICTLY above the
      // live max (num never recycles, so no id collision), its grave `num` kept.
      // A dead entity now has BOTH a spine row and a tombstone row — exactly the
      // go-forward representation apply() maintains (T-18878). The `tombstone` table
      // is untouched (never in graphTables, so the copy loop below skips it), so
      // refToId still refuses writes AT these graves by reading it directly — history
      // resolves without any grave becoming writable. Guarded for a legacy db that
      // predates the tombstone table or its num column.
      if (tableExists(db, 'tombstone')) {
        let tnum = hasCol(db, 'tombstone', 'num') ? 'num' : 'null'
        db.exec(
          `insert into entity (id, eid, num)
             select (select coalesce(max(id), 0) from entity)
                      + row_number() over (order by eid),
                    eid, ${tnum}
               from tombstone
              where eid not in (select eid from entity)`,
        )
      }
      let reports: CopyReport[] = []
      for (let t of graphTables()) {
        if (t == 'entity' || !tableExists(db, t)) continue
        db.exec(`alter table ${sqlName(t)} rename to __mig_${t}`)
        db.exec(ddlOf(t))
        reports.push(copyLegacyTable(db, t, `__mig_${t}`))
        db.exec(`drop table __mig_${t}`)
      }
      return reports
    })
  } catch (e) {
    scratch.close()
    throw e
  }
  scratch.close()
  let orphans = db.prepare('pragma foreign_key_check').all()
  if (orphans.length) {
    throw new Error(
      `eid→id migration left ${orphans.length} dangling reference(s)`,
    )
  }
  return reports
}

// The attachment table used to own both per-use metadata and the content
// address. Split it once: each distinct SHA becomes the eid of one blob entity,
// attachments point to it, and intrinsic image dimensions move to that shared
// content. This runs after eid→id, so every reference is born in final form.
let migrateBlobEntities = (db: DatabaseSync) => {
  if (!tableExists(db, 'blob') || !hasCol(db, 'blob', 'sha')) return
  let invalid = prep(
    db,
    `select count(*) n from blob
     where sha is null or length(sha) != 64
        or lower(sha) glob '*[^0-9a-f]*'`,
  ).get() as { n: number }
  if (invalid.n) {
    throw new Error(
      `cannot migrate ${invalid.n} blob row(s) without SHA-256 content identity`,
    )
  }
  db.exec('savepoint blob_entities')
  try {
    db.exec(`
      drop index if exists blob_sha;
      alter table blob rename to __legacy_blob;
      create table blob (
        entity integer primary key references entity(id),
        bytes integer
      );
      create table if not exists attachment (
        entity integer primary key references entity(id),
        blob integer not null references entity(id),
        mime text,
        name text
      );
      create table if not exists image (
        entity integer primary key references blob(entity),
        w integer,
        h integer
      );
      insert or ignore into entity (eid)
        select distinct lower(sha) from __legacy_blob;
      insert into blob (entity, bytes)
        select e.id, max(b.bytes) from __legacy_blob b
        join entity e on e.eid = lower(b.sha)
        group by e.id;
      insert into attachment (entity, blob, mime, name)
        select b.entity, e.id, b.mime, b.name from __legacy_blob b
        join entity e on e.eid = lower(b.sha);
      insert into image (entity, w, h)
        select e.id, max(b.w), max(b.h) from __legacy_blob b
        join entity e on e.eid = lower(b.sha)
        where b.w is not null or b.h is not null
        group by e.id;
      drop table __legacy_blob;
    `)
    db.exec('release blob_entities')
  } catch (e) {
    db.exec('rollback to blob_entities')
    db.exec('release blob_entities')
    throw e
  }
}

// doc.body is a wire value and a storage reference. Move legacy inline text to
// the internal blob backend atomically, keeping doc's owner rowids stable so
// every component/reference join still addresses the same entity. FTS/gram are
// derived and are rebuilt from the resolved projection by the current schema.
let migrateDocBodies = (db: DatabaseSync) => {
  if (!tableExists(db, 'doc') || !hasCol(db, 'doc', 'body')) return
  let col = prep(
    db,
    `select lower(type) as type from pragma_table_info('doc') where name = 'body'`,
  ).get() as { type: string } | undefined
  if (col?.type == 'integer') return
  db.exec('savepoint doc_bodies')
  try {
    db.exec(`
      drop trigger if exists doc_ai;
      drop trigger if exists doc_ad;
      drop trigger if exists doc_au;
      drop trigger if exists doc_fts_ai;
      drop trigger if exists doc_fts_ad;
      drop trigger if exists doc_fts_au;
      drop trigger if exists doc_gram_ai;
      drop trigger if exists doc_gram_ad;
      drop trigger if exists doc_gram_au;
      drop table if exists doc_fts;
      drop table if exists doc_gram;
      drop view if exists doc_value;
      create table if not exists blob (
        entity integer primary key references entity(id),
        bytes integer
      );
      create table if not exists blob_text (
        entity integer primary key references blob(entity),
        value text not null
      );
      alter table doc rename to __legacy_doc;
      create table doc (
        entity integer primary key references entity(id),
        title text not null,
        body integer not null references blob(entity)
      );
    `)
    let rows = prep(
      db,
      'select entity, title, body from __legacy_doc order by entity',
    )
      .all() as { entity: number; title: string; body: string }[]
    let put = prep(db, 'insert into doc (entity, title, body) values (?, ?, ?)')
    for (let row of rows) put.run(row.entity, row.title, textBlob(db, row.body))
    db.exec(`
      drop table __legacy_doc;
      create view doc_value as
        select d.entity as rowid, d.entity, d.title, b.value as body
        from doc d join blob_text b on b.entity = d.body;
      release doc_bodies;
    `)
  } catch (e) {
    db.exec('rollback to doc_bodies')
    db.exec('release doc_bodies')
    throw e
  }
}

// A WAL-present boot follows a crash or overlaps another healthy connection,
// so verify the complete SQLite view before migrations write anything. A
// failed check is never repaired in place: WAL and SHM are live parts of the
// database, and renaming either behind an open connection creates two WAL
// generations. Recovery is an offline operation over a preserved copy of the
// database/WAL/SHM set.
let exists = (p: string) => {
  try {
    Deno.statSync(p)
    return true
  } catch {
    return false
  }
}
let probe = (db: DatabaseSync) => {
  let row = db.prepare('pragma quick_check(1)').get() as Record<string, string>
  let verdict = row?.quick_check ?? Object.values(row ?? {})[0]
  if (verdict != 'ok') throw new Error(`quick_check: ${verdict}`)
}
let verifyWal = (db: DatabaseSync, path: string): DatabaseSync => {
  if (path == ':memory:' || !exists(`${path}-wal`)) return db
  try {
    probe(db)
    return db
  } catch (e) {
    throw new Error(
      `SQLite integrity check failed for ${path} while ${path}-wal exists: ` +
        `${e}. Startup stopped without copying, renaming, or deleting the ` +
        `database, WAL, or SHM files. Stop every process using this graph, ` +
        `preserve the three files as one set, and diagnose or recover an ` +
        `offline copy.`,
      { cause: e },
    )
  }
}

// Connect without migration. open() composes this with migrate(); read-only
// consumers use connect() directly.
// The app-plane-only boot switch (TASKS_PLANE=app, D-22804 §8 strangler). When
// set, this Deno process opens the graph read-only and forwards writes. This is
// retained for disposable parity copies; live_db.ts refuses it on owner data.
export let appPlane = () => Deno.env.get('TASKS_PLANE') == 'app'

// The data-plane writer's HTTP base URL (TASKS_WRITER_URL) — the Deno→bridge
// direction of the strangler write-proxy (T-22927), the mirror of the bridge's
// own --upstream/TASKS_UPSTREAM Deno target. In TASKS_PLANE=app the mutating
// doors forward the write here (the Rust bridge) and relay its
// answer, instead of refusing it (503). Absent, they still refuse rather than
// guess a server — a wrong guess (this reader's own 5173) would proxy every
// write straight back into the read-only process it came from. Read at the door,
// not cached, so a probe can point a fresh reader at a fresh bridge per boot.
export let writerUrl = () =>
  Deno.env.get('TASKS_WRITER_URL')?.replace(/\/+$/, '') || undefined

export let connect = (path = file, vector = false, readOnly = false) => {
  // A test must NEVER open the owner's live graph. Under `deno test` the main
  // module is always a *_test.ts file; reaching the live path there means a
  // caller forgot DB_PATH (the `test` task sets :memory:). Refuse before we
  // mkdir/migrate/lock it — loudly, so the next module-scope import that would
  // reintroduce this footgun fails at the door instead of quietly reseeding
  // the owner's board (T-14260).
  if (
    Deno.mainModule.endsWith('_test.ts') &&
    sameGraphFile(path, liveDb())
  ) {
    throw new Error(
      `refusing to open the live graph (${path}) under a test — set DB_PATH`,
    )
  }
  Deno.mkdirSync(dirname(path), { recursive: true })
  // readOnly (the app-plane reader, appPlane()): writing is made impossible at
  // the SQLite layer, not merely avoided per-door.
  let db = verifyWal(new DatabaseSync(path, { readOnly }), path)
  // The vector extension is OPT-IN, because it is write-capable and connect()
  // is the LIBRARY door (D-22530: such an extension loads only in the
  // distribution that owns its write). Loading it here handed one to every
  // consumer — the CLI's read arm, a probe, any future library client — and it
  // is what put a native writer in a second process (T-22622). Only
  // live_db.ts, the server-side handle, asks for it.
  if (vector) loadVector(db)
  // Connection-local settings only: busy_timeout and synchronous both live in
  // the connection; the persistent journal-mode setting stays in migrate().
  db.exec('pragma busy_timeout = 5000')
  // Durability is tunable for throwaway graphs (TASKS_SYNC, like TASKS_BACKOFF):
  // the default (unset) leaves SQLite's own `full`, which fsyncs every DDL
  // statement — and migrate() runs ~200 of them (schema + migrations), so a
  // fresh file on real disk costs ~2s. A test graph is ephemeral and never
  // survives a crash, so the test task sets `off` and every file-backed open
  // drops from ~2s to ~10ms. Production never sets it and stays fully durable.
  let sync = Deno.env.get('TASKS_SYNC')
  // Durability is a writer's concern; a read-only handle never fsyncs, so skip
  // the pragma rather than run a connection setting a reader has no use for.
  if (sync && !readOnly) db.exec(`pragma synchronous = ${sync}`)
  return db
}

// Mint the durable sync epoch (T-20299) if absent — the cursor-lineage identity
// a delta client checks (epochOf). This write runs once in transactional
// migrate(), never on a read path. `insert or ignore` makes it idempotent — a no-op on a graph
// that already carries the row, so a re-open writes nothing.
export let mintEpoch = (db: DatabaseSync) =>
  db.exec(
    `insert or ignore into server_meta (k, v) values ('epoch', '${crypto.randomUUID()}')`,
  )

// Bumped with every serving-schema change. Guards remain idempotent for
// expand/contract upgrades; the version makes a newer database fail closed in
// an older binary instead of letting that binary infer compatibility.
let schemaVersion = 1

// Migrate a connected handle in place: the eid→id reshape, ref migration, the
// hand + derived schema, the additive column/index fills, and the vector index.
// The schema work runs under one BEGIN IMMEDIATE and is idempotent: concurrent
// openers serialize in SQLite, and a waiter rechecks every guard after the
// winner commits. Returns the same handle for the one-line open() below.
export let migrate = (db: DatabaseSync) => {
  // Migrations ALTER tables; a cached statement would strand against an
  // intermediate schema. Compile raw until the schema is final, then restore.
  let wasCaching = caching
  caching = false
  // The legacy reshape rebuilds tables whose old foreign keys name the old
  // spine. This pragma must be set before BEGIN; SQLite deliberately ignores
  // foreign_keys changes inside a transaction. Every other migration keeps FK
  // enforcement enabled.
  let legacy = tableExists(db, 'entity') && !hasCol(db, 'entity', 'id')
  if (legacy) db.exec('pragma foreign_keys = off')
  try {
    // WAL lets readers proceed during a write, removing the reader/writer
    // blocking of the default rollback journal. The fleet supports many
    // ordinary read-write connections; SQLite serializes their write
    // transactions. Unconditional since T-19444 (validated live via T-13905); an
    // in-memory db answers `memory` and stays there — that is its only mode,
    // not a failure. WAL's -wal/-shm sidecars are gitignored, and bin/backup's
    // VACUUM INTO reads a consistent snapshot under WAL unchanged. Setting
    // synchronous = normal is WAL's crash-safe pairing (a checkpoint still
    // fsyncs), unless TASKS_SYNC already named a mode.
    //
    // This persistent setting lives in migrate(), never connect(). SQLite
    // serializes the header change with every other connection.
    {
      let got = (db.prepare('pragma journal_mode = wal').get() as
        | { journal_mode: string }
        | undefined)?.journal_mode
      if (got == 'wal') {
        if (!Deno.env.get('TASKS_SYNC')) db.exec('pragma synchronous = normal')
      } else if (got != 'memory') {
        console.warn(`journal_mode is ${got}, not wal`)
      }
    }
    let reports: CopyReport[] = []
    let migrated = atomic(db, () => {
      // One SQLite transaction owns the schema transition. Concurrent openers
      // wait at BEGIN IMMEDIATE, then re-run the idempotent guards against the
      // schema the winner committed; no application sidecar lock is involved.
      // The version check belongs after that wait: reading it before BEGIN lets
      // an older waiter overwrite a newer migrator's version after it commits.
      let stored = (db.prepare('pragma user_version').get() as {
        user_version: number
      }).user_version
      if (stored > schemaVersion) {
        throw new Error(
          `database schema version ${stored} is newer than this binary's ` +
            `version ${schemaVersion}; upgrade the serving process`,
        )
      }
      // The eid→id storage reshape (D-18866) runs FIRST: it reshapes an
      // eid-keyed legacy graph to the canonical id-keyed spine every statement
      // below assumes, so migrateRefs/schema/the backfills all see id-keyed
      // tables. Its focused atomic boundary becomes a savepoint inside this
      // transaction. A no-op on an already-id-keyed or brand-new db.
      reports = migrateToIdKeys(db)
      // Split the legacy blob table into content/attachment/image entities,
      // minting each distinct SHA as a blob entity's eid. Runs after eid→id so
      // every reference is born on the canonical id-keyed spine.
      migrateBlobEntities(db)
      // Move legacy inline doc bodies to the internal blob text backend, so
      // doc.body becomes a content-addressed reference. FTS/gram are rebuilt
      // from the resolved projection by the schema below.
      migrateDocBodies(db)
      // This must precede schema: an old table may not yet have the canonical
      // columns named by a newly added index in the current DDL.
      migrateRefs(db)
      migratePrompt(db)
      db.exec(schema)
      let addCol = (table: string, col: string, ddl: string) => {
        if (!hasCol(db, table, col)) {
          db.exec(`alter table ${table} add column ${ddl}`)
        }
      }
      // The mirror of addCol, for a column whose mechanism is gone. A retired
      // column that lingers still answers a schema read, so it keeps teaching a
      // mechanism the code no longer has — the drop is what makes removal true.
      let dropCol = (table: string, col: string) => {
        if (hasCol(db, table, col)) {
          db.exec(`alter table ${table} drop column ${col}`)
        }
      }
      // Retire an index whose name the derivation no longer spells — a hand-written
      // `create index` line that has been superseded by its derived twin under a
      // different name (subscription_one → subscription_actor_target). Guarded, so
      // it runs once and a fresh db (which never had the legacy name) is a no-op.
      let dropIdx = (name: string) => {
        db.exec(`drop index if exists ${name}`)
      }
      // The DERIVED component tables (T-12764), planted beside the hand-written
      // `schema` above from the same vocabulary `cmps`/`readable` read. Tables
      // first — a fresh db gets them; then the additive column fill, the SAME alter
      // path addCol runs for the hand tables, so a live db that predates a
      // vocabulary edit grows the new column in place; then the indexes, which may
      // name a column that fill just added. `migrateDelivery`/`migrateErrors` below
      // pour into deliver/delivered/error, so those tables must already stand here.
      for (let comp of derived) db.exec(tableDdl(comp) + ';')
      for (let comp of derived) {
        for (let { prop, ddl } of derivedCols(comp)) addCol(comp, prop, ddl)
      }
      // Favorite predates its clock. The insertion moment is unavailable for
      // rows already standing, so preserve their relative age with the entity's
      // creation stamp; anonymous legacy rows fall back to migration time.
      db.exec(
        `update favorite set at = coalesce(
        (select at from created where created.entity = favorite.entity),
        strftime('%Y-%m-%dT%H:%M:%fZ','now')
      ) where at is null`,
      )
      // num is a UI label, not identity (T-3684): a cheap/bulk entity (T-3683)
      // needs none, so the spine's num goes NULLABLE. One in-place ALTER on SQLite
      // 3.53+ (ALTER COLUMN landed in 3.53.0), guarded on the notnull flag so it
      // runs once. UNIQUE stays — SQLite treats NULLs as distinct, so num-less
      // entities coexist. No rebuild, no backfill: existing nums are untouched.
      if (
        (prep(
          db,
          `select "notnull" as nn from pragma_table_info('entity') where name = 'num'`,
        ).get() as { nn: number } | undefined)?.nn
      ) {
        db.exec('alter table entity alter column num drop not null')
      }
      // Retired by per-item human notification state; agents derive attention
      // from claims and transcript references instead of this session cursor.
      dropCol('session', 'acked_at')
      addCol('task', 'project', 'project integer references entity(id)')
      addCol('task', 'assignee', 'assignee integer references entity(id)')
      addCol('task', 'domain', 'domain text')
      addCol('repo', 'url', 'url text')
      // Off for every checkout the graph already knows: the permission to push
      // is the owner's to grant per venture, never something a migration hands
      // out (src/git.ts).
      addCol('repo', 'push', 'push integer not null default 0')
      // A missing gate refuses landing. There is no safe cross-language default,
      // so the project names one complete command explicitly (src/land.ts).
      addCol('repo', 'gate', 'gate text')
      // Additional resolvable-only handles beside the primary `slug` (T-16673):
      // a space-delimited set, every member globally unique (enforced in apply()).
      addCol('alias', 'slugs', 'slugs text')
      // A wake's note (T-17654): what the setter was mid-doing, relayed into the
      // knock's words when it fires so a resumed session reconstitutes.
      addCol('wake', 'note', 'note text')
      // The crash-loop breaker's fresh-start fence (types.ts, src/roles.ts).
      addCol('role', 'retry_at', 'retry_at text')
      addCol('role', 'checkout', 'checkout integer references entity(id)')
      addCol('role', 'schedule', 'schedule text')
      addCol(
        'role',
        'wake_policy',
        "wake_policy text not null default 'always'",
      )
      addCol('role', 'wake_target', 'wake_target integer references entity(id)')
      addCol('role', 'decision', 'decision text')
      addCol('role', 'reason', 'reason text')
      addCol('role', 'observed', 'observed integer')
      addCol('role', 'decided_at', 'decided_at text')
      addCol('role', 'quiet', 'quiet integer')
      addCol('role', 'cooldown', 'cooldown integer')
      addCol('role', 'cap', 'cap integer')
      addCol('generation', 'serving_model', 'serving_model text')
      addCol('session', 'cwd', 'cwd text')
      addCol('session', 'pid', 'pid integer')
      addCol('session', 'pane', 'pane text')
      addCol('session', 'turn', 'turn text')
      addCol('session', 'notice_at', 'notice_at text')
      addCol('session', 'notice_accepted_at', 'notice_accepted_at text')
      addCol('session', 'notice_token', 'notice_token text')
      // A provider-owned transcript JSONL — an external session's log file.
      addCol('session', 'transcript', 'transcript text')
      // Self-reported at SessionStart (types.ts): what kind of session, how it booted.
      addCol('session', 'agent_type', 'agent_type text')
      addCol('session', 'source', 'source text')
      addCol('session', 'operator', 'operator integer')
      // The operator session a delegated agent descends from (types.ts): a child
      // reifies as its own row rather than a second writer on the operator's.
      addCol('session', 'parent', 'parent integer references entity(id)')
      // Which way the decision went (D-21212); null reads as approved.
      addCol('decided', 'verdict', 'verdict text')
      for (
        let table of ['created', 'updated', 'notified', 'opened', 'archived']
      ) {
        addCol(table, 'via', 'via integer')
      }
      addCol('journal', 'via', 'via text')
      // What apply() learned that the batch JSON doesn't say (D-22388): which
      // comp rows were CREATED and which rows deletes took — the effects.ts
      // Trace, serialized, so the journal feed (catchup.ts) can fire the same
      // effects the writer would have. Written only for a fed() trace — a
      // writer that DEFERRED dispatch to the feed. NULL means dispatch already
      // happened at the call site or was never asked for (a plain/absent
      // trace, the record() stamp door), and the feed broadcasts without
      // dispatching, so an effect can never fire twice for one row.
      addCol('journal', 'trace', 'trace text')
      // The managed-session lifecycle (src/sessions.ts): what it is doing and
      // how it ended. The old launch aliases are planted before backfillSpawn()
      // for live databases, then stay dormant as rollback input. The rest is
      // server-owned and rides OUT in the snapshot.
      // Listed once, planted in place; each ddl leads with its column name.
      for (
        let ddl of [
          `origin text not null default 'external'`,
          'provider text',
          'model text',
          'effort text',
          'persona integer',
          'requested_task integer',
          'role integer',
          'branch text',
          'base_revision text',
          'status text',
          'provider_session_id text',
          'serving_model text',
          'latest_seq integer not null default 0',
          'standing text',
          'started_at text',
          'stop_requested_at text',
          'input_at text',
          'finished_at text',
          'exit_code integer',
          'stop_reason text',
          'final_text text',
          'usage_json text',
          // The process stderr tail, bounded — a graph facet now (T-16798), so
          // every reader shows a process-backed run's diagnostics from the graph
          // rather than a /logs file-read.
          'stderr text',
        ]
      ) addCol('session', ddl.split(' ')[0], ddl)
      // Managed prompts have always occupied seq 1. Materialize the facet for
      // existing logs so deploy-time UI behavior matches newly appended runs.
      db.exec(`
      insert or ignore into prompt (entity)
      select e.entity from entry e
      join message m on m.entity = e.entity
      join session s on s.entity = e.session
      where e.seq = 1 and m.role = 'user' and s.origin = 'managed'
    `)
      backfillSpawn(db)
      backfillSessionFacets(db)
      backfillLineage(db)
      // The identity chain (types.ts): instruments point at who they act for.
      addCol('client', 'actor', 'actor integer references entity(id)')
      // Inbound provenance (inbound.ts): the fleet sweep's idempotency key
      // (and the never-send mark), arrival time, and the edge's DKIM verdict
      // — see stamped.mail in types.ts.
      addCol('mail', 'message_id', 'message_id text')
      addCol('mail', 'received_at', 'received_at text')
      addCol('mail', 'verified', 'verified integer')
      // Threading (mail.ts): the mail this one answers — no FK, like
      // target (death 'keep' + tombstoned spines veto FK'd deletes,
      // T-4593). sent_id is the sender-assigned Message-ID, server-stamped.
      addCol('mail', 'reply_to', 'reply_to integer')
      addCol('mail', 'sent_id', 'sent_id text')
      addCol('mail', 'in_reply_to', 'in_reply_to text')
      // The narrow routing-header set (T-14133) — last mail column, so it lands
      // at the tail in both a fresh mailDdl and a live db, keeping mendMail's
      // positional `insert select *` aligned. See stamped.mail in types.ts.
      addCol('mail', 'headers', 'headers text')
      addCol('session', 'actor', 'actor integer references entity(id)')
      // board.query, project.color and the hook request columns (method/path/
      // headers/sig_ok) were planted here before their tables were derived
      // (T-12764); the addDerivedCols pass above now fills them from the vocabulary.
      // A live table's check constraint is frozen at create; when the edge
      // vocabulary outgrows the baked list (the 'about' verb shipped without
      // this once — every about edge bounced off the old check), rebuild the
      // table around the current one, rows copied whole.
      let dep = ddlOf(db, 'dependency')
      if (dep && edges.some((e) => !dep.includes(`'${e}'`))) {
        rebuild(db, 'dependency', depDdl)
      }
      // A live edge table that predates the listing order grows the column in
      // place (additive; null on every existing edge, unchanged behavior).
      addCol('dependency', 'ord', 'ord integer')
      // The per-type delivery receipts become the shared delivered/error
      // components, and the per-type recipient columns the shared deliver.to.
      migrateErrors(db)
      migrateDelivery(db)
      migrateDeliver(db)
      // The FK-era mail rebuild (mendMail, T-4593) is retired: migrateToIdKeys
      // rebuilds mail to the canonical ddl first, so no db can reach here still
      // wearing the eid FK.
      // Mend the inbound letters an earlier migrateDeliver stranded in deliver{to}
      // (T-15110).
      healInboundDeliver(db)
      mendCalls(db)
      mendApply(db)
      // A legacy separate project-main-board collapses into its project — the
      // project becomes its own board (T-17322). Idempotent; a no-op once every
      // mirror is folded in.
      migrateBoardsToProjects(db)
      // A mail was briefly a 'send_request' (the intent idiom over-applied —
      // the artifact deserved its name). Adopt the old table's rows once;
      // `create if not exists mail` above already made the empty successor,
      // so copy across and drop the stale name.
      let sr = prep(
        db,
        `select 1 from sqlite_master where type = 'table' and name = 'send_request'`,
      ).get()
      if (sr) {
        atomic(db, () => {
          db.exec('insert into mail select * from send_request')
          db.exec('drop table send_request')
        })
      }
      // Nums already recycled before this column existed stay unknowable —
      // monotonic from here on; old graves just don't raise the high-water.
      addCol('tombstone', 'num', 'num integer')
      // Both doc mirrors follow it by trigger from here on. Anything older,
      // any out-of-band writer, or shadow-table damage (overlapping watcher
      // restarts have managed it) shows up here as a failed integrity check
      // or a count drift — one rebuild pass over the content table heals
      // both, and at this scale it costs milliseconds on boot. A doc_gram
      // that has never been built is exactly a count drift, so the index
      // arrives filled on the first boot that knows about it.
      let count = (t: string) =>
        (prep(db, `select count(*) as n from ${t}`).get() as { n: number }).n
      type FtsFault = {
        operation: 'integrity-check' | 'count-check'
        error: unknown
      }
      let diagnosis = (error: unknown) =>
        error instanceof Error ? error.message : String(error)
      let fault = (t: string): FtsFault | undefined => {
        try {
          db.exec(`insert into ${t} (${t}, rank) values ('integrity-check', 1)`)
        } catch (error) {
          return { operation: 'integrity-check', error }
        }
        try {
          let indexed = count(t), docs = count('doc')
          if (indexed != docs) {
            return {
              operation: 'count-check',
              error: new Error(
                `${t} returned ${indexed} rows; doc returned ${docs}`,
              ),
            }
          }
        } catch (error) {
          return { operation: 'count-check', error }
        }
      }
      let quick = () => {
        try {
          let row = prep(db, 'pragma quick_check(1)').get() as Record<
            string,
            string
          >
          return row?.quick_check ?? String(Object.values(row ?? {})[0])
        } catch (error) {
          return `failed: ${diagnosis(error)}`
        }
      }
      for (let t of ['doc_fts', 'doc_gram']) {
        let before = fault(t)
        if (!before) continue
        try {
          db.exec(`insert into ${t} (${t}) values ('rebuild')`)
        } catch (error) {
          // Keep BOTH SQLite errors: an FTS integrity failure often says only
          // "database disk image is malformed", and dropping it made the later
          // rebuild failure indistinguishable from damage to the main database.
          // quick_check is paid only on this failed repair path; its verdict says
          // whether SQLite sees a wider database problem or an FTS-only one.
          throw new AggregateError(
            [before.error, error],
            `${t} rebuild failed after ${before.operation}; ` +
              `${before.operation}: ${diagnosis(before.error)}; ` +
              `rebuild: ${diagnosis(error)}; quick_check: ${quick()}`,
          )
        }
        let after = fault(t)
        if (after) {
          throw new AggregateError(
            [before.error, after.error],
            `${t} ${after.operation} failed after rebuild; ` +
              `before: ${diagnosis(before.error)}; ` +
              `after: ${diagnosis(after.error)}; quick_check: ${quick()}`,
          )
        }
      }
      let { n } = prep(db, 'select count(*) as n from task').get() as {
        n: number
      }
      if (!n) seed(db)
      // Provenance components (T-6670), now the ONLY home: birth and last-edit
      // moved off the spine, and this is the last pass that reads the old
      // columns before they go. Runs AFTER seed so the demo entities (direct
      // inserts, not apply) get provenance too; insert-or-ignore keeps it a
      // no-op once healed.
      //
      // `updated` is deliberately NOT re-derived. A minted entity took its
      // created_at from spine()'s clock and its modified_at from apply()'s, a
      // few ms later — so `modified_at <> created_at` reads a birth as an edit
      // and would mint provenance for entities nothing ever touched (61 such
      // rows in the live graph). apply() has stamped the component directly
      // since T-6670 shipped, so there is nothing left for a derivation to
      // recover and nothing but noise for it to invent.
      if (hasCol(db, 'entity', 'created_at')) {
        db.exec(`insert or ignore into created (eid, at, "by")
      select eid, created_at, null from entity`)
      }
      backfillVia(db)
      backfillOpened(db)
      // Fill the journal seek index once (T-13915) before its index is built
      // below — insert-then-index is the cheaper order for the one-time ~26k-row
      // load, and later boots skip both (populated table, existing index).
      backfillJournalTouch(db)
      // The dormant columns are migration INPUT, and every one of them has now
      // been read for the last time (T-6670, T-7113, T-7006). A retired column
      // that lingers still answers a schema read, so it keeps teaching a
      // mechanism the code no longer has.
      dropCol('entity', 'created_at')
      dropCol('entity', 'modified_at')
      dropCol('comment', 'author_eid')
      // Machine comments are not a species of their own: the sweep noise that
      // wanted marking is deleted, and everything else was always someone's
      // words (T-7018). Nothing reads the mark now, so the column goes.
      dropCol('comment', 'event')
      dropCol('memory', 'source_eid')
      dropCol('mail', 'read_at')
      // Reads memory.type and drops it in the same breath, so it belongs with
      // the retirements rather than the backfills above.
      retireMemoryType(db)
      retireProposal(db)
      retireProjectRetiredAt(db)
      retireTaskStatus(db)
      healStored(db)
      // Indexes LAST — over EVERY component, not just `derived` (T-17678). SQLite
      // auto-indexes no foreign key, and the hand-written `schema` tables (comment,
      // cancel, card, stop_request, review, camera, fold, mail, …) carry {eid} ref
      // columns too, so realizing indexDdl only over `derived` left comment.target
      // and its siblings unindexed — a server-side `.comment.target=x` full-SCANNED
      // the table (the browser is unaffected: index.ts builds the reverse map in
      // memory). indexDdl is the one vocabulary's index set (index.ts indexesFor),
      // so this is the SQL realization the design always anticipated. Placed after
      // every addCol/rebuild above: a ref column may be added by migration
      // (task.project, role.checkout, mail.reply_to) and a table rebuild (mendMail,
      // migrateDelivery) drops and recreates its rows without indexes. Guarded by
      // hasIdx — a bare `create index if not exists` still opens an empty write
      // transaction that bumps the file change counter (breaking open()'s byte-
      // idempotency), so the guard makes a re-open pure reads, the SAME shape addCol
      // takes with hasCol.
      let depIndexName = `dependency_${depIndex.cols.join('_')}`
      if (!hasIdx(db, depIndexName)) {
        db.exec(indexDdlOne('dependency', depIndex) + ';')
      }
      // The journal seek index (T-13915): (eid, jrow desc) so a per-entity read is
      // an index seek, newest-first, then a fetch by rowid. hasIdx-guarded like
      // the rest — a bare `create index if not exists` bumps the file change
      // counter and breaks open()'s byte-idempotency.
      if (!hasIdx(db, 'journal_touch_eid')) {
        db.exec(
          'create index journal_touch_eid on journal_touch (eid, jrow desc);',
        )
      }
      for (
        let comp of new Set([...Object.keys(comps), ...Object.keys(stamped)])
      ) {
        for (let i of indexesFor(comp)) {
          let name = `${comp}_${i.cols.join('_')}`
          if (!hasIdx(db, name)) db.exec(indexDdlOne(comp, i) + ';')
        }
      }
      // The one hand index whose name diverges from its derived twin: `schema` used
      // to name subscription(actor,target) `subscription_one`, but indexDdl derives
      // `subscription_actor_target` from the columns, so both would coexist. Retire
      // the legacy name once — the derived unique index above already holds the
      // (actor,target) uniqueness the drop would otherwise lose.
      dropIdx('subscription_one')
      // Mint the durable sync epoch (T-20299) if the graph lacks it. After first
      // boot the row stands, so every later epochOf() is a pure SELECT.
      mintEpoch(db)
      initVector(db)
      if (stored != schemaVersion) {
        db.exec(`pragma user_version = ${schemaVersion}`)
      }
      return db
    }, true)
    // Announce cleanup only after the encompassing schema transaction commits;
    // a later migration failure must not report data whose reshape rolled back.
    reportMigration(reports)
    return migrated
  } finally {
    if (legacy) db.exec('pragma foreign_keys = on')
    // Runtime caches; a throwing or recursively opened migration restores the
    // state it inherited instead of enabling caching in its outer migration.
    caching = wasCaching
  }
}

// Open the file, migrate it transactionally in place, plant missing schema,
// and seed once if the graph is empty. SQLite serializes concurrent openers.
export let open = (path = file, vector = false) =>
  migrate(connect(path, vector))

// One schema-shaping DDL statement, classified so a non-Deno kernel can replay
// it (D-22804 §8). The classes are the whole guard surface: an idempotent
// create/drop runs as-is; an `add column` runs only when the column is absent;
// a bare `create index` runs only when the index is absent.
export type SchemaOp =
  | { kind: 'exec'; sql: string }
  | { kind: 'addColumn'; table: string; col: string; sql: string }
  | { kind: 'index'; name: string; sql: string }

// The ordered schema-shaping DDL a fresh migrate() runs, classified — the ONE
// source the codegen emits crates/yak-kernel/src/schema_gen.rs from, so the
// Rust kernel owns schema CREATE + ADDITIVE migration off db.ts's own schema
// (D-22804 §8), never a hand-kept copy. Captured by RECORDING db.exec over a
// fresh :memory: migrate() through the SAME driver the live server writes with,
// so the emitted DDL is byte-for-byte what this process would run; then
// augmented with the derived-component add-columns. Those last are the one thing
// the capture cannot see: addDerivedCols runs one `add column` per derived
// column, but on a FRESH db the column is already present (tableDdl created the
// table whole), so the guarded alter is a no-op and never reaches db.exec — yet
// an OLD db that predates a newly-derived column needs it. They are spliced in
// right after the derived table creates, before the index realization that may
// name such a column. Additive only: the historical one-time reshapes
// (migrateToIdKeys, board→project, the backfills/retirements) are no-ops on a
// fresh db and never captured — the live graph is already past them, and
// "anything shapier needs the owner" (M-17876).
export let schemaDdl = (): SchemaOp[] => {
  let recorded: string[] = []
  let real = new DatabaseSync(':memory:')
  let proxy = new Proxy(real, {
    get(t, p, _r) {
      if (p === 'exec') {
        return (sql: string) => {
          recorded.push(sql)
          return (t as unknown as { exec: (s: string) => unknown }).exec(sql)
        }
      }
      // Private-field accessors must receive the concrete DatabaseSync as
      // `this`; using the proxy receiver breaks getters such as inTransaction.
      let v = Reflect.get(t, p, t)
      return typeof v === 'function'
        ? (v as (...a: unknown[]) => unknown).bind(t)
        : v
    },
  })
  migrate(proxy as unknown as DatabaseSync)
  real.close()

  let classify = (sql: string): SchemaOp => {
    let t = sql.trim()
    let add = t.match(/^alter\s+table\s+(\S+)\s+add\s+column\s+(\S+)/i)
    if (add) return { kind: 'addColumn', table: add[1], col: add[2], sql }
    // A bare `create index NAME` (no `if not exists`) needs a presence guard;
    // every other create/drop already carries its own `if [not] exists`.
    let idx = t.match(
      /^create\s+(?:unique\s+)?index\s+(?!if\s+not\s+exists)(\S+)\s+on/i,
    )
    if (idx) return { kind: 'index', name: idx[1], sql }
    return { kind: 'exec', sql }
  }
  let ops = recorded
    .filter((s) => /^\s*(?:create|alter|drop)\b/i.test(s))
    .map(classify)

  let derivedAdds: SchemaOp[] = []
  for (let comp of derived) {
    for (let { prop, ddl } of derivedCols(comp)) {
      derivedAdds.push({
        kind: 'addColumn',
        table: comp,
        col: prop,
        sql: `alter table ${comp} add column ${ddl}`,
      })
    }
  }
  let createSqls = new Set(derived.map((c) => tableDdl(c) + ';'))
  let lastCreate = -1
  ops.forEach((op, i) => {
    if (createSqls.has(op.sql)) lastCreate = i
  })
  if (lastCreate < 0) {
    throw new Error('schemaDdl: derived table creates not found in capture')
  }
  ops.splice(lastCreate + 1, 0, ...derivedAdds)
  return ops
}

// The one live handle moved to live_db.ts: importing THIS module runs nothing
// — it is library code (D-22388), safe in the CLI's read arm and in any test —
// while importing live_db.ts is the deliberate act of opening the live graph.

// The sync allowlist: the shared vocabulary plus the spine (which has no
// writable columns — num is server-owned, kind doesn't exist, and the
// timestamps are components now). Order matters — deletes run it REVERSED
// so dependents go first.
let cmps: Record<string, string[]> = {
  entity: [],
  ...Object.fromEntries(
    Object.entries(comps).map(([name, props]) => [name, Object.keys(props)]),
  ),
}

let edgeCols = ['type', 'child', 'ord', 'gone']

// What the SCHEMA has, as opposed to what the wire may write — the
// authority for telling a name that EXISTS from a name that doesn't.
// Memoized per table, per handle (a process can hold several graphs —
// the live one and a probe's); an empty set means no such table.
let stored = new WeakMap<DatabaseSync, Record<string, Set<string>>>()
let columnsOf = (db: DatabaseSync, table: string): Set<string> => {
  let mine = stored.get(db) ?? {}
  stored.set(db, mine)
  return mine[table] ??= new Set(
    (prep(db, 'select name from pragma_table_info(?)').all(table) as {
      name: string
    }[]).map((c) => c.name),
  )
}

// The effective batch says what landed. An unknown COMPONENT stays a
// compatible no-op on purpose — that is the seam a plugin or a newer
// client writes through, and the effective batch reports what was
// dropped. But inside a component we DO know, a column naming nothing is
// a typo, not a version:
//
//   writable             → kept.
//   stored, not writable → dropped in silence. Server-owned (a client
//     that read a row and patched it back must not be punished for
//     echoing created.at, and stripping mail.from here is the boundary
//     holding T-9511's forged-sender fix) or dormant (retired from comps,
//     column still standing — the deprecation path).
//   stored nowhere       → THROWS. `task.statuss` has no compatibility
//     story: the wire used to take it, write the DEFAULT status, and
//     answer 200, so a caller asking for `done` got `open` and success.
// Components the wire may not create, patch, or DELETE, whoever the caller —
// their whole data lives in `stamped` and is written ONLY by trusted server
// code that writes the row by direct SQL and BROADCASTS the change, never
// crossing apply()'s wire path: the runner's `lease`/`usage`, the
// interrupted-work `resume` stack, the ingest `imported` coordinate (D-16704),
// and the deliver outcome/health facets `delivered`/`error`/`exception`
// (D-14945/D-17077 — deliver.ts, entries.ts, managed_codex.ts). Their empty
// writable declarations keep them in the generic read/delete machinery; this
// door is what denies the wire the AUTHORITY to mint a false fleet-health
// `error` or ERASE an effect-stamped diagnosis with a bare component-delete
// (T-15457). Refused BEFORE the comp==null branch, so a delete is refused too.
//
// A curated list on purpose, not a vocabulary derivation: the boundary is the
// write PATH, which `comps`/`stamped` cannot express — `hook` and the
// notification stamps have the same empty-writable shape yet legitimately
// write their presence THROUGH apply(), so a shape rule would wrongly refuse
// them. The lease/usage pair this grew from was already such a list.
let serverOwned = new Set([
  'lease',
  'usage',
  'imported',
  'resume',
  'delivered',
  'error',
  'exception',
  'redaction',
])

// Rewrite a change that names a RENAMED component or column to its current
// home, per the prop projection of types.ts `renames`. A change is ONE
// component, so a column whose new home is a different component moves the
// whole change; two columns in one change disagreeing on the new component is
// an authoring error in the table, refused here rather than silently split.
// Empty map (today's state — session↔spawn is the bidirectional window, not a
// rename) is a no-op. Exported so a test drives the mechanism with its own map
// before the first real rename lands; admitted() binds the live table.
export let renamed = (
  change: Change,
  map: Record<string, string> = propRenames,
): Change => {
  if (!Object.keys(map).length) return change
  let name = map[change.name] ?? change.name
  let comp = change.comp
  if (comp) {
    let out: Record<string, unknown> = {}
    let hit = false
    for (let [col, v] of Object.entries(comp)) {
      let to = map[`${change.name}.${col}`]
      if (!to) {
        out[col] = v
        continue
      }
      hit = true
      let [dc, dcol] = to.includes('.') ? to.split('.') as [string, string] : [
        name,
        to,
      ]
      if (dc != name) {
        if (name != change.name) {
          throw new Error(`rename splits ${change.name} across ${name}, ${dc}`)
        }
        name = dc
      }
      out[dcol] = v
    }
    if (hit) comp = out
  }
  return name == change.name && comp == change.comp
    ? change
    : { ...change, name, comp }
}

let admitted = (db: DatabaseSync, change: Change): Change | undefined => {
  change = renamed(change)
  let table = change.name
  let cols = table == 'dependency' ? edgeCols : cmps[table]
  if (!cols) return
  if (serverOwned.has(table)) return
  if (change.comp == null) return change
  // `eid` is the entity's identity, projected into every snapshot row by
  // select(); it is never a writable column (the owner key is the int `entity`
  // now), so ignore it here rather than reading it as an unknown column when a
  // snapshot is replayed back through apply().
  let sent = Object.entries(change.comp).filter(([n]) => n != 'eid')
  let real = columnsOf(db, table)
  let alien = sent.filter(([n]) => !cols.includes(n) && !real.has(n))
  if (alien.length) {
    throw new Error(
      `unknown column${alien.length > 1 ? 's' : ''}: ${
        alien.map(([n]) => `${table}.${n}`).join(', ')
      }`,
    )
  }
  let kept = sent.filter(([name]) => cols.includes(name))
  if (sent.length && !kept.length) return
  let comp = Object.fromEntries(kept)
  return { ...change, comp }
}

let spawnCols = Object.keys(comps.spawn)
let spawnSpec = (comp: Record<string, unknown>) =>
  Object.fromEntries(
    spawnCols.filter((col) => col in comp).map((col) => [col, comp[col]]),
  )

// One session launch spec, two rolling-release homes. Whole-batch projection
// runs under apply()'s write lock: canonical spawn fields win a conflict,
// every session gets a spawn facet, and a task hint can never mint session.
// Coalescing the session twin into one change matters — created(session)
// effects key off the Trace row and must fire once.
let dualSpawn = (db: DatabaseSync, changes: Change[]): Change[] => {
  let out = changes.map((change) => ({
    ...change,
    comp: change.comp && { ...change.comp },
  }))
  let eids = new Set(
    out.filter((c) => c.name == 'session' || c.name == 'spawn')
      .map((c) => c.eid),
  )
  let sessions = new Set(
    [...eids].filter((eid) =>
      prep(db, `select 1 from session where ${byEid}`).get(eid)
    ),
  )
  let killed = new Set<string>()
  for (let change of out) {
    if (change.name == 'entity' && change.comp == null) {
      killed.add(change.eid)
      sessions.delete(change.eid)
    }
    if (killed.has(change.eid) || change.name != 'session') continue
    if (change.comp == null) sessions.delete(change.eid)
    else sessions.add(change.eid)
  }
  for (let eid of sessions) {
    let si: number[] = [], pi: number[] = []
    let legacy: Record<string, unknown> = {}
    let canonical: Record<string, unknown> = {}
    let spawnGone = false
    let spawnAt: number | undefined
    out.forEach((change, i) => {
      if (change.eid != eid) return
      if (change.name == 'session' && change.comp) {
        si.push(i)
        legacy = { ...legacy, ...spawnSpec(change.comp) }
      }
      if (change.name == 'spawn') {
        spawnAt = i
        if (change.comp) {
          pi.push(i)
          canonical = { ...canonical, ...spawnSpec(change.comp) }
          spawnGone = false
        } else {
          canonical = Object.fromEntries(spawnCols.map((col) => [col, null]))
          spawnGone = true
        }
      }
    })
    let spec = { ...legacy, ...canonical }
    for (let i of [...si, ...pi]) {
      for (let col of spawnCols) delete out[i].comp?.[col]
    }
    let session = si.at(-1)
    if (session == null && Object.keys(canonical).length) {
      session = out.push({ eid, name: 'session', comp: {} }) - 1
    }
    if (session != null) out[session].comp = { ...out[session].comp, ...spec }
    let spawn = spawnGone ? spawnAt : pi.at(-1)
    if (spawnGone && spawn != null) out[spawn].comp = {}
    if (spawn == null) {
      spawn = out.push({ eid, name: 'spawn', comp: {} }) - 1
    }
    if (spawn != null) out[spawn].comp = { ...out[spawn].comp, ...spec }
  }
  return out
}

let facetCols = (name: 'worktree' | 'runtime') => [
  ...Object.keys(comps[name]),
  ...Object.keys(stamped[name]),
]

// The apply-side half of the lineage alias (see backfillLineage above): a
// session.parent write also links
// `parent delegates child` (a rewrite or clear unlinks the old edge), so
// edge readers see lineage no matter which door wrote it. The PRE-batch
// column names the outgoing edge — safe because apply holds the whole batch
// under one lock. Column-ward mirroring is deliberately absent: nothing
// writes the edge directly yet, and the column retires only after this
// rolling release proves out (T-16412).
let mirrorLineage = (db: DatabaseSync, changes: Change[]): Change[] => {
  let last = new Map<string, string | null>()
  for (let change of changes) {
    if (change.name != 'session') continue
    if (change.comp != null && !('parent' in change.comp)) continue
    last.set(change.eid, (change.comp?.parent ?? null) as string | null)
  }
  if (!last.size) return changes
  let out = [...changes]
  for (let [eid, next] of last) {
    let prior = prep(
      db,
      `select p.eid from session s join entity p on p.id = s.parent
       where s.entity = (select id from entity where eid = ?)`,
    ).get(eid) as { eid: string } | undefined
    if (prior && prior.eid != next) {
      out.push({
        eid: prior.eid,
        name: 'dependency',
        comp: { type: 'delegates', child: eid, gone: true },
      })
    }
    if (next && prior?.eid != next) {
      out.push({
        eid: next,
        name: 'dependency',
        comp: { type: 'delegates', child: eid },
      })
    }
  }
  return out
}

// Old and new session doors overlap during a rolling release. Apply sees the
// whole batch under one lock, so it can make the canonical facet win without
// making order significant, then write the same projection back to aliases
// for a rollback server. A canonical component delete clears every alias.
let dualFacet = (
  db: DatabaseSync,
  changes: Change[],
  name: 'worktree' | 'runtime',
): Change[] => {
  let out = changes.map((change) => ({
    ...change,
    comp: change.comp && { ...change.comp },
  }))
  let cols = facetCols(name)
  let eids = new Set(
    out.filter((c) => c.name == 'session' || c.name == name)
      .map((c) => c.eid),
  )
  let sessions = new Set(
    [...eids].filter((eid) =>
      prep(db, `select 1 from session where ${byEid}`).get(eid)
    ),
  )
  let killed = new Set<string>()
  for (let change of out) {
    if (change.name == 'entity' && change.comp == null) {
      killed.add(change.eid)
      sessions.delete(change.eid)
    }
    if (killed.has(change.eid) || change.name != 'session') continue
    if (change.comp == null) sessions.delete(change.eid)
    else sessions.add(change.eid)
  }
  for (let eid of sessions) {
    let current = prep(
      db,
      `select ${cols.map(sqlName).join(', ')} from ${sqlName(name)}
       where ${byEid}`,
    ).get(eid) as Record<string, unknown> | undefined
    let si: number[] = [], fi: number[] = []
    let legacy: Record<string, unknown> = {}
    let canonical: Record<string, unknown> = {}
    let legacyTouched = false, canonicalTouched = false, gone = false
    out.forEach((change, i) => {
      if (change.eid != eid) return
      if (change.name == 'session' && change.comp) {
        si.push(i)
        for (let col of cols) {
          if (!(col in change.comp)) continue
          legacy[col] = change.comp[col]
          legacyTouched = true
        }
      }
      if (change.name != name) return
      fi.push(i)
      canonicalTouched = true
      if (change.comp) {
        for (let col of cols) {
          if (col in change.comp) canonical[col] = change.comp[col]
        }
        gone = false
      } else {
        canonical = Object.fromEntries(cols.map((col) => [col, null]))
        gone = true
      }
    })
    if (!legacyTouched && !canonicalTouched) continue
    let spec = { ...current, ...legacy, ...canonical }
    for (let i of si) for (let col of cols) delete out[i].comp?.[col]
    let aliases = Object.fromEntries(
      Object.keys(comps.session).filter((col) => col in spec)
        .map((col) => [col, spec[col]]),
    )
    let session = si.at(-1)
    if (session == null) {
      session = out.push({ eid, name: 'session', comp: {} }) - 1
    }
    out[session].comp = { ...out[session].comp, ...aliases }
    let facet = fi.at(-1)
    if (gone) {
      if (facet != null) out[facet].comp = null
      continue
    }
    if (facet == null) facet = out.push({ eid, name, comp: {} }) - 1
    let writable = Object.fromEntries(
      Object.keys(comps[name]).filter((col) => col in spec)
        .map((col) => [col, spec[col]]),
    )
    out[facet].comp = { ...out[facet].comp, ...writable }
  }
  return out
}

let syncFacetAliases = (
  db: DatabaseSync,
  changes: Change[],
  extra: Change[],
) => {
  for (let name of ['worktree', 'runtime'] as const) {
    let cols = facetCols(name)
    let eids = new Set(
      changes.filter((c) => c.name == name).map((c) => c.eid),
    )
    for (let eid of eids) {
      if (!prep(db, `select 1 from session where ${byEid}`).get(eid)) continue
      let row = prep(
        db,
        `select ${cols.map(sqlName).join(', ')} from ${sqlName(name)}
         where ${byEid}`,
      ).get(eid) as Record<string, unknown> | undefined
      let spec = row ?? Object.fromEntries(cols.map((col) => [col, null]))
      prep(
        db,
        `update session set ${
          cols.map((col) => `${sqlName(col)} = ?`).join(', ')
        }
         where ${byEid}`,
      ).run(
        ...cols.map((col) => spec[col] as string | number | null ?? null),
        eid,
      )
      extra.push({ eid, name: 'session', comp: spec })
    }
  }
}

// Graph-out is the declared readable vocabulary, never the table's migration
// history. `comps` admits writes; `stamped` adds server-owned reads.
let readable: Record<string, string[]> = Object.fromEntries(
  Object.keys(cmps).map((name) => [
    name,
    [
      'eid',
      ...new Set([
        ...(cmps[name] ?? []),
        ...Object.keys(stamped[name] ?? {}),
      ]),
    ],
  ]),
)

// Graph-out projected back to EIDs. The owner column is `entity` (an int id),
// so join the spine for its eid under the alias `eid`, and each `{eid}`
// REFERENCE column joins the spine again for ITS target's eid under the
// reference's own name; a plain scalar reads straight off the base row `t`. The
// projection is WRAPPED in a subquery so the only `eid` a caller's appended
// `where eid = ?` can bind is the single projected output column — every joined
// spine also carries an `eid` column, so the bare name would otherwise be
// ambiguous. The `entity` spine is eid-native (eid is a real column), so it
// projects itself.
let select = (name: string): string => {
  if (name == 'entity') {
    return `select ${readable.entity.map(sqlName).join(', ')} from entity`
  }
  let joins: string[] = []
  let cols = readable[name].map((c) => {
    if (c == 'eid') return `__o.eid as eid`
    if (name == 'doc' && c == 'body') {
      joins.push('join blob_text __body on __body.entity = t.body')
      return '__body.value as body'
    }
    if (isRef(name, c)) {
      let a = `__r_${c.replace(/[^A-Za-z0-9]/g, '_')}`
      joins.push(`left join entity ${a} on ${a}.id = t.${sqlName(c)}`)
      return `${a}.eid as ${sqlName(c)}`
    }
    return `t.${sqlName(c)} as ${sqlName(c)}`
  })
  return `select * from (select ${cols.join(', ')} from ${sqlName(name)} t ` +
    `join entity __o on __o.id = t.entity${
      joins.length ? ' ' + joins.join(' ') : ''
    }) __s`
}

// A boot sweep replays a deliverable's created() effect as if its row were a
// fresh wire write, so the row must read back the way the wire delivered it:
// the owner eid under `eid`, and every {eid} REFERENCE projected to its target's
// eid — not the int id it is stored as (D-18866), which is what a handler like
// stopped() binds as `comp.target`. Unlike select(), this is NOT wrapped in a
// subquery: the base table stays in FROM under its own name so the sweep's
// pending predicate (deliver.ts PENDING) can still filter on `${comp}.entity`.
export let sweepSelect = (name: string, pending: string): string => {
  let base = sqlName(name)
  let joins: string[] = []
  let cols = readable[name].map((c) => {
    if (c == 'eid') return `__o.eid as eid`
    if (name == 'doc' && c == 'body') {
      joins.push(
        `join blob_text __body on __body.entity = ${base}.body`,
      )
      return '__body.value as body'
    }
    if (isRef(name, c)) {
      let a = `__r_${c.replace(/[^A-Za-z0-9]/g, '_')}`
      joins.push(`left join entity ${a} on ${a}.id = ${base}.${sqlName(c)}`)
      return `${a}.eid as ${sqlName(c)}`
    }
    return `${base}.${sqlName(c)} as ${sqlName(c)}`
  })
  return `select ${cols.join(', ')} from ${base} ` +
    `join entity __o on __o.id = ${base}.entity` +
    `${joins.length ? ' ' + joins.join(' ') : ''} where ${pending}`
}

// The boot snapshot omits every entity carrying a LAZY-partition comp
// (types.ts `partition`) — the whole entity, so a lazy entity's eager comps
// (a session's `recalled`) leave with it too. These are the lazy tables whose
// owner EIDs form the omit-set; snapshot() materializes them ONCE into an
// indexed temp table (`_omit`) before its per-table loop rather than
// re-running a spine-join UNION subquery inside every one of the 89 component
// scans (the eid→id migration turned that subquery into a ~36k-row
// spine-join, ~50ms per table even on empty ones — T-18874). Derived from the
// one-list so a new lazy comp joins the omission with zero further edits.
// Today lazy = {entry}.
let lazyTables = Object.keys(readable).filter(lazy)

// The one generic scalar writer for every non-ref column (refs go through
// refToId). It is the storage boundary, so it is where the scalar invariant
// lives: a text/number/bool column must never receive an object, array, or
// other non-scalar. node:sqlite only refuses one by accident — it reads an
// object as a named-param dict and throws an opaque "Unknown named parameter" —
// so guard here with an addressed message instead. Valid: null, string, number,
// bigint, and (bool columns) boolean.
export let bound = (
  name: string,
  col: string,
  value: unknown,
): string | number | bigint | null => {
  if (comps[name]?.[col] == 'bool' && typeof value == 'boolean') {
    return Number(value)
  }
  let kind = typeof value
  if (
    value !== null && kind != 'string' && kind != 'number' && kind != 'bigint'
  ) {
    throw new Error(
      `${name}.${col} expects a scalar value, got ${
        Array.isArray(value) ? 'array' : kind
      }`,
    )
  }
  return value as string | number | bigint | null
}

// The stamp family (notified/opened/archived/decided/proposed): a
// client-requested act
// the server signs, whose component carries the whole {at, by, via} stamp.
// That shape is the discriminator — derived, not hand-listed, so a new stamp
// joins with zero edits — and `recall` (stamped {count…}, no at) and
// `conflict` (no by: a server-minted audit, never wire-created) fall out on
// it. Containment, not exactness: a payload column may ride beside the stamp
// (`decided.verdict`) without costing the component its signature.
//
// Which HALF the wire owns varies and doesn't matter here: the notification
// three write a bare presence and the server dates them; `decided` and
// `proposed` may date and sign themselves (types.ts). What the loop below owns
// is `via`, server-only in every member. `created`/`updated` wear the same
// shape but fire on an entity's birth and touch rather than on the wire naming
// them, so they keep their own loops and are named out.
let stamps = Object.keys(comps).filter((c) => {
  let all = { ...comps[c], ...stamped[c] }
  return c != 'created' && c != 'updated' &&
    !comps[c].via && stamped[c]?.via && all.at && all.by
})

// A clocked presence (favorite today) is the smaller stamp family: the wire
// asks for a bare facet and the server freezes its sole `at`. Derive the family
// from its shape so the schema vocabulary remains the only component list.
let clocked = Object.keys(comps).filter((c) =>
  !Object.keys(comps[c]).length &&
  Object.keys(stamped[c] ?? {}).length == 1 && stamped[c]?.at
)

// The reaper's worklists, derived from the death word each reference
// declares in the vocabulary (types.ts Death says what each word means).
// No hand-kept list: a new reference picks its word where it's declared,
// and the cascade below already honors it.
let AIMED = deaths('cascade')
let DETACHED = deaths('detach')
let RELEASED = deaths('release')

// An FK bounce (errcode 787, SQLITE_CONSTRAINT_FOREIGNKEY) names nothing,
// so enrich it: walk the table's declared refs and point at each sent
// value whose referent is missing. The caller rejects every SQL failure;
// other errors keep their own message.
let refused = (
  db: DatabaseSync,
  name: string,
  eid: string,
  comp: Record<string, unknown>,
  e: unknown,
) => {
  if ((e as { errcode?: number })?.errcode != 787) return null
  let given: Record<string, unknown> = { eid, ...comp }
  // The sent reference values are still EIDS here (refused runs on the original
  // comp, before id resolution). Every FK now targets an int key, so resolve
  // the eid through the spine to test existence: an entity(id) FK checks the
  // spine by eid, a component-owner FK (pin→card(entity)) checks that table.
  let bad = (prep(
    db,
    `select "from" as col, "table" as t, coalesce("to", 'id') as pk
     from pragma_foreign_key_list(?)`,
  ).all(name) as { col: string; t: string; pk: string }[])
    .filter((f) =>
      given[f.col] != null &&
      !(f.pk == 'id'
        ? prep(db, 'select 1 from entity where eid = ?').get(
          given[f.col] as string,
        )
        : prep(
          db,
          `select 1 from ${f.t} where ${f.pk} = (select id from entity where eid = ?)`,
        ).get(given[f.col] as string))
    )
    .map((f) =>
      `${f.col} → ${human(db, given[f.col] as string)} (${
        prep(db, 'select 1 from tombstone where eid = ?')
            .get(given[f.col] as string)
          ? 'tombstoned'
          : `no such ${f.t}`
      })`
    )
  return new Error(
    `${name} ${human(db, eid)} refused: ${
      bad.join(', ') || 'foreign key violation'
    }`,
  )
}

type Ref = {
  name: string
  col: string
  target: string
}

// The refs whose target apply() validates exists on write and whose drop it
// audits on death. Only KIND-CONSTRAINED references (`target` a specific
// component): an any-entity reference (target 'entity') is trusted here —
// a session's requested_task_eid is validated by its spawn effect, not a
// 400, and a card/comment aimed anywhere may outrun its target's sync. So
// `target != 'entity'`, the renamed spelling of the old "truthy target"
// gate — the same set, now that the any-entity sentinel is a word.
let refs = Object.entries(comps).flatMap(([name, props]) =>
  Object.entries(props).flatMap(([col, type]) =>
    typeof type == 'object' && 'eid' in type && type.eid != 'entity'
      ? [{ name, col, target: type.eid }]
      : []
  )
)

// Every eid-valued column, by component — the FULL set (refs above excludes
// any-entity targets, but graduation must notice a comment or claim AIMED at an
// ephemeral entity just as much as a typed reference). dependency's parent/child
// are not comps columns, so graduate() handles the edge case explicitly.
let eidCols: [string, string][] = Object.entries(comps).flatMap(
  ([name, props]) =>
    Object.entries(props).flatMap(([col, type]) =>
      typeof type == 'object' && 'eid' in type
        ? [[name, col] as [string, string]]
        : []
    ),
)

// The SPAWN-REQUEST references the created(session) effect validates by failing
// the session on the board — never a 400 (M-17876): creating a session with a
// requested_task IS the ask, and a name that resolves to no task is reported by
// the effect as "no such task", not refused at apply. Under the old eid-text
// storage the dangling eid simply sat in the column; under id storage (D-18866)
// the value is an int id, so an absent target has nothing to point at. apply()
// mints a bare placeholder spine for it (see the pre-mint pass) so the reference
// stays storable and the eid round-trips to the effect. Everything else stays
// strict — session.actor, a comment's or card's target, a task's project:
// refToId refuses a name that resolves to nothing.
let trustedRefs: [string, string][] = [['session', 'requested_task']]

// Graduation on interaction (D-17790): a write that attaches to a source-
// materialized (ephemeral) entity hydrates that entity's source components into
// THIS batch, so it persists and mints its num alongside the write. The engaged
// set is every eid this batch WRITES (a change's own eid) or NAMES (an
// eid-valued reference — a comment.target, a claim.session, a dependency child).
// An engaged eid with no spine, not tombstoned, and owned by a source
// graduates; an untouched session stays pass-through forever. The source comps
// ride the normal write loop, which keeps only wire-writable columns (so a
// source's server-owned `origin`/`serving_model` drop just as they do on a live
// interactive session) and mints the spine + num. Called only when sources
// exist, and only ever prepends — a batch that engages nothing ephemeral is
// returned untouched, so the non-graduating write path is unchanged.
let graduate = (db: DatabaseSync, changes: Change[]): Change[] => {
  let engaged = new Set<string>()
  for (let { eid, name, comp } of changes) {
    if (name == 'entity' && comp == null) continue // a delete never graduates
    engaged.add(eid)
    if (name == 'dependency') {
      if (comp?.child) engaged.add(String(comp.child))
      continue
    }
    if (!comp) continue
    for (let [n, col] of eidCols) {
      if (n == name && comp[col] != null) engaged.add(String(comp[col]))
    }
  }
  let live = prep(db, 'select 1 from entity where eid = ?')
  let dead = prep(db, 'select 1 from tombstone where eid = ?')
  let hydration: Change[] = []
  for (let eid of engaged) {
    if (live.get(eid) || dead.get(eid)) continue
    let batch = sourceResolve(eid)
    if (batch) hydration.push(...batch)
  }
  return hydration.length ? [...hydration, ...changes] : changes
}

let refRefused = (
  db: DatabaseSync,
  ref: Ref,
  eid?: string,
  target?: string,
) => {
  let to = ref.target // always a specific component table (refs excludes 'entity')
  let col = sqlName(ref.col)
  let args: string[] = []
  if (eid) args.push(eid)
  if (target) args.push(target)
  // The reference is an int id; `tt` is the target COMPONENT row (owner
  // `entity`), absent when the id names no such KIND. `o`/`rr` project the
  // referrer's and referent's eids for the message and the filters.
  let bad = prep(
    db,
    `
    select o.eid as eid, rr.eid as target
    from ${sqlName(ref.name)} r
    join entity o on o.id = r.entity
    left join entity rr on rr.id = r.${col}
    left join ${sqlName(to)} tt on tt.entity = r.${col}
    where r.${col} is not null and tt.entity is null
      ${eid ? 'and o.eid = ?' : ''}
      ${target ? `and rr.eid = ?` : ''}
    limit 1
  `,
  ).get(...args) as
    | { eid: string; target: string }
    | undefined
  if (!bad) return null
  let gone = prep(db, 'select 1 from tombstone where eid = ?')
    .get(bad.target)
  return new Error(
    `${ref.name} ${human(db, bad.eid)} refused: ${ref.col} → ${
      human(db, bad.target)
    } (${gone ? 'tombstoned' : `no such ${to}`})`,
  )
}

// The box owner: the lone `person` behind a HUMAN instrument — a browser
// tab that hasn't named itself is still someone at a keyboard, and on a
// one-person box that someone is them. With several people it goes DARK
// rather than guess. Same rule T-3758 binds a browser's "you are" by.
// Nothing else may reach for this: an agent is not its owner and the
// server's own machinery is nobody, so both resolve blank instead (T-9934).
let ownerActor = (db: DatabaseSync): string | null => {
  let people = prep(
    db,
    'select o.eid as eid from person p join entity o on o.id = p.entity',
  ).all() as { eid: string }[]
  return people.length == 1 ? people[0].eid : null
}

let read = (path: string) => {
  try {
    return Deno.readTextFileSync(path)
  } catch {
    return ''
  }
}

// A linked worktree names its main checkout in the nearest .git file.
let worktreeGitdir = (cwd: string): string | null => {
  let at = resolve(cwd)
  while (true) {
    let gitdir = read(`${at}/.git`).match(/^gitdir:\s*(.+)$/m)?.[1].trim()
    if (gitdir) return resolve(at, gitdir)
    let parent = dirname(at)
    if (parent == at) return null
    at = parent
  }
}

// The venture a path stands in: the repo whose path prefixes the cwd, or
// whose gitdir owns the linked worktree. The cwd → repo → project rule every
// operator-scoped door shares (client.ts repoAt is its cache-side twin).
let ventureAt = (db: DatabaseSync, cwd?: string | null): string | null => {
  if (!cwd) return null
  let repos = prep(
    db,
    'select o.eid as eid, r.path from repo r join entity o on o.id = r.entity',
  ).all() as {
    eid: string
    path: string
  }[]
  let path = ancestorAt(repos.map((r) => r.path), cwd)
  if (path) {
    return repos.find((r) => resolve(r.path) == resolve(path))?.eid ?? null
  }
  let gitdir = worktreeGitdir(cwd)
  if (!gitdir) return null
  let roots = repos.map((r) => resolve(r.path, '.git/worktrees'))
  let common = ancestorAt(roots, gitdir)
  return repos.find((r) => resolve(r.path, '.git/worktrees') == common)?.eid ??
    null
}

// The project a session's WORK names when its cwd doesn't (D-21308): the
// project of a task it claims (newest lease first), else of the task it was
// spawned for. Reaches through claim/requested_task so a run outside any
// repo still attributes to the scope it serves.
let workProject = (db: DatabaseSync, sid: number): string | null => {
  let c = prep(
    db,
    `select ${refEid('t.project')} as eid
     from claim c join task t on t.entity = c.entity
     where c.session = ? and t.project is not null
     order by c.rowid desc limit 1`,
  ).get(sid) as { eid: string } | undefined
  if (c) return c.eid
  let r = prep(
    db,
    `select ${refEid('t.project')} as eid
     from session s join task t on t.entity = s.requested_task
     where s.entity = ? and t.project is not null`,
  ).get(sid) as { eid: string } | undefined
  return r?.eid ?? null
}

// The cascade's terminal (D-21308): the model ENTITY whose name matches the
// wire spelling a session's model columns speak. A lookup, never a mint — an
// unknown spelling leaves attribution null, the doctor-countable
// configuration gap, rather than guessing.
let modelActor = (db: DatabaseSync, name?: string | null): string | null =>
  name
    ? (prep(
      db,
      `select ${refEid('m.entity')} as eid from model m
       where m.name = ? order by m.entity limit 1`,
    ).get(name) as { eid: string } | undefined)?.eid ?? null
    : null

// The actor a write acts FOR, resolved from the writer the door named — a
// session id (the CLI's x-via, a reified agent), a client eid (a browser
// tab), or nothing. A session speaks as the attribution cascade (D-21308)
// resolves: DEGREES OF CONFIGURATION of the program that ran — the most
// specific persona in force, else the project it stands in (its explicit
// actor, its cwd's venture, or the project of the work it holds), else the
// model that ran. Never a human fallback — the human is the substrate's
// motive force always, so a human default carries zero information; a human
// is `by` only through direct authorship (their client or a wire-named by).
// A client speaks as its person. Never the raw label the journal used
// to keep — the audit trail is actor eids, each resolvable to a name.
//
// A write that resolves to nobody stays BLANK. It used to fall back to the
// box owner, which made every server-minted entity — an arriving letter, a
// wake's knock, the scribe's desk — read as authored by them: 608 rows, one
// of which was holdco's comment relayed as a letter FROM the owner, to the
// owner, about a residual he never raised (T-9934). Machinery is not a
// person, and an unowned write says so by naming no one.
// `human` is the one place the two callers differ: a browser tab that never
// named an actor is still someone at a keyboard, so provenance reads it as
// the box owner. A SIGNATURE won't — see senderActor.
let actorFor = (
  db: DatabaseSync,
  writer: string | null | undefined,
  human: boolean,
): string | null => {
  if (!writer) return null
  let s = prep(
    db,
    `select s.entity as sid, s.cwd as cwd,
            ${refEid('s.actor')} as actor,
            ${refEid('coalesce(s.persona, sp.persona)')} as persona,
            s.serving_model as served,
            coalesce(s.model, sp.model) as model
     from session s left join spawn sp on sp.entity = s.entity
     where s.id = ? or s.entity = (select id from entity where eid = ?)`,
  )
    .get(writer, writer) as
      | {
        sid: number
        cwd: string | null
        actor: string | null
        persona: string | null
        served: string | null
        model: string | null
      }
      | undefined
  if (s) {
    return s.persona ?? s.actor ?? ventureAt(db, s.cwd) ??
      workProject(db, s.sid) ?? modelActor(db, s.served) ??
      modelActor(db, s.model)
  }
  let c = prep(
    db,
    `select ${refEid('actor')} as actor from client where ${byEid}`,
  )
    .get(writer) as { actor: string | null } | undefined
  if (c) return c.actor ?? (human ? ownerActor(db) : null)
  // A writer naming an actor entity (person or project) directly stands
  // for itself — the CLI's own operator eid, or a hand-set x-via.
  let a = prep(
    db,
    `select 1 from person where ${byEid} union select 1 from project where ${byEid}`,
  ).get(writer, writer) as { 1: number } | undefined
  return a ? writer : null
}

export let writerActor = (
  db: DatabaseSync,
  writer?: string | null,
): string | null => actorFor(db, writer, true)

// Who may SIGN a letter: the same chain, minus the one inference provenance
// is allowed to make. A tab at the owner's keyboard may be RECORDED as them;
// it may not SPEAK as them, because that is the fleet's highest-trust byline
// and exactly the tier a forged sender claimed (T-9511). Nothing resolved
// means nothing signed, and mail.ts refuses to deliver an unsigned letter.
export let senderActor = (
  db: DatabaseSync,
  writer?: string | null,
): string | null => actorFor(db, writer, false)

// The instrument stopped one step before writerActor's principal: a session
// label/eid, client eid, or runner eid resolves to that graph-visible writer.
// Direct actor writes have no reified instrument.
export let writerVia = (
  db: DatabaseSync,
  writer?: string | null,
): string | null => {
  if (!writer) return null
  let s = prep(
    db,
    `select ${refEid('session.entity')} as eid from session
     where id = ? or ${byEid}`,
  )
    .get(writer, writer) as { eid: string } | undefined
  if (s) return s.eid
  let c = prep(
    db,
    `select ${refEid('client.entity')} as eid from client where ${byEid}`,
  )
    .get(writer) as { eid: string } | undefined
  if (c) return c.eid
  let r = prep(
    db,
    `select ${refEid('runner.entity')} as eid from runner where ${byEid}`,
  )
    .get(writer) as { eid: string } | undefined
  return r?.eid ?? null
}

// Apply a batch atomically. Unknown component names are ignored (a newer
// client speaking to an older server shouldn't wedge the socket). num is
// server-owned — never writable over the wire. Returns the
// EFFECTIVE batch: the input plus a synthesized entity-null for every
// cascade victim and the minted spine of every entity BORN here (num is
// server-owned, so no cache — the sender's included — knows it otherwise),
// so casting the return keeps every client cache honest.
//
// `t` (effects.ts Trace) is an out-param for the effect dispatcher: which
// comp rows this batch INSERTED (a create and a patch look identical as
// changes) and which existing rows it deleted. Pure bookkeeping — no
// effect ever runs in here; RULES (the claim lease, the stop_request
// gate) do, because rejecting a batch is part of what a commit means.
//
// `writer` is who's writing, when the door knows (a session id, a client
// eid) — resolved to the actor it acts for (writerActor) and journaled,
// never trusted for auth. A session that lands here without an actor gets
// one stamped from its venture or the box owner (T-6669): the writing
// identity is never blank, and the journal keeps a resolvable actor eid,
// not a raw label.
// What a precondition compares — one definition, shared with the door that
// hands agents their token (sha.ts says why it lives there). Re-exported
// because apply()'s rule is where callers already look for it.
export { sha }

// A refused precondition, carrying what is stored NOW in full. The consumer
// is an agent, and its loop is: refused-with-value → merge into the value it
// was handed → re-send with that value's hash. Handing back a bare conflict
// would send it back to READ, and the state can move between the refusal and
// that read — the same lost update, one level up. The value rides in the
// message because every door already surfaces `e.message` (HTTP 400, the
// CLI, MCP); the fields are for an in-process caller that would rather not
// parse prose.
export class Stale extends Error {
  eid: string
  comp: string
  col: string
  value: unknown
  // `id` is what to PRINT — the human id (human() above) when the entity
  // has one; `eid` is what to CARRY, for the in-process caller reading the
  // fields. Defaulted so the class stands alone, but every throw hands the
  // spoken form: the reader here is an agent mid-collision.
  constructor(
    eid: string,
    comp: string,
    col: string,
    value: unknown,
    id = eid,
  ) {
    super(
      `${comp}.${col} on ${id} has moved since you read it — batch refused. ` +
        `Merge into the current value below and retry with its hash.\n` +
        // The hash of the value shown, not of whatever is stored when the
        // caller gets around to retrying. A caller that had to re-read for
        // the token could merge into the value printed here and guard with
        // a token for a NEWER one — a refusal that hands out the means to
        // clobber. It also spares every caller a second door: an agent
        // cannot hash for itself.
        `was: ${value == null ? null : sha(value)}\n` +
        `--- current ${comp}.${col} ---\n${value ?? ''}`,
    )
    this.eid = eid
    this.comp = comp
    this.col = col
    this.value = value
  }
}

// The `$edit` field operator (T-23829): a comp value carrying `{ $edit }`
// instead of a literal is a surgical patch on that column's CURRENT stored
// value. Resolve it here, under the write lock, into the literal result plus a
// per-column `was` guard — comp-agnostic (any text column of any comp), the
// Claude-family door onto the same shared core as `graph_patch`. A guard on a
// value read under this same lock cannot race, so `was` is belt-and-suspenders
// here; the real no-clobber property is that a surgical patch merges rather
// than replacing, and `old` must still match (or the whole batch refuses).
// Any OTHER `$`-keyed operator is a typo/unknown op — refused legibly here at
// the operator layer, before it reaches storage as a non-scalar (bound()).
let editOps = (db: DatabaseSync, changes: Change[]): Change[] =>
  changes.map((change) => {
    if (!change.comp) return change
    let ops = Object.entries(change.comp).filter(([, v]) => isFieldOp(v))
    if (!ops.length) return change
    if (!readable[change.name]) return change
    let row = prep(db, `${select(change.name)} where eid = ?`).get(
      change.eid,
    ) as Record<string, unknown> | undefined
    let comp = { ...change.comp }
    let was = { ...(change.was ?? {}) }
    for (let [col, op] of ops) {
      let where = `${human(db, change.eid)}.${change.name}.${col}`
      // A `$`-keyed value that isn't `$edit` is an unknown operator — a typo
      // like `{$edt:…}`. Name it here, rather than letting bound() reject the
      // stray object with its generic "expects a scalar".
      if (!isEditOp(op)) {
        let key = Object.keys(op as Record<string, unknown>).find((k) =>
          k.startsWith('$')
        )
        throw new Error(`${where}: unknown operator ${JSON.stringify(key)}`)
      }
      // $edit is a string surgery — refuse it on an enum/number/ref/bool
      // column, whose value editOps would otherwise write UNVALIDATED
      // (normalizeChanges already ran, before the operator was a literal).
      let type = comps[change.name]?.[col]
      if (type != 'text' && type != 'body') {
        throw new Error(`$edit: ${where} is not a wire-writable text column`)
      }
      let cur = row?.[col]
      if (typeof cur != 'string') {
        throw new Error(`$edit: ${where} has no text value to edit`)
      }
      comp[col] = patchText(cur, editHunks(op.$edit), where)
      was[col] = sha(cur)
    }
    return { ...change, comp, was }
  })

// An actor has one cadence clock: minting its next untargeted wake removes
// every pending predecessor in the same transaction. A target makes a wake a
// reminder about that entity, so those stay independent of the cadence and of
// one another. The rule lives at apply(), where concurrent doors serialize;
// command-side replacement would let two stale snapshots both survive.
let replaceWakes = (db: DatabaseSync, changes: Change[]): Change[] => {
  let exists = prep(
    db,
    'select 1 from wake where entity = (select id from entity where eid = ?)',
  )
  // Unacted = neither outcome component present (D-14945); the wake's own
  // receipt columns moved to the shared delivered/error tables. The recipient
  // moved too — to the `deliver {to}` facet, joined here and named in the same
  // batch, since a fresh self-wake always mints its deliver alongside. Owner
  // and `to` are int ids; the projected owner eid rides back out.
  let pending = prep(
    db,
    `
    select o.eid as eid from wake w
    join entity o on o.id = w.entity
    join deliver dl on dl.entity = w.entity
    where dl."to" = (select id from entity where eid = ?)
      and w.target is null and o.eid != ?
      and not exists (select 1 from delivered d where d.entity = w.entity)
      and not exists (select 1 from error e where e.entity = w.entity)
  `,
  )
  let toOf = new Map<string, string>()
  for (let c of changes) {
    if (c.name == 'deliver' && c.comp && typeof c.comp.to == 'string') {
      toOf.set(c.eid, c.comp.to)
    }
  }
  return changes.flatMap((change) => {
    let to = toOf.get(change.eid)
    if (
      change.name != 'wake' || !change.comp ||
      change.comp.target != null || !to ||
      exists.get(change.eid)
    ) return [change]
    let drops = pending.all(to, change.eid) as { eid: string }[]
    return [
      ...drops.map(({ eid }) => ({ eid, name: 'entity', comp: null })),
      change,
    ]
  })
}

// The setting boundary (D-18092): a `setting` write must name a KNOWN catalog
// key, and its value is validated + normalized against that key before it lands
// — the URL constraint, the secret refusal, the unknown-key refusal, all in the
// same transaction so every door (CLI, MCP, web) is guarded, and a bad write
// bounces the whole batch the way a claim does rather than storing garbage a
// consumer would later read. A value-only patch resolves its key from the
// existing row; a key-only or bare touch is refused unless the key is catalogued.
// The value is normalized IN PLACE so storage and the echoed batch are canonical.
let guardSettings = (db: DatabaseSync, changes: Change[]): Change[] => {
  let keyOf = prep(
    db,
    'select key from setting where entity = (select id from entity where eid = ?)',
  )
  for (let c of changes) {
    if (c.name != 'setting' || !c.comp) continue
    let comp = c.comp
    let setsKey = 'key' in comp && comp.key != null
    let setsValue = 'value' in comp && comp.value != null
    if (!setsKey && !setsValue) continue
    let key = setsKey
      ? String(comp.key)
      : (keyOf.get(c.eid) as { key?: string } | undefined)?.key
    if (!key) {
      throw new Invalid(`setting ${shortId(c.eid)} names no catalog key`)
    }
    if (setsValue) {
      // validate() checks the key is known + non-secret and normalizes the value.
      comp.value = validateSetting(key, String(comp.value))
    } else if (!configSpec(key) || configSpec(key)!.sensitive) {
      // A key-only create still must be a known, non-secret catalog key.
      throw new Invalid(
        configSpec(key)
          ? `${key} is a secret and cannot be stored in the graph`
          : `unknown setting ${JSON.stringify(key)}`,
      )
    }
  }
  return changes
}

// The current non-secret override for a catalog key, or undefined. The graph
// plane of config.resolve() — server code passes this as the reader so a value
// is read at the operation boundary, current as of the last committed write.
export let settingValue = (
  db: DatabaseSync,
  key: string,
): string | undefined =>
  (prep(db, 'select value from setting where key = ?').get(key) as {
    value?: string | null
  } | undefined)?.value ?? undefined

// The eid of the `setting` entity holding a catalog key's override, or
// undefined. `setting.key` is UNIQUE, so this is the row a client save targets
// (config.settingRows returns it) rather than mint a second, colliding key. The
// eid-by-key half of the config panel's graph plane, beside settingValue.
export let settingEid = (
  db: DatabaseSync,
  key: string,
): string | undefined =>
  (prep(
    db,
    'select o.eid as eid from setting join entity o on o.id = setting.entity where key = ?',
  ).get(key) as {
    eid?: string
  } | undefined)?.eid ?? undefined

// A doc write speaks text but stores a blob reference. Materialize the blob as
// an ordinary graph change before the doc so lifecycle, journal, and caches all
// see a newly-created content entity; repeated values collapse by hash.
let casBodies = (db: DatabaseSync, changes: Change[]): Change[] => {
  let spoken = new Set(
    changes.filter((c) => c.name == 'blob').map((c) => c.eid),
  )
  let blobs: Change[] = []
  for (let change of changes) {
    if (change.name != 'doc' || !change.comp) continue
    let body = typeof change.comp.body == 'string' ? change.comp.body : !prep(
        db,
        'select 1 from doc where entity = (select id from entity where eid = ?)',
      ).get(change.eid)
      ? ''
      : undefined
    if (body == null) continue
    let eid = sha(body)
    if (
      spoken.has(eid) || prep(
        db,
        'select 1 from blob where entity = (select id from entity where eid = ?)',
      ).get(eid)
    ) continue
    spoken.add(eid)
    blobs.push({
      eid,
      name: 'blob',
      comp: { bytes: utf8.encode(body).byteLength },
    })
  }
  return [...blobs, ...changes]
}

export let apply = (
  db: DatabaseSync,
  changes: Change[],
  t?: Trace,
  writer?: string | null,
  // The ingest coordinate, server-stamped (D-16704). Keyed by the entry eid
  // it marks; the trusted append path (entries.ts) is the only caller that
  // supplies it, so `imported` is written in the SAME transaction as its
  // entry — atomic append-and-advance — while every WIRE caller passes
  // nothing and the column stays unwritable from the wire (admitted refuses
  // it too, belt and suspenders).
  imports?: Map<string, { source: string; line: number }>,
): Change[] => {
  // A raw @-address in `deliver.to` names no eid the parser could resolve —
  // fold it into its address-book entity (find-or-mint) before normalize.
  changes = mintAddresses(db, changes)
  // The address book stores only the deliverable spelling of a fleet address —
  // an illegal local-part is canonicalized before it can land (also covers the
  // email entities mintAddresses just prepended).
  changes = canonEmail(changes)
  changes = normalizeChanges(changes, {
    now: Date.now(),
    resolve: (id) => ident(db, id),
  }).flatMap((change) => {
    let kept = admitted(db, change)
    return kept ? [kept] : []
  })
  let dead = prep(db, 'select 1 from tombstone where eid = ?')
  let extra: Change[] = []
  let touched = new Set<string>()
  let minted = new Set<string>()
  let createdComps = new Set<string>()
  let refWrites = new Map<string, [Ref, string]>()
  let targetDrops = new Map<string, [Ref, string]>()
  // Whose provenance `by` the WIRE named this batch — the server keeps it
  // and only defaults the gap (created.by at birth, updated.by on a touch).
  let saidCreator = new Set<string>()
  let saidEditor = new Set<string>()
  // Removals are logged locally (the journal's trace column serializes them
  // for a fed trace); `t`, when brought, mirrors the same rows.
  let removedLog = new Map<string, string[]>()
  let took = (eid: string, name: string) => {
    removedLog.set(eid, [...(removedLog.get(eid) ?? []), name])
    t?.removed.set(eid, [...(t.removed.get(eid) ?? []), name])
  }
  // A bounced claim is worth remembering: noted here mid-transaction,
  // written AFTER the rollback (an audit row can't ride the batch it
  // condemns) as a conflict entity — display strings, not references,
  // because the loser's session row may die in that same rollback.
  let bounced: { target: string; loser: string; holder: string } | null = null
  // This is a write transaction from birth. Taking its reserved lock before
  // the validation reads lets busy_timeout wait for a handoff peer; upgrading
  // a deferred read transaction can fail immediately to avoid a deadlock.
  db.exec('begin immediate')
  try {
    // Claim release is the interruption event. Capture the holder before the
    // row can vanish — including through a session cascade — then derive the
    // durable actor stack from the transaction's final state below.
    let priorClaims = prep(
      db,
      `
      select co.eid as eid, c.claimed_at, c.rowid as claim_order,
             act.eid as actor, s.cwd as cwd
      from claim c
      join entity co on co.id = c.entity
      left join session s on s.entity = c.session
      left join entity act on act.id = s.actor
    `,
    ).all() as {
      eid: string
      claimed_at: string
      claim_order: number
      actor: string | null
      cwd: string | null
    }[]
    changes = editOps(db, changes)
    changes = replaceWakes(db, changes)
    changes = guardSettings(db, changes)
    changes = dualSpawn(db, changes)
    changes = dualFacet(db, changes, 'worktree')
    changes = dualFacet(db, changes, 'runtime')
    changes = mirrorLineage(db, changes)
    // A write that engages a source-materialized entity graduates it — hydrates
    // its source comps into this batch (D-17790). After the dual* transforms so
    // a hydrated session.provider is never promoted to a spawn request; a
    // historical session must not launch an agent.
    if (hasSources()) changes = graduate(db, changes)
    changes = casBodies(db, changes)
    // A log entry is an append-only fact. Every request/content facet is
    // born in the same batch as entry membership and can never be revised,
    // removed, or attached later. Outcomes use server-owned facets instead.
    let facts = new Set(
      Object.keys(sessionComps)
        .filter((name) =>
          name != 'runner' && name != 'lease' && name != 'usage'
        ),
    )
    let appends = new Set(
      changes.filter((c) => c.name == 'entry' && c.comp?.session)
        .map((c) => c.eid),
    )
    let existed = prep(
      db,
      'select 1 from entry where entity = (select id from entity where eid = ?)',
    )
    for (let { eid, name, comp } of changes) {
      if (!facts.has(name)) continue
      if (existed.get(eid)) {
        throw new Error(`entry ${shortId(eid)} is immutable`)
      }
      if (name == 'entry' && !comp?.session) {
        throw new Error(`entry ${shortId(eid)} needs a session`)
      }
      if (name != 'entry' && !appends.has(eid)) {
        throw new Error(`${name} ${shortId(eid)} needs entry in its batch`)
      }
    }
    // Mint spines in first-touch order before writing components. A typed
    // reference may then precede its target component without pre-minting that
    // target out of order. An entity-null still voids every later touch.
    let killed = new Set<string>()
    for (let { eid, name, comp } of changes) {
      if (name == 'entity' && comp == null) {
        killed.add(eid)
        continue
      }
      if (
        comp == null || name == 'dependency' || !cmps[name] ||
        killed.has(eid) || dead.get(eid)
      ) continue
      if (spine(db, eid).changes) minted.add(eid)
    }
    // A trusted spawn-request reference (trustedRefs) may name a target this
    // batch neither writes nor has on file — a requested_task naming a task that
    // never existed, which the created(session) effect reports rather than a
    // 400. Its stored value is an int id (D-18866), so mint a bare placeholder
    // spine for the target now, keeping the eid answerable through the ref. A
    // tombstoned target is left for refToId to refuse — a new reference must not
    // point at a grave — and a killed-in-batch one is already void.
    for (let { name, comp } of changes) {
      if (!comp) continue
      for (let [n, col] of trustedRefs) {
        if (n != name || comp[col] == null) continue
        let t = String(comp[col])
        if (killed.has(t) || dead.get(t)) continue
        if (spine(db, t).changes) minted.add(t)
      }
    }
    for (let { eid, name, comp, was } of changes) {
      // An edge is a TRIPLE, not a row keyed by eid: the comp names the
      // whole (parent=eid, type, child) sentence, so linking is
      // insert-or-ignore, and unlinking says the same sentence with
      // gone: true — comp: null could never name WHICH edge to drop.
      // Both endpoints must be live; a bad edge (unknown type, missing
      // spine) drops alone in its savepoint like any malformed create.
      if (name == 'dependency') {
        if (!comp || dead.get(eid) || dead.get(String(comp.child))) {
          continue
        }
        // Both spines checked HERE for the friendlier message (the driver
        // enforces FKs by default, but its bounce names no column): an
        // edge may only join entities that exist.
        let spines = prep(
          db,
          'select count(*) as n from entity where eid in (?, ?)',
        ).get(eid, String(comp.child)) as { n: number }
        if (spines.n != 2) {
          console.warn(`sync: edge for ${eid} dropped — missing endpoint`)
          continue
        }
        // Endpoints are int ids in storage; both spines exist (checked above).
        let pid = toId(db, eid)
        let cid = toId(db, String(comp.child))
        db.exec('savepoint change')
        try {
          if (comp.gone) {
            prep(
              db,
              `
              delete from dependency
              where parent = ? and type = ? and child = ?
            `,
            ).run(pid, String(comp.type), cid)
          } else if ('ord' in comp) {
            // An edge carrying a listing order create-or-PATCHes its ord:
            // re-linking the same sentence with a new ord sets it (an
            // editable field, not a second edge). Absent ord (the else)
            // leaves an existing edge's ord untouched.
            prep(
              db,
              `
              insert into dependency (parent, type, child, ord)
              values (?, ?, ?, ?)
              on conflict(parent, type, child) do update set ord = excluded.ord
            `,
            ).run(
              pid,
              String(comp.type),
              cid,
              (comp.ord ?? null) as number | null,
            )
          } else {
            prep(
              db,
              `
              insert or ignore into dependency (parent, type, child)
              values (?, ?, ?)
            `,
            ).run(pid, String(comp.type), cid)
          }
          db.exec('release change')
          touched.add(eid) // a moved edge is news at both ends
          touched.add(String(comp.child))
        } catch (e) {
          db.exec('rollback to change')
          db.exec('release change')
          console.warn(`sync: edge for ${eid} dropped —`, e)
        }
        continue
      }
      let cols = cmps[name]
      if (!cols) continue
      touched.add(eid)
      // The wire naming an author/editor (created.by / updated.by) — noted
      // so the server-default below leaves that value alone.
      if (comp && 'by' in comp) {
        if (name == 'created') saidCreator.add(eid)
        if (name == 'updated') saidEditor.add(eid)
      }
      // A deleted entity stays deleted: the tombstone voids every late or
      // replayed change for its eid — an edit racing a delete loses
      // deterministically, and nothing can resurrect the id.
      if (dead.get(eid)) continue
      for (let ref of refs) {
        if (ref.name == name && comp?.[ref.col] != null) {
          refWrites.set(`${name}\0${eid}\0${ref.col}`, [ref, eid])
        }
        if (ref.target == name && comp == null) {
          targetDrops.set(`${name}\0${eid}\0${ref.name}\0${ref.col}`, [
            ref,
            eid,
          ])
        }
      }
      // A precondition is the graph's --ff-only: the caller names the value
      // it READ, and a value that has moved since refuses the whole batch
      // rather than clobbering the writer it never saw. Checked here with
      // the other rules so it holds for every entry path by construction —
      // in memory_save it would be reintroduced as a bug by the next door
      // that replaces a body. A batch guarding two columns and losing one
      // keeps NEITHER: partial application is how you end up with a body
      // from one writer and a title from another.
      if (was) {
        // Read through the PROJECTION (select()), so a reference column reads
        // back as the eid the caller named in `was` — not the int id it is
        // stored as. The guard columns are readable names (`eid`, refs, scalars).
        let row = prep(db, `${select(name)} where eid = ?`).get(
          eid,
        ) as
          | Record<string, unknown>
          | undefined
        let real = new Set(readable[name])
        for (let [col, want] of Object.entries(was)) {
          // A guard on a column that doesn't exist would read undefined,
          // compare equal to null, and protect nothing — the precondition
          // failing OPEN, which is the original bug wearing a safety label.
          // A typo is refused here, the way `admitted` refuses one in comp.
          if (!real.has(col)) throw new Error(`unknown column: ${name}.${col}`)
          let cur = row?.[col] ?? null
          if ((cur == null ? null : sha(cur)) == want) continue
          throw new Stale(eid, name, col, cur, human(db, eid))
        }
      }
      // A claim is a LEASE, not a patch: taking one over another session's
      // claim fails the whole batch loudly — release, then claim. The same
      // session re-claiming is a no-op refresh. apply() runs serially on
      // the one db handle, so check-then-write here IS the atomic take.
      if (name == 'claim' && comp) {
        // claim.session and the owner are int ids; project the current
        // holder's session eid (for the != comp.session eid compare) and its
        // label. `eid` is the claimed entity's eid (claim is keyed by it).
        let cur = prep(
          db,
          `
          select cs.eid as session, s.id as id from claim c
          left join session s on s.entity = c.session
          left join entity cs on cs.id = c.session
          where c.entity = (select id from entity where eid = ?)
        `,
        ).get(eid) as { session: string; id: string | null } | undefined
        if (cur && cur.session != comp.session) {
          let loser = prep(
            db,
            `select s.id as id from session s
             join entity o on o.id = s.entity where o.eid = ?`,
          ).get(String(comp.session)) as { id: string } | undefined
          bounced = {
            target: eid,
            loser: loser?.id ?? String(comp.session),
            holder: cur.id ?? cur.session,
          }
          // The holder is named by its session LABEL when it has one —
          // that's a name someone chose, not an eid; only the fallback
          // needs speaking.
          throw new Error(
            `${human(db, eid)} already claimed by ${
              cur.id ?? human(db, cur.session)
            }`,
          )
        }
        // A lease is temporary; having done the work is not. The edge is the
        // durable, indexed truth used by Session Tiles. Insert it in the same
        // transaction as the claim and echo only its first landing so every
        // live cache learns the relation without a fetch or a journal read.
        let session = String(comp.session)
        if (
          prep(
            db,
            `
            insert or ignore into dependency (parent, type, child)
            values (?, 'worked', ?)
          `,
          ).run(toId(db, session), toId(db, eid)).changes
        ) {
          touched.add(session)
          touched.add(eid)
          extra.push({
            eid: session,
            name: 'dependency',
            comp: { type: 'worked', child: eid },
          })
        }
        // A claim IS wip now (D-24102): status is derived, so the claim's mere
        // presence makes an open task read wip — no stored move to synthesize,
        // and none to get stuck when the session dies and the claim is reaped.
      }
      // A stop_request is a lever, not a note: it may only be pulled on a
      // managed session that is still going — anything else is refused
      // loudly, like a bounced claim. (The stop itself is an EFFECT,
      // post-commit; this gate is the rule half.)
      if (name == 'stop_request' && comp?.target) {
        // session facets are int-keyed now: the target session's own eid names
        // its row, and every entry-borne facet joins the entry by its owner
        // int (e.entity), the id that was formerly e.eid.
        let target = String(comp.target)
        let s = prep(
          db,
          `select s.origin as origin, s.status as status from session s
           join entity o on o.id = s.entity where o.eid = ?`,
        )
          .get(target) as
            | { origin: string; status: string | null }
            | undefined
        let graph = !!prep(
          db,
          `select 1 from entry e
           where e.session = (select id from entity where eid = ?) and (
             exists (select 1 from lease l where l.entity = e.entity)
             or (
               not exists (select 1 from imported i where i.entity = e.entity)
               and not exists (select 1 from error x where x.entity = e.entity)
               and not exists (
                 select 1 from cancel z where z.target = e.entity
               )
               and (
                 (exists (select 1 from generation g where g.entity = e.entity)
                  and not exists (
                    select 1 from delivered d where d.entity = e.entity
                  ))
                 or
                 (exists (select 1 from call c where c.entity = e.entity)
                  and not exists (
                    select 1 from result r where r.call = e.entity
                  ))
               )
             )
           ) limit 1`,
        ).get(target)
        if (
          !s || s.origin != 'managed' ||
          (!sessionActive.includes(String(s.status)) && !graph)
        ) {
          throw new Error(
            `stop_request refused: session is ${
              s ? s.status ?? 'external' : 'gone'
            }`,
          )
        }
      }
      // A slug names exactly ONE entity, so every member of an alias's set
      // (the primary `slug` plus each word of `slugs`) must be free or already
      // this eid's — the write-time generalization of the old single-column
      // unique index, now that one entity wears several handles. A patch that
      // touches only `slugs` merges over the stored `slug` so the check sees
      // the whole set; a slug already worn by another entity bounces the batch,
      // the way a taken claim does.
      if (name == 'alias' && comp) {
        let cur = prep(
          db,
          `select slug, slugs from alias
           where entity = (select id from entity where eid = ?)`,
        )
          .get(eid) as { slug: string; slugs: string | null } | undefined
        let slug = (comp.slug ?? cur?.slug ?? null) as string | null
        let extra = (comp.slugs !== undefined ? comp.slugs : cur?.slugs) as
          | string
          | null
        let seen = new Set<string>()
        for (let s of slugsOf({ slug, slugs: extra })) {
          if (seen.has(s)) throw new Error(`alias ${s} is listed twice`)
          seen.add(s)
          let owner = prep(
            db,
            `select o.eid as eid from alias a join entity o on o.id = a.entity
             where o.eid != ? and (a.slug = ?
               or instr(' ' || coalesce(a.slugs, '') || ' ', ' ' || ? || ' ') > 0)`,
          ).get(eid, s, s) as { eid: string } | undefined
          if (owner) {
            throw new Error(`alias ${s} already names ${human(db, owner.eid)}`)
          }
        }
      }
      // A board IS its query (membership is never stored), so a query the
      // grammar can't parse is a board that will never match anything and
      // never say why. The parser already knows — `task list .zzz=1`
      // errors — so refuse at the door, while the typo is still in front
      // of whoever made it. Empty stays legal: it selects nothing.
      if (name == 'board' && comp?.query != null) {
        try {
          parseQuery(String(comp.query))
        } catch (e) {
          throw new Error(
            `board query refused: ${e instanceof Error ? e.message : e}`,
          )
        }
      }
      // A comment's identity is CREATED, never reused. The wire is
      // patch-by-design (M-17872), so a client that reuses an eid for a SECOND
      // comment silently DISPLACES the first: the doc.body change (processed
      // just before this one) patches over the live comment, and the earlier
      // note is lost with no trace (T-23428 — two sequential comments collided
      // on one eid). No legit path re-asserts comment-hood on an entity that
      // already wears it: editing a body sends `doc` alone, never the `comment`
      // component again. So a `comment` component landing on an entity that is
      // ALREADY a comment is identity reuse — bounce the whole batch loudly, the
      // way a taken claim or alias does, rolling back the displacing doc write
      // with it, for every entry path (CLI, MCP, raw graph_apply, deno eval).
      if (name == 'comment' && comp) {
        if (
          prep(
            db,
            `select 1 from comment
             where entity = (select id from entity where eid = ?)`,
          ).get(eid)
        ) {
          throw new Error(
            `${human(db, eid)} is already a comment — mint a fresh id ` +
              `(comment identity reuse would displace the existing one)`,
          )
        }
      }
      if (name == 'blob' && comp && !CONTENT_EID.test(eid)) {
        throw new Error('blob eid must be its SHA-256')
      }
      if (comp == null) {
        if (name != 'entity') {
          if (
            prep(
              db,
              `delete from ${sqlName(name)}
               where entity = (select id from entity where eid = ?)`,
            ).run(eid).changes
          ) {
            took(eid, name)
          }
          continue
        }
        // A redaction is the durable fact that bytes were deliberately
        // forgotten. The value is gone, but that fact may not be erased —
        // redacting a redaction would recreate the very ambiguity this audit
        // exists to prevent.
        if (
          prep(
            db,
            `select 1 from redaction
             where entity = (select id from entity where eid = ?)`,
          ).get(eid)
        ) {
          throw new Error(`${human(db, eid)} is a permanent redaction audit`)
        }
        // Death spreads to entities that exist ABOUT the dead one — cards
        // viewing it, comments aimed at it, pins and cameras on a dead
        // canvas or client. The worklist walks that closure first; then
        // soft references let go (claims by a dead session, tasks of a
        // dead project); then every component row goes in reverse
        // declaration order (dependents before their referents), and only
        // then the spines are TOMBSTONED — the identity row is retained
        // forever (D-18866) so its integer id can never recycle into a new
        // entity (C-19754#2), it just leaves the wire. Reference columns are
        // int ids, so every cascade walk resolves the doomed eid to its id
        // first and projects the owner eid back out.
        let doomed = [eid]
        for (let i = 0; i < doomed.length; i++) {
          let did = toId(db, doomed[i])
          if (did == null) continue
          for (let [t, col] of AIMED) {
            let rows = prep(
              db,
              `select o.eid as eid from ${sqlName(t)} r
               join entity o on o.id = r.entity
               where r.${sqlName(col)} = ?`,
            ).all(did) as { eid: string }[]
            for (let r of rows) {
              if (!doomed.includes(r.eid)) doomed.push(r.eid)
            }
          }
        }
        for (let d of doomed) {
          let did = toId(db, d)
          if (did == null) continue
          // Soft references let go — and the wire HEARS them let go, or
          // every client cache keeps a ghost (a lease whose holder died,
          // a task pointing at a gone project or assignee) until reload.
          // 'release' rows die whole (the claim vanishes, the claimed
          // entity survives) — each one synthesized into the returned
          // batch and the Trace, so removed(claim) hooks fire like any
          // deliberate release. 'detach' columns just null. A casualty's
          // own entity-null already says everything, so only SURVIVORS
          // get a change.
          for (let [t, col] of RELEASED) {
            let freed = prep(
              db,
              `select o.eid as eid from ${sqlName(t)} r
               join entity o on o.id = r.entity
               where r.${sqlName(col)} = ?`,
            ).all(did) as { eid: string }[]
            prep(db, `delete from ${sqlName(t)} where ${sqlName(col)} = ?`)
              .run(did)
            for (let { eid: held } of freed) {
              if (doomed.includes(held)) continue
              took(held, t)
              touched.add(held)
              extra.push({ eid: held, name: t, comp: null })
            }
          }
          for (let [t, col] of DETACHED) {
            let homed = prep(
              db,
              `select o.eid as eid from ${sqlName(t)} r
               join entity o on o.id = r.entity
               where r.${sqlName(col)} = ?`,
            ).all(did) as { eid: string }[]
            prep(
              db,
              `update ${sqlName(t)} set ${sqlName(col)} = null
                      where ${sqlName(col)} = ?`,
            ).run(did)
            for (let { eid: orphan } of homed) {
              if (doomed.includes(orphan)) continue
              touched.add(orphan)
              extra.push({ eid: orphan, name: t, comp: { [col]: null } })
            }
          }
          for (let c of Object.keys(cmps).toReversed()) {
            if (c != 'entity') {
              if (
                prep(db, `delete from ${sqlName(c)} where entity = ?`).run(did)
                  .changes
              ) {
                took(d, c)
              }
            }
          }
          prep(db, 'delete from dependency where parent = ? or child = ?').run(
            did,
            did,
          )
        }
        for (let d of doomed) {
          // The num rides into the grave: a dead entity keeps its name
          // answerable, and the allocator's high-water mark survives it. The
          // spine row is RETAINED (never `delete from entity`) so its id is
          // never reissued; the tombstone is the liveness marker every read
          // excludes on.
          prep(
            db,
            `insert or ignore into tombstone (eid, num, deleted_at)
             values (?, (select num from entity where eid = ?), ?)`,
          ).run(d, d, new Date().toISOString())
          if (d != eid) extra.push({ eid: d, name: 'entity', comp: null })
        }
        continue
      }
      if (name == 'entity') {
        // a bare touch mints the spine; nothing to patch
        if (spine(db, eid).changes) minted.add(eid)
        continue
      }
      let sent = cols.filter((c) => c in comp)
      // A reference column stores the target's int id; resolve the sent eid to
      // it (null passes through). refToId REFUSES a non-null eid that names no
      // live entity — the pre-mint pass above already minted every in-batch
      // referent's spine, so an unresolved eid is a genuine ghost (or a
      // tombstone), exactly what the old entity(eid) FK bounced. Plain scalars
      // keep their bound value.
      let vals = sent.map((c) =>
        name == 'doc' && c == 'body' && comp[c] != null
          ? textBlob(db, String(comp[c]))
          : isRef(name, c)
          ? refToId(db, name, eid, c, comp[c])
          : bound(name, c, comp[c])
      )
      // Update first (a patch can't re-satisfy not-null columns an insert
      // would demand). An existing row implies an existing spine. An FK
      // bounce here fails the batch with its offender named — the outer
      // catch rolls everything back, like the claim lease.
      let hit: number | bigint = 0
      if (sent.length) {
        try {
          hit = prep(
            db,
            `update ${sqlName(name)} set ${
              sent.map((c) => `${sqlName(c)} = ?`).join(', ')
            }
             where entity = (select id from entity where eid = ?)`,
          ).run(...vals, eid).changes
        } catch (e) {
          throw refused(db, name, eid, comp, e) ?? e
        }
      }
      if (hit) continue
      // Both doc values are wire-defaulted at the sole writer. Storage cannot
      // express a dynamic default for body (the empty string's blob id), so a
      // title-only create lands that reference here. This runs only after the
      // update missed; a patch never clobbers the other value.
      if (name == 'doc' && comp) {
        if (!('title' in comp)) {
          sent = ['title', ...sent]
          vals = ['', ...vals]
        }
        if (!('body' in comp)) {
          sent.push('body')
          vals.push(textBlob(db, ''))
        }
      }
      // No row: this change CREATES — spine + comp together, in a savepoint.
      // A known component that reaches SQL must land or fail its whole
      // batch: "applied N change(s)" means every accepted row landed.
      // Semantic no-ops (unknown comps, invalid edges, dead eids) were
      // decided above, before SQL.
      db.exec('savepoint change')
      try {
        if (spine(db, eid).changes) minted.add(eid)
        if (name == 'entry' && sent.length) {
          let session = String(comp.session)
          let sid = toId(db, session)
          let { seq } = prep(
            db,
            `select coalesce(max(seq), 0) + 1 as seq from entry
             where session = ?`,
          ).get(sid) as { seq: number }
          // entry owner and session are int ids; the owner spine was minted
          // above, the session must already exist for the entry to append.
          prep(db, 'insert into entry (entity, session, seq) values (?, ?, ?)')
            .run(toId(db, eid), sid, seq)
          // A graph-native session has no log FILE to tail, so its summary
          // is advanced here at the single door that assigns seq — same
          // transaction, so entry.seq and session.latest_seq cannot drift.
          // Not cast (like the JSONL tail, T-7063): it rides the snapshot's
          // whole-row select, not a per-entry broadcast.
          prep(db, 'update session set latest_seq = ? where entity = ?')
            .run(seq, sid)
          createdComps.add(`${name} ${eid}`)
          t?.created.add(`${name} ${eid}`)
          extra.push({ eid, name: 'entry', comp: { eid, seq } })
        } else if (sent.length) {
          prep(
            db,
            `insert into ${sqlName(name)} (entity${
              sent.map((c) => `, ${sqlName(c)}`).join('')
            })
             values ((select id from entity where eid = ?)${
              ', ?'.repeat(sent.length)
            })`,
          ).run(eid, ...vals)
          createdComps.add(`${name} ${eid}`)
          t?.created.add(`${name} ${eid}`)
        } else {
          // A bare {} touch: create with defaults if possible, else no-op.
          let made = prep(
            db,
            `insert or ignore into ${sqlName(name)} (entity)
               values ((select id from entity where eid = ?))`,
          )
            .run(eid).changes
          if (made) {
            createdComps.add(`${name} ${eid}`)
            t?.created.add(`${name} ${eid}`)
          }
        }
        db.exec('release change')
      } catch (e) {
        // Decode BEFORE the rollback: FK diagnostics need the freshly
        // minted spine so the entity's eid can't read as a false offender.
        let refusal = refused(db, name, eid, comp, e)
        db.exec('rollback to change')
        db.exec('release change')
        throw refusal ?? e // the outer catch rolls the whole batch back
      }
    }
    // Canonical session facets are the read truth. Mirror their final state
    // after every component patch, including a deletion, so a rollback server
    // and an old client see the same values without gaining stamp authority.
    syncFacetAliases(db, changes, extra)
    // Components have landed, so each new spine's KIND is finally knowable —
    // assign the human number spine() no longer mints at birth (T-3684). Only
    // the spines born in THIS batch, still inside the transaction, so every
    // downstream reader here (the proposed-not-decided check, effects, the
    // journal) and the births echo below all see the num rather than a NULL.
    for (let eid of minted) mintNum(db, eid)
    for (let [ref, eid] of refWrites.values()) {
      let refusal = refRefused(db, ref, eid)
      if (refusal) throw refusal
    }
    for (let [ref, target] of targetDrops.values()) {
      let refusal = refRefused(db, ref, undefined, target)
      if (refusal) throw refusal
    }
    // A proposal does not authorize an agent spawn. This rule sits after
    // every write so deciding and spawning in one batch works, and before
    // commit so every door — including a raw session request — gets the same
    // refusal.
    let request = prep(
      db,
      `select rt.eid as requested_task from session s
       join entity o on o.id = s.entity
       left join entity rt on rt.id = s.requested_task
       where o.eid = ?`,
    )
    let pending = prep(
      db,
      `
      select 1 from proposed p
      left join decided d on d.entity = p.entity
      where p.entity = (select id from entity where eid = ?) and d.entity is null
    `,
    )
    for (let key of createdComps) {
      if (!key.startsWith('session ')) continue
      let eid = key.slice('session '.length)
      let row = request.get(eid) as
        | { requested_task: string | null }
        | undefined
      let target = row?.requested_task
      if (!target || !pending.get(target)) continue
      let id = human(db, target)
      throw new Error(
        `${id} is proposed but not decided — accept it with ` +
          `task set ${id} .decided.at=now .decided.by=U-3709`,
      )
    }
    // One clock for the whole batch: every provenance stamp below reads it,
    // so a birth and the edits beside it agree instead of drifting by the
    // milliseconds between two `new Date()` calls (T-6670).
    let now = new Date().toISOString()
    // Taking a task again pops it; settling one removes it. Releasing an
    // unsettled task pushes it for the holder's actor. A wrap releases several
    // claims in one batch, so claimed_at supplies their nested order and rank
    // preserves it after those lease rows are gone.
    let finalClaims = new Set(
      (prep(
        db,
        'select o.eid as eid from claim c join entity o on o.id = c.entity',
      ).all() as { eid: string }[])
        .map((r) => r.eid),
    )
    // Status is derived (D-24102): settled = wears completed or cancelled. A
    // non-task eid returns no row, exactly as the old `select status` did.
    let settledRow = prep(
      db,
      `select (
         exists(select 1 from cancelled x where x.entity = t.entity)
         or exists(select 1 from completed x where x.entity = t.entity)
       ) as settled
       from task t where t.entity = (select id from entity where eid = ?)`,
    )
    let clear = new Set(
      changes.filter((c) =>
        c.name == 'claim' || c.name == 'task' || c.name == 'completed' ||
        c.name == 'cancelled'
      )
        .map((c) => c.eid),
    )
    for (let eid of clear) {
      let task = settledRow.get(eid) as { settled: number } | undefined
      if (!finalClaims.has(eid) && task && !task.settled) continue
      if (
        prep(
          db,
          'delete from resume where entity = (select id from entity where eid = ?)',
        ).run(eid).changes
      ) {
        took(eid, 'resume')
        extra.push({ eid, name: 'resume', comp: null })
      }
    }
    let released = priorClaims
      .filter((c) => !finalClaims.has(c.eid))
      .filter((c) => {
        let task = settledRow.get(c.eid) as { settled: number } | undefined
        return task && !task.settled
      })
      .map((c) => ({ ...c, actor: c.actor ?? ventureAt(db, c.cwd) }))
      .filter((c) => c.actor)
      .sort((a, b) =>
        a.claimed_at.localeCompare(b.claimed_at) ||
        a.claim_order - b.claim_order
      )
    let top = Number(
      (prep(db, 'select coalesce(max(rank), 0) as rank from resume')
        .get() as {
          rank: number
        }).rank,
    )
    let push = prep(
      db,
      `
      insert into resume (entity, actor, at, rank)
      values ((select id from entity where eid = ?), ?, ?, ?)
      on conflict(entity) do update set actor = excluded.actor,
        at = excluded.at, rank = excluded.rank
    `,
    )
    for (let item of released) {
      let comp = { actor: String(item.actor), at: now, rank: ++top }
      push.run(item.eid, toId(db, comp.actor), comp.at, comp.rank)
      extra.push({ eid: item.eid, name: 'resume', comp })
    }
    // A session that RAN somewhere but names no actor gets one from where
    // it stands — the writing identity is never blank (T-6669). Resolved
    // from the session row's CURRENT cwd (not a client's stale snapshot,
    // the bug that left real sessions blank when cwd and reify split across
    // batches): the venture whose repo holds the cwd, else the box owner.
    // actor stays wire-writable — a batch that named an actor keeps it;
    // the server only fills the gap, and only for a session with a cwd (a
    // real run, never an abstract fixture), so the fill heals old blanks on
    // their next touch. It rides the return so caches hear it.
    let fill = prep(
      db,
      'update session set actor = ? where entity = (select id from entity where eid = ?)',
    )
    let has = prep(
      db,
      `select s.cwd as cwd, act.eid as actor from session s
       join entity o on o.id = s.entity
       left join entity act on act.id = s.actor
       where o.eid = ?`,
    )
    for (let eid of touched) {
      let s = has.get(eid) as
        | { cwd: string | null; actor: string | null }
        | undefined
      if (!s || s.actor || !s.cwd) continue
      let a = ventureAt(db, s.cwd)
      if (a) {
        fill.run(refId(db, a), eid)
        extra.push({ eid, name: 'session', comp: { actor: a } })
      }
    }
    // Provenance components (T-6670): who + when, paired. `created` is set
    // once at birth — `by` the author (the wire's, else the writing actor);
    // `updated` is the LAST edit, absent until the first touch after birth.
    // `at` is server-frozen; the wire's `by` (saidCreator/saidEditor) is
    // kept, the gap defaulted to the actor. Both ride the return so caches
    // hear them, like the session fill above.
    let actor = writerActor(db, writer)
    let via = writerVia(db, writer)
    // An entity minted then deleted in the same batch (or rolled back by its
    // savepoint) has no LIVE spine — a tombstoned entity keeps its row but is
    // dead, so the guard is presence AND not tombstoned. `by`/`via` are int
    // ids now; resolve them on write and re-read through the projection
    // (readComp) so the echoed change carries eids.
    let actorId = refId(db, actor)
    let viaId = refId(db, via)
    let alive = prep(
      db,
      `select 1 from entity e where e.eid = ?
       and not exists (select 1 from tombstone t where t.eid = e.eid)`,
    )
    let cNew = prep(
      db,
      `insert or ignore into created (entity, at, "by", via)
       values ((select id from entity where eid = ?), ?, ?, ?)`,
    )
    let cVia = prep(
      db,
      'update created set at = ?, via = ? where entity = (select id from entity where eid = ?)',
    )
    for (let eid of minted) {
      if (!alive.get(eid)) continue
      if (saidCreator.has(eid)) cVia.run(now, viaId, eid)
      else cNew.run(eid, now, actorId, viaId)
      let row = readComp(db, eid, 'created')
      if (row) extra.push({ eid, name: 'created', comp: row })
    }
    let uSet = prep(
      db,
      `insert into updated (entity, at, "by", via)
       values ((select id from entity where eid = ?), ?, ?, ?)
       on conflict(entity) do update set at = excluded.at, "by" = excluded."by",
       via = excluded.via`,
    )
    let uAt = prep(
      db,
      'update updated set at = ?, via = ? where entity = (select id from entity where eid = ?)',
    )
    for (let eid of touched) {
      if (minted.has(eid) || !alive.get(eid)) continue // birth writes created
      if (saidEditor.has(eid)) uAt.run(now, viaId, eid)
      else uSet.run(eid, now, actorId, viaId)
      let row = readComp(db, eid, 'updated')
      if (row) extra.push({ eid, name: 'updated', comp: row })
    }
    // The ingest coordinate (D-16704), stamped beside the entry it marks so
    // the pair (entry, imported) commits atomically. Only the trusted append
    // path passes `imports`; the wire never does. It rides `extra` (not the
    // `echoed` set below), so it reaches the journal and every replaying
    // cache — the coordinate is the durable cursor and must not be lost.
    if (imports) {
      let stampImported = prep(
        db,
        `insert into imported (entity, source, line)
         values ((select id from entity where eid = ?), ?, ?)`,
      )
      for (let [eid, coord] of imports) {
        if (!alive.get(eid)) continue
        stampImported.run(eid, coord.source, coord.line)
        extra.push({ eid, name: 'imported', comp: { eid, ...coord } })
      }
    }
    // The stamp family (notified/opened/archived/decided/proposed): fill the
    // actor GAP
    // and stamp the instrument, on insert only — then re-read the row so an
    // optimistic cache never keeps a blank stamp. The created/updated re-read,
    // generalized to one small loop.
    //
    // `coalesce` is what lets one loop serve both halves of the family: a
    // notification stamp can't carry a wire `by` (the column isn't in comps),
    // so filling it is unconditional there; `decided` can, and a caller who
    // named the decider keeps it. Insert-only for the same reason `created`
    // is: correcting a decision's date later doesn't change who wrote it down,
    // and the correction is journaled anyway.
    for (let { eid, name, comp } of changes) {
      if (comp == null || !stamps.includes(name) || !alive.get(eid)) continue
      if (createdComps.has(`${name} ${eid}`)) {
        prep(
          db,
          `update ${sqlName(name)} set "by" = coalesce("by", ?), via = ?
           where entity = (select id from entity where eid = ?)`,
        ).run(actorId, viaId, eid)
      }
      let row = readComp(db, eid, name)
      if (row) extra.push({ eid, name, comp: row })
    }
    // Clocked presence facets freeze their insertion time. Re-reading on every
    // effective presence write keeps an optimistic cache complete, while only
    // a delete followed by a fresh insert can move the clock.
    for (let { eid, name, comp } of changes) {
      if (comp == null || !clocked.includes(name) || !alive.get(eid)) continue
      if (createdComps.has(`${name} ${eid}`)) {
        prep(
          db,
          `update ${sqlName(name)} set at = ?
           where entity = (select id from entity where eid = ?)`,
        ).run(now, eid)
      }
      let row = readComp(db, eid, name)
      if (row) extra.push({ eid, name, comp: row })
    }
    // The mail SENDER, derived. `from` is off the wire (types.ts), so this
    // is its only writer: a letter speaks as the actor that WROTE it, the
    // same resolution behind created.by. No caller can sign as anyone else
    // (T-9511), and nothing signs as the fleet default any more (T-9489).
    //
    // An actor with no address leaves `from` empty rather than failing the
    // batch — writing the graph is not sending, and a fixture that mints a
    // mail is not asking to deliver one. The refusal belongs at delivery,
    // where mailed() stamps the error onto the row and the board shows it.
    //
    // Inbound arrives through this door too (inbound.ts mint), and its
    // message_id — the never-send mark — is stamped just AFTER apply. So a
    // swept row is stamped here as well and corrected a moment later by that
    // same stamp, before dispatch hands anything to delivery. Only the
    // intermediate cast ever carries the derived value.
    let addrOf = prep(
      db,
      'select address from email where entity = (select id from entity where eid = ?)',
    )
    let sender = prep(
      db,
      'update mail set "from" = ? where entity = (select id from entity where eid = ?)',
    )
    for (let key of createdComps) {
      if (!key.startsWith('mail ')) continue
      let eid = key.slice(5)
      if (!alive.get(eid)) continue
      let signer = senderActor(db, writer)
      let addr = signer
        ? (addrOf.get(signer) as { address: string } | undefined)?.address
        : undefined
      if (!addr) continue
      sender.run(addr, eid)
      extra.push({ eid, name: 'mail', comp: { eid, from: addr } })
    }
    // A create may omit columns that SQLite defaults. The persisted row is
    // complete, so make the last write for that new component complete too:
    // a live cache then sees the same writable shape as a fresh snapshot in
    // this one atomic batch. Read only `cmps` — server-owned columns still
    // ride through their explicit stamped echoes, never as client-writable
    // data.
    for (let key of createdComps) {
      let cut = key.indexOf(' ')
      let name = key.slice(0, cut)
      let eid = key.slice(cut + 1)
      let cols = cmps[name]
      if (!cols.length) continue
      // Project through select() so reference columns read back as eids, then
      // keep only the wire-writable cmps columns (server-owned stamped columns
      // ride their own explicit echoes, never this client-writable shape).
      let full = readComp(db, eid, name)
      let row = full &&
        Object.fromEntries(
          cols.filter((c) => c in full).map((c) => [c, full[c]]),
        ) as Change['comp']
      if (!row) continue
      let i = changes.findLastIndex((change) =>
        change.eid == eid && change.name == name && change.comp != null
      )
      if (i >= 0) changes[i] = { ...changes[i], comp: row }
    }
    // Births ride the return AFTER stamping, so the spine arrives final.
    // A mint rolled back by its savepoint (or deleted later in the batch)
    // has no row — the select is the guard. entity === eid: only identity
    // rides now (T-6670), the timestamps travel as their components above.
    let born = prep(
      db,
      `select eid, num from entity e where e.eid = ?
       and not exists (select 1 from tombstone t where t.eid = e.eid)`,
    )
    for (let eid of minted) {
      let row = born.get(eid) as Change['comp'] | undefined
      if (row) extra.push({ eid, name: 'entity', comp: row })
    }
    // The wire's record: one row per batch, inside the transaction — the
    // batch as APPLIED (reasons rewritten into comments, cascades and
    // births synthesized), so the record includes what the rules did, not
    // just what was asked. The server-stamped echoes are LEFT OUT: created/
    // updated and the notification stamps repeat the journal's provenance
    // envelope. Recording never throws: a broken journal must not break the
    // write it records.
    try {
      // Only the server-STAMPED provenance echoes (extra) are dropped —
      // created/updated and the notification stamps (stampedPresence) just
      // repeat the ts + actor + via the journal row keeps. The wire's own
      // write (the bare presence, an authorship `by`) rides in `changes` and
      // stays audited.
      let echoed = new Set(['created', 'updated', ...stamps, ...clocked])
      let logged = [...changes, ...extra.filter((c) => !echoed.has(c.name))]
      if (logged.length) {
        // The Trace, journaled — but only when the caller DEFERRED its
        // dispatch to the journal feed (a fed() trace). A plain trace()
        // means the call site dispatches itself, and an absent trace
        // means no effects at all (the runner's deliberate effect-free
        // applies) — either way the feed must not fire them again.
        let trace = t?.fed
          ? JSON.stringify({
            created: [...createdComps],
            removed: [...removedLog],
          })
          : null
        let jrow = Number(
          prep(
            db,
            'insert into journal (ts, actor, via, batch, trace) values (?, ?, ?, ?, ?)',
          )
            .run(
              now,
              actor, // the resolved writing actor (T-6669), same as the by-default
              via,
              JSON.stringify(logged),
              trace,
            ).lastInsertRowid,
        )
        touchJournal(db, jrow, logged)
        // The normalized parallel record (T-18878), same transaction, same
        // `logged` — the JSON row above stays authoritative. journal_tx.id is
        // that JSON row's rowid, so the two logs share one transaction identity.
        journalNormalized(db, jrow, now, actor, via, trace, logged)
      }
    } catch (e) {
      console.warn('journal skipped —', e)
    }
    db.exec('commit')
    return [...changes, ...extra]
  } catch (e) {
    rollback(db)
    if (bounced) {
      try {
        db.exec('begin')
        let ceid = crypto.randomUUID()
        spine(db, ceid)
        prep(
          db,
          `insert into conflict (entity, target, loser, holder)
           values ((select id from entity where eid = ?), ?, ?, ?)`,
        ).run(ceid, refId(db, bounced.target), bounced.loser, bounced.holder)
        mintNum(db, ceid) // spine no longer numbers at birth (T-3684)
        db.exec('commit')
      } catch (audit) {
        rollback(db)
        console.warn('conflict audit failed —', audit) // never mask the claim error
      }
    }
    throw e
  }
}

// The Vocabulary doc — the schema, written INTO the graph it describes.
// Alias-keyed upsert (slug `vocabulary`), regenerated every boot with a
// body the caller rendered from the live structures (schema.ts), the
// FTS-heal pattern for documentation: stale by at most one restart. A
// no-op when the body already matches, so a quiet boot journals nothing.
// Anyone may edit the doc between boots; the next boot writes it back —
// server-minted, like every stamped column.
export let vocabularyDoc = (db: DatabaseSync, body: string): void => {
  let cur = prep(
    db,
    `
    select ae.eid as eid, d.body from alias a
    join entity ae on ae.id = a.entity
    left join doc_value d on d.entity = a.entity
    where a.slug = 'vocabulary'
  `,
  ).get() as { eid: string; body: string | null } | undefined
  if (cur?.body == body) return
  let eid = cur?.eid ?? crypto.randomUUID()
  apply(
    db,
    [
      { eid, name: 'doc', comp: { title: 'Vocabulary', body } },
      { eid, name: 'alias', comp: { slug: 'vocabulary' } },
    ],
    undefined,
    'server',
  )
}

// The seek-index side of a journal write (T-13915): one journal_touch row per
// distinct eid the batch touched, so journalOf & kin seek instead of scanning.
// Indexes the same eids json_extract(value,'$.eid') found — every change's own
// eid — so the reads it replaces stay behavior-identical. Called inside the
// caller's transaction, beside the journal insert it describes.
let touchJournal = (db: DatabaseSync, jrow: number, changes: Change[]) => {
  let ins = prep(db, 'insert into journal_touch (jrow, eid) values (?, ?)')
  for (let eid of new Set(changes.map((c) => c.eid))) ins.run(jrow, eid)
}

// The NORMALIZED journal write (D-18860/D-18861) — the parallel record beside
// the JSON `journal` row, DUAL-WRITE (T-18878): same transaction, same `logged`
// array, so the two can never disagree. journal_tx keeps the batch's provenance;
// journal_change one ordered operation per Change; journal_field the ordered
// after-image, present rows for an upsert and tombstones for a removal. Derived
// wholly from `logged` plus the append-only field log itself, so it touches
// nothing in the change loop. Called inside the caller's transaction, beside the
// JSON insert it mirrors; the caller's try guards it — a broken parallel record
// must not break the write it records, exactly like the JSON journal.
//
// `tx` is the JSON journal row's rowid, written as journal_tx.id EXPLICITLY so
// the two logs share ONE transaction identity (journal.rowid = journal_tx.id):
// a monotonic total order that never rests on ts, a free join for every reader
// (T-18880), and the key the history backfill (T-18879) skips on to stay
// idempotent. This is the SINGLE derivation both the live dual-write and the
// backfill drive, so the parallel record cannot fork a second, drifting shape.
export let journalNormalized = (
  db: DatabaseSync,
  tx: number,
  ts: string,
  actor: string | null,
  via: string | null,
  trace: string | null,
  logged: Change[],
) => {
  prep(
    db,
    'insert into journal_tx (id, ts, actor, via, trace) values (?, ?, ?, ?, ?)',
  ).run(tx, ts, actor, via, trace)
  let insChange = prep(
    db,
    `insert into journal_change (tx, ordinal, eid, component, operation)
     values (?, ?, ?, ?, ?)`,
  )
  let insField = prep(
    db,
    `insert into journal_field (change, ordinal, field, present, value)
     values (?, ?, ?, ?, ?)`,
  )
  // The fields (eid, component) still shows as present: newest after-image wins
  // — journal_field.id is monotonic, so the max-id row per field is the latest
  // in total order (and reads THIS batch's earlier upserts, uncommitted but
  // visible on the same connection). A component with no baseline yet (older
  // than dual-write, until T-18879 backfills) names none, so it tombstones none.
  let present = prep(
    db,
    `select field from (
       select jf.field as field, jf.present as present,
              row_number() over (partition by jf.field order by jf.id desc) as rn
       from journal_field jf join journal_change jc on jc.id = jf.change
       where jc.eid = ? and jc.component = ?
     ) where rn = 1 and present = 1`,
  )
  logged.forEach(({ eid, name, comp }, ordinal) => {
    let change = Number(
      insChange.run(tx, ordinal, eid, name, comp == null ? 'remove' : 'upsert')
        .lastInsertRowid,
    )
    if (comp == null) {
      // A component removal tombstones every field it still had, so field
      // history stays self-contained across a removal and a later recreation.
      ;(present.all(eid, name) as { field: string }[]).forEach(({ field }, i) =>
        insField.run(change, i, field, 0, null)
      )
    } else {
      // An upsert records one present after-image per field, JSON-encoded so a
      // present null (present=1, value='null') stays distinct from a tombstone.
      // An empty component writes none — its journal_change alone marks presence.
      Object.keys(comp).forEach((field, i) =>
        insField.run(change, i, field, 1, JSON.stringify(comp[field]))
      )
    }
  })
}

// One journal `batch` column decoded, or null if the row is a known-corrupt
// torn write — a batch that is not parseable JSON (row #2106568, invalid bytes
// from the Aug'25 SIGBUS/ENOSPC incident; T-24020). The normalized readers skip
// such a row as an honest gap (the backfill wrote no journal_tx for it), and the
// JSON readers still authoritative until T-18883 (the backfill itself, and the
// redaction scrubber) share that policy: warn once and skip, so one torn row
// cannot break a whole-log scan for the entire timeline. The catch is narrow,
// around the parse alone, so a real bug still surfaces.
let parseBatch = (batch: string, rowid: number): Change[] | null => {
  try {
    return JSON.parse(batch) as Change[]
  } catch (e) {
    console.warn(`journal: skipping unparseable batch #${rowid} —`, e)
    return null
  }
}

// Backfill the EXISTING JSON journal history into the normalized tables
// (T-18879), so the parallel record covers ALL of history and not merely the
// writes since dual-write (T-18878) began. Every legacy `journal` row is parsed
// back into its Change[] and driven through the SAME journalNormalized()
// derivation the live writer uses — one code path, so the two can never fork —
// with journal_tx.id = the JSON row's rowid, which preserves the original total
// order (rowid is monotonic in apply order) and every within-batch ordinal.
//
// Canonical form: each parsed change is passed through renamed() — exactly what
// admitted() does before a live write logs — so a batch predating a forward
// rename records the column spelling today's writer would produce, and one
// entity's field history (predecessor lookup, tombstones) stays consistent
// across the rename boundary. renamed() is add-only and idempotent, so on an
// already-canonical batch (every batch today: the live rename map is empty) it
// is the identity. Values are recorded verbatim — a doc body stays inline text
// (casBodies journals the body inline and prepends a separate content-addressed
// `blob` change; it never rewrites doc.body), and an entity/edge reference is
// already its eid — so the derivation is a faithful round-trip of what the batch
// holds.
//
// BASELINE (D-18861): because rows are processed in ascending rowid order and
// each upsert's present after-images accumulate in journal_field, a historical
// component removal tombstones exactly the fields present per the BACKFILLED
// record up to that point — the predecessor frontier is established by the
// backfill itself, not by live-only state.
//
// RESTARTABLE & IDEMPOTENT: a `journal_backfill` high-water mark in server_meta
// records the highest rowid contiguously backfilled. Absent means no backfill
// has run: the interim dual-write rows written before this identity mapping
// existed carry auto-increment ids that do NOT equal their rowid, so the first
// run clears the three normalized tables and rebuilds every row keyed by rowid —
// a one-time reset guarded by the absent mark, never repeated. A resumed run
// reads the mark and continues, and a per-row `journal_tx` existence check makes
// a re-run (or a row a concurrent live apply already dual-wrote into the gap) a
// skip rather than a double-insert. Work is chunked: each chunk is one atomic
// transaction that advances the mark, so an interruption loses at most the
// in-flight chunk and never a giant single transaction.
//
// RESILIENCE: a legacy batch that does not parse as JSON is a pre-existing
// corruption (T-24020) that cannot be faithfully derived. The backfill decodes
// through parseBatch, which WARNS and skips exactly that row (advancing past it,
// leaving an honest gap with no journal_tx) rather than aborting the whole
// migration; the catch is narrow, around the parse alone, so a real derivation
// bug still surfaces. The remaining JSON readers (the redaction scrubber) share
// that helper and policy. Returns the count of legacy rows written and of
// unparseable rows skipped this call.
export let backfillJournal = (
  db: DatabaseSync,
  { chunk = 1000, onChunk }: {
    chunk?: number
    onChunk?: (upto: number, wrote: number, skipped: number) => void
  } = {},
): { wrote: number; skipped: number } => {
  let markGet = () =>
    (prep(db, `select v from server_meta where k = 'journal_backfill'`)
      .get() as { v: string } | undefined)?.v
  let markSet = (v: number) =>
    prep(
      db,
      `insert into server_meta (k, v) values ('journal_backfill', ?)
       on conflict(k) do update set v = excluded.v`,
    ).run(String(v))
  let existing = markGet()
  let hwm = existing == null ? 0 : Number(existing)
  if (existing == null) {
    // First run: drop the interim non-identity dual-write rows and establish the
    // baseline mark, atomically, so a rebuilt log is keyed by rowid throughout.
    db.exec('begin immediate')
    db.exec('delete from journal_field')
    db.exec('delete from journal_change')
    db.exec('delete from journal_tx')
    markSet(0)
    db.exec('commit')
  }
  let has = prep(db, 'select 1 from journal_tx where id = ?')
  let page = prep(
    db,
    `select rowid as id, ts, actor, via, batch, trace from journal
     where rowid > ? order by rowid limit ?`,
  )
  let wrote = 0
  let skipped = 0
  for (;;) {
    let rows = page.all(hwm, chunk) as {
      id: number
      ts: string
      actor: string | null
      via: string | null
      batch: string
      trace: string | null
    }[]
    if (!rows.length) break
    db.exec('begin immediate')
    try {
      for (let r of rows) {
        if (!has.get(r.id)) {
          let parsed = parseBatch(r.batch, r.id)
          if (!parsed) {
            // A corrupt, unparseable legacy batch: leave a gap (no journal_tx
            // for this rowid) rather than abort the migration.
            skipped++
            hwm = r.id
            continue
          }
          let logged = parsed.map((c) => renamed(c))
          journalNormalized(db, r.id, r.ts, r.actor, r.via, r.trace, logged)
          wrote++
        }
        hwm = r.id
      }
      markSet(hwm)
      db.exec('commit')
    } catch (e) {
      rollback(db)
      throw e
    }
    onChunk?.(hwm, wrote, skipped)
  }
  return { wrote, skipped }
}

// The journal door for a server STAMP — a write the wire may not carry
// (frozen_at and kin), made by direct SQL beside this call. delta()
// promises catch-up clients the same content the live cast carried, so
// a stamp must reach the journal too, or every tab that boots by replay
// silently loses the column (T-7437). Recording never throws, like the
// journal insert in apply().
export let record = (
  db: DatabaseSync,
  changes: Change[],
  writer?: string | null,
) => {
  try {
    let now = new Date().toISOString()
    let actor = writerActor(db, writer)
    let via = writerVia(db, writer)
    let jrow = Number(
      prep(
        db,
        'insert into journal (ts, actor, via, batch) values (?, ?, ?, ?)',
      )
        .run(now, actor, via, JSON.stringify(changes)).lastInsertRowid,
    )
    touchJournal(db, jrow, changes)
    // The normalized parallel record (T-18878): a server stamp is journaled
    // too, so the two logs stay a faithful pair. journal_tx.id mirrors the JSON
    // row's rowid; no trace — a stamp fires no effects.
    journalNormalized(db, jrow, now, actor, via, null, changes)
  } catch (e) {
    console.warn('journal skipped —', e)
  }
}

export type RedactionResult = {
  changes: Change[]
  audit: string
  target: string
  column: DocColumn
  hash: string
  journalRows: number
  replacements: number
  firstSeen?: string
}

type RedactionJournal = {
  rowid: number
  ts: string
  batch: string
}

let redactionRows = (
  db: DatabaseSync,
  value: string,
): RedactionJournal[] => {
  // journal.batch is JSON, so pre-screen with the JSON-escaped spelling and
  // parse only candidates. The parsed transform below is the authority — this
  // merely avoids decoding every batch in a large graph.
  let encoded = JSON.stringify(value).slice(1, -1)
  return prep(
    db,
    `select rowid, ts, batch from journal
     where instr(batch, ?) > 0 order by rowid`,
  ).all(encoded) as RedactionJournal[]
}

// Garbage-collect unreferenced content-addressed text (D-18862/D-18864). A
// blob's in-db text backend (blob_text) holds the canonical bytes doc.body and
// text attachments share by content hash; forgetting a doc body repoints it at a
// clean blob, which can strand the old content with no live referrer. This
// collects the VALUE — the blob_text row — only when NOTHING needs it: no
// doc.body points at the blob, no attachment.blob does, and it is not itself an
// image facet sharing the sha. A referenced (shared) value is never touched, so
// a body two docs hold survives forgetting one. The blob entity's byte-count
// shell stays (it carries no content and, being content-addressed, no num), so
// a later identical write re-lands the text through textBlob's insert-or-ignore
// and structural dedup is preserved — forgetting removes what was written, it
// does not blacklist the string.
//
// CONCURRENCY: the caller runs this inside a `begin immediate` transaction, and
// SQLite serializes writers, so the referrer test and the delete are ONE atomic
// step against every other write. A value that becomes referenced mid-collection
// cannot be dropped: a writer that referenced it already committed BEFORE this
// transaction (its doc.body row is visible, so the referrer test keeps the
// value), or it blocks on the write lock until AFTER this commits (it then
// reconstructs blob_text through textBlob's insert-or-ignore, restoring the row
// this collection removed). Either order is safe; there is no window in which a
// referrer exists that this transaction cannot see.
//
// `only` scopes the sweep to specific blob eids — redaction passes the old body's
// hash so the cost is O(candidates), not a full blob_text scan. Absent, it sweeps
// every orphaned text value. Returns the eids whose content it collected.
export let collectBlobText = (
  db: DatabaseSync,
  only?: string[],
): string[] => {
  let scope = only?.length
    ? `and o.eid in (${only.map(() => '?').join(', ')})`
    : ''
  let orphans = prep(
    db,
    `select o.eid as eid, bt.entity as id
       from blob_text bt join entity o on o.id = bt.entity
      where not exists (select 1 from doc where body = bt.entity)
        and not exists (select 1 from attachment where blob = bt.entity)
        and not exists (select 1 from image where entity = bt.entity)
        ${scope}`,
  ).all(...(only ?? [])) as { eid: string; id: number }[]
  let del = prep(db, 'delete from blob_text where entity = ?')
  for (let o of orphans) del.run(o.id)
  return orphans.map((o) => o.eid)
}

// Forget one doc value everywhere the graph's write record carried it. This is
// deliberately NOT apply(): changing live state, old journal rows, the derived
// vector and the audit must be one transaction, and the ordinary write path is
// append-only. FTS/gram update synchronously through doc's existing triggers.
// Any failure — including the sanitized audit append — rolls the whole act
// back. The removed bytes never appear in an error or return value.
export let redact = (
  db: DatabaseSync,
  id: string,
  selector: string,
  writer?: string | null,
): RedactionResult => {
  db.exec('begin immediate')
  try {
    let target = resolveId(db, id)
    let targetId = target &&
      (prep(db, 'select id from entity where eid = ?').get(target) as
        | { id: number }
        | undefined)?.id
    if (!target || targetId == null) throw new Error('no such redaction target')

    let doc = prep(
      db,
      `select d.title, d.body from doc_value d
       where d.entity = ?`,
    ).get(targetId) as { title: string; body: string } | undefined
    let named: DocColumn | undefined = selector == '.title' ||
        selector == '.doc.title'
      ? 'title'
      : selector == '.body' || selector == '.doc.body'
      ? 'body'
      : undefined
    let value = named ? doc?.[named] : selector
    if (!value || value == REDACTED) {
      throw new Error(
        named
          ? `redact: ${named} has no value to remove`
          : 'redact: literal has no value to remove',
      )
    }
    if (!named && value.length < 4) {
      throw new Error(
        'redact: a literal needs at least 4 characters; use .title or .body ' +
          'to remove the whole column',
      )
    }

    let rows = redactionRows(db, value)
    let column: DocColumn
    if (named) {
      column = named
    } else {
      let columns = new Set<DocColumn>()
      for (let col of ['title', 'body'] as DocColumn[]) {
        if (doc?.[col]?.includes(value)) columns.add(col)
      }
      for (let row of rows) {
        let batch = parseBatch(row.batch, row.rowid)
        if (!batch) continue
        for (let col of docColumns(batch, target, value)) {
          columns.add(col)
        }
      }
      if (!columns.size) {
        throw new Error('redact: literal was not found on the target document')
      }
      if (columns.size > 1) {
        throw new Error(
          `redact: literal occurs in ${[...columns].join(' and ')}; ` +
            'redact one whole column instead',
        )
      }
      column = [...columns][0]
    }

    let journalRows = 0
    let replacements = 0
    let firstSeen: string | undefined
    let rewrite = prep(db, 'update journal set batch = ? where rowid = ?')
    for (let row of rows) {
      let batch = parseBatch(row.batch, row.rowid)
      if (!batch) continue
      let clean = scrubBatch(batch, value)
      if (!clean.count) continue
      rewrite.run(JSON.stringify(clean.batch), row.rowid)
      journalRows++
      replacements += clean.count
      firstSeen ??= row.ts
    }

    // The normalized parallel record holds the SAME content, and every history/
    // replay reader now reads it (T-18880) — and backups dump it like the JSON
    // journal — so the removed value must leave journal_field too or it leaks
    // through the new door. Scrub every present after-image whose component/
    // field is a content column (scrubBatch's test, lifted to the field rows),
    // in THIS transaction. The pre-screen mirrors redactionRows: the JSON-
    // escaped spelling narrows the scan, the decoded compare is the authority.
    let encoded = JSON.stringify(value).slice(1, -1)
    let scrubField = prep(db, 'update journal_field set value = ? where id = ?')
    let fieldRows = prep(
      db,
      `select jf.id as id, jf.value as value,
              jc.component as component, jf.field as field
       from journal_field jf join journal_change jc on jc.id = jf.change
       where jf.present = 1 and instr(jf.value, ?) > 0`,
    ).all(encoded) as {
      id: number
      value: string
      component: string
      field: string
    }[]
    for (let f of fieldRows) {
      if (!scrubbable(f.component, f.field)) continue
      let decoded = JSON.parse(f.value)
      if (typeof decoded != 'string' || !decoded.includes(value)) continue
      scrubField.run(JSON.stringify(decoded.replaceAll(value, REDACTED)), f.id)
    }

    let docChange: Change | undefined
    if (doc) {
      let old = doc[column]
      let clean = named ? REDACTED : old.replaceAll(value, REDACTED)
      if (clean != old) {
        if (column == 'body') {
          prep(db, 'update doc set body = ? where entity = ?')
            .run(textBlob(db, clean), targetId)
          // Repointing doc.body at the clean blob can strand the old content in
          // its content-addressed backend (D-18862): the doc's UPDATE trigger has
          // just repaired FTS/gram off the still-present old blob_text, so collect
          // it now — but only if no other doc or attachment shares that value.
          // Same transaction, so the referrer test sees this doc already moved.
          collectBlobText(db, [sha(old)])
        } else {
          prep(db, 'update doc set title = ? where entity = ?')
            .run(clean, targetId)
        }
        docChange = { eid: target, name: 'doc', comp: { [column]: clean } }
      }
    }
    // A stale vector can retain the removed meaning until the next sweep.
    // Delete it in the same transaction; embedding's trigger dirties the ANN
    // index and the sweep later embeds only the sanitized doc.
    prep(db, 'delete from embedding where eid = ?').run(target)

    let now = new Date().toISOString()
    let actor = writerActor(db, writer)
    let via = writerVia(db, writer)
    let actorId = refId(db, actor)
    let viaId = refId(db, via)
    let audit = crypto.randomUUID()
    let digest = sha(value)
    spine(db, audit)
    prep(
      db,
      `insert into redaction (entity, target, "column", hash)
       values ((select id from entity where eid = ?), ?, ?, ?)`,
    ).run(audit, targetId, column, digest)
    mintNum(db, audit)
    prep(
      db,
      `insert into created (entity, at, "by", via)
       values ((select id from entity where eid = ?), ?, ?, ?)`,
    ).run(audit, now, actorId, viaId)

    let updated: Change | undefined
    if (docChange) {
      prep(
        db,
        `insert into updated (entity, at, "by", via)
         values (?, ?, ?, ?)
         on conflict(entity) do update set at = excluded.at,
           "by" = excluded."by", via = excluded.via`,
      ).run(targetId, now, actorId, viaId)
      let comp = readComp(db, target, 'updated')
      if (comp) updated = { eid: target, name: 'updated', comp }
    }

    let redaction = {
      eid: audit,
      name: 'redaction',
      comp: readComp(db, audit, 'redaction')!,
    }
    let entity = {
      eid: audit,
      name: 'entity',
      comp: readComp(db, audit, 'entity')!,
    }
    let created = {
      eid: audit,
      name: 'created',
      comp: readComp(db, audit, 'created')!,
    }
    // This forward transaction IS the cursor invalidation (D-18864): the sanitized
    // docChange advances cursorOf, so every returning client's since-delta and
    // every live socket's cast carries the [redacted] value over the one it held —
    // the same append-forward path any write travels. (The durable epoch is NOT
    // rotated: it is the graph's lineage identity, read per-connection and cached
    // at boot, so a mid-run bump would reach the writer connection but never the
    // per-worker read connections that serve /ws handshakes — it would silently
    // no-op in the file-backed config while forcing a full resnapshot only under
    // :memory:. The forward change reaches every connection through the journal
    // feed, which is why it is the right lever for a content correction.)
    let logged: Change[] = [
      ...(docChange ? [docChange] : []),
      redaction,
      entity,
    ]
    let jrow = Number(
      prep(
        db,
        'insert into journal (ts, actor, via, batch, trace) values (?, ?, ?, ?, ?)',
        // An EMPTY trace, not null: redaction historically dispatched with a
        // fresh Trace (changed-handlers only — a role doc rewrite re-drives
        // its role), and the journal consumer reproduces that.
      ).run(
        now,
        actor,
        via,
        JSON.stringify(logged),
        '{"created":[],"removed":[]}',
      )
        .lastInsertRowid,
    )
    touchJournal(db, jrow, logged)
    // The normalized parallel record (T-18878) — this redaction AUDIT event is a
    // fresh journaled transaction, so it mirrors like any apply. The historical
    // batch rewrites above stay JSON-only; scrubbing existing history into these
    // tables belongs to backfill (T-18879) and retirement (T-18883).
    journalNormalized(
      db,
      jrow,
      now,
      actor,
      via,
      '{"created":[],"removed":[]}',
      logged,
    )

    let changes: Change[] = [
      ...logged,
      created,
      ...(updated ? [updated] : []),
    ]
    db.exec('commit')
    return {
      changes,
      audit,
      target,
      column,
      hash: digest,
      journalRows,
      replacements,
      firstSeen,
    }
  } catch (e) {
    rollback(db)
    throw e
  }
}

// A single entity's history, newest first: the journal rows that touched
// the eid, each cut down to its changes. journal_touch (T-13915) makes this a
// seek — the eid's rows by index, then the batch fetched by rowid and parsed —
// rather than a full json_each scan of the whole log.
export type JournalEntry = {
  // The journal rowid — the batch's id, the handle `task undo` reverses. Blessed
  // rather than added as a column: the rowid is already stable within an epoch,
  // and a db restore mints a fresh epoch precisely to retire stale cursors.
  id: number
  ts: string
  actor: string | null
  via: string | null
  changes: Change[]
}
// The read side of the normalized journal (D-18860/D-18861): the Change[] a
// batch applied, reconstructed from journal_change + journal_field — the
// parallel record's authoritative content, which REPLACES parsing the JSON
// `journal.batch` in every history/replay/undo reader (T-18880). The JSON row
// stays dual-written, but nothing reads it back. An operation is `remove`
// (comp: null — a component removal, or entity death when component='entity')
// or `upsert` (comp rebuilt from its present after-image field rows, each
// JSON-decoded, in field order; an empty component has no field rows and
// rebuilds as {}). canonicalChanges keeps a forward-renamed ref column reading
// under its current name, exactly as the JSON reader did. The one thing the
// JSON batch carried that this does NOT is `was` — apply()'s per-column CAS
// guard, a write-time precondition and never history (D-18861: canonical rows
// do not duplicate before-values). No reader reads `was` back (historyLine
// shows comp keys, delta column-merges, inverseBatch recomputes its own via
// wasOf), so its absence is behavior-neutral.
type ChangeRow = {
  id: number
  eid: string
  component: string
  operation: string
}
let rebuildChanges = (db: DatabaseSync, rows: ChangeRow[]): Change[] => {
  let fieldsOf = prep(
    db,
    `select field, value from journal_field
     where change = ? and present = 1 order by ordinal`,
  )
  return canonicalChanges(rows.map((ch) => {
    if (ch.operation == 'remove') {
      return { eid: ch.eid, name: ch.component, comp: null }
    }
    let comp: Record<string, unknown> = {}
    for (
      let f of fieldsOf.all(ch.id) as { field: string; value: string }[]
    ) comp[f.field] = JSON.parse(f.value)
    return { eid: ch.eid, name: ch.component, comp }
  }))
}

// One journaled batch reconstructed whole (all eids) or, with `eid`, screened
// to that entity's own changes — both in applied order (journal_change.ordinal).
let normalizedBatch = (
  db: DatabaseSync,
  tx: number,
  eid?: string,
): Change[] =>
  rebuildChanges(
    db,
    (eid == null
      ? prep(
        db,
        `select id, eid, component, operation from journal_change
         where tx = ? order by ordinal`,
      ).all(tx)
      : prep(
        db,
        `select id, eid, component, operation from journal_change
         where tx = ? and eid = ? order by ordinal`,
      ).all(tx, eid)) as ChangeRow[],
  )

export let journalOf = (
  db: DatabaseSync,
  eid: string,
  limit = 50,
): JournalEntry[] =>
  (prep(
    db,
    `select jc.tx as tx, jt.ts as ts, jt.actor as actor, jt.via as via
     from journal_change jc join journal_tx jt on jt.id = jc.tx
     where jc.eid = ?
     group by jc.tx
     order by jc.tx desc limit ?`,
  ).all(eid, limit) as {
    tx: number
    ts: string
    actor: string | null
    via: string | null
  }[])
    .map((r) => ({
      id: r.tx,
      ts: r.ts,
      actor: r.actor,
      via: r.via,
      changes: normalizedBatch(db, r.tx, eid),
    }))

// The same record cut by instrument instead of what: every batch a session
// or client wrote, whole (no per-eid filtering — a wrap ledger wants the
// batch's full sentence). Newest first, like journalOf.
export let journalBy = (
  db: DatabaseSync,
  via: string,
  limit = 500,
): JournalEntry[] =>
  (prep(
    db,
    `select id, ts, actor, via from journal_tx
     where via = ? order by id desc limit ?`,
  ).all(via, limit) as {
    id: number
    ts: string
    actor: string | null
    via: string | null
  }[])
    .map((r) => ({
      id: r.id,
      ts: r.ts,
      actor: r.actor,
      via: r.via,
      changes: normalizedBatch(db, r.id),
    }))

// One entity's component state as of just BEFORE journal rowid `before`, rebuilt
// by column-merging that entity's own journal slice (rowid < before, oldest
// first) — per-entity and bounded, never a whole-log scan. A present component
// key exists; its value is the merged columns. undo restores from this: the
// value to put back is the value a batch found when it wrote.
let stateBefore = (
  db: DatabaseSync,
  eid: string,
  before: number,
): Record<string, Record<string, unknown>> => {
  // This entity's own changes across every batch below `before`, oldest first
  // (journal_change (eid, component) index, then applied order) — per-entity
  // and bounded, never a whole-log scan. Reconstructed from the normalized
  // rows, so the corrupt-gap batch (no journal_change) is skipped like every
  // other reader.
  let changes = rebuildChanges(
    db,
    prep(
      db,
      `select id, eid, component, operation from journal_change
       where eid = ? and tx < ? order by tx, ordinal`,
    ).all(eid, before) as ChangeRow[],
  )
  let state: Record<string, Record<string, unknown>> = {}
  for (let c of changes) {
    if (c.name == 'dependency') continue
    // A death mid-window can't precede a valid target (a tombstone voids
    // later writes), but resetting keeps the reconstruction honest if seen.
    if (c.name == 'entity') {
      if (!c.comp) state = {}
      continue
    }
    if (c.comp == null) delete state[c.name]
    else state[c.name] = { ...(state[c.name] ?? {}), ...c.comp }
  }
  return state
}

// The guard tokens for the columns a change wrote: sha of each value AS STORED,
// null for a column it cleared. A bool rides the wire as true/false but apply()
// reads it back as the 0/1 SQLite keeps, so it must hash in that shape or the
// guard would refuse an unchanged column. apply() refuses the inverse if any
// token has moved since the batch wrote it.
let wasOf = (name: string, comp: Record<string, unknown>, keys: string[]) => {
  let types = (comps as Record<string, Record<string, unknown>>)[name] ?? {}
  let was: Record<string, string | null> = {}
  for (let k of keys) {
    let v = comp[k]
    was[k] = v == null ? null : sha(types[k] == 'bool' ? (v ? 1 : 0) : v)
  }
  return was
}

// A journaled batch reversed: the guarded inverse patch that restores the state
// each change found, for apply() to land atomically. The batch is read O(1) by
// rowid and prior state is per-entity (stateBefore) — no whole-journal scan.
// The refusals ARE the feature on a graph several agents write concurrently:
//   - an entity DELETED in the batch → throws: a tombstone is permanent, so the
//     eid cannot be resurrected.
//   - an entity CREATED in the batch → the inverse deletes it, but only if
//     nothing has touched it since (an entity-delete has no column to was-guard,
//     so a later touch is the coarse "world moved").
//   - every restored column carries `was` = the value the batch wrote, so a
//     concurrent edit refuses the whole undo rather than clobbering it.
// Server-owned components (resume, imported — empty wire vocabulary) and the
// provenance echoes are re-derived by apply(), never user intent: skipped.
export let inverseBatch = (db: DatabaseSync, id: number): Change[] => {
  // The batch reconstructed from the normalized rows (every journal_change
  // shares this one tx). A tx always journals at least one change, so an empty
  // reconstruction means the batch does not exist — including the corrupt-gap
  // row that has no journal_tx (T-24020).
  let batch = normalizedBatch(db, id)
  if (!batch.length) throw new Error(`no journal batch #${id}`)

  let dead = batch.find((c) => c.name == 'entity' && c.comp == null)
  if (dead) {
    throw new Error(
      `${human(db, dead.eid)} was deleted in #${id} — deletions are permanent`,
    )
  }
  let born = new Set(
    batch.filter((c) => c.name == 'entity' && c.comp).map((c) => c.eid),
  )
  let touchedSince = prep(
    db,
    `select 1 from journal_change where eid = ? and tx > ? limit 1`,
  )
  let priors = new Map<string, Record<string, Record<string, unknown>>>()
  let priorOf = (eid: string) => {
    let p = priors.get(eid)
    if (!p) priors.set(eid, p = stateBefore(db, eid, id))
    return p
  }

  let inverse: Change[] = []
  // Content identities are synthesized before the docs/attachments that point
  // at them. Undo those owners first so their physical FK cannot strand the
  // content deletion; retain the batch order for every ordinary entity.
  let content = new Set(
    batch.filter((c) => c.name == 'blob').map((c) => c.eid),
  )
  let bornOrder = [...born].sort((a, b) =>
    Number(content.has(a)) - Number(content.has(b))
  )
  for (let eid of bornOrder) {
    if (touchedSince.get(eid, id)) {
      throw new Error(
        `${human(db, eid)} was modified after #${id} — undo refused`,
      )
    }
    inverse.push({ eid, name: 'entity', comp: null })
  }
  for (let c of batch) {
    if (born.has(c.eid) || c.name == 'entity') continue // the delete covers it
    if (c.name == 'dependency') {
      // Flip the edge: a link becomes an unlink and vice versa. A triple has no
      // row key to guard; apply() refuses if an endpoint has died.
      if (!c.comp) continue
      let { type, child, gone } = c.comp as Record<string, unknown>
      inverse.push({
        eid: c.eid,
        name: 'dependency',
        comp: gone ? { type, child } : { type, child, gone: true },
      })
      continue
    }
    if (!cmps[c.name]?.length || !c.comp) continue // server-owned / derived
    let keys = Object.keys(c.comp).filter((k) => k != 'eid')
    if (!keys.length) continue
    let was = wasOf(c.name, c.comp, keys) as Change['was']
    let prior = priorOf(c.eid)[c.name]
    if (!prior) {
      // The batch CREATED this component → undo deletes it, guarded.
      inverse.push({ eid: c.eid, name: c.name, comp: null, was })
    } else {
      // The batch UPDATED it → restore each written column to its prior value
      // (absent → null, which column-merge clears).
      let comp: Record<string, unknown> = {}
      for (let k of keys) comp[k] = prior[k] ?? null
      inverse.push({ eid: c.eid, name: c.name, comp, was })
    }
  }
  return inverse
}

// The one database mutation capability. Named mutations live here only when
// their read and guarded write must be indivisible; HTTP and in-process MCP
// both call this function, so transport cannot weaken that boundary.
export let mutate = <T extends Mutation>(
  db: DatabaseSync,
  mutation: T,
  trace?: Trace,
  via?: string | null,
): MutationOutput<T> => {
  if (Array.isArray(mutation)) {
    return apply(db, mutation, trace, via) as MutationOutput<T>
  }
  if ('entities' in mutation) {
    let plan = normalizeLiterals(mutation.entities, {
      resolve: (id) => resolveId(db, id),
    })
    return {
      changes: apply(db, plan.changes, trace, via),
      aliases: plan.aliases,
    } as MutationOutput<T>
  }
  if (mutation.mutation != 'undo') throw new Error('unknown mutation')
  if ((mutation.id == null) == (mutation.eid == null)) {
    throw new Error('undo needs exactly one of id or eid')
  }
  if (
    mutation.id != null &&
    (!Number.isSafeInteger(mutation.id) || mutation.id < 1)
  ) {
    throw new Error('undo id must be a positive integer')
  }
  if (mutation.eid != null && !mutation.eid.trim()) {
    throw new Error('undo eid must not be empty')
  }
  let id = mutation.id ?? lastBatch(db, mutation.eid!)
  if (!id) throw new Error(`${mutation.eid} has no history to undo`)
  return apply(db, inverseBatch(db, id), trace, via) as MutationOutput<T>
}

// The rowid of the latest batch that touched an entity — what `task undo <e>`
// reverses. 0 when the entity has no history.
export let lastBatch = (db: DatabaseSync, eid: string): number =>
  Number(
    (prep(
      db,
      `select max(tx) as id from journal_change where eid = ?`,
    ).get(eid) as { id: number | null } | undefined)?.id ?? 0,
  )

// History is paid for only by the explicit local backfill operation. The result is
// ordinary graph changes, so the caller can land and broadcast them through
// apply() rather than growing a second persistence path.
export let historicalWorked = (db: DatabaseSync): Change[] =>
  (prep(
    db,
    `
    select distinct
      json_extract(sess.value, '$') as parent,
      jc.eid as child
    from journal_change jc
    join journal_field sess
      on sess.change = jc.id and sess.field = 'session' and sess.present = 1
    join entity se on se.eid = json_extract(sess.value, '$')
    join session s on s.entity = se.id
    join entity te on te.eid = jc.eid
    join task t on t.entity = te.id
    left join dependency d
      on d.parent = se.id
     and d.type = 'worked'
     and d.child = te.id
    where jc.component = 'claim'
      and jc.operation = 'upsert'
      and d.parent is null
    order by parent, child
  `,
  ).all() as { parent: string; child: string }[]).map((r) => ({
    eid: r.parent,
    name: 'dependency',
    comp: { type: 'worked', child: r.child },
  }))

// Session entries are a lazy graph partition: root clients never receive
// their eids or any facets/provenance hung from them. A Session subscription
// still sees the unfiltered batch through maintain(), and keyed readers stay
// complete. A creation in this batch marks the eid even if a later batch has
// already deleted it — important when filtering a journal window.
export let rootChanges = (db: DatabaseSync, changes: Change[]): Change[] => {
  let hidden = new Set(
    changes.filter((c) => c.name == 'entry' && c.comp).map((c) => c.eid),
  )
  let isEntry = prep(db, `select 1 from entry where ${byEid}`)
  for (let eid of new Set(changes.map((c) => c.eid))) {
    if (isEntry.get(eid)) hidden.add(eid)
  }
  return changes.filter((c) => !hidden.has(c.eid))
}

// The journal replayed as a delta: every batch since `since` (an EXCLUSIVE
// rowid cursor) concatenated in apply order. A client holding the graph up
// to `since` lands exactly what changed — cascade tombstones, freed claims,
// detaches and births all ride, because the journal keeps the batch AS
// APPLIED (apply() above), the same content the live /ws broadcast carries.
// The one thing apply() leaves out of the journal is provenance (created/
// updated are the envelope's twins); delta re-derives it from each row's
// ts+actor+via, which ARE the when+who+how — lossless, no journal bloat.
// `cursor` is the max rowid seen (or `since` when the
// window is empty), the client's next since. Shared by IndexedDB catch-up
// (a temporal cut) and query subscriptions (a spatial cut) — one journal
// reader, two doors (T-6823/T-3683).
// One journal row, read back whole: the batch as applied (canonicalized), the
// provenance envelope, and the writer's Trace (revived — null when the writer
// asked for no effects). The unit a journal-cursor consumer (catchup.ts) is
// handed per commit, and the row delta() concatenates for a replay window.
export type JournalRow = {
  rowid: number
  ts: string
  actor: string | null
  via: string | null
  batch: Change[]
  trace: Trace | null
}

export let journalSince = (db: DatabaseSync, since: number): JournalRow[] =>
  (prep(
    db,
    `select id, ts, actor, via, trace from journal_tx
     where id > ? order by id`,
  ).all(since) as {
    id: number
    ts: string
    actor: string | null
    via: string | null
    trace: string | null
  }[]).map((r) => {
    let t = r.trace
      ? JSON.parse(r.trace) as {
        created: string[]
        removed: [string, string[]][]
      }
      : null
    return {
      rowid: Number(r.id),
      ts: r.ts,
      actor: r.actor,
      via: r.via,
      batch: normalizedBatch(db, r.id),
      trace: t
        ? { created: new Set(t.created), removed: new Map(t.removed) }
        : null,
    }
  })

// One row replayed as the changes its commit meant: the batch, then the
// provenance the journal deliberately left out, re-derived from the envelope.
export let rowChanges = (r: JournalRow): Change[] => {
  let changes: Change[] = [...r.batch]
  // Sort the batch's eids the way apply() did to stamp provenance: a
  // birth is a server-minted spine (an `entity` change carrying num — a
  // delete is `entity`/comp:null instead), the dead are those deletes and
  // cascade tombstones, and everything else is a touch. Edge changes touch
  // BOTH endpoints, like apply(). A wire batch that named its own author/
  // editor already rides in `changes` above; its `by` survives applyLocal's
  // column-merge, so the synth only fills the `at` the journal dropped.
  let born = new Set<string>()
  let dead = new Set<string>()
  let touched = new Set<string>()
  let saidCreated = new Set<string>()
  let saidUpdated = new Set<string>()
  for (let c of r.batch) {
    if (c.name == 'entity') (c.comp ? born : dead).add(c.eid)
    else if (c.name == 'dependency') {
      touched.add(c.eid)
      if (c.comp) touched.add(String(c.comp.child))
    } else {
      touched.add(c.eid)
      if (c.name == 'created') saidCreated.add(c.eid)
      if (c.name == 'updated') saidUpdated.add(c.eid)
    }
  }
  // created: one per birth, mirroring apply()'s stamp for every `minted`
  // eid — the row's ts+actor+via is its provenance.
  for (let eid of born) {
    changes.push({
      eid,
      name: 'created',
      comp: saidCreated.has(eid)
        ? { eid, at: r.ts, via: r.via }
        : { eid, at: r.ts, by: r.actor, via: r.via },
    })
  }
  // updated: every distinct touched eid NOT born here and NOT dead —
  // apply() skips births (created covers them) and the dead (a tombstone
  // takes no edits). Appending per row in rowid order makes the LAST write
  // win under column-merge: "updated is the last edit."
  for (let eid of touched) {
    if (born.has(eid) || dead.has(eid)) continue
    changes.push({
      eid,
      name: 'updated',
      comp: saidUpdated.has(eid)
        ? { eid, at: r.ts, via: r.via }
        : { eid, at: r.ts, by: r.actor, via: r.via },
    })
  }
  return changes
}

export let delta = (
  db: DatabaseSync,
  since: number,
): { changes: Change[]; cursor: number } => {
  let changes: Change[] = []
  let cursor = since
  for (let r of journalSince(db, since)) {
    cursor = r.rowid
    changes.push(...rowChanges(r))
  }
  return { changes: rootChanges(db, changes), cursor }
}

// A journal row replayed as the frames its LIVE cast carries: rowChanges plus
// a re-read of every touched comp that wears server-stamped columns — the
// insert-time fills (a notification stamp's at/by/via, mail.from) that apply()
// echoes to live sockets but deliberately leaves out of the journal. The
// re-read is current-state, which for the settle-right-after-commit caller is
// the same state apply() echoed; a later row's overwrite re-broadcasts anyway,
// so column-merge converges either way. A tombstoned eid reads no row and
// echoes nothing.
export let recast = (db: DatabaseSync, r: JournalRow): Change[] => {
  let out = rowChanges(r)
  let seen = new Set<string>()
  for (let { eid, name, comp } of r.batch) {
    if (!comp || name == 'entity' || name == 'dependency') continue
    if (name == 'created' || name == 'updated') continue
    if (!Object.keys(stamped[name] ?? {}).length) continue
    let key = `${name} ${eid}`
    if (seen.has(key)) continue
    seen.add(key)
    let row = readComp(db, eid, name)
    if (row) out.push({ eid, name, comp: row as Change['comp'] })
  }
  return out
}

// A recall touch — the server-minted aggregate behind ranked retrieval
// (query.ts hot()). Bumps count and last_at; first_at never moves. It
// deliberately does NOT stamp updated (it bypasses apply()'s touch set):
// reading is not editing, and recency-in-search must not feed back on
// itself. `confirm` also stamps
// memory.last_confirmed_at — an explicit re-confirmation is the
// strongest touch there is. Skips eids with no live spine (tombstoned
// or unknown). Returns the fresh rows as cast-able changes so every
// cache hears the new warmth.
export let touch = (
  db: DatabaseSync,
  eids: string[],
  confirm = false,
): Change[] => {
  let now = new Date().toISOString()
  let out: Change[] = []
  for (let eid of eids) {
    // A LIVE spine only: D-18866 retains a tombstoned entity's row (its id never
    // recycles), so existence in `entity` no longer proves liveness — a dead eid
    // is excluded by the tombstone, or touch would revive a recall row on it.
    if (
      !prep(
        db,
        `select 1 from entity where eid = ?
         and eid not in (select eid from tombstone)`,
      ).get(eid)
    ) continue
    prep(
      db,
      `
      insert into recall (entity, first_at, last_at)
        values ((select id from entity where eid = ?), ?, ?)
      on conflict (entity) do update
      set count = count + 1, last_at = excluded.last_at
    `,
    ).run(eid, now, now)
    out.push({
      eid,
      name: 'recall',
      comp: prep(db, `${select('recall')} where eid = ?`)
        .get(eid) as Change['comp'],
    })
    if (
      confirm &&
      prep(db, `update memory set last_confirmed_at = ? where ${byEid}`)
        .run(now, eid).changes
    ) {
      out.push({
        eid,
        name: 'memory',
        comp: prep(db, `${select('memory')} where eid = ?`)
          .get(eid) as Change['comp'],
      })
    }
  }
  return out
}

// Full-text search over every doc — tasks, boards, projects, comments all
// carry one. User words are quoted into FTS terms (AND semantics) so raw
// operator syntax can't error, and EVERY term prefix-matches — search is
// typed live, so the words are half-typed more often than not ('card fon'
// must already find the font mockups). Rank blends bm25 (title hits well
// over body hits) with recency — what you touched today is what you're
// looking for — matching the house recall bias. Snippets mark matches
// with \x01…\x02 so renderers can highlight without trusting HTML. A comment hit points
// open at its target — you open the conversation, not the aside —
// and wears the target's title (the aside has none of its own).
// A search line mixes FTS terms with dot-param filters (query.ts —
// 'runner .status=done .updated.at=today'): the TEXT preds drive FTS,
// the rest narrow the candidates BEFORE the result cap, then screen each hit
// against its components. A line of ONLY filters is a listing, newest touched
// first. A malformed filter throws; the doors show the message.
// Resolve a reference value server-side — the db's half of client.ts find().
// One grammar for every door: num, full uuid, short-eid handle, alias slug
// (resolveId, T-3684).
export let findEid = (db: DatabaseSync, id: string): string | undefined =>
  resolveId(db, id)

// One row's exact TEXT membership for incremental subscription maintenance.
// The database tokenizer is the definition; JavaScript never approximates
// unicode61 (its diacritic behavior has boundary cases JS normalization lacks).
export let textMatches = (
  db: DatabaseSync,
  eid: string,
  pred: Pred,
): boolean => {
  let term = ftsTerm(pred.value)
  return !!term && !!prep(
    db,
    `select 1 from doc_fts
      join doc_value d on d.rowid = doc_fts.rowid
      join entity e on e.id = d.entity
     where doc_fts match ? and e.eid = ?`,
  ).get(term, eid)
}

export let search = (db: DatabaseSync, q: string, limit = 20): Hit[] => {
  let preds = parseQuery(q)
  let addressed = preds.length == 1 && preds[0].op == TEXT
    ? findEid(db, preds[0].value)
    : undefined
  let reveal = preds.some((p) =>
    p.comp == 'quarantined' || leafOf(p).comp == 'quarantined'
  )
  let filters = resolveRefs(
    preds.filter((p) => p.op != TEXT),
    (id) => findEid(db, id),
  )
  if (!reveal) {
    filters.unshift({ comp: 'quarantined', prop: '', op: '', value: '' })
  }
  let built = where(filters)
  // A sparse facet may sit outside any fixed candidate window. Compile the
  // filter into the selection when possible; an exactness decline reads every
  // candidate so the JS definition below still decides before the result cap.
  let screen = built ? `and e.eid in (${built.sql})` : ''
  // A visible comment aimed at quarantined content is another route into the
  // same content. Keep it out before LIMIT so hidden hits cannot displace
  // visible ones.
  if (!reveal) {
    screen += ` and not exists (
      select 1 from comment c join quarantined q on q.entity = c.target
      where c.entity = e.id
    )`
  }
  let cap = built ? 'limit ?' : ''
  let params = built?.params ?? []
  let match = ftsQuery(preds)
  if (!match && !filters.length) return []
  // Filters screen AFTER the rank, so cast a wider net before the cap.
  let rows = match
    ? prep(
      db,
      `
      select e.eid, d.title,
        highlight(doc_fts, 0, char(1), char(2)) as title_hit,
        snippet(doc_fts, 1, char(1), char(2), '…', 10) as snip,
        -(bm25(doc_fts, 8.0, 1.0)
          - 2.0 / (1 + julianday('now') - julianday(coalesce(up.at, cr.at))))
          as score,
        e.num
      from doc_fts
      join doc_value d on d.rowid = doc_fts.rowid
      join entity e on e.id = d.entity
      left join updated up on up.entity = e.id
      left join created cr on cr.entity = e.id
      where doc_fts match ? ${screen}
      order by score desc
        ${cap}
    `,
    ).all(match, ...params, ...(cap ? [limit] : [])) as (Omit<
      Hit,
      'kind' | 'open' | 'retired'
    >)[]
    : prep(
      db,
      `
      select e.eid, d.title, d.title as title_hit, '' as snip,
        coalesce(julianday(up.at), julianday(cr.at), 0) as score, e.num
      from doc_value d
      join entity e on e.id = d.entity
      left join updated up on up.entity = e.id
      left join created cr on cr.entity = e.id
      where 1 ${screen}
      order by score desc, e.eid ${cap}
    `,
    ).all(...params, ...(cap ? [limit] : [])) as (Omit<
      Hit,
      'kind' | 'open' | 'retired'
    >)[]
  // An address is identity, not prose. Keep textual mentions behind the
  // entity the operator named, without giving ids a second search index.
  if (addressed) {
    let direct = prep(
      db,
      `
      select e.eid, d.title, d.title as title_hit, '' as snip,
        1000000000 as score, e.num
      from doc_value d
      join entity e on e.id = d.entity
      where e.eid = ? ${screen}
    `,
    ).get(addressed, ...params) as
      | Omit<Hit, 'kind' | 'open' | 'retired'>
      | undefined
    if (direct) {
      rows = [direct, ...rows.filter((r) => r.eid != direct.eid)]
        .slice(0, limit)
    }
  }
  if (filters.length) {
    // Each hit's components, only the ones the filters actually read —
    // matchQuery sees the same shape a live cache row has. A path pred
    // reads its TARGET through the same fetcher (compsOf doubles as the
    // ent argument), so `.comment.target.doc.title~=j` walks every hop's
    // component one row further.
    let owners = (comp: string, prop: string) =>
      comp ? [comp] : propOwners(prop)
    // Every component a pred reads, forward path AND reverse hop (its child ref
    // comp plus, recursively, its sub-filter's) — so compsOf can hydrate a hop's
    // far side, whichever direction it walks.
    let predComps = (p: Pred): string[] =>
      p.rev ? [p.rev.comp, ...p.rev.preds.flatMap(predComps)] : [
        ...owners(p.comp, p.prop),
        ...(p.at ?? []).flatMap((h) => owners(h.comp, h.prop)),
      ]
    let names = [...new Set(filters.flatMap(predComps))]
    let get = new Map(
      names.map((c) => [c, prep(db, `${select(c)} where eid = ?`)]),
    )
    let compsOf = (eid: string) => {
      let comps: Record<string, Record<string, unknown> | undefined> = {}
      for (let [c, s] of get) {
        comps[c] = s.get(eid) as Record<string, unknown> | undefined
      }
      return comps
    }
    // A reverse hop's children, hydrated the same way — referrersOf reads the
    // {eid}-ref index (T-17678), and each child bag carries its eid so a nested
    // hop can ask "who points at ME" in turn.
    let kids = (eid: string, comp: string, prop: string) =>
      referrersOf(db, [eid], { comp, prop }).map((k) => ({
        entity: { eid: k },
        ...compsOf(k),
      }))
    rows = rows
      .filter((r) =>
        matchQuery(
          compsOf(r.eid),
          filters,
          compsOf,
          undefined,
          kids,
          undefined,
          (eid, p) => textMatches(db, eid, p),
        )
      )
      .slice(0, limit)
  }
  let is = kindOrder.map((k) =>
    [k, prep(db, `select 1 from ${k} where ${byEid}`)] as const
  )
  let aim = prep(
    db,
    `
    select ${refEid('c.target')} as target, td.title from comment c
    join entity ce on ce.id = c.entity
    left join doc_value td on td.entity = c.target
    where ce.eid = ?
  `,
  )
  // Retirement sinks a hit, never hides it: a hit that IS a retired
  // project, or a task filed under one, keeps its rank order among the
  // sunk — they all queue behind the last live hit, flagged for the
  // renderers to mark.
  let sank = prep(
    db,
    `
    select 1 from project p
    join archived a on a.entity = p.entity
    left join task t on t.entity = (select id from entity where eid = ?1)
    where p.entity in ((select id from entity where eid = ?1), t.project)
  `,
  )
  let hits = rows.map((r) => {
    let kind = is.find(([, s]) => s.get(r.eid))?.[0] ?? 'entity'
    let at = aim.get(r.eid) as
      | { target: string; title: string | null }
      | undefined
    return {
      ...r,
      title: r.title || at?.title || '',
      kind,
      open: at?.target ?? r.eid,
      // What a comment hit points AT, spoken: the line already says
      // `→ on …`, and a uuid there is unpasteable in every other door.
      ...(at?.target ? { open_id: human(db, at.target) } : {}),
      ...(sank.get(r.eid) ? { retired: true } : {}),
    }
  })
  return [...hits.filter((h) => !h.retired), ...hits.filter((h) => h.retired)]
}

// Cursor invalidation stamps a delta client checks before trusting its
// `since`. The epoch is the GRAPH's cursor-lineage identity: minted once and
// persisted in `server_meta`, so it survives a process restart, a deploy, and
// the two-process listener handoff — a returning client with a matching epoch
// resumes via a small delta instead of a full resnapshot. It changes only when
// the journal lineage does: a DIFFERENT graph carries its own persisted epoch,
// so its rows can never replay against a stale cursor. A restore that rewinds
// THIS graph's own journal keeps the same epoch — the `since > cursor` guard in
// the join handshake (server.ts) reseeds any client whose frontier now sits
// beyond the shortened journal, which is the only cursor a rewind can strand.
// `vocabHash` fingerprints graph-out's writable and stamped declarations — a
// shape change (new component, renamed column) shifts it, so a delta derived
// against the old shape is refused and the client reseeds. Both declarations
// are insertion-ordered, so their JSON (and the hash) is stable across boots.
// mintEpoch (the WRITE) lives up by migrate(), its only caller — a read path
// must never write. epochOf is the READ — a pure SELECT (cached per handle), so
// every read and snapshot path only reads. The row is present on any migrated graph; an un-minted graph
// (never migrated, or a test that stripped server_meta) reads '' — distinct from
// any real client's held epoch, so those clients reseed, the safe answer.
let epochs = new WeakMap<DatabaseSync, string>()
export let epochOf = (db: DatabaseSync): string => {
  let hit = epochs.get(db)
  if (hit) return hit
  // A never-migrated graph may not have the table. Absent table or row reads
  // empty instead of making a read-only connection perform schema work.
  let got = !tableExists(db, 'server_meta') ? '' : (prep(
    db,
    `select v from server_meta where k = 'epoch'`,
  ).get() as { v: string } | undefined)?.v ?? ''
  // Cache only a real value — never the '' of an un-minted graph, so a read that
  // preceded migrate()'s mint is not pinned to empty.
  if (got) epochs.set(db, got)
  return got
}
export let vocabHashOf = (
  writable: Record<string, Record<string, unknown>>,
  stamped: Record<string, Record<string, unknown>>,
) =>
  createHash('sha1')
    .update(JSON.stringify({ writable, stamped })).digest('hex').slice(0, 16)

export let vocabHash = vocabHashOf(comps, stamped)

// The journal's current transaction id — the cursor a snapshot, a delta, or a
// live subscription frame is current as of (T-6823/T-3683). A client stamps its
// next `since` from it; a subscription rides it on every pushed frame so a
// client can bridge to the catch-up delta. Read from journal_tx (T-18880), the
// SAME id-space journalSince/delta seek, so the cursor and the reader can never
// drift apart — journal_tx.id == the JSON journal rowid, so the value is
// unchanged, but it no longer depends on the JSON journal that T-18883 retires.
// 0 on an empty journal.
export let cursorOf = (db: DatabaseSync): number =>
  (prep(db, 'select max(id) as m from journal_tx')
    .get() as { m: number | null }).m ?? 0

// Whether a returning client's held cursor can NO LONGER be trusted for a
// delta, so the server must full-resnapshot instead. Three ways it goes stale,
// each answering a distinct question the client cannot answer for itself:
//  - `epoch` mismatch: the cursor was issued by a DIFFERENT graph lineage
//    (a restore from an unrelated dump, a swapped db), whose rowids mean
//    something else — replaying them would splice alien history into the cache.
//  - `vocab` mismatch: the graph's SHAPE moved (new/renamed component) since
//    the cursor issued, so a delta in the old shape would mis-key rows.
//  - `since > cursor`: the client's frontier sits BEYOND the server's journal —
//    only a rewind (a restore of this same graph to an earlier point) can do
//    that, and the rows it saw past the new tip are gone; a delta would return
//    nothing and leave those rolled-back rows stranded in its cache. This is
//    the guard that lets `epoch` stay durable across restarts (T-20299): the
//    epoch no longer rotates on every boot to catch a rewind, this does.
// Never fires in normal append-only operation: a live client's `since` is a
// rowid the server issued, and cursorOf only grows within a lineage.
export let cursorStale = (
  db: DatabaseSync,
  epochHeld: string | null | undefined,
  vocabHeld: string | null | undefined,
  since: number,
): boolean =>
  epochHeld != epochOf(db) || vocabHeld != vocabHash || since > cursorOf(db)

// One entity's current components, keyed read — what subscription maintenance
// tests a touched eid against (design §2). Shaped like a snapshot row's comps
// (eid→comp, entity as {eid,num}); a missing spine returns {} (tombstoned or
// never minted), which reads as "not alive" to the matcher.
export let eager = (
  db: DatabaseSync,
  eid: string,
): Record<string, Record<string, unknown>> => {
  let spine = prep(db, `${select('entity')} where eid = ?`)
    .get(eid) as Record<string, unknown> | undefined
  if (!spine) {
    // No persisted rows — a pass-through entity is hydrated from its source.
    if (hasSources()) {
      let batch = sourceResolve(eid)
      if (batch) return compsOf(batch)
    }
    return {}
  }
  let out: Record<string, Record<string, unknown>> = { entity: spine }
  for (let name of Object.keys(readable)) {
    if (name == 'entity') continue
    let row = prep(db, `${select(name)} where eid = ?`)
      .get(eid) as Record<string, unknown> | undefined
    if (row) out[name] = row
  }
  return out
}

// The body columns a bodyless payload left behind (subs.ts), keyed by eid —
// the other end of the deferral. The answer IS a Change batch, so it lands
// through the client's ordinary applyLocal and merges onto the doc already
// cached, keeping its title: exactly what a live body edit does. One
// statement per component that declares a body, so a card asks for its own
// body and all its comments' bodies in one trip.
export let bodies = (db: DatabaseSync, eids: string[]): Change[] => {
  if (!eids.length) return []
  let out: Change[] = []
  let holes = eids.map(() => '?').join(', ')
  for (let name of Object.keys(readable)) {
    let cut = bodyCols(name).filter((c) => readable[name].includes(c))
    if (!cut.length) continue
    // doc.body is storage-addressed but wire-transparent; every other body
    // remains an inline append-only value. Both leave this door as text.
    let rows = prep(
      db,
      `select o.eid as eid, ${
        cut.map((c) =>
          name == 'doc' && c == 'body'
            ? '__body.value as body'
            : `t.${sqlName(c)} as ${sqlName(c)}`
        )
          .join(', ')
      } from ${sqlName(name)} t
       join entity o on o.id = t.entity
       ${name == 'doc' ? 'join blob_text __body on __body.entity = t.body' : ''}
       where o.eid in (${holes})`,
    ).all(...eids) as Record<string, unknown>[]
    for (let row of rows) out.push({ eid: String(row.eid), name, comp: row })
  }
  return out
}

// The authoritative state of exactly what a REJECTED batch touched — the scoped
// re-sync that reverts a sender's optimistic writes without reseeding the whole
// graph (M-21143: no door pulls the whole graph into memory). A rejected batch
// commits nothing, so "authoritative" is simply the pre-batch state: per touched
// eid, send back what the graph actually holds — every component whole (a
// delete-revert needs them all, not just the columns named), a null for any
// component the batch ADDED that the graph lacks, an entity-null for an eid that
// never existed (an optimistic create), and each touched edge re-asserted or
// dropped to match the stored set. Applied through the client's ordinary
// applyLocal, it undoes the optimistic apply precisely, cursor untouched (the
// batch never committed, so the client's frontier has not moved).
export let correct = (db: DatabaseSync, sent: Change[]): Change[] => {
  let out: Change[] = []
  for (let eid of new Set(sent.map((c) => c.eid))) {
    let comps = eager(db, eid)
    let mine = sent.filter((c) => c.eid == eid)
    if (!comps.entity) {
      // Never committed — drop the phantom the optimistic create left behind.
      out.push({ eid, name: 'entity', comp: null })
      continue
    }
    for (let [name, comp] of Object.entries(comps)) {
      out.push({ eid, name, comp: comp as Change['comp'] })
    }
    // A component the batch touched that the graph does not hold: the loop above
    // only re-asserts what exists, so null it to undo an optimistic add.
    for (let c of mine) {
      if (c.name != 'entity' && c.name != 'dependency' && !(c.name in comps)) {
        out.push({ eid, name: c.name, comp: null })
      }
    }
    // Each edge the batch touched, re-asserted or dropped to match the stored
    // set, so an optimistic link/unlink is undone the same way a comp add is.
    let live = depsOf(db, [eid])
    for (let c of mine) {
      if (c.name != 'dependency' || !c.comp) continue
      let type = c.comp.type
      let child = c.comp.child
      let d = live.find((d) =>
        d.parent == eid && d.type == type && d.child == child
      )
      out.push(
        d
          ? {
            eid,
            name: 'dependency',
            comp: { type, child, ...(d.ord != null ? { ord: d.ord } : {}) },
          }
          : { eid, name: 'dependency', comp: { type, child, gone: true } },
      )
    }
  }
  return out
}

// The home each persona names — homeReads' whole input, twenty-odd rows off
// its own table, where reading it out of a materialized graph costs the graph.
// Owner and `home` are int ids in storage, so project both back to eids: `o` is
// the persona's spine, `h` its home's. `only` is a where clause written against
// those aliases (`o.eid`, `h.eid`), so the narrow door asks the same question
// keyed without tripping the ref-column binding landmine (C-19763).
let homes = (db: DatabaseSync, only = '') =>
  prep(
    db,
    `select o.eid as eid, h.eid as home from persona t
     join entity o on o.id = t.entity
     left join entity h on h.id = t.home ${only}`,
  ).all() as { eid: string; home: unknown }[]

// The whole graph as one batch (plus edges) — what a fresh client cache eats.
// entity === eid: only identity (eid, num) rides in the spine comp now —
// provenance travels as `created`/`updated` (T-6670), the dormant spine
// timestamp columns stay OUT of the wire. apply() never lets num back IN.
// `cursor` is the journal rowid this snapshot is current as of — a returning
// client resumes its delta from here (T-6823). Read FIRST, before walking
// the tables: apply() is atomic and the server single-threaded, so nothing
// commits between max(rowid) and the rows the loop sees.
// Reconciliation asks for the same whole graph once per role, so share one walk
// until the database moves. total_changes() sees every write through this
// handle, including stamps that deliberately do not journal; data_version sees
// commits through another handle. Per-db keeps probe graphs apart.
type SnapHit = { local: number; remote: number; snap: Snapshot }
let snapCache = new WeakMap<DatabaseSync, SnapHit>()

let snapKey = (db: DatabaseSync) => ({
  local: Number(
    (prep(db, 'select total_changes() as n').get() as { n: number }).n,
  ),
  remote: Number(
    (prep(db, 'pragma data_version').get() as { data_version: number })
      .data_version,
  ),
})

// Materialize the lazy omit-set ONCE into an indexed temp table, then read it
// as the `not in` source per component table, instead of re-materializing a
// ~36k-row spine-join UNION subquery inside each of the 89 per-table scans
// (T-18874: that subquery cost ~50ms per table even on empty ones). The outer
// query keeps its EXACT prior shape — only the `not in (…)` source changes —
// so the planner's scan order is untouched and the wire stays byte-identical;
// an anti-join instead would reorder rows. `if not exists` + `delete from`
// keeps `_omit` safe across repeated calls and lets the cached statements that
// read it stay valid — the temp table lives for the connection. `insert or
// ignore` folds the lazy tables the way `union` did; every eid is non-null
// (entity.eid), so `not in` carries no NULL footgun. snapshot() AND allDeps()
// share it, so an edge omitted from the components is omitted from the deps too.
let fillOmit = (db: DatabaseSync) => {
  db.exec('create temp table if not exists _omit(eid text primary key)')
  db.exec('delete from _omit')
  for (let name of lazyTables) {
    db.exec(
      `insert or ignore into _omit
         select o.eid from ${
        sqlName(name)
      } lz join entity o on o.id = lz.entity`,
    )
  }
}

export let snapshot = (db: DatabaseSync): Snapshot => {
  let cursor = cursorOf(db)
  let key = snapKey(db)
  let hit = snapCache.get(db)
  if (hit?.local == key.local && hit.remote == key.remote) return hit.snap
  fillOmit(db)
  let changes: Change[] = []
  for (let name of Object.keys(readable)) {
    for (
      let row of prep(
        db,
        // A tombstoned entity keeps its spine row (so its int id can never
        // recycle, C-19754#2) but leaves the wire: exclude it from the entity
        // walk. Component tables never hold a dead entity's row (the delete
        // cascades them), so the tombstone clause is a no-op on the 88
        // component tables — but it stays on EVERY table, exactly as the
        // pre-opt query had it: this whole change swaps only the omit-set
        // SOURCE (the ~36k-row spine-join UNION → the indexed `_omit` temp),
        // leaving the WHERE shape untouched so the planner's per-table scan
        // order — and thus the wire — is byte-for-byte unchanged. Dropping the
        // clause from the 88 tables reorders their rows (a no-op `not in`
        // still shifts the plan), and tombstone is a tiny indexed scan, so the
        // saving is nil and the wire-order cost is real. Verified byte-identical
        // on a live-size copy (T-20299).
        `${select(name)} where eid not in (select eid from _omit)
           and eid not in (select eid from tombstone)`,
      ).all() as Record<string, unknown>[]
    ) {
      changes.push({ eid: row.eid as string, name, comp: row })
    }
  }
  // Edge endpoints are int ids in storage; project both back to their eids.
  // Both endpoints read the same `_omit` set the component walk used.
  let deps = (prep(
    db,
    `select p.eid as parent, d.type as type, c.eid as child, d.ord as ord
     from dependency d
     join entity p on p.id = d.parent
     join entity c on c.id = d.child
     where p.eid not in (select eid from _omit)
       and c.eid not in (select eid from _omit)
     order by p.eid, d.type, d.ord, c.eid`,
  ).all() as Dep[]).map(shedOrd)
  // A project's specialist personas ride derived `reads` edges (homeReads):
  // home is the one truth, so these compute here on the graph-out door
  // and can never drift from ownership — nothing to store, nothing to sync.
  let snap: Snapshot = {
    changes,
    deps: [...deps, ...homeReads(homes(db), deps)],
    cursor,
    epoch: epochOf(db),
    vocabHash,
    capabilities,
  }
  snapCache.set(db, { ...key, snap })
  return snap
}

// The census's honest denominator: one COUNT per component table, over the
// WHOLE graph. The browser cache is a correct but partial view — snapshot()
// deliberately omits the entry partition (110k+ log rows no browser loads),
// so a presence-tally over the cache understates every entry-borne component
// (recalled, message, reasoning, …). This counts the tables themselves, the
// same way a board is a query against the graph rather than a cache scan.
// Derived from `comps`, so a new component is counted here with zero edits.
//
// All counts ride ONE statement — 89 scalar subqueries in a single compile +
// round-trip — not one prepared count(*) per table: 89 cold compiles on a fresh
// handle were the census's whole ~1ms cost (and the db-test slowness behind
// T-18336). Column-less facets stay 0 without a query. Aliases are quoted so a
// component named like a SQL word stays safe; table names are `comps` keys,
// already used unquoted as identifiers elsewhere.
export let componentCounts = (db: DatabaseSync): Record<string, number> => {
  let out: Record<string, number> = {}
  let named: string[] = []
  for (let name of Object.keys(comps)) {
    if (columnsOf(db, name).size) named.push(name)
    else out[name] = 0
  }
  if (named.length) {
    let sql = 'select ' +
      named.map((n) => `(select count(*) from ${n}) as "${n}"`).join(', ')
    let row = prep(db, sql).get() as Record<string, number>
    for (let name of named) out[name] = Number(row[name])
  }
  return out
}

// The two integrity anomalies the eid→id reshape (D-18866, T-18874) must clean,
// and the doctor watches for afterward. Both are INVISIBLE to the wire by
// construction — which is exactly why the eid-keyed readers tolerated them and a
// clean-fixture test missed the class:
//  - orphans: a component row whose OWNER has no spine. snapshot() joins each
//    component to `entity`, so the row never rode a query — but the id-keyed
//    schema resolves its owner to NULL and collides on the integer PK.
//  - dangling: a stored {eid} reference to an entity that no longer exists. An
//    eid-keyed reader's missing join silently read it as absent; the id-keyed
//    NOT NULL columns reject it and the nullable ones must be counted, not nulled
//    in silence.
// Counted over the RAW tables. Shape-agnostic so the SAME scan reads the
// pre-cutover eid-keyed live graph (owner/refs are eids, spine key `eid`) and the
// post-cutover id-keyed graph (ints, spine key `id`): it reads directly and never
// calls open(), so a read-only snapshot connection is a valid argument — this is
// the cutover rehearsal's pre-count and the doctor's ongoing gate.
export type Anomalies = {
  orphans: Record<string, number> // component table → rows with no owner spine
  dangling: Record<string, number> // `table.column` → refs to a missing entity
  // The ANN index's maintenance state — the split-brain tell (T-22622). Absent
  // from a server too old to report it, which the doctor treats as unverified.
  vector?: { dirty: boolean; rows: number; newest: string | null }
  // Governed durable work/knowledge outside every project-rooted dependency
  // closure. Human ids because doctor output is agent-facing.
  unrooted?: string[]
}

export type ProjectReachability = {
  reachable: string[]
  orphans: string[]
}

// One cycle-safe project-root closure over every semantic edge. UNION is the
// visited set: detached cycles terminate and remain outside the closure. The
// recursive step reads dependency's parent-leading primary key; edge type is
// deliberately absent because no relation, including contains, is structural.
// The governed facet list is generated vocabulary shared with later readers and
// write gates, so the corpus boundary cannot drift between doors.
export let projectReachability = (db: DatabaseSync): ProjectReachability => {
  let idKeyed = hasCol(db, 'entity', 'id')
  let spineKey = idKeyed ? 'id' : 'eid'
  let ownerCol = idKeyed ? 'entity' : 'eid'
  let corpus = governed.map((name) =>
    `select ${sqlName(ownerCol)} from ${sqlName(name)}`
  ).join(' union ')
  let rows = prep(
    db,
    `with recursive rooted(entity) as (
       select ${sqlName(ownerCol)} from project
       union
       select d.child from dependency d join rooted r on r.entity = d.parent
     ), corpus(entity) as (
       ${corpus}
     )
     select e.eid, 1 as reachable
       from corpus c join rooted r on r.entity = c.entity
       join entity e on e.${sqlName(spineKey)} = c.entity
     union all
     select e.eid, 0 as reachable
       from corpus c join entity e on e.${sqlName(spineKey)} = c.entity
      where not exists (
        select 1 from rooted r where r.entity = e.${sqlName(spineKey)}
      )
     order by eid`,
  ).all() as { eid: string; reachable: number }[]
  return {
    reachable: rows.filter((r) => r.reachable).map((r) => r.eid),
    orphans: rows.filter((r) => !r.reachable).map((r) => r.eid),
  }
}

export let scanAnomalies = (db: DatabaseSync): Anomalies => {
  let idKeyed = hasCol(db, 'entity', 'id')
  let spineKey = idKeyed ? 'id' : 'eid'
  let ownerCol = idKeyed ? 'entity' : 'eid'
  let orphans: Record<string, number> = {}
  let dangling: Record<string, number> = {}
  // A cell that names an entity the spine does not hold — null cells are legal
  // absence, so only a non-null value with no matching spine row is an anomaly.
  let missing = (col: string) =>
    `${col} is not null and not exists ` +
    `(select 1 from entity e where e.${spineKey} = t.${col})`
  let count = (t: string, where: string) =>
    (prep(db, `select count(*) as n from ${sqlName(t)} t where ${where}`)
      .get() as { n: number }).n
  for (let t of graphTables()) {
    if (t == 'entity' || !tableExists(db, t)) continue
    let cols = new Set(colNames(db, t))
    // Orphaned component rows — dependency has no owner key, only its endpoints.
    if (t != 'dependency' && cols.has(ownerCol)) {
      let n = count(t, missing(ownerCol))
      if (n) orphans[t] = n
    }
    // Dangling references — every {eid} column, plus dependency's parent/child.
    for (let c of cols) {
      let depRef = t == 'dependency' && (c == 'parent' || c == 'child')
      if (c == ownerCol || !(isRef(t, c) || depRef)) continue
      let n = count(t, missing(sqlName(c)))
      if (n) dangling[`${t}.${c}`] = n
    }
  }
  let unrooted = projectReachability(db).orphans.map((eid) => human(db, eid))
  return { orphans, dangling, vector: vectorState(db), unrooted }
}

// The ANN index's maintenance state, read from plain tables — no extension
// needed, so any connection can report it. `dirty` is the trigger's mark that
// an embedding write has not been quantized since; `newest` is the most recent
// embedding row. The pair is what makes the T-22622 split-brain visible: a
// dirty mark that OUTLIVES the sweep interval means nobody is quantizing —
// either no process claimed ownVector(), or the owner's connection never ran
// vector_init and every rebuild throws "Vector context not found".
let vectorState = (db: DatabaseSync): Anomalies['vector'] => {
  if (!tableExists(db, 'embedding') || !tableExists(db, 'embedding_index')) {
    return undefined
  }
  let mark = prep(db, 'select dirty from embedding_index where id = 1')
    .get() as { dirty: number } | undefined
  let head = prep(db, 'select count(*) n, max(at) newest from embedding')
    .get() as { n: number; newest: string | null }
  return { dirty: !!mark?.dirty, rows: head.n, newest: head.newest }
}

// One entity's one component, projected exactly as snapshot() would (same
// select()), read by primary key instead of walking the whole graph. The
// narrow read a single-entity caller wants — snapshot() over a seeded graph
// walks ~180 rows (~2ms); this hits the eid index (~µs). Undefined for an
// absent row or a component with no readable columns.
export let readComp = (
  db: DatabaseSync,
  eid: string,
  name: string,
): Record<string, unknown> | undefined =>
  readable[name]
    ? prep(db, `${select(name)} where eid = ?`).get(eid) as
      | Record<string, unknown>
      | undefined
    : undefined

// `deno task seed` (or a direct run) bootstraps the file without the server.
if (import.meta.main) {
  let db = open()
  let n = (q: string) => (prep(db, q).get() as { n: number }).n
  console.log(
    `seeded ${n('select count(*) as n from task')} tasks, ${
      n('select count(*) as n from dependency')
    } edges`,
  )
}

// An id to an eid, through the index — client.ts `find()`'s rules (X-123 or a
// bare number by num, an eid verbatim or by its short handle, an alias slug)
// asked of SQLite instead of of a materialized graph. It exists so a query can
// resolve its own references without anyone building a snapshot first; keep the
// two readings of "what names an entity" in step. resolveId is that one
// reading (T-3684).
export let locate = (db: DatabaseSync, id: string): string | undefined =>
  resolveId(db, id)

// A tombstoned entity keeps its spine row and its name (C-19754#2), so locate
// still resolves it — naming a dead entity must keep working (human(), history).
// But it has LEFT the graph: the addressing doors (id=) exclude it, so a dead
// name reads as absent rather than as a spine with no components. Before the
// D-18866 flip, delete removed the spine and locate simply missed; the spine now
// survives, so the exclusion is explicit.
export let buried = (db: DatabaseSync, eid: string): boolean =>
  !!prep(db, 'select 1 from tombstone where eid = ?').get(eid)

// The page entity at a URL, keyed off the `web.url` index — a normalized
// address reaches the same row it minted (url.ts), so the browser-extension
// door finds-or-mints without materializing the graph (M-21143). The caller
// hands a NORMALIZED url, the same shape a write stores.
export let webAt = (db: DatabaseSync, url: string): string | undefined =>
  (prep(
    db,
    'select o.eid as eid from web t join entity o on o.id = t.entity where t.url = ?',
  ).get(url) as { eid: string } | undefined)?.eid

let clear = (db: DatabaseSync) => {
  db.exec('create temp table if not exists hit (eid text primary key)')
  db.exec('delete from hit')
}

// The eids a keyed reader asks about, staged. A temp table rather than an
// `in (?,?,…)` list because a hit set has no ceiling (a query can match the
// whole graph) and a bound parameter list does. `hit` is filled and read out
// within one reader, never held across two.
let stage = (db: DatabaseSync, eids: string[]) => {
  clear(db)
  let put = prep(db, 'insert or ignore into hit (eid) values (?)')
  for (let e of eids) put.run(e)
}

// The comps of whatever `hit` holds, shaped as `rows(snapshot())` shapes them.
let staged = (db: DatabaseSync) => {
  let out = new Map<string, Record<string, Record<string, unknown>>>()
  let only = `where eid in (select eid from hit)`
  let spine = prep(db, `${select('entity')} ${only}`)
    .all() as Record<string, unknown>[]
  for (let r of spine) out.set(String(r.eid), { entity: r })
  if (!out.size) return []
  for (let name of Object.keys(readable)) {
    if (name == 'entity') continue
    let rows = prep(db, `${select(name)} ${only}`)
      .all() as Record<string, unknown>[]
    for (let r of rows) {
      let e = out.get(String(r.eid))
      if (e) e[name] = r
    }
  }
  return [...out].map(([eid, comps]) => ({ eid, comps }))
}

// Every entity a compiled filter matches, with its components — the shape
// `rows(snapshot())` hands a matcher, restricted to the rows that matched.
//
// One statement per component table, rather than one `eager()` per row: a
// query matching the 10,618-entity graph costs about as many statements as the
// graph has components either way, where per-row reads cost 150,000 and time
// out.
//
// The filter itself runs ONCE, into `hit`. It used to ride into each of those
// statements as a subquery, which re-asked the whole question forty times over
// — invisible while every predicate was an indexed column read, and the whole
// cost the moment one of them takes milliseconds. A substring over a body
// (sql.ts) is that predicate: answered forty times it is slower than the JS
// matcher it replaces, and answered once it is several times faster.
export let matching = (
  db: DatabaseSync,
  filter: { sql: string; params: (string | number)[] },
): { eid: string; comps: Record<string, Record<string, unknown>> }[] => {
  clear(db)
  prep(db, `insert or ignore into hit (eid) ${filter.sql}`)
    .run(...filter.params)
  let out = staged(db)
  // Union in pass-through entities the sources say match the same query — a
  // board of ephemeral (e.g. legacy-session) entities. Skip any eid already in
  // SQL (a graduated entity), so a match is never double-counted.
  if (hasSources()) {
    let have = new Set(out.map((e) => e.eid))
    for (let batch of sourceList(filter)) {
      let eid = batch[0]?.eid
      if (!eid || have.has(eid)) continue
      have.add(eid)
      out.push({ eid, comps: compsOf(batch) })
    }
  }
  return out
}

// The same rows for a KNOWN set of eids — what a backlinks layer needs to
// NAME its sources (an id and a title come off the whole row, since kind is
// derived from which components are there). One eager() each would cost a
// statement per component per row; this costs one per component.
export let rowsOf = (db: DatabaseSync, eids: string[]) => {
  if (!eids.length) return []
  stage(db, eids)
  let out = staged(db)
  // Any requested eid SQL had no rows for may be a pass-through entity — hydrate
  // it from its source. Graduated entities are in SQL, so they never double.
  if (hasSources() && out.length < eids.length) {
    let have = new Set(out.map((e) => e.eid))
    for (let eid of eids) {
      if (have.has(eid)) continue
      let batch = sourceResolve(eid)
      if (batch) out.push({ eid, comps: compsOf(batch) })
    }
  }
  return out
}

let entryRows = (
  db: DatabaseSync,
  index: { eid: string; seq: number }[],
) => {
  if (!index.length) return []
  // A spine-less index row (entriesOf's left join) has a null eid — skip it in
  // the stage; byEid.get(undefined) ?? {} below already gives it inert comps.
  stage(db, index.map((e) => e.eid).filter((e): e is string => e != null))
  let byEid = new Map(staged(db).map((e) => [e.eid, e.comps]))
  // staged() keys off the entity SPINE, so an index row whose spine is gone —
  // a legacy partial ingest left `entry`+`imported` without minting the spine
  // (T-19261) — has no comps here. Give it `{}` so it stays an inert,
  // contentless entry: EntryRow.comps is non-optional, and every consumer
  // (standingOf, graphLog, activityOf) reads `row.comps.x` trusting that. A
  // bare `!` handed them `undefined` and the first `.x` threw — aborting the
  // whole read (the unattended sweep, once per cycle). Keeping the row (over
  // dropping it) preserves the seq count the caller's paging relies on.
  return index.map(({ eid, seq }) => ({
    eid,
    seq,
    comps: byEid.get(eid) ?? {},
  }))
}

// One entry by identity. Hosted work names its call directly; its Session
// partition is unrelated to locating or hydrating that immutable row.
export let entryOf = (db: DatabaseSync, eid: string) => {
  let row = prep(
    db,
    `select o.eid as eid, t.seq as seq from entry t
     join entity o on o.id = t.entity where o.eid = ?`,
  ).get(eid) as
    | { eid: string; seq: number }
    | undefined
  return row ? entryRows(db, [row])[0] : undefined
}

// One Session's lazy log partition, ordered by its server-minted sequence.
// Keyed reads remain full even though snapshot() deliberately omits these
// entities from the root cache. `through` gives replay a closed upper bound;
// ordinary UI and audit reads omit it and retain the complete tail.
export let entriesOf = (
  db: DatabaseSync,
  session: string,
  after = 0,
  limit = 500,
  through?: number,
) => {
  let cap = Math.max(1, Math.min(limit, 5000))
  // entry.session is an int id; join the spine so the caller keeps passing a
  // session EID and the projected owner eid rides back out. The entry's OWN
  // spine is LEFT-joined: a spine-less entry (a legacy partial ingest whose
  // entity never persisted, T-19261) still surfaces — with a null eid, which
  // entryRows turns into an inert `{}`-comps row rather than dropping it and
  // miscounting the caller's paging.
  let base = `select o.eid as eid, t.seq as seq from entry t
       left join entity o on o.id = t.entity
       join entity s on s.id = t.session`
  let index = (through == null
    ? prep(
      db,
      `${base} where s.eid = ? and t.seq > ?
       order by t.seq limit ?`,
    ).all(session, after, cap)
    : prep(
      db,
      `${base}
       where s.eid = ? and t.seq > ? and t.seq <= ?
       order by t.seq limit ?`,
    ).all(session, after, through, cap)) as {
      eid: string
      seq: number
    }[]
  // A pass-through session has no persisted entry rows — its tail streams from
  // the source's transcript file. (through-bounded replay stays a persisted
  // concern; an ephemeral session serves its live tail.)
  if (!index.length && hasSources() && through == null) {
    let tail = sourceEntries(session, after, cap)
    if (tail.length) return tail
  }
  return entryRows(db, index)
}

// The lazy partition scanned ACROSS sessions, ordered (session, seq) and
// capped — the fallback universe for a lazy query that names no single session
// and whose predicate the index declined to compile. entriesOf is the keyed,
// per-session read; this is its unscoped sibling, bounded so an all-sessions
// scan can never be unbounded.
export let entriesScan = (db: DatabaseSync, after = 0, limit = 500) => {
  let index = prep(
    db,
    `select o.eid as eid, t.seq as seq from entry t
     left join entity o on o.id = t.entity
     where t.seq > ?
     order by t.session, t.seq limit ?`,
  ).all(after, Math.max(1, Math.min(limit, 5000))) as {
    eid: string
    seq: number
  }[]
  if (!index.length) return []
  stage(db, index.map((e) => e.eid).filter((e): e is string => e != null))
  let byEid = new Map(staged(db).map((e) => [e.eid, e.comps]))
  // Same spine-less guard as entryRows (T-19261): a dangling index row gets
  // `{}`, never undefined, so a cross-session scan can't throw on it either.
  return index.map(({ eid, seq }) => ({
    eid,
    seq,
    comps: byEid.get(eid) ?? {},
  }))
}

// Is this edge endpoint in the LAZY partition — the entities the root snapshot
// omits and no cache ever holds? Asked per ENDPOINT as a correlated seek on the
// lazy table's own owner key (`entry.entity` is an integer primary key), not
// through `_omit`. `_omit` is the right shape for snapshot(), which pays its
// build once and then screens 89 whole-table scans with it; a rider pays it per
// SUBSCRIBE, and rebuilding a 36,000-row temp table to screen two edges measured
// 80ms a call against 0.37ms for the unscreened read — eleven route subs on one
// canvas mount would have blocked the loop for most of a second (M-17862).
// Derived from the same `lazyTables` list, so a second lazy comp is free.
let notLazy = (endpoint: string) =>
  lazyTables.map((name) =>
    ` and not exists (select 1 from ${
      sqlName(name)
    } lz where lz.entity = ${endpoint})`
  ).join('')

// Every edge touching these entities, both directions — the narrow reading of
// `snap.deps`, derived `reads` included. Losing those would make this door
// disagree with the graph-out one about what an entity's edges ARE, so the
// persona table is read here too, keyed the same way: personas homed at a hit,
// and a hit that is itself a persona.
//
// `eagerOnly` screens the answer to the entities a CLIENT can hold — see
// eagerDeps below.
let incident = (
  db: DatabaseSync,
  eids: string[],
  eagerOnly: boolean,
): Dep[] => {
  if (!eids.length) return []
  stage(db, eids)
  let mine = `in (select eid from hit)`
  // C-19763's landmine is binding an eid VALUE to a base int column, which
  // matches nothing in silence; the cure it prescribes is resolving eid→id
  // BEFORE binding, which is what `myIds` does here. Filtering the projected
  // p.eid/c.eid instead spans two joined copies of `entity`, so no single
  // index answers the disjunction and sqlite SCANS all of entity, seeking
  // dependency once per row. Naming the edge table's own columns keeps both
  // halves on one table, which sqlite answers as a MULTI-INDEX OR: the parent
  // half seeks the primary key, the child half seeks dependency_child.
  let myIds = `in (select e.id from entity e where e.eid ${mine})`
  // The screen rides OUTSIDE the disjunction — an endpoint is lazy or it isn't,
  // whichever side of the OR selected the row — so the multi-index OR above is
  // untouched and each NOT EXISTS is one more seek per candidate edge.
  let live = eagerOnly ? notLazy('d.parent') + notLazy('d.child') : ''
  let deps = (prep(
    db,
    `select p.eid as parent, d.type as type, c.eid as child, d.ord as ord
      from dependency d
      join entity p on p.id = d.parent
      join entity c on c.id = d.child
      where (d.parent ${myIds} or d.child ${myIds})${live}
      order by p.eid, d.type, d.ord, c.eid`,
  ).all() as Dep[]).map(shedOrd)
  return [
    ...deps,
    ...homeReads(homes(db, `where h.eid ${mine} or o.eid ${mine}`), deps),
  ]
}

export let depsOf = (db: DatabaseSync, eids: string[]): Dep[] =>
  incident(db, eids, false)

// The same edges, screened to the EAGER graph: the edges a CLIENT may hold.
// A session-log entry's `referenced` edge points from an entity no cache will
// ever carry, so delivering it is a dangling triple — and `snapshot()` and the
// `allDeps` this replaced both dropped exactly those, so the `.edges!` rider has
// to agree with them or the wire says two different things about what an edge
// IS. Not a nicety: one card on a well-referenced task draws 522 incident edges,
// 469 of them from entries, and the rider would have shipped every one along
// with a projected peer row for each.
export let eagerDeps = (db: DatabaseSync, eids: string[]): Dep[] =>
  incident(db, eids, true)

// Stored dependency edges incident to `eids` AFTER an optional endpoint
// projection. The projection is one vocabulary `{eid}` column: an endpoint
// wearing its component reads as the referenced entity, and membership is
// tested in that projected graph. `endpoint` is built from two indexed seeks —
// the member spine ids and the projection column's reverse index — then each
// half seeks dependency by its own endpoint index. No component partition is
// enumerated.
export let selectedDeps = (
  db: DatabaseSync,
  eids: string[],
  select: EdgeSelector,
): Dep[] => {
  if (!eids.length) return []
  if (!select.via) {
    return eagerDeps(db, eids).filter((d) => d.type == select.type)
  }
  stage(db, eids)
  let table = sqlName(select.via.comp)
  let col = sqlName(select.via.prop)
  let rows = prep(
    db,
    `with endpoint(id) as (
       select e.id from entity e
        where e.eid in (select eid from hit)
          and not exists (select 1 from ${table} v where v.entity = e.id)
       union
       select v.entity from ${table} v
        where v.${col} in (
          select e.id from entity e where e.eid in (select eid from hit)
        )
     ), picked(parent, type, child, ord) as (
       select d.parent, d.type, d.child, d.ord from dependency d
        where d.parent in (select id from endpoint) and d.type = ?
       union
       select d.parent, d.type, d.child, d.ord from dependency d
        where d.child in (select id from endpoint) and d.type = ?
     )
     select distinct coalesce(pp.eid, p.eid) as parent,
            d.type as type,
            coalesce(pc.eid, c.eid) as child,
            d.ord as ord
       from picked d
       join entity p on p.id = d.parent
       join entity c on c.id = d.child
       left join ${table} vp on vp.entity = d.parent
       left join entity pp on pp.id = vp.${col}
       left join ${table} vc on vc.entity = d.child
       left join entity pc on pc.id = vc.${col}
      order by parent, type, ord, child`,
  ).all(select.type, select.type) as Dep[]
  return rows.map(shedOrd)
}

// The bounded transitive closure `.reaches[type,<=N]=id` selects: the eids that
// reach `target` through at most `depth` edges of one type, walking child→parent
// so every step is a `dependency_child` seek (sql.ts reachSql documents why the
// type term is held back with `+`). The target itself is excluded — reaching is
// a path of at least one hop. This is the JS matcher's half of the same closure
// the compiler emits, so a query mixing `.reaches` with a pred SQL declines
// still answers, and answers identically.
//
// There is no whole-graph edge reader beside it, deliberately: `allDeps` — the
// dump every joining client used to receive — is gone (T-22371). Edges are
// delivered SCOPED, by depsOf above, to whatever a subscription selected.
export let reaching = (
  db: DatabaseSync,
  target: string,
  type: string,
  depth: number,
): string[] =>
  (prep(
    db,
    `with recursive __reach(id, depth) as (
       select id, 0 from entity where eid = ?
       union select d.parent, __reach.depth + 1 from dependency d
         join __reach on d.child = __reach.id
         where __reach.depth < ? and +d.type = ?
     )
     select o.eid as eid from __reach join entity o on o.id = __reach.id
      where __reach.depth > 0`,
  ).all(target, depth, type) as { eid: string }[]).map((r) => r.eid)

// Who points AT these entities through a typed eid column — one keyed
// statement per column in the readable vocabulary (`stamped` included, so an
// association nobody may write still says who made it), where the graph-out
// reading walks every column of every row. `via` names the column. A column
// is a reference by its PropType, not its name, so `created.by` and
// `deliver.to` counts as surely as `project` — isRef reads the declared type.
export let refsOf = (db: DatabaseSync, eids: string[]) => {
  if (!eids.length) return []
  stage(db, eids)
  let out: { from: string; via: string; to: string }[] = []
  for (let [name, cols] of Object.entries(readable)) {
    for (let col of cols.filter((c) => isRef(name, c))) {
      // Owner and the reference are int ids; join the spine for both eids and
      // filter on the referenced eid (not the base int, C-19763).
      let rows = prep(
        db,
        `select o.eid as eid, r.eid as at from ${sqlName(name)} t
          join entity o on o.id = t.entity
          join entity r on r.id = t.${sqlName(col)}
          where r.eid in (select eid from hit)`,
      ).all() as { eid: string; at: string }[]
      for (let r of rows) {
        out.push({ from: r.eid, via: `${name}.${col}`, to: r.at })
      }
    }
  }
  return out
}

// Who points AT these entities through the named reference columns. Unlike
// refsOf(), this is the narrow reverse walk query subscriptions need: a
// far-side change re-tests only sources reachable through that predicate's
// own path, not every row that happens to reference the same entity.
export let referrersOf = (
  db: DatabaseSync,
  eids: string[],
  { comp, prop }: { comp: string; prop: string },
): string[] => {
  if (!eids.length) return []
  stage(db, eids)
  let names = (comp ? [comp] : propOwners(prop)).filter(
    (name) => readable[name]?.includes(prop) && isRef(name, prop),
  )
  let out = new Set<string>()
  for (let name of names) {
    let rows = prep(
      db,
      `select o.eid as eid from ${sqlName(name)} t
        join entity o on o.id = t.entity
        join entity r on r.id = t.${sqlName(prop)}
        where r.eid in (select eid from hit)`,
    ).all() as { eid: string }[]
    for (let row of rows) out.add(row.eid)
  }
  return [...out]
}

// The forward complement of referrersOf: the `comp.prop` values these eids
// carry — a touched CHILD's parent, for maintaining a reverse-hop subscription
// (a comment moves; its comment.target parent must re-test). Only the given
// component's own column, so a touched non-child yields nothing.
export let refValuesOf = (
  db: DatabaseSync,
  eids: string[],
  { comp, prop }: { comp: string; prop: string },
): string[] => {
  if (!eids.length || !readable[comp]?.includes(prop)) return []
  stage(db, eids)
  // The named column is a reference (a reverse-hop parent); project its int id
  // to the target's eid, filtering by the owners staged in `hit`.
  let rows = prep(
    db,
    `select r.eid as v from ${sqlName(comp)} t
      join entity o on o.id = t.entity
      join entity r on r.id = t.${sqlName(prop)}
      where o.eid in (select eid from hit) and t.${sqlName(prop)} is not null`,
  ).all() as { v: string }[]
  return [...new Set(rows.map((r) => String(r.v)))]
}
