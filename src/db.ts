// The fleet entity graph, over one SQL handle. Star ECS: `entity` holds the
// shared primary key (`eid`); component tables (`task`, `board`, `card`, …)
// hang off it by that same id; an edge is an entity of its own, wearing
// `edge{from, to}` and the nature tag that is its verb, and reads as a
// sentence. This module owns the schema, the seed, and the two wire
// operations: apply (patch batches in) and snapshot (the whole graph out) —
// all over the Sql interface (store/sql.ts), never a driver; the SQLite file
// itself, its path and its pragmas, is store/sqlite.ts.
// SERVER-ONLY — the browser reads the graph from its cache in live.ts.
//
// Ids: `eid` is a UUID so ANY side (client included) can mint entities;
// `num` is the server-minted human number (T-7 in the UI, one global counter).
import type { SchemaOp, Sql, SqlValue, Statement } from './store/sql.ts'
import { SEED } from './catalog.ts'
import { asBundle, asChanges } from './store/wire.ts'
import type { FleetWrite } from './store/fleet_stamps.ts'
export type { SchemaOp } from './store/sql.ts'
import { initVector } from './vector.ts'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { sha } from './sha.ts'
import { hop } from './hops.ts'
import {
  capabilities,
  type Change,
  comps,
  type Dep,
  EID,
  governed,
  type Hit,
  idOf,
  kindOf,
  kindOrder,
  lazy,
  learnKinds,
  type PropType,
  sessionActive,
  sessionComps,
  shapeOf,
  SHORT,
  shortId,
  type Snapshot,
  stamped,
  uuid,
} from './types.ts'
import {
  type Mutation,
  type MutationOutput,
  type WorkClaimMutation,
} from './mutation.ts'
import { type Trace } from './effects.ts'
import { ancestorAt, normalizeLiterals } from './client.ts'
import { env } from './http.ts'
import { homeReads } from './persona.ts'
import {
  type EdgeSelector,
  ftsQuery,
  leafOf,
  matchQuery,
  pageRanked,
  parseQuery,
  type Pred,
  type Reach,
  resolveRefs,
  teaches,
  TEXT,
} from './query.ts'
import { reachRows, textMatchesAt, where } from './sql.ts'
import { type Frag, toSql } from './relation.ts'
import { derivedCols, indexDdlOne, tableDdl } from './ddl.ts'
import { FILTERS, type Vocab, vocabOps } from './store/vocab.ts'
import type { Vocab as FleetVocab } from '@yaks/vocab'
import { type Bundle, type Driver, read as sqliteRead } from '@yaks/sqlite'
import { and as queryAnd, every, order } from '@yaks/query'
import { type Derived, raw } from '@yaks/sql'
import { blobRead } from '@yaks/blob'
import { fleetVocab } from './vocab/fleet_vocab.ts'
import { Stale as CoreStale } from '@yaks/graph'
import { Bounced as LeaseBounced } from '@yaks/session'
import {
  auditFleetBounce,
  type GuardHost,
  sync,
} from './store/fleet_preconditions.ts'
import { type LifecycleHost } from './store/fleet_lifecycle.ts'
import { type FleetGraph, fleetGraph } from './store/fleet_graph.ts'
import { fleetNormalizers } from './store/fleet_normalize.ts'
import {
  cameraEid,
  cursorEid,
  edgeEid,
  link,
  links,
  natureOf,
  natures,
  sentences,
  typeOf,
  unlink,
} from './edge.ts'
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
import { type DocColumn, REDACTED, scrubbable } from './redaction.ts'
import {
  compsOf,
  type EntrySourceOutcome,
  hasSources,
  sourceEntries,
  sourceList,
  sourceResolve,
} from './source.ts'
import { workReadyJoinsSql, workReadyWhereSql } from './work.ts'
import { advanceable } from './entry_work.ts'

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
let stmtCache = new WeakMap<Sql, Map<string, Statement>>()
// Off during open(): migrations ALTER tables, so a statement cached against an
// intermediate schema would strand. With caching off, prep() is exactly
// db.prepare() — open()'s migrations behave identically to before — and only the
// post-open runtime populates the cache.
let caching = true
// Every statement EXECUTED is one round trip to the store, counted on the
// request's tally (hops.ts) — the count /query and /apply report as
// `hops;dur=<n>` on their Server-Timing, so an N+1 is a number in the header
// and not a pause. Counted here and not at prepare: a cached statement is
// prepared once and stepped a thousand times, and the thousand is the news.
// The wrapper is built with the statement, so it too is cached.
let counting = (s: Statement): Statement => ({
  get: <T extends object = Record<string, unknown>>(...args: SqlValue[]) => {
    hop('hops')
    return s.get<T>(...args)
  },
  all: <T extends object = Record<string, unknown>>(...args: SqlValue[]) => {
    hop('hops')
    return s.all<T>(...args)
  },
  run: (...args: SqlValue[]) => {
    hop('hops')
    return s.run(...args)
  },
})
let prep = (db: Sql, sql: string): Statement => {
  if (!caching) return db.prepare(sql)
  let m = stmtCache.get(db)
  if (!m) stmtCache.set(db, m = new Map())
  let s = m.get(sql)
  if (!s) m.set(sql, s = counting(db.prepare(sql)))
  return s
}

// Package reads use the same prepared-statement cache and hop accounting as
// fleet reads. Keep their driver read-only; none of these paths stages writes.
export let readDriver = (db: Sql): Driver => ({
  query: (sql, params) => prep(db, sql).all(...params),
  exec: () => {
    throw new Error('a storage read cannot execute writes')
  },
})

// Every transaction goes through the seam's one door, db.transaction(): the
// file adapter spells it as BEGIN/savepoints, a hosted store as its runtime's
// transaction call. Migrations compose: the outer immediate transaction is the
// schema lock, while older focused migrations keep their all-or-nothing
// boundary as nested runs. No process-level lock participates in correctness.

// The grave keys on the retained spine (D-18866): a dead entity's row IS its
// int id, and its num still lives on that spine, so the table carries only
// when. Named apart from `schema` because open() rebuilds a legacy eid-keyed
// grave table to this shape (migrateTombstone).
let tombstoneDdl = `create table if not exists tombstone (
    entity     integer primary key references entity(id),
    deleted_at text not null
  )`

// Derived data, not graph (like doc_fts): a doc's semantic vector, written
// only by embed.ts's sweep, keyed by the doc's spine id — so its rowid IS the
// entity id the ANN scan hands back. hash names the exact text embedded (skip
// unchanged), model names the embedder (a model upgrade just re-sweeps). Never
// on the wire, never in snapshot(); a stale or missing row costs recall, never
// correctness. Named apart from `schema` because open() rebuilds a legacy
// eid-keyed table to this shape (migrateEmbedding).
let embeddingDdl = `create table if not exists embedding (
    entity integer primary key references entity(id),
    model  text not null,
    hash   text not null,
    vec    blob not null,
    at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`
// The extension's ANN data is derived from embedding. These triggers are the
// crash fence: any raw-vector write dirties the persisted index in the same
// SQLite statement; vector.ts clears it only after a successful rebuild.
// A bounced claim's audit row. Both sides reference the retained spine; a
// loser whose session was born in the very batch that rolled back has no spine
// row, so loser (and holder, symmetrically) admit null. Named apart from
// `schema` because open() rebuilds a legacy label-keyed table to this shape
// (migrateConflict).
let conflictDdl = `create table if not exists conflict (
    entity integer primary key references entity(id),
    target integer not null,
    loser  integer references entity(id),
    holder integer references entity(id),
    at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`
let embeddingTriggers = `
  create trigger if not exists embedding_index_ai after insert on embedding
  begin update embedding_index set dirty = 1 where id = 1; end;
  create trigger if not exists embedding_index_au after update on embedding
  begin update embedding_index set dirty = 1 where id = 1; end;
  create trigger if not exists embedding_index_ad after delete on embedding
  begin update embedding_index set dirty = 1 where id = 1; end;`

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

// A letter's ENVELOPE as one indexable string: the two addresses that say who
// wrote it and who received it (T-32657). An address is what an operator has
// in hand when they go looking for a letter — `task search yaktest6` — and it
// appears nowhere in the subject or the prose, so doc_value carries it beside
// title and body and the FTS mirror indexes it. `mail."from"` needs its quotes
// (a keyword) and both columns are nullable, so the empty envelope is '' both
// here and in every trigger below.
let addrOf = (at: string) =>
  `trim(coalesce(${at}"from", '') || ' ' || coalesce(${at}to_addr, ''))`
// The same envelope read through an entity id, for a trigger on `doc` that has
// no mail row in hand: an entity that is not a letter has no address.
let addrAt = (entity: string) =>
  `coalesce((select ${addrOf('')} from mail where entity = ${entity}), '')`

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
  -- The doc projection the FTS mirrors index and search reads back: title,
  -- body and envelope, resolved through the blob backend.
  create view if not exists doc_value as
    select d.entity as rowid, d.entity, d.title, b.value as body,
      ${addrOf('m.')} as addr
    from doc d join blob_text b on b.entity = d.body
    left join mail m on m.entity = d.entity;
  create table if not exists task (
    entity    integer primary key references entity(id)
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
  -- How something ended. A transcript's exit always carries a code; a tracked
  -- process's ending (T-35323) may be witnessed without one — the wrapper died
  -- unreporting, or nobody was watching — so the column is nullable.
  create table if not exists exit (
    entity  integer primary key references entity(id),
    code integer
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
  ${conflictDdl};
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
  -- A task FINISHED / CALLED OFF (D-24102): the marks the dissolved task.status
  -- becomes. Same stamp shape as decided — "at"/"by" ride the wire (a completion
  -- recorded after the fact), the server alone stamps "via" — so they carry a
  -- default clock and stay HAND-written rather than derived. cancelled adds its
  -- optional "reason". Presence IS the status: statusOf reads these two + claim.
  create table if not exists completed (
    entity integer primary key references entity(id),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" integer,
    via integer
  );
  create table if not exists cancelled (
    entity integer primary key references entity(id),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" integer,
    reason text,
    via integer
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
  ${tombstoneDdl};
  -- The journal (D-18860/D-18861) -- log data, not graph (like tool_call
  -- below): the record OF the wire, never part of it, written inside apply()'s
  -- transaction. Three append-only tables with no eid of their own, never in
  -- snapshot() or a client cache, not vocabulary components (so no
  -- codegen); read per-entity via journalOf(), per-batch via
  -- journalSince(). The symmetry: telemetry records READS, the journal records
  -- WRITES.
  --
  -- journal_tx: one row per applied batch, its provenance (ts, actor, via,
  -- trace). Its id is the transaction's durable total-order identity --
  -- monotonic, so ordering never rests on ts alone -- and the cursor every
  -- delta client holds. actor and via are spine ids like every other
  -- reference (the actor it resolved to; the session or client that wrote),
  -- null when unowned.
  create table if not exists journal_tx (
    id    integer primary key,
    ts    text not null,
    actor integer references entity(id),
    via   integer references entity(id),
    trace text
  );
  -- journal_change: one ordered operation per Change in the batch. (tx, ordinal)
  -- reproduces the exact applied order within a transaction. operation is
  -- upsert (comp != null -- a present component, an empty one being an upsert
  -- with no field rows) or remove (comp == null -- a component removal, or
  -- entity death when component = 'entity'). component is the wire component
  -- name, entity its spine id. A spine row outlives its entity (a death is
  -- retained, D-18866), so every change names one; history whose spine an
  -- out-of-band purge removed was given a retained spine and a grave when the
  -- journal was keyed (migrateJournalKeys), so the reference never goes
  -- unmet.
  create table if not exists journal_change (
    id        integer primary key,
    tx        integer not null references journal_tx(id),
    ordinal   integer not null,
    entity    integer not null references entity(id),
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
  -- ordinal is the field's order within its change. A content-addressed
  -- field (doc.body) carries no text: ref names the content's blob entity,
  -- the one copy blob_text keeps, and value stays null -- history shares the
  -- graph's bytes instead of repeating them. An eid field is never
  -- journaled: it is the row's own identity, already the change's entity.
  create table if not exists journal_field (
    id       integer primary key,
    change   integer not null references journal_change(id),
    ordinal  integer not null,
    field    text not null,
    present  integer not null,
    value    text,
    ref      integer references entity(id)
  );
  -- Reconstruct a batch in order (by tx), per-entity history and predecessor
  -- lookup (by entity+component), and the field rows of a change (by change).
  create index if not exists journal_change_tx on journal_change(tx, ordinal);
  create index if not exists journal_change_ent on journal_change(entity, component);
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
  ${embeddingDdl};
  create table if not exists embedding_index (
    id    integer primary key check (id = 1),
    dirty integer not null
  );
  ${embeddingTriggers}
`

// A letter's envelope arrives AFTER its doc — the batch writes doc, then mail —
// and is stamped again when delivery resolves the address, so the doc triggers
// alone would index an empty envelope forever. These re-index the doc row on
// every move of its mail row. The 'delete' half names the PREVIOUS addr
// explicitly ('' before the row existed, old's after): doc_value already reads
// the new one, and an fts5 delete whose values miss what is indexed corrupts
// the index. Same reason for the `when`: no doc row, no indexed row to correct.
let mailFts = `create trigger if not exists mail_fts_ai after insert on mail
  when exists (select 1 from doc where entity = new.entity) begin
    insert into doc_fts (doc_fts, rowid, title, body, addr)
      select 'delete', rowid, title, body, '' from doc_value
       where rowid = new.entity;
    insert into doc_fts (rowid, title, body, addr)
      select rowid, title, body, addr from doc_value where rowid = new.entity;
  end;
  create trigger if not exists mail_fts_au after update on mail
  when exists (select 1 from doc where entity = new.entity) begin
    insert into doc_fts (doc_fts, rowid, title, body, addr)
      select 'delete', rowid, title, body, ${addrOf('old.')} from doc_value
       where rowid = new.entity;
    insert into doc_fts (rowid, title, body, addr)
      select rowid, title, body, addr from doc_value where rowid = new.entity;
  end;
  create trigger if not exists mail_fts_ad after delete on mail
  when exists (select 1 from doc where entity = old.entity) begin
    insert into doc_fts (doc_fts, rowid, title, body, addr)
      select 'delete', rowid, title, body, ${addrOf('old.')} from doc_value
       where rowid = old.entity;
    insert into doc_fts (rowid, title, body, addr)
      select rowid, title, body, '' from doc_value where rowid = old.entity;
  end;`

// The FTS5 mirrors, apart from `schema` because they are the one part of it a
// backend may lack (Can.fts): these derive from doc and the integrity pass in
// migrate() rebuilds them, so a store without FTS5 skips them whole and its
// search() refuses instead of failing on a missing table.
let ftsSchema = `
  create virtual table if not exists doc_fts using fts5(
    title, body, addr, content='doc_value', content_rowid='rowid'
  );
  create trigger if not exists doc_fts_ai after insert on doc begin
    insert into doc_fts (rowid, title, body, addr)
    values (new.rowid, new.title,
      (select value from blob_text where entity = new.body),
      ${addrAt('new.entity')});
  end;
  create trigger if not exists doc_fts_ad after delete on doc begin
    insert into doc_fts (doc_fts, rowid, title, body, addr)
    values ('delete', old.rowid, old.title,
      (select value from blob_text where entity = old.body),
      ${addrAt('old.entity')});
  end;
  create trigger if not exists doc_fts_au after update on doc begin
    insert into doc_fts (doc_fts, rowid, title, body, addr)
    values ('delete', old.rowid, old.title,
      (select value from blob_text where entity = old.body),
      ${addrAt('old.entity')});
    insert into doc_fts (rowid, title, body, addr)
    values (new.rowid, new.title,
      (select value from blob_text where entity = new.body),
      ${addrAt('new.entity')});
  end;
  ${mailFts}
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

// Content is already inline text (unlike doc.body's blob reference). Keep
// token and substring semantics separate, just as for docs. docsize is FTS5's
// actual membership, not count(*) on an external-content table (which reads
// the source). Guard deletes because old rows may await the additive backfill.
let contentIndexes = ['content_fts', 'content_gram']
let contentFtsSchema = contentIndexes.map((t) => `
  create virtual table if not exists ${t} using fts5(
    body, content='content', content_rowid='entity'
    ${t.endsWith('_gram') ? ", tokenize='trigram', detail='none'" : ''}
  );
  create trigger if not exists ${t}_ai after insert on content begin
    insert into ${t} (rowid, body) values (new.entity, new.body);
  end;
  create trigger if not exists ${t}_ad after delete on content
  when exists (select 1 from ${t}_docsize where id = old.entity) begin
    insert into ${t} (${t}, rowid, body)
      values ('delete', old.entity, old.body);
  end;
  create trigger if not exists ${t}_au after update on content begin
    insert into ${t} (${t}, rowid, body)
      select 'delete', old.entity, old.body
      where exists (select 1 from ${t}_docsize where id = old.entity);
    insert into ${t} (rowid, body) values (new.entity, new.body);
  end;
`).join('\n')

export let contentFtsPending = (db: Sql): boolean =>
  db.can.fts &&
  !!prep(db, "select 1 from server_meta where k = 'content_fts_pending'").get()

// One bounded, resumable maintenance slice, never a full rebuild on boot.
// Writers and concurrent openers serialize with the slice: a source row is
// read and indexed under the same lock, so edits/deletes cannot strand stale
// prose. The cursor skips rows already maintained by triggers. A crash loses
// at most this transaction; the next open resumes it.
export let fillContentFts = (db: Sql, limit = 64): boolean => {
  if (!contentFtsPending(db)) return false
  return db.transaction(() => {
    let state = prep(
      db,
      "select v from server_meta where k = 'content_fts_pending'",
    ).get() as { v: string } | undefined
    if (!state) return false
    let rows = prep(
      db,
      `select entity, body from content
      where entity > ? order by entity limit ?`,
    ).all(Number(state.v), limit) as { entity: number; body: string }[]
    // Bound text volume too: one unusually long entry is indivisible, but never
    // compound it with another batch of long responses in the same slice.
    let chars = 0, through = Number(state.v)
    for (let row of rows) {
      for (let t of contentIndexes) {
        prep(
          db,
          `insert into ${t} (rowid, body)
          select ?, ? where not exists (select 1 from ${t}_docsize where id = ?)`,
        )
          .run(row.entity, row.body, row.entity)
      }
      through = row.entity
      chars += row.body.length
      if (chars >= 256_000) break
    }
    if (!rows.length) {
      db.exec("delete from server_meta where k = 'content_fts_pending'")
      // Ask the usual integrity pass to verify the finished mirrors next boot.
      db.exec("delete from server_meta where k = 'fts_check'")
      return false
    }
    prep(db, "update server_meta set v = ? where k = 'content_fts_pending'")
      .run(String(through))
    return true
  }, true)
}

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
  'filed',
  'project',
  'accept',
  'venture',
  'board',
  'layout',
  'design',
  // A goal (M-31946 §5): {scope FK keep} — a tag with one nullable ref, the
  // memory shape without the stamp, so it derives.
  'goal',
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
  // The spawn catalog (T-35023): a provider is a name, a transport word, where
  // its credential comes from and two flags; a model adds a provider ref and
  // its effort levels. Nullable text/bool columns and one {eid} reference by
  // death word, so both derive.
  'provider',
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
  // A commit (M-31946 §7): {target FK cascade, sha/repo/message text} — the
  // notice shape with three nullable text columns, so it derives.
  'commit',
  // A tracked process (T-35323, @yaks/process): {pid number, command/cwd text}
  // — three nullable columns on an entity-keyed spine, so it derives.
  'process',
  // Desired state for one (T-35328): {command/cwd text, restart word, attempts
  // number}, and the bare mark that says the wanting is over. Both derive.
  'service',
  'stop',
  // The platform directory (D-32318): nullable text/real columns and {eid}
  // references by death word, so all three derive.
  'space',
  'app',
  // A deploy of an app (T-32886): one {eid} reference by death word, a
  // number and two nullable texts, so it derives.
  'deploy',
  'member',
  // A hostname someone else owns, aimed at one app (T-33037): a unique text
  // key, one {eid} reference by death word, a word and a time — so it derives
  // like the rest of the directory.
  'hostname',
  // An app offered by name and an app that took one (T-32888, T-32889):
  // nullable text/real columns and one {eid} reference by death word, so both
  // derive like the three above.
  'published',
  'installed',
  // What a person's agent said about the platform (T-32950): two {eid}
  // references by death word beside nullable text and number columns, so it
  // derives like the rest of the directory.
  'report',
  // What a space pays and what it spent (D-32751): a tier word, and the
  // meter's month of nullable counts — no FK, no NOT NULL, so both derive.
  'plan',
  'meter',
  // A sign-in in flight: four stamped nullable columns, no FK, so it derives.
  'signin',
  'deliver',
  'delivered',
  'error',
  'exception',
  'fixer',
  'verifier',
  'nofix',
  'noverify',
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
  // An edge entity (D-23820): {from, to} both FK cascade — the notice shape
  // twice over, so it derives; its natures are bare tags. THE edge store
  // since T-23821.
  'edge',
  'requires',
  'contains',
  'reads',
  'about',
  'supervises',
  'delegates',
  'supersedes',
  'worked',
  'references',
  'wants',
  'satisfies',
]

// Insert a bare entity spine — the eid, and nothing else. num is NOT minted
// here (T-3684): it is a kind-driven UI label, and this fires at FIRST-TOUCH,
// before any component says what KIND the entity is. mintNum() assigns it
// once the components land (apply()'s late pass, seed(), addressEntity()), or
// leaves it NULL for a numberless kind. No kind column: an entity is what its
// components make it. Birth time is the `created` component's business
// (T-6670), stamped by apply() from the batch's one clock — not taken here.
let spine = (db: Sql, eid: string) =>
  prep(db, 'insert or ignore into entity (eid) values (?)').run(eid)

// The kinds that get a human number. Cheap/bulk/ephemeral kinds stay out:
// `entry` (log lines) and `wake` (one per pace cycle, read only by kind=wake and
// self-replaced per actor) are never typed by a human, so a num is pure overload.
// Their spines carry a NULL num; every other kind is numbered (T-3684). An
// `edge` (D-23820) is bulk the same way — tens of thousands, named by what
// they join, never typed — so it stays out too.
let unnumbered = new Set(['entry', 'wake', 'edge'])
export let numbered = (kind: string) => !unnumbered.has(kind)

// Assign the next human number to a newly-created entity — the allocator
// spine() used to run at first-touch, moved here where the entity's KIND is
// finally knowable (its component rows exist). Same max+1 over the living AND
// the graves (tombstone.num keeps a dead entity's number), so a number is
// never reused and ids stay monotonic. A no-op if the entity is already
// numbered, is gone (deleted later in the same batch), or wears an unnumbered
// kind — the kind is derived only when the exclusion is non-empty, so part 1
// pays nothing for the lookup.
let mintNum = (db: Sql, eid: string) => {
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
  // The graves count too: a dead entity's spine row is retained with its num.
  let { n } = prep(
    db,
    'select coalesce(max(num), 0) + 1 as n from entity',
  ).get() as { n: number }
  prep(db, 'update entity set num = ? where eid = ? and num is null')
    .run(n, eid)
}

let utf8 = new TextEncoder()

// Land one internal text backend under the same blob identity attachments use.
// The caller stores only the returned integer id; graph-out resolves the text
// through blob_text, so the wire continues to speak the component value.
export let textBlob = (db: Sql, value: string): number => {
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
let ent = (db: Sql) => {
  let eid = crypto.randomUUID()
  spine(db, eid)
  return eid
}

// Seed writes go straight to SQL (bypassing apply()), so they resolve their
// own eids to the int owner/reference keys the reshaped tables use (D-18866):
// `(select id from entity where eid = ?)` for every owner and every reference.
let ID = '(select id from entity where eid = ?)'
let doc = (db: Sql, eid: string, title: string, body = '') =>
  prep(db, `insert into doc (entity, title, body) values (${ID}, ?, ?)`)
    .run(eid, title, textBlob(db, body))

let addTask = (db: Sql, title: string, status: string, body = '') => {
  let eid = ent(db)
  doc(db, eid, title, body)
  prep(db, `insert into task (entity) values (${ID})`).run(eid)
  prep(db, `insert into filed (entity, priority) values (${ID}, 0)`).run(eid)
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

let addProject = (db: Sql, title: string) => {
  let eid = ent(db)
  doc(db, eid, title)
  prep(db, `insert into project (entity) values (${ID})`).run(eid)
  return eid
}

let addBoard = (db: Sql, title: string) => {
  let eid = ent(db)
  doc(db, eid, title)
  prep(db, `insert into board (entity) values (${ID})`).run(eid)
  return eid
}

// A card views one entity through one lens; pinning places it on a canvas.
let addCard = (db: Sql, target: string, view: string) => {
  let eid = ent(db)
  prep(db, `insert into card (entity, target, view) values (${ID}, ${ID}, ?)`)
    .run(eid, target, view)
  return eid
}

let pin = (
  db: Sql,
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

// A demo sentence, said the way every writer says one: the edge ENTITY named
// by edgeEid, wearing its two ends and its nature (edge.ts).
let seedLink = (db: Sql, parent: string, type: string, child: string) => {
  let nature = natureOf[type]
  let eid = edgeEid(parent, nature, child)
  spine(db, eid)
  prep(
    db,
    `insert into edge (entity, "from", "to") values (${ID}, ${ID}, ${ID})`,
  )
    .run(eid, parent, child)
  prep(db, `insert into ${sqlName(nature)} (entity) values (${ID})`).run(eid)
}

// The spawn catalog carried into the graph (T-35023, catalog.ts SEED). Runs on
// every boot and is a no-op after the first: each provider and model is found
// by NAME or minted, and only columns still blank are filled — so an owner's
// edit (a retired model, a renamed label) survives, and a model entity that
// already existed for another reason gains its catalog facts instead of a twin.
let seedCatalog = (db: Sql) => {
  let key = (table: 'provider' | 'model', name: string) =>
    (prep(db, `select entity from ${table} where name = ?`).get(name) as
      | { entity: number }
      | undefined)?.entity
  let idOf = (table: 'provider' | 'model', name: string, title: string) => {
    let had = key(table, name)
    if (had) return had
    let eid = ent(db)
    doc(db, eid, title)
    prep(db, `insert into ${table} (entity, name) values (${ID}, ?)`)
      .run(eid, name)
    mintNum(db, eid)
    return key(table, name)!
  }
  let fill = (table: string, id: number, cols: Record<string, SqlValue>) => {
    for (let [col, v] of Object.entries(cols)) {
      if (v == null) continue
      prep(
        db,
        `update ${table} set "${col}" = ?
          where entity = ? and "${col}" is null`,
      ).run(v, id)
    }
  }
  let flag = (v?: boolean) => (v === false ? 0 : 1)
  let seats: Record<string, number> = {}
  for (let p of SEED) {
    let id = idOf('provider', p.name, p.title)
    seats[p.name] = id
    fill('provider', id, {
      transport: p.transport,
      credential: p.credential ?? null,
      fallback: p.fallback ? 1 : null,
      offered: flag(p.offered),
    })
  }
  for (let p of SEED) {
    if (p.serves) fill('provider', seats[p.name], { serves: seats[p.serves] })
    for (let m of p.models) {
      let id = idOf('model', m.name, m.title)
      fill('model', id, {
        provider: seats[p.name],
        label: m.label ?? m.title,
        efforts: m.efforts ?? null,
        effort: m.effort ?? null,
        offered: flag(m.offered),
      })
    }
  }
}

// A handful of neutral demo rows — a board containing tasks, one edge of
// each type, and a root canvas showing it as a Board plus one task
// card. No fleet data in the repo.
let seed = (db: Sql) => {
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
    'Render each task with what it requires.',
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
  seedLink(db, view, 'requires', schema) // the view is gated by the schema
  seedLink(db, view, 'contains', keys) // the view work decomposes into shortcuts
  seedLink(db, readme, 'reads', schema) // read the schema before writing docs

  let board = addBoard(db, 'Walking skeleton')
  for (let t of [schema, view, keys, readme]) {
    seedLink(db, board, 'contains', t)
  }

  let proj = addProject(db, 'Demo project')
  prep(db, `update filed set project = ${ID}`).run(proj)

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
export let hasCol = (db: Sql, table: string, col: string) =>
  (prep(db, `select name from pragma_table_info('${table}')`)
    .all() as { name: string }[]).some((c) => c.name == col)
// Is the column declared NOT NULL? The guard a tightening migration reads.
let colNotNull = (db: Sql, table: string, col: string) =>
  (prep(db, `select name, "notnull" as nn from pragma_table_info('${table}')`)
    .all() as { name: string; nn: number }[]).some((c) =>
      c.name == col && c.nn == 1
    )

// A table's column names in declaration order — what rebuild() copies BY NAME
// rather than by position, so a shape change never relies on `select *` lining
// up value for value (T-18475).
let colNames = (db: Sql, table: string) =>
  (prep(db, 'select name from pragma_table_info(?)')
    .all(table) as { name: string }[]).map((c) => c.name)

// `instruction` used to be the empty marker on a Session's assembled prompt.
// The evaluator now needs that name for executable instructions, so migrate
// the marker TABLE before the current schema is planted. Shape is the guard:
// a future executable instruction table has contract columns and must never be
// mistaken for this retired one-column marker. The two-table arm makes an
// interrupted/rolling migration idempotent without keeping two writable names.
export let migratePrompt = (db: Sql) => {
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
export let hasIdx = (db: Sql, name: string) =>
  !!prep(db, `select 1 from sqlite_master where type = 'index' and name = ?`)
    .get(name)

let ddlOf = (db: Sql, name: string) =>
  (prep(db, `select sql from sqlite_master where type = 'table' and name = ?`)
    .get(name) as { sql: string } | undefined)?.sql
let rebuild = (db: Sql, name: string, ddl: string) => {
  db.transaction(() => {
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

// A legacy grave table keyed by eid becomes the spine-keyed one (tombstoneDdl).
// Every grave's spine row is retained (migrateToIdKeys carries even pre-flip
// deaths onto it), so the copy is a join; a grave naming no spine at all is a
// record nothing can key and is reported, not invented. `num` falls away: the
// retained spine already carries it. No-op once the table wears `entity`.
export let migrateTombstone = (db: Sql) => {
  if (!hasCol(db, 'tombstone', 'eid')) return
  db.transaction(() => {
    db.exec('alter table tombstone rename to tombstone_stale')
    db.exec(tombstoneDdl)
    db.exec(
      `insert or ignore into tombstone (entity, deleted_at)
       select e.id, t.deleted_at from tombstone_stale t
       join entity e on e.eid = t.eid`,
    )
    let { n } = prep(
      db,
      `select count(*) as n from tombstone_stale t
       where not exists (select 1 from entity e where e.eid = t.eid)`,
    ).get() as { n: number }
    if (n) console.warn(`tombstone: ${n} grave(s) named no spine — dropped`)
    db.exec('drop table tombstone_stale')
  })
}

// Key the vectors by spine id. Every doc's spine row exists (a vector without
// one is an orphan the sweep would prune anyway), so the copy is a join. The
// rowids the persisted ANN data names are the OLD table's, so the index is
// marked dirty for the sweep's next rebuild. No-op once the table wears
// `entity`.
export let migrateEmbedding = (db: Sql) => {
  if (!hasCol(db, 'embedding', 'eid')) return
  db.transaction(() => {
    for (let t of ['ai', 'au', 'ad']) {
      db.exec(`drop trigger if exists embedding_index_${t}`)
    }
    db.exec('alter table embedding rename to embedding_stale')
    db.exec(embeddingDdl)
    db.exec(
      `insert or ignore into embedding (entity, model, hash, vec, at)
       select e.id, s.model, s.hash, s.vec, s.at from embedding_stale s
       join entity e on e.eid = s.eid`,
    )
    db.exec('drop table embedding_stale')
    db.exec(embeddingTriggers)
    db.exec('update embedding_index set dirty = 1 where id = 1')
  })
}

// A column's declared type, for a migration that keys on a SHAPE change
// rather than a column's presence.
let colType = (db: Sql, table: string, col: string) =>
  (prep(db, `select type from pragma_table_info('${table}') where name = ?`)
    .get(col) as { type: string } | undefined)?.type

// Point a conflict's sides at the spine. The legacy rows carried display
// strings — a session's chosen label when it had one, else its eid, else a
// human id — so each resolves through those doors in turn; what none of them
// names (a session that rolled back with the batch, a hand-typed label) is
// reported and left null. No-op once the sides are integers.
export let migrateConflict = (db: Sql) => {
  if (colType(db, 'conflict', 'loser') != 'TEXT') return
  let side = (col: string) =>
    `coalesce(
       (select s.entity from session s where s.id = c.${col}),
       (select e.id from entity e where e.eid = c.${col}),
       (select e.id from entity e
        where c.${col} glob '[A-Z]*-[0-9]*'
          and substr(c.${col}, instr(c.${col}, '-') + 1) not glob '*[^0-9]*'
          and e.num = cast(substr(c.${col}, instr(c.${col}, '-') + 1) as integer))
     )`
  db.transaction(() => {
    db.exec('alter table conflict rename to conflict_stale')
    db.exec(conflictDdl)
    db.exec(
      `insert into conflict (entity, target, loser, holder, at)
       select c.entity, c.target, ${side('loser')}, ${side('holder')}, c.at
       from conflict_stale c`,
    )
    let { losers, holders } = prep(
      db,
      `select count(*) filter (where loser is null) as losers,
              count(*) filter (where holder is null) as holders from conflict`,
    ).get() as { losers: number; holders: number }
    if (losers || holders) {
      console.warn(
        `conflict: ${losers} loser(s) and ${holders} holder(s) named no spine — left null`,
      )
    }
    db.exec('drop table conflict_stale')
  })
}

// The same shape for tool_call's source list: a row the CHECK doesn't know
// is dropped with a warning, and record() is by contract silent about its
// own failures — so an unwidened live table would swallow the very reports
// nobody else makes. No-ops once healed.
export let mendCalls = (db: Sql) => {
  if (!ddlOf(db, 'tool_call')?.includes("'cli'")) {
    rebuild(db, 'tool_call', callDdl)
  }
}

// The hosted graph_apply once persisted a single serialized Change; it now
// persists the whole atomic Change[] batch (T-16716). Wrap each existing
// single-object body into a one-element array and rename the column, so a
// legacy row and a batch read back under one name. Guarded on the old
// column, so it runs once and no-ops thereafter.
export let mendApply = (db: Sql) => {
  if (!hasCol(db, 'apply', 'change')) return
  db.transaction(() => {
    db.exec('update apply set change = json_array(json(change))')
    db.exec('alter table apply rename column change to changes')
  })
}

// The read→opened migration (T-7006): seed `opened` from every letter the
// old mail.read_at column already marked read. `insert or ignore` on the pk
// is idempotent, so a re-boot never moves an existing stamp. A no-op once
// the column is gone — the stamp has been the only read-state since.
export let backfillOpened = (db: Sql) => {
  if (!hasCol(db, 'mail', 'read_at')) return
  db.exec(
    `insert or ignore into opened (entity, at)
       select entity, read_at from mail where read_at is not null`,
  )
}

// Lift component-specific instruments into the universal register once
// (T-7113). Each half is guarded on its own source column: the register is
// the only home, and these reads are the last thing the columns are for.
export let backfillVia = (db: Sql) => {
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

// Is the journal keyed by spine id, every change naming one? The guard both
// migrate()'s pragma and the rebuild below read: a text `eid` column on
// journal_change is the old shape (journal_tx's text actor/via arrived and
// leave with it), and a nullable `entity` is the interim keyed shape.
let journalKeyed = (db: Sql) =>
  !tableExists(db, 'journal_change') ||
  (!hasCol(db, 'journal_change', 'eid') &&
    colNotNull(db, 'journal_change', 'entity'))

// Give every eid the journal names and no spine carries a RETAINED spine row
// and a grave, so the keyed journal can reference each one (D-18866's
// representation of a death, applied to history whose deletion predates it:
// session entries purged out of band, an actor slug that never was an entity).
// num stays null -- these never carried one -- and the grave's deleted_at is
// the ts of the last transaction that named the eid, the latest moment it is
// known to have existed. The grave is written in whichever shape the table
// wears. Returns how many were buried.
let buryJournalOrphans = (db: Sql) => {
  db.exec(
    `create temp table __orphan as
     select eid, max(ts) as last from (
       select jc.eid as eid, jt.ts as ts
         from journal_change jc join journal_tx jt on jt.id = jc.tx
       union all select actor, ts from journal_tx where actor is not null
       union all select via, ts from journal_tx where via is not null
     ) where eid not in (select eid from entity) group by eid`,
  )
  db.exec('insert into entity (eid, num) select eid, null from __orphan')
  db.exec(
    hasCol(db, 'tombstone', 'entity')
      ? `insert or ignore into tombstone (entity, deleted_at)
         select e.id, o.last from __orphan o join entity e on e.eid = o.eid`
      : `insert or ignore into tombstone (eid, deleted_at)
         select eid, last from __orphan`,
  )
  let { n } = db.prepare('select count(*) as n from __orphan').get() as {
    n: number
  }
  db.exec('drop table __orphan')
  return n
}

// The legacy reshapes read a table's target DDL off a fresh, migrated,
// throwaway graph, so they reuse the one schema definition instead of
// reconstructing it. Only the adapter can mint that sibling handle, so
// migrate() takes it as `fresh`; a backend without one never holds a legacy
// graph to reshape, and says so if it somehow does.
let scratchOf = (fresh?: () => Sql) => {
  if (!fresh) throw new Error('legacy reshape needs a scratch database')
  return migrate(fresh())
}

// Key the journal by spine id (T-18883). journal_change.eid and
// journal_tx.actor/via were eid TEXT; every other reference in the graph is an
// integer into entity(id), and now so are these -- entity NOT NULL, since
// every eid the journal names has a spine once the orphans are buried above;
// actor and via stay nullable for the unowned write. SQLite cannot retype a
// column, so each table is rebuilt beside itself from the fresh DDL and
// swapped in, keeping every id (journal_field points at journal_change ids,
// journal_change at journal_tx ids). Runs with foreign keys OFF (migrate()
// lifts them before BEGIN): the drops would otherwise cascade-check the child
// rows being kept. The interim keyed shape (nullable entity, no eid column)
// tightens in place when nothing names no entity; a row that does has lost
// its eid and must be restored from a backup before the rebuild -- reported,
// never invented.
let migrateJournalKeys = (db: Sql, fresh?: () => Sql) => {
  if (journalKeyed(db)) return
  let count = (sql: string) => (db.prepare(sql).get() as { n: number }).n
  let text = hasCol(db, 'journal_change', 'eid')
  if (!text) {
    let lost = count(
      'select count(*) as n from journal_change where entity is null',
    )
    if (lost) {
      console.warn(
        `journal: ${lost} change(s) name no entity and carry no eid — restore them before the journal can be keyed NOT NULL`,
      )
      return
    }
  }
  let scratch = scratchOf(fresh)
  let ddlOf = (t: string) =>
    (scratch.prepare(
      `select sql from sqlite_master where type = 'table' and name = ?`,
    ).get(t) as { sql: string }).sql.replace(t, `__mig_${t}`)
  let txDdl = ddlOf('journal_tx'), changeDdl = ddlOf('journal_change')
  scratch.close()

  let buried = text ? buryJournalOrphans(db) : 0
  let txs = count('select count(*) as n from journal_tx')
  let changes = count('select count(*) as n from journal_change')
  if (text) {
    db.exec(txDdl)
    db.exec(
      `insert into __mig_journal_tx (id, ts, actor, via, trace)
       select jt.id, jt.ts, a.id, v.id, jt.trace from journal_tx jt
         left join entity a on a.eid = jt.actor
         left join entity v on v.eid = jt.via`,
    )
    db.exec('drop table journal_tx')
    db.exec('alter table __mig_journal_tx rename to journal_tx')
  }
  db.exec(changeDdl)
  db.exec(
    `insert into __mig_journal_change (id, tx, ordinal, entity, component, operation)
     select jc.id, jc.tx, jc.ordinal, ${
      text ? 'e.id' : 'jc.entity'
    }, jc.component, jc.operation
       from journal_change jc${text ? ' join entity e on e.eid = jc.eid' : ''}`,
  )
  db.exec('drop table journal_change')
  db.exec('alter table __mig_journal_change rename to journal_change')
  db.exec(
    `create index journal_change_tx on journal_change(tx, ordinal);
     create index journal_change_ent on journal_change(entity, component);`,
  )
  console.warn(
    `journal: keyed ${txs} transactions and ${changes} changes by spine id — ` +
      `${buried} purged eid(s) given a retained spine and a grave`,
  )
}

// The components whose history the journal keeps (T-18883). Everything else
// is mechanical -- the role heartbeat, the session log partition, UI state,
// delivery marks, lifecycle stamps -- and is collected below. `entity` and
// `blob` stay only where a kept component's history names the entity, so a
// kept birth stays a birth and nothing else's does.
let JOURNAL_KEEP = [
  'doc',
  'task',
  'comment',
  'memory',
  'design',
  'goal',
  'commit',
  'project',
  'persona',
  'edge',
  ...natures,
  'claim',
  'decided',
  'proposed',
  'completed',
  'cancelled',
  'created',
  'updated',
  'mail',
  'deliver',
  'person',
  'feedback',
  'review',
  'quarantined',
  'accept',
  'verifier',
  'noverify',
  'finding',
  'bug',
  'notice',
  'brief',
  'patch',
  'alias',
]

// Collect the journal once (T-18883): drop every change of a component the
// journal does not keep, every `eid` field (the row's own identity, already
// the change's entity), the births of entities nothing kept ever named, the
// no-op writes (a field equal to its previous present value, then the upsert
// left with no fields and no presence change), and finally the transactions
// left with no changes. Marked in server_meta so a later open is a pure read;
// the SQL itself is idempotent. The `lost_and_found` tables an old .recover
// left behind go with it. Children before parents, so foreign keys hold.
let gcJournal = (db: Sql) => {
  if (
    !tableExists(db, 'journal_change') ||
    prep(db, `select 1 from server_meta where k = 'journal_gc'`).get()
  ) return
  let count = (sql: string) => (db.prepare(sql).get() as { n: number }).n
  let before = {
    tx: count('select count(*) as n from journal_tx'),
    change: count('select count(*) as n from journal_change'),
    field: count('select count(*) as n from journal_field'),
  }
  let keep = JOURNAL_KEEP.map((c) => `'${c}'`).join(', ')
  db.exec(`
    delete from journal_field where change in
      (select id from journal_change where component not in (${keep}, 'entity', 'blob'));
    delete from journal_change where component not in (${keep}, 'entity', 'blob');
    delete from journal_field where field = 'eid';
    delete from journal_field where change in
      (select id from journal_change jc where jc.component in ('entity', 'blob')
        and not exists (select 1 from journal_change o
          where o.entity = jc.entity and o.component not in ('entity', 'blob')));
    delete from journal_change where component in ('entity', 'blob')
      and not exists (select 1 from journal_change o
        where o.entity = journal_change.entity
          and o.component not in ('entity', 'blob'));
    delete from journal_field where id in (
      select id from (
        select jf.id as id, jf.present as present, jf.value as value,
               lag(jf.value) over (
                 partition by jc.entity, jc.component, jf.field
                 order by jc.tx, jc.ordinal, jf.ordinal) as prev
          from journal_field jf join journal_change jc on jc.id = jf.change)
       where present = 1 and value = prev);
    delete from journal_change where id in (
      select id from (
        select jc.id as id, jc.operation as op,
               lag(jc.operation) over (
                 partition by jc.entity, jc.component
                 order by jc.tx, jc.ordinal) as prev,
               (select count(*) from journal_field jf where jf.change = jc.id) as n
          from journal_change jc)
       where op = 'upsert' and n = 0 and prev = 'upsert');
    delete from journal_tx where not exists
      (select 1 from journal_change jc where jc.tx = journal_tx.id);
    drop table if exists lost_and_found;
    drop table if exists lost_and_found_0;
    insert or ignore into server_meta (k, v) values ('journal_gc', '1');
  `)
  let after = {
    tx: count('select count(*) as n from journal_tx'),
    change: count('select count(*) as n from journal_change'),
    field: count('select count(*) as n from journal_field'),
  }
  if (before.tx != after.tx || before.field != after.field) {
    console.warn(
      `journal: collected — tx ${before.tx} → ${after.tx}, ` +
        `changes ${before.change} → ${after.change}, ` +
        `fields ${before.field} → ${after.field}`,
    )
  }
}

// Share the graph's bytes with its history (T-18883): a journaled doc.body
// that still carries its text is pointed at the content blob that text hashes
// to (minted through textBlob if the graph no longer holds it -- content-
// addressed, so this is idempotent) and the copy is dropped, and every `eid`
// field row goes (the row's own identity, never a field). Guarded on the ref
// column, so a later open is a pure read; the ref index is realized here on
// every shape, since the schema template cannot name a column an old table
// lacks.
let migrateJournalRefs = (db: Sql) => {
  if (!tableExists(db, 'journal_field')) return
  if (!hasCol(db, 'journal_field', 'ref')) {
    db.exec(
      'alter table journal_field add column ref integer references entity(id)',
    )
    let rows = prep(
      db,
      `select jf.id as id, jf.value as value
         from journal_field jf join journal_change jc on jc.id = jf.change
        where jc.component = 'doc' and jf.field = 'body'
          and jf.present = 1 and jf.value is not null`,
    ).all() as { id: number; value: string }[]
    let point = prep(
      db,
      'update journal_field set ref = ?, value = null where id = ?',
    )
    let moved = 0
    for (let r of rows) {
      let text = JSON.parse(r.value)
      if (typeof text != 'string') continue
      point.run(textBlob(db, text), r.id)
      moved++
    }
    let gone = prep(db, `delete from journal_field where field = 'eid'`).run()
      .changes
    console.warn(
      `journal: ${moved} body after-image(s) now ref their content, ${gone} eid field(s) dropped`,
    )
  }
  if (!hasIdx(db, 'journal_field_ref')) {
    db.exec(
      'create index journal_field_ref on journal_field(ref) where ref is not null;',
    )
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
export let retireMemoryType = (db: Sql) => {
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
export let retireProposal = (db: Sql) => {
  let legacy = hasCol(db, 'task', 'proposal')
  let stale = prep(
    db,
    "select 1 from board where instr(query, '.proposal=true') > 0 limit 1",
  ).get()
  if (!legacy && !stale) return
  db.transaction(() => {
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
export let retireTaskStatus = (db: Sql) => {
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
  db.transaction(() => {
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

export let retireProjectRetiredAt = (db: Sql) => {
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
  db.transaction(() => {
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
export let backfillSpawn = (db: Sql) => {
  let cols = ['provider', 'model', 'effort', 'persona']
  db.transaction(() => {
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
// backfills the edge from every stored column value, live parents only, and it
// goes through apply() rather than straight into the row store — the sentence
// entity is what readers read now, and a door that writes only one of the two
// stores is a divergence (T-23824). The anti-join is what keeps the promise
// `insert or ignore` used to: a settled backfill re-fires as a true no-op.
export let backfillLineage = (db: Sql) => {
  let rows = prep(
    db,
    `select p.eid as parent, e.eid as child
       from session s
       join entity p on p.id = s.parent
       join entity e on e.id = s.entity
       left join (${sentences('delegates')}) d
         on d.parent = s.parent and d.child = s.entity
      where s.parent is not null and d.parent is null`,
  ).all() as { parent: string; child: string }[]
  for (let i = 0; i < rows.length; i += 2000) {
    apply(
      db,
      rows.slice(i, i + 2000).flatMap(({ parent, child }) =>
        link(parent, 'delegates', child)
      ),
    )
  }
}

// Lift the remaining Session aspects without inventing facets for rows that
// never carried them. An existing canonical row wins — including its nulls —
// so an interrupted rolling deploy can never revive a cleared legacy alias.
export let backfillSessionFacets = (db: Sql) => {
  db.transaction(() => {
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
export let migrateErrors = (db: Sql) => {
  let tables = ['role', 'session'].filter((table) => hasCol(db, table, 'error'))
  if (!tables.length) return
  let at: Record<string, string> = {
    role: 'null',
    session: `case when status in
      ('completed', 'failed', 'interrupted', 'lost') then finished_at end`,
  }
  db.transaction(() => {
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
export let migrateDelivery = (db: Sql) => {
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
  db: Sql,
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
  // A full eid: a uuid, a blob's content hash, or a commit's git sha.
  if (EID.test(id)) {
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
  let aliases = prep(
    db,
    `select o.eid as eid from alias a join entity o on o.id = a.entity
     where a.slug = ?
       or instr(' ' || coalesce(a.slugs, '') || ' ', ' ' || ? || ' ') > 0
     limit 2`,
  ).all(id, id) as { eid: string }[]
  if (aliases.length > 1) {
    throw new Error(
      `${id} is an ambiguous alias — matches ${
        aliases.map((hit) => shortId(hit.eid)).join(', ')
      }; use an eid`,
    )
  }
  if (aliases.length == 1) return aliases[0].eid
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
// died, so kindOf finds none and it wears the generic prefix rather
// than a kind-specific one. The raw-eid fallback is for an entity with no
// num at all (a numless cheap/bulk entity, or a numless old grave), never
// a demotion a death itself imposes.
export let human = (db: Sql, eid: string): string => {
  let row = prep(db, 'select num from entity where eid = ?').get(eid) as
    | { num: number }
    | undefined
  if (!row?.num) return shortId(eid)
  let kind = kindOf(
    Object.fromEntries(worn(db, fromEid, eid).map((n) => [n, true])),
  )
  return idOf({ eid, kind, num: row.num })
}

let ADDR = /@/
let UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A blob's eid IS its content hash, so the same bytes are one entity.
let CONTENT_EID = /^[0-9a-f]{64}$/i

// The entity already wearing this address: an address-book `email`, or an
// id-shaped fleet address naming one by its human id (S-31@<fleet> → that
// session). Mirrors mail.ts wearer()/named() — inlined because mail.ts imports
// db.ts, and this is the pre-mint half of the same resolution: an address the
// graph already knows must NOT get a second entity minted for it (that would
// SHADOW the real one in homeOf).
let addressed = (db: Sql, addr: string): string | undefined => {
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
export let addressEntity = (db: Sql, addr: string): string => {
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
export let migrateDeliver = (db: Sql) => {
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
export let migrateBoardsToProjects = (db: Sql) => {
  let boards = prep(
    db,
    'select o.eid as eid, query from board b join entity o on o.id = b.entity',
  ).all() as {
    eid: string
    query: string | null
  }[]
  let now = new Date().toISOString()
  db.transaction(() => {
    for (let { eid, query } of boards) {
      if (!query) continue
      let preds
      try {
        preds = parseQuery(query, vocabOf(db))
      } catch {
        continue // an unparseable query is not a clean project mirror
      }
      if (preds.length != 1) continue
      let p = preds[0]
      // op '' is equality (query.ts OPS['=']); a list/range value or a deref
      // path is not a single whole-project mirror.
      if (p.comp != 'filed' || p.prop != 'project' || p.op != '' || !p.value) {
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
      prep(
        db,
        'insert or ignore into tombstone (entity, deleted_at) values (?, ?)',
      ).run(bid, now)
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
export let healInboundDeliver = (db: Sql) => {
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
let mintAddresses = (db: Sql, changes: Change[]): Change[] => {
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
export let healStored = (db: Sql) => {
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
  db.transaction(() => {
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
let toId = (db: Sql, eid: string): number | null =>
  (prep(db, 'select id from entity where eid = ?').get(eid) as
    | { id: number }
    | undefined)?.id ?? null
let refId = (db: Sql, v: unknown): number | null =>
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
// The grave, asked two ways: by the spine's int id (the row itself), and by
// eid through the spine, for the doors that still speak eids. One statement
// each, prepared once, so every "is it dead?" reads the same table the same way.
let grave = (db: Sql) => prep(db, 'select 1 from tombstone where entity = ?')
let graveOf = (db: Sql) =>
  prep(
    db,
    `select 1 from tombstone t join entity e on e.id = t.entity
     where e.eid = ?`,
  )

let refToId = (
  db: Sql,
  name: string,
  owner: string,
  col: string,
  v: unknown,
): number | null => {
  if (v == null) return null
  let eid = String(v)
  let id = toId(db, eid)
  let gone = id != null && grave(db).get(id)
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
// The inverse, for a WRITE or a lookup that binds an eid where the column
// holds a spine id: `insert … values (${spineId})`, `where jc.entity = ${spineId}`.
let spineId = `(select id from entity where eid = ?)`

let tableExists = (db: Sql, t: string) =>
  !!prep(db, `select 1 from sqlite_master where type = 'table' and name = ?`)
    .get(t)

// The graph tables: the spine and every component table. The log/derived
// tables (the journal, tool_call, embedding, the FTS shadows) and the grave key
// on the spine through their own guarded steps.
let graphTables = () => ['entity', ...Object.keys(comps)]

// The envelope joined the projection (T-32657): a doc_value without `addr`,
// and the two-column doc_fts built from it, predate the change. Both are
// DERIVED from doc and mail, so the migration is to drop them and let schema
// and ftsSchema recreate the current shape; migrate() refills the emptied
// index in the same transaction. A view that already carries addr, or a graph
// too fresh to have one, is left alone.
let migrateDocAddr = (db: Sql) => {
  if (!hasCol(db, 'doc_value', 'entity')) return
  if (hasCol(db, 'doc_value', 'addr')) return
  db.exec(`
    drop trigger if exists doc_fts_ai;
    drop trigger if exists doc_fts_ad;
    drop trigger if exists doc_fts_au;
    drop table if exists doc_fts;
    drop view if exists doc_value;
  `)
}

// The app-plane-only boot switch (TASKS_PLANE=app, D-22804 §8 strangler). When
// set, this Deno process opens the graph read-only and forwards writes. This is
// retained for disposable parity copies; live_db.ts refuses it on owner data.
export let appPlane = () => env('TASKS_PLANE') == 'app'

// The data-plane writer's HTTP base URL (TASKS_WRITER_URL) — the Deno→bridge
// direction of the strangler write-proxy (T-22927), the mirror of the bridge's
// own --upstream/TASKS_UPSTREAM Deno target. In TASKS_PLANE=app the mutating
// doors forward the write here (the Rust bridge) and relay its
// answer, instead of refusing it (503). Absent, they still refuse rather than
// guess a server — a wrong guess (this reader's own 5173) would proxy every
// write straight back into the read-only process it came from. Read at the door,
// not cached, so a probe can point a fresh reader at a fresh bridge per boot.
export let writerUrl = () =>
  env('TASKS_WRITER_URL')?.replace(/\/+$/, '') || undefined

// Mint the durable sync epoch (T-20299) if absent — the cursor-lineage identity
// a delta client checks (epochOf). This write runs once in transactional
// migrate(), never on a read path. `insert or ignore` makes it idempotent — a no-op on a graph
// that already carries the row, so a re-open writes nothing.
export let mintEpoch = (db: Sql) =>
  db.exec(
    `insert or ignore into server_meta (k, v) values ('epoch', '${crypto.randomUUID()}')`,
  )

// T-36727: rekey client singletons in open()'s one transaction. Keep the
// integer spine id: component owners and ALL graph references (including
// card.target and pin.canvas) already name that id, so they follow the new
// public eid without copying or deleting any rows. Journal after-images are
// historical evidence and stay untouched. The equality guard makes reopening
// read-only; a conflicting derived eid refuses the whole migration, not data.
let deriveClientRows = (db: Sql) => {
  let changed = false
  for (let table of ['camera', 'cursor']) {
    let rows = prep(
      db,
      `
      select e.id, e.eid, c.eid as client${
        table == 'camera' ? ', v.eid as canvas' : ''
      }
      from ${table} r join entity e on e.id = r.entity
      join entity c on c.id = r.client
      ${table == 'camera' ? 'join entity v on v.id = r.canvas' : ''}
    `,
    ).all<{ id: number; eid: string; client: string; canvas: string }>()
    for (let row of rows) {
      let eid = table == 'camera'
        ? cameraEid(row.client, row.canvas)
        : cursorEid(row.client)
      if (eid == row.eid) continue
      prep(db, 'update entity set eid = ? where id = ?').run(eid, row.id)
      changed = true
    }
  }
  // Old UUIDs may survive in a returning browser's durable cache. This is a
  // non-journaled identity rewrite: require a fresh snapshot, not a delta.
  if (changed) {
    prep(db, `insert or replace into server_meta (k, v) values ('epoch', ?)`)
      .run(uuid())
  }
}

// Bumped with every serving-schema change. Guards remain idempotent for
// expand/contract upgrades; the version makes a newer database fail closed in
// an older binary instead of letting that binary infer compatibility.
export let schemaVersion = 1

let writableVersion = (db: Sql) => {
  let stored = db.version
  if (stored > schemaVersion) {
    throw new Error(
      `database schema version ${stored} is newer than this binary's ` +
        `version ${schemaVersion}; upgrade the serving process`,
    )
  }
  return stored
}

// Move portfolio filing without changing task identity or touching owner data.
// The old column is the one-time marker; open() owns the surrounding transaction.
export let migrateFiled = (db: Sql) => {
  if (!hasCol(db, 'task', 'priority')) return
  db.exec(tableDdl('filed'))
  let cols = ['priority', 'project', 'assignee', 'domain']
  let select = cols.map((c) => hasCol(db, 'task', c) ? c : 'null')
  db.exec(`insert into filed (entity, ${cols.join(', ')})
    select entity, ${select.join(', ')} from task`)
  // The old reference indexes must go before SQLite will drop their columns.
  for (
    let { name } of prep(
      db,
      "select name from pragma_index_list('task') where origin = 'c'",
    ).all() as { name: string }[]
  ) {
    db.exec(`drop index ${sqlName(name)}`)
  }
  for (let c of cols) {
    if (hasCol(db, 'task', c)) db.exec(`alter table task drop column ${c}`)
  }
}

// Migrate a connected handle in place: the hand + derived schema, the additive
// column/index fills, and the vector index.
// The schema work runs under one BEGIN IMMEDIATE and is idempotent: concurrent
// openers serialize in SQLite, and a waiter rechecks every guard after the
// winner commits. Returns the same handle for the one-line open() below.
export let migrate = <D extends Sql>(db: D, fresh?: () => Sql): D => {
  // Migrations ALTER tables; a cached statement would strand against an
  // intermediate schema. Compile raw until the schema is final, then restore.
  let wasCaching = caching
  caching = false
  // The journal rekey drops parent tables whose children it keeps. This pragma
  // must be set before BEGIN; SQLite deliberately ignores foreign_keys changes
  // inside a transaction. Every other migration keeps FK enforcement enabled.
  let legacy = !journalKeyed(db)
  if (legacy) db.exec('pragma foreign_keys = off')
  try {
    let migrated = db.transaction(() => {
      // One SQLite transaction owns the schema transition. Concurrent openers
      // wait at BEGIN IMMEDIATE, then re-run the idempotent guards against the
      // schema the winner committed; no application sidecar lock is involved.
      // The version check belongs after that wait: reading it before BEGIN lets
      // an older waiter overwrite a newer migrator's version after it commits.
      let stored = writableVersion(db)
      migratePrompt(db)
      // Retire a doc_value/doc_fts pair that predates the mail envelope; the
      // schema below recreates both carrying it.
      migrateDocAddr(db)
      // A mirror about to be CREATED is born empty, and the boot integrity
      // check below cannot see that: count(*) over an external-content table
      // reads the content table, not the index. So whoever just dropped one —
      // the body migration, the envelope migration, or a graph that never had
      // it — has its rows put back here, once, in this transaction.
      let unbuilt = !db.can.fts ? [] : ['doc_fts', 'doc_gram']
        .filter((t) => !tableExists(db, t))
      let contentUnbuilt = db.can.fts &&
        contentIndexes.some((t) => !tableExists(db, t))
      db.exec(schema)
      if (db.can.fts) {
        db.exec(ftsSchema)
        db.exec(contentFtsSchema)
        if (contentUnbuilt && prep(db, 'select 1 from content limit 1').get()) {
          db.exec(`insert or replace into server_meta (k, v)
            values ('content_fts_pending', '0')`)
        }
      }
      for (let t of unbuilt) {
        db.exec(`insert into ${t} (${t}) values ('rebuild')`)
      }
      let addCol = (table: string, col: string, ddl: string) => {
        if (!hasCol(db, table, col)) {
          // Quoted: a component may be named after a keyword (`commit`).
          db.exec(`alter table ${sqlName(table)} add column ${ddl}`)
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
      // The same in-place ALTER for a live graph's `exit` (T-35323): a process
      // whose ending was seen but whose code was not is `exit{}`. Every
      // transcript exit already standing carries one, so nothing is rewritten.
      if (
        (prep(
          db,
          `select "notnull" as nn from pragma_table_info('exit') where name = 'code'`,
        ).get() as { nn: number } | undefined)?.nn
      ) {
        db.exec('alter table exit alter column code drop not null')
      }
      // Retired by per-item human notification state; agents derive attention
      // from claims and transcript references instead of this session cursor.
      dropCol('session', 'acked_at')
      migrateFiled(db)
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
      // The process this session is a transcript OF (T-35323): a provider-harness
      // run is two tracked things — the session, and the child that produced it.
      // `source` above is already the boot mode a SessionStart hook self-reports,
      // so the reference wears the word it names.
      addCol('session', 'process', 'process integer references entity(id)')
      addCol('session', 'operator', 'operator integer')
      // The operator session a delegated agent descends from (types.ts): a child
      // reifies as its own row rather than a second writer on the operator's.
      addCol('session', 'parent', 'parent integer references entity(id)')
      // What said it (T-35323): the ask, for a model's own words, or the process
      // whose stream the line came off. Absent on prose a person wrote.
      addCol('content', 'source', 'source integer references entity(id)')
      // Which way the decision went (D-21212); null reads as approved.
      addCol('decided', 'verdict', 'verdict text')
      for (
        let table of ['created', 'updated', 'notified', 'opened', 'archived']
      ) {
        addCol(table, 'via', 'via integer')
      }
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
      // The retired edge row store (T-23821). Every edge is an entity now —
      // `edge{from, to}` wearing its nature — and the rows were carried over
      // before this drop shipped, so a live graph loses nothing and a fresh one
      // never had the table.
      db.exec('drop table if exists dependency;')
      // The per-type delivery receipts become the shared delivered/error
      // components, and the per-type recipient columns the shared deliver.to.
      migrateErrors(db)
      migrateDelivery(db)
      migrateDeliver(db)
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
        db.transaction(() => {
          db.exec('insert into mail select * from send_request')
          db.exec('drop table send_request')
        })
      }
      // The grave table keys on the spine's int id; a legacy eid-keyed one is
      // rebuilt to that shape (its num already rides the retained spine).
      migrateTombstone(db)
      migrateEmbedding(db)
      migrateConflict(db)
      // All mirrors follow their source by trigger. Out-of-band writes and
      // shadow-table damage show up as a failed integrity check or actual
      // membership drift. Docs heal inline; the much larger transcript indexes
      // reset here and resume their bounded backfill off the serving thread.
      let count = (t: string) =>
        (prep(db, `select count(*) as n from ${t}`).get() as { n: number }).n
      type FtsFault = {
        operation: 'integrity-check' | 'count-check'
        error: unknown
      }
      let diagnosis = (error: unknown) =>
        error instanceof Error ? error.message : String(error)
      // The integrity-check reads both shadow tables whole — 2.3s of boot on
      // the live graph — for damage none of our writers can cause, so it runs
      // once a day (marked in server_meta); the count-check, which catches
      // every drift a missed trigger leaves, stays on every boot.
      let checked = prep(db, `select v from server_meta where k = 'fts_check'`)
        .get() as { v: string } | undefined
      let deep = !checked ||
        !(Date.now() - Date.parse(checked.v) < 24 * 3_600_000)
      let fault = (t: string): FtsFault | undefined => {
        if (deep) {
          try {
            db.exec(
              `insert into ${t} (${t}, rank) values ('integrity-check', 1)`,
            )
          } catch (error) {
            return { operation: 'integrity-check', error }
          }
        }
        try {
          let source = t.startsWith('content_') ? 'content' : 'doc'
          let indexed = count(`${t}_docsize`), docs = count(source)
          if (indexed != docs) {
            return {
              operation: 'count-check',
              error: new Error(
                `${t} returned ${indexed} rows; ${source} returned ${docs}`,
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
      for (
        let t of db.can.fts ? ['doc_fts', 'doc_gram', ...contentIndexes] : []
      ) {
        if (contentIndexes.includes(t) && contentFtsPending(db)) continue
        let before = fault(t)
        if (!before) continue
        if (contentIndexes.includes(t)) {
          // Drop only derived mirrors on damage. Recreate both atomically,
          // then refill off the boot path, with the same guarded triggers.
          for (let index of contentIndexes) {
            db.exec(`drop trigger if exists ${index}_ai;
              drop trigger if exists ${index}_ad;
              drop trigger if exists ${index}_au;
              drop table ${index};`)
          }
          db.exec(contentFtsSchema)
          db.exec(`insert or replace into server_meta (k, v)
            values ('content_fts_pending', '0')`)
          continue
        }
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
      if (deep) {
        prep(
          db,
          `insert or replace into server_meta (k, v) values ('fts_check', ?)`,
        ).run(new Date().toISOString())
      }
      let { n } = prep(db, 'select count(*) as n from task').get() as {
        n: number
      }
      if (!n) seed(db)
      // The spawn catalog is graph data, so every graph carries it: a fresh
      // one, the live one, and a test's :memory: alike (T-35023).
      seedCatalog(db)
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
      migrateJournalKeys(db, fresh)
      gcJournal(db)
      migrateJournalRefs(db)
      deriveClientRows(db)
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
      // healStored re-parses every stored cell of every component table (6.6s
      // of a 15s boot on the live graph) for what an older vocabulary let in.
      // The vocabulary decides validity, so one pass per vocabulary is the
      // whole job: marked in server_meta under the vocabulary's hash, and a
      // boot that finds its own hash skips the pass. apply() validates every
      // write in between.
      let vocab = `heal:${sha(JSON.stringify([comps, stamped]))}`
      if (!prep(db, `select 1 from server_meta where k = ?`).get(vocab)) {
        healStored(db)
        prep(db, `insert or ignore into server_meta (k, v) values (?, '1')`)
          .run(vocab)
      }
      // Indexes LAST — over EVERY component, not just `derived` (T-17678). SQLite
      // auto-indexes no foreign key, and the hand-written `schema` tables (comment,
      // cancel, card, stop_request, review, camera, fold, mail, …) carry {eid} ref
      // columns too, so realizing indexDdl only over `derived` left comment.target
      // and its siblings unindexed — a server-side `.comment.target=x` full-SCANNED
      // the table (the browser is unaffected: index.ts builds the reverse map in
      // memory). indexDdl is the one vocabulary's index set (index.ts indexesFor),
      // so this is the SQL realization the design always anticipated. Placed after
      // every addCol/rebuild above: a ref column may be added by migration
      // (filed.project, role.checkout, mail.reply_to) and a table rebuild (mendMail,
      // migrateDelivery) drops and recreates its rows without indexes. Guarded by
      // hasIdx — a bare `create index if not exists` still opens an empty write
      // transaction that bumps the file change counter (breaking open()'s byte-
      // idempotency), so the guard makes a re-open pure reads, the SAME shape addCol
      // takes with hasCol.
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
      if (stored != schemaVersion) db.version = schemaVersion
      return db
    }, true)
    return migrated
  } finally {
    if (legacy) db.exec('pragma foreign_keys = on')
    // Runtime caches; a throwing or recursively opened migration restores the
    // state it inherited instead of enabling caching in its outer migration.
    caching = wasCaching
  }
}

// The planner's statistics, kept within 2x of the truth. ANALYZE had run once,
// at 58k entities; at 294k the stale row had the planner scanning the spine
// for a `.kind=` filter (1.2s where fresh stats answer in 0.4ms). `pragma
// optimize` re-analyzes only past 25x, so the staleness test is our own —
// entity's count against its stat row — and the cure a full ANALYZE (~0.5s
// on the live graph). store/sqlite.ts open() runs it after migrate(), outside
// the transaction schemaDdl() records.
export let freshStats = (db: Sql) => {
  let stat = tableExists(db, 'sqlite_stat1')
    ? prep(
      db,
      `select stat from sqlite_stat1
       where tbl = 'entity' and idx = 'sqlite_autoindex_entity_1'`,
    ).get() as { stat: string } | undefined
    : undefined
  let have = Number(stat?.stat.split(' ')[0] ?? 0)
  let n =
    (prep(db, 'select count(*) as n from entity').get() as { n: number }).n
  // A small graph (every test's, a fresh install's) plans well on defaults,
  // and statistics over a handful of rows only teach the planner to prefer
  // scanning tables that are tiny today — estimates a connection keeps until
  // it reparses the schema. Statistics start mattering when a scan costs.
  if (n < 1000) return false
  let analyzed = !(have && n < have * 2 && have < n * 2)
  if (analyzed) prep(db, 'analyze').run()
  // ANALYZE writes no row for an EMPTY table, and a table without one is
  // sized like any unknown table — so `.goal!` over an empty goal table
  // scanned the spine (100ms) rather than the table. A synthetic one-row
  // stat says "tiny"; `analyze sqlite_schema` loads it into the planner.
  let known = prep(db, `select 1 from sqlite_stat1 where tbl = ?`)
  let tiny = prep(
    db,
    `insert into sqlite_stat1 (tbl, idx, stat) values (?, null, '1')`,
  )
  let added = 0
  for (let t of new Set([...Object.keys(comps), ...Object.keys(stamped)])) {
    if (tableExists(db, t) && !known.get(t)) added += tiny.run(t).changes
  }
  if (analyzed || added) prep(db, 'analyze sqlite_schema').run()
  return analyzed
}

// The ordered schema-shaping DDL a fresh migrate() runs, classified — the ONE
// source the codegen emits src/store/schema.json from, so a backend that plants
// at runtime (workers/yak/graph.ts) owns schema CREATE + ADDITIVE migration off
// db.ts's own schema (D-22804 §8), never a hand-kept copy. Captured by RECORDING
// db.exec over a
// migrate() of the EMPTY handle the caller passes (the file adapter's :memory:,
// the SAME driver the live server writes with, so the emitted DDL is
// byte-for-byte what this process would run; closed here when done); then
// augmented with the derived-component add-columns. Those last are the one thing
// the capture cannot see: addDerivedCols runs one `add column` per derived
// column, but on a FRESH db the column is already present (tableDdl created the
// table whole), so the guarded alter is a no-op and never reaches db.exec — yet
// an OLD db that predates a newly-derived column needs it. They are spliced in
// right after the derived table creates, before the index realization that may
// name such a column. Additive only: the historical one-time reshapes
// (board→project, the backfills/retirements) are no-ops on a fresh db and
// never captured — the live graph is already past them, and
// "anything shapier needs the owner" (M-17876).
export let schemaDdl = (real: Sql): SchemaOp[] => {
  let recorded: string[] = []
  let proxy = new Proxy(real, {
    get(t, p, _r) {
      if (p === 'exec') {
        return (sql: string) => {
          recorded.push(sql)
          return t.exec(sql)
        }
      }
      // Private-field accessors must receive the concrete handle as `this`;
      // using the proxy receiver breaks getters such as inTransaction.
      let v = Reflect.get(t, p, t)
      return typeof v === 'function'
        ? (v as (...a: unknown[]) => unknown).bind(t)
        : v
    },
  })
  migrate(proxy)
  real.close()

  let classify = (sql: string): SchemaOp => {
    let t = sql.trim()
    // The table is unquoted for the guard: pragma_table_info takes a bare name,
    // and addCol quotes its DDL (a component may be named after a keyword).
    let add = t.match(/^alter\s+table\s+(\S+)\s+add\s+column\s+(\S+)/i)
    if (add) {
      let table = add[1].replace(/^"(.*)"$/, '$1').replaceAll('""', '"')
      return { kind: 'addColumn', table, col: add[2], sql }
    }
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

// Plant the schema on an EMPTY handle from schemaDdl()'s ops, guarded the way
// the Rust kernel replays them (schema.rs apply_schema): an idempotent
// create/drop runs as-is, an add-column only when the column is absent, a bare
// create-index only when the index is absent. This is a fresh backend's door
// (D-32318): a store that begins empty runs it once and never the historical
// migrations, which are no-ops on a fresh graph anyway. vocab/schema_capture.ts
// proves it reproduces a fresh migrate() byte-for-byte at codegen time. No
// seed: the demo graph belongs to the local file, not to a backend.
export let plant = <D extends Sql>(db: D, ops: SchemaOp[]): D =>
  shaped(db, () => {
    raise(db, ops)
    mintEpoch(db)
    db.version = schemaVersion
    return db
  })

// The guarded replay itself: an idempotent create/drop runs as-is, an
// add-column only when the column is absent, a bare create-index only when the
// index is absent.
let raise = (db: Sql, ops: SchemaOp[]) => {
  for (let op of ops) {
    if (op.kind == 'addColumn') {
      if (!hasCol(db, op.table, op.col)) db.exec(op.sql)
    } else if (op.kind == 'index') {
      if (!hasIdx(db, op.name)) db.exec(op.sql)
    } else db.exec(op.sql)
  }
}

// One DDL transaction, with the statement cache off (a statement prepared
// against the intermediate schema would strand) and the column memo dropped
// after (a new table changes what columnsOf() knows).
let shaped = <T>(db: Sql, fn: () => T): T => {
  let wasCaching = caching
  caching = false
  try {
    return db.transaction(fn, true)
  } finally {
    caching = wasCaching
    stored.delete(db)
  }
}

// The same replay, additive and on its own: an app's declared components
// (store/vocab.ts) land in a store that is already planted, so no epoch is
// minted and no schema version moves — the app's vocabulary grew, the
// platform's schema did not.
export let graft = <D extends Sql>(db: D, ops: SchemaOp[]): D =>
  shaped(db, () => {
    raise(db, ops)
    return db
  })

// Every object in the ops that IS its definition — a view, a trigger, a
// virtual table. `create … if not exists` is a no-op where an older one
// stands, so a definition that CHANGED never lands on a store raised from an
// older schema, and the halves that did land compile against the halves that
// did not.
let defined = (ops: SchemaOp[]) =>
  ops.flatMap((op) => [
    ...op.sql.matchAll(
      /create\s+(trigger|view|virtual\s+table)\s+(?:if\s+not\s+exists\s+)?(\w+)([^;]*)/gi,
    ),
  ]).map(([, what, name, rest]) => ({
    name,
    drop: what.toLowerCase() == 'view' ? 'view' : 'table',
    trigger: what.toLowerCase() == 'trigger',
    // An fts5 mirror comes back empty and is refilled from its content table;
    // every other definition holds nothing of its own to lose.
    fts: /using\s+fts5/i.test(rest),
  }))

// The replay a store raised from an OLDER schema needs. Definitions cannot be
// altered in place, so they are dropped and raised again at the current shape:
// the mail triggers a plain graft added wrote doc_fts.addr into a doc_fts
// planted before that column, and every DELETE in that store then failed to
// prepare, because SQLite compiles a table's triggers with the statement that
// fires them (T-32826). Everything dropped here is derived — the doc_value
// projection and the FTS mirrors hold nothing `doc` does not — so the cost is
// the rebuild below and nothing else.
export let regraft = <D extends Sql>(db: D, ops: SchemaOp[]): D =>
  shaped(db, () => {
    let all = defined(ops)
    // Triggers first: one names the tables around it, and a table dropped
    // under a live trigger is a trigger nothing can drop.
    for (let d of all) {
      if (d.trigger) db.exec(`drop trigger if exists ${d.name}`)
    }
    for (let d of all) {
      if (!d.trigger) db.exec(`drop ${d.drop} if exists ${d.name}`)
    }
    raise(db, ops)
    for (let d of all) {
      if (d.fts && tableExists(db, d.name)) {
        db.exec(`insert into ${d.name} (${d.name}) values ('rebuild')`)
      }
    }
    return db
  })

// The schema a store was raised from, as one word: the vocabulary's columns
// and the statements that shape them. A store wakes into THIS schema or into
// a mix of two, and the mix is what T-32826 was — so the stamp moves with the
// DDL too, not with the component vocabulary alone.
export let schemaStamp = (ops: SchemaOp[]) =>
  createHash('sha1').update(vocabHash).update(JSON.stringify(ops))
    .digest('hex').slice(0, 16)

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

// Vocabulary and composed graph handles live beside each Sql connection.
// App-authored components join the fleet schema through vocabOf(db).
let fleetVocabs = new WeakMap<Sql, FleetVocab>()

export let fleetVocabOf = (db: Sql): FleetVocab => {
  let vocab = fleetVocabs.get(db)
  if (!vocab) {
    vocab = fleetVocab(vocabOf(db))
    fleetVocabs.set(db, vocab)
  }
  return vocab
}

// Bound once per Sql handle: the sole storage/CAS and fleet policy writer.
let fleetGraphs = new WeakMap<Sql, FleetGraph>()
export let fleetGraphOf = (db: Sql): FleetGraph => {
  let held = fleetGraphs.get(db)
  if (!held) {
    held = fleetGraph({
      db,
      vocab: fleetVocabOf(db),
      driver: {
        query: (sql, params) => prep(db, sql).all(...params),
        run: (sql, params) => prep(db, sql).run(...params).changes,
        exec: (sql) => db.exec(sql),
        tx: (fn) => db.transaction(fn, true),
      },
      normalizers: fleetNormalizers({
        db,
        prepare: (sql) => prep(db, sql),
        component: (eid, name) => readComp(db, eid, name),
        known: (name) => !!readOf(db, name),
        text: (name, col) =>
          comps[name]?.[col] == 'text' || comps[name]?.[col] == 'body',
        name: (eid) => human(db, eid),
      }),
      input: (changes) => fleetInput(db, changes),
      project: (changes, context) => projectFleet(db, changes, context),
      guards: fleetGuardHost(db),
      lifecycle: {
        ...fleetLifecycleHost(db),
        afterCommit: (run) => db.afterCommit(run),
        actor: (writer) => writerActor(db, writer),
        via: (writer) => writerVia(db, writer),
        person: (actor) => isPerson(db, actor),
        number: (eid) => mintNum(db, eid),
        removalOrder: () =>
          [...Object.keys(cmps), ...Object.keys(vocabOf(db))].toReversed(),
        journal: (now, actor, via, trace, changes) =>
          journalWrite(db, now, actor, via, trace, changes),
      },
      patchRefusal: (b, err) => {
        for (let c of asChanges(b)) {
          if (c.comp) {
            let why = refused(db, c.name, c.eid, c.comp, err)
            if (why) return why
          }
        }
        return err
      },
      refusal: (err) =>
        err instanceof CoreStale
          ? new Stale(
            err.eid,
            err.comp,
            err.column,
            err.current,
            human(db, err.eid),
          )
          : fleetRefusal(db, err),
      number: (eid) => mintNum(db, eid),
      component: (eid, name) => readComp(db, eid, name),
    })
    fleetGraphs.set(db, held)
  }
  return held
}

// An APP's own components, declared by its vocab.json and planted in its own
// store (T-32502, store/vocab.ts). Held per HANDLE, never as module state: one
// Worker isolate holds many stores, and a word one app declares is not another
// app's word. A handle that has never been told carries the platform
// vocabulary alone, which is every local graph.
let ownVocab = new WeakMap<Sql, Vocab>()

export let vocabOf = (db: Sql): Vocab => ownVocab.get(db) ?? {}

// Does this store have a vocabulary of its own to grow? An app store says yes
// even before it declares anything — that is what makes "unknown component"
// able to name vocab.json instead of shrugging.
export let ownsVocab = (db: Sql): boolean => ownVocab.has(db)

// Plant an app's manifest: the tables and columns it names, additively, then
// the word itself — into this handle, which is where the filter grammar reads
// it from so `.recipe.serves=4` parses for THIS store and no other (every
// parseQuery below is handed vocabOf(db)), and into the kinds so a row
// wearing the word says the word (types.ts learnKinds). A store with a
// vocabulary door also teaches that grammar's refusals in its own terms: a
// hosted app hears about vocab.json, never about the fleet CLI or another
// graph's ids.
export let plantVocab = (db: Sql, vocab: Vocab): void => {
  let ops = vocabOps(vocab)
  if (ops.length) graft(db, ops)
  ownVocab.set(db, vocab)
  fleetVocabs.delete(db)
  fleetGraphs.delete(db)
  learnKinds(Object.keys(vocab))
  teaches(FILTERS)
}

// This store's whole writable vocabulary at one name: the platform's, then its
// own. Undefined for a word neither knows.
let colsOf = (db: Sql, name: string): string[] | undefined => {
  let own = vocabOf(db)[name]
  return cmps[name] ?? (own && Object.keys(own))
}

// The declared type of one column, either vocabulary — what bound() types a
// value against.
let typeAt = (db: Sql, name: string, col: string): PropType | undefined =>
  comps[name]?.[col] ?? vocabOf(db)[name]?.[col]

// Graph-out at one name, and every name this store reads. An app's component
// has no stamped half, so its readable columns are exactly what it declared.
let readOf = (db: Sql, name: string): string[] | undefined => {
  let own = vocabOf(db)[name]
  return readable[name] ?? (own && ['eid', ...Object.keys(own)])
}

let readNames = (db: Sql): string[] => [
  ...Object.keys(readable),
  ...Object.keys(vocabOf(db)),
]

// What the SCHEMA has, as opposed to what the wire may write — the
// authority for telling a name that EXISTS from a name that doesn't.
// Memoized per table, per handle (a process can hold several graphs —
// the live one and a probe's); an empty set means no such table.
let stored = new WeakMap<Sql, Record<string, Set<string>>>()
let columnsOf = (db: Sql, table: string): Set<string> => {
  let mine = stored.get(db) ?? {}
  stored.set(db, mine)
  return mine[table] ??= new Set(
    (prep(db, 'select name from pragma_table_info(?)').all(table) as {
      name: string
    }[]).map((c) => c.name),
  )
}

// Preserve the fleet's addressed diagnostic while core owns the validation.
let fleetRefusal = (db: Sql, err: unknown) => {
  if (!(err instanceof Error)) return err
  err.message = err.message.replace(
    'unknown column in $was:',
    'unknown column:',
  )
  let match = err.message.match(/^(unknown columns?: .*?) — (\w+) declares /)
  if (match) {
    let [, prefix, name] = match
    err.message = `${prefix} — ${
      shapeOf(name, colsOf(db, name) ?? [], (col) =>
        typeAt(db, name, col) ?? stamped[name]?.[col])
    }`
  }
  return err
}

// Historical stored columns and projected row identities are readable echoes,
// not new vocabulary. Core owns admission; this removes only fleet SQL aliases.
let fleetInput = (db: Sql, changes: Change[]) =>
  normalizeChanges(canonEmail(mintAddresses(db, changes)), {
    now: Date.now(),
    resolve: (id) => ident(db, id),
  }).flatMap((c) => {
    if (!c.comp) return [c]
    let sent = Object.entries(c.comp).filter(([col]) => col != 'eid')
    let kept = sent.filter(([col]) =>
      !(columnsOf(db, c.name).has(col) &&
        !fleetVocabOf(db).column(c.name, col))
    )
    return sent.length && !kept.length
      ? []
      : [{ ...c, comp: Object.fromEntries(kept) }]
  })

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
let dualSpawn = (db: Sql, changes: Change[]): Change[] => {
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
let mirrorLineage = (db: Sql, changes: Change[]): Change[] => {
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
      out.push(...unlink(prior.eid, 'delegates', eid))
    }
    if (next && prior?.eid != next) out.push(...link(next, 'delegates', eid))
  }
  return out
}

// The edge entity a stored edge eid wears, spoken in eids, with its nature —
// found by asking each nature table; an edge wears exactly one.
let storedEnds = (db: Sql, eid: string) =>
  prep(
    db,
    `select f.eid as "from", t.eid as "to" from edge e
     join entity f on f.id = e."from" join entity t on t.id = e."to"
     where e.${byEid}`,
  ).get(eid) as { from: string; to: string } | undefined

let storedEdge = (
  db: Sql,
  eid: string,
): { from: string; to: string; nature: string } | undefined => {
  let row = storedEnds(db, eid)
  let nature = row &&
    natures.find((n) =>
      prep(db, `select 1 from ${sqlName(n)} where ${byEid}`).get(eid)
    )
  return nature ? { ...row!, nature } : undefined
}

// Every edge write answers here, and the server's own edges are minted here
// (T-32552, T-23821). An edge is an ENTITY — edgeEid(from, nature, to) wearing
// `edge{from, to}` and its nature tag (edge.ts `link`/`unlink`) — so there is
// nothing to lower: this pass only says what the SERVER owes, and holds every
// edge write to the derivation.
//
// It is a WHOLE-BATCH pass rather than a step inside admitted(), because an
// edge may name an endpoint that only this batch mints — one change cannot know
// that alone. Only the batch's own changes are read, never this pass's output,
// so nothing feeds itself. An endpoint that neither exists nor arrives in this
// batch drops the edge alone rather than refusing the batch: the tolerance a
// link has always had, since an edge is a statement ABOUT two entities and a
// missing one makes it merely untrue.
let edgeWrites = (db: Sql, changes: Change[]): Change[] => {
  let dead = graveOf(db)
  let inBatch = new Set(
    changes.filter((c) => c.comp != null).map((c) => c.eid),
  )
  let live = (eid: string) =>
    inBatch.has(eid) || (toId(db, eid) != null && !dead.get(eid))
  let batchNature = new Map<string, string>()
  for (let c of changes) {
    if (c.comp && typeOf[c.name]) batchNature.set(c.eid, c.name)
  }
  let out: Change[] = []
  let dropped = new Set<string>()
  for (let { eid, name, comp } of changes) {
    if (name == 'claim' && comp?.session) {
      // A lease is temporary; having done the work is not. The durable,
      // indexed truth Session Tiles read is the SENTENCE, minted here so every
      // reader learns it without a fetch or a journal read.
      let session = String(comp.session)
      if (live(session) && live(eid)) out.push(...link(session, 'worked', eid))
    } else if (name == 'edge' && comp) {
      // The endpoints ARE the identity, so an edge write carries both, and
      // its eid must be the sentence's — a random uuid would be a second
      // entity for the same edge, the duplicate the derivation exists to
      // prevent (the blob-eid rule, in edge clothes).
      let { from, to } = comp
      if (from == null || to == null) {
        throw new Error(`edge ${shortId(eid)} needs both from and to`)
      }
      let nature = batchNature.get(eid) ?? storedEdge(db, eid)?.nature
      if (!nature) throw new Error(`edge ${shortId(eid)} needs a nature`)
      if (eid != edgeEid(String(from), nature, String(to))) {
        throw new Error(
          `edge ${shortId(eid)} eid must be edgeEid(from, ${nature}, to)`,
        )
      }
      if (!live(String(from)) || !live(String(to))) {
        console.warn(`sync: edge ${shortId(eid)} dropped — missing endpoint`)
        dropped.add(eid)
      }
    }
  }
  // A dropped sentence takes its verb with it: half an edge is not an edge.
  let kept = dropped.size
    ? changes.filter((c) =>
      !(dropped.has(c.eid) && (c.name == 'edge' || typeOf[c.name]))
    )
    : changes
  return out.length ? [...kept, ...out] : kept
}

// Old and new session doors overlap during a rolling release. Apply sees the
// whole batch under one lock, so it can make the canonical facet win without
// making order significant, then write the same projection back to aliases
// for a rollback server. A canonical component delete clears every alias.
let dualFacet = (
  db: Sql,
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
let select = (db: Sql, name: string): string => {
  if (name == 'entity') {
    return `select ${readable.entity.map(sqlName).join(', ')} from entity`
  }
  let joins: string[] = []
  let cols = readOf(db, name)!.map((c) => {
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

// SQLite has no boolean: a `bool` column stores 0/1 and reads back a number,
// contradicting the type its vocabulary declares and every schema derived from
// it — the MCP output schema refused every result carrying a `repo` over
// exactly this (T-35365). So the graph speaks the declared type: reading a row,
// a bool column becomes true/false. The declared types answer, never a list of
// names, so every bool column of every component is covered — a store's own
// vocabulary included. Null stays null: an unset bool is absent, not false.
// Writes stay lenient (bound() takes 0/1 and true/false alike).
let unbool = (db: Sql, name: string) => {
  let cols = (readOf(db, name) ?? [])
    .filter((c) => typeAt(db, name, c) == 'bool')
  return (row: Record<string, unknown>) => {
    for (let c of cols) if (row[c] != null) row[c] = !!row[c]
    return row
  }
}

// prep() for a select() projection — the ONE door graph-out rows come through,
// so a reader cannot skip the flip above and no site has to remember it.
let reads = (db: Sql, name: string, tail = '') => {
  let st = prep(db, tail ? `${select(db, name)} ${tail}` : select(db, name))
  let fix = unbool(db, name)
  type Row = Record<string, unknown>
  return {
    get: (...args: SqlValue[]) => {
      let row = st.get(...args) as Row | undefined
      return row && fix(row)
    },
    all: (...args: SqlValue[]) => (st.all(...args) as Row[]).map(fix),
  }
}

// A write that changes nothing IS nothing. Given a comp bound for an existing
// row, return it with every column whose value already matches the stored one
// removed; `null` when nothing is left (the change is a no-op: not written,
// not journaled, not cast, no `updated` stamp). A comp for a row that does
// not exist yet is returned whole — presence is the change. Compared through
// the same projection a precondition reads (refs as eids, doc.body as text),
// loosely, so a number sent as a string still matches its stored self. The
// role heartbeat restamped decided_at 1.8M times before this held.
let settled = (
  db: Sql,
  name: string,
  eid: string,
  comp: Record<string, unknown>,
  row = reads(db, name, 'where eid = ?').get(eid),
): Record<string, unknown> | null => {
  if (!row) return comp
  let same = (col: string) => {
    if (!(col in row)) return false
    let want: unknown
    try {
      want = isRef(name, col)
        ? comp[col]
        : bound(name, col, comp[col], typeAt(db, name, col))
    } catch {
      return false // let the write path raise the shape error
    }
    // deno-lint-ignore eqeqeq
    return (want ?? null) == (row[col] ?? null)
  }
  let left = Object.fromEntries(
    Object.entries(comp).filter(([col]) => !same(col)),
  )
  return Object.keys(left).length ? left : null
}

// A boot sweep replays a deliverable's created() effect as if its row were a
// fresh wire write, so the row must read back the way the wire delivered it:
// the owner eid under `eid`, and every {eid} REFERENCE projected to its target's
// eid — not the int id it is stored as (D-18866), which is what a handler like
// stopped() binds as `comp.target`. Unlike select(), this is NOT wrapped in a
// subquery: the base table stays in FROM under its own name so the sweep's
// pending predicate (deliver.ts PENDING) can still filter on `${comp}.entity`.
// Read it through sweepRows below, never bare: the wire's bools are booleans.
let sweepSelect = (name: string, pending: string): string => {
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

// The sweep's rows, read the way the wire delivered them — the projection
// above, with bools said as booleans (unbool). The relay's one door.
export let sweepRows = (
  db: Sql,
  name: string,
  pending: string,
): Record<string, unknown>[] =>
  (prep(db, sweepSelect(name, pending)).all() as Record<string, unknown>[])
    .map(unbool(db, name))

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
  // The declared type, when the caller holds a store whose vocabulary is
  // wider than the platform's (typeAt): a store's own bool column takes a
  // JSON `true` the way `repo.push` does.
  type: PropType | undefined = comps[name]?.[col],
): string | number | bigint | null => {
  if (type == 'bool' && typeof value == 'boolean') {
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

// An FK bounce (errcode 787, SQLITE_CONSTRAINT_FOREIGNKEY) names nothing,
// so enrich it: walk the table's declared refs and point at each sent
// value whose referent is missing. The caller rejects every SQL failure;
// other errors keep their own message.
let refused = (
  db: Sql,
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
        graveOf(db).get(given[f.col] as string)
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
// Keep vocabulary declaration order within each component, including the
// reverse target index used when a kind is removed. Ordinary scalar writes
// need neither a vocabulary-wide reference scan nor a tombstone lookup.
let refsFrom = Map.groupBy(refs, (ref) => ref.name)
let refsTo = Map.groupBy(refs, (ref) => ref.target)

// Every eid-valued column, by component — the FULL set (refs above excludes
// any-entity targets, but graduation must notice a comment or claim AIMED at an
// ephemeral entity just as much as a typed reference). An edge's own ends are
// ordinary {eid} columns on `edge`, so they are already here.
let eidCols = new Map(
  Object.entries(comps).map(([name, props]) => [
    name,
    Object.entries(props).flatMap(([col, type]) =>
      typeof type == 'object' && 'eid' in type ? [col] : []
    ),
  ]),
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

// Whether a source batch describes a session the graph already holds under a
// different eid — asked of the one identity a file-backed session shares with
// its persisted self, the stable `session.id`. The eid a file store derives
// from that id is its own, so an `entity` lookup can never see this.
let onFile = (db: Sql, batch: Change[]) =>
  batch.some((change) =>
    change.name == 'session' && change.comp?.id != null &&
    prep(db, 'select 1 from session where id = ?').get(String(change.comp.id))
  )

// Graduation on interaction (D-17790): a write that attaches to a source-
// materialized (ephemeral) entity hydrates that entity's source components into
// THIS batch, so it persists and mints its num alongside the write. The engaged
// set is every eid this batch WRITES (a change's own eid) or NAMES (an
// eid-valued reference — a comment.target, a claim.session, an edge's end).
// An engaged eid with no spine, not tombstoned, and owned by a source
// graduates; an untouched session stays pass-through forever. The source comps
// ride the normal write loop, which keeps only wire-writable columns (so a
// source's server-owned `origin`/`serving_model` drop just as they do on a live
// interactive session) and mints the spine + num. Called only when sources
// exist, and only ever prepends — a batch that engages nothing ephemeral is
// returned untouched, so the non-graduating write path is unchanged.
let graduate = (
  db: Sql,
  changes: Change[],
  resolved: Change[] = [],
): Change[] => {
  let engaged = new Set<string>()
  for (let { eid, name, comp } of changes) {
    if (name == 'entity' && comp == null) continue // a delete never graduates
    engaged.add(eid)
    if (!comp) continue
    for (let col of eidCols.get(name) ?? []) {
      if (comp[col] != null) engaged.add(String(comp[col]))
    }
  }
  let live = prep(db, 'select 1 from entity where eid = ?')
  let dead = graveOf(db)
  let hydration = [...resolved]
  let resolvedEids = new Set(resolved.map((change) => change.eid))
  for (let eid of engaged) {
    if (resolvedEids.has(eid) || live.get(eid) || dead.get(eid)) continue
    let batch = sourceResolve(eid)
    // Two answers that are not this entity graduating (T-32507). A source
    // answers a HANDLE as readily as an eid, so a reference value that is some
    // session's stable id answers with a batch for a DIFFERENT eid — and a
    // value naming no entity would drag a whole past session in behind it.
    // And a session already persisted answers with an ephemeral twin of
    // itself, which `live` cannot see (onFile) and which lands as a second row
    // wearing the same unique id. Graduate only the entity the batch is FOR,
    // and only one the graph does not already hold.
    if (!batch?.length || batch[0].eid != eid || onFile(db, batch)) continue
    hydration.push(...batch)
  }
  return hydration.length ? [...hydration, ...changes] : changes
}

let refRefused = (
  db: Sql,
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
  let gone = graveOf(db).get(bad.target)
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
let ownerActor = (db: Sql): string | null => {
  let people = prep(
    db,
    'select o.eid as eid from person p join entity o on o.id = p.entity',
  ).all() as { eid: string }[]
  return people.length == 1 ? people[0].eid : null
}

// A hosted store has no filesystem (and no worktrees to place): nothing read.
let read = (path: string) => {
  try {
    return typeof Deno == 'undefined' ? '' : Deno.readTextFileSync(path)
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
let ventureAt = (db: Sql, cwd?: string | null): string | null => {
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
let workProject = (db: Sql, sid: number): string | null => {
  let c = prep(
    db,
    `select ${refEid('t.project')} as eid
     from claim c join filed t on t.entity = c.entity
     where c.session = ? and t.project is not null
     order by c.rowid desc limit 1`,
  ).get(sid) as { eid: string } | undefined
  if (c) return c.eid
  let r = prep(
    db,
    `select ${refEid('t.project')} as eid
     from session s join filed t on t.entity = s.requested_task
     where s.entity = ? and t.project is not null`,
  ).get(sid) as { eid: string } | undefined
  return r?.eid ?? null
}

// The cascade's terminal (D-21308): the model ENTITY whose name matches the
// wire spelling a session's model columns speak. A lookup, never a mint — an
// unknown spelling leaves attribution null, the doctor-countable
// configuration gap, rather than guessing.
let modelActor = (db: Sql, name?: string | null): string | null =>
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
  db: Sql,
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
  // A writer naming an actor entity (person, project, or persona) directly
  // stands for itself — the CLI's own operator eid, a hand-set x-via, or a
  // sessionless system voice like the dream (persona, aliased `dream`) that
  // authors graph writes without a run of its own.
  let a = prep(
    db,
    `select 1 from person where ${byEid}
       union select 1 from project where ${byEid}
       union select 1 from persona where ${byEid}`,
  ).get(writer, writer, writer) as { 1: number } | undefined
  return a ? writer : null
}

export let writerActor = (
  db: Sql,
  writer?: string | null,
): string | null => actorFor(db, writer, true)

// Whether a writer's actor is a human. One thing is the owner's to decide
// (M-31946): whether a memory is ACCEPTED, which is what lets it reach the
// next agent's prompt. An agent proposes, never programs — but it composes
// freely, since an unaccepted memory says nothing wherever it is filed.
// Nothing resolved is not a person: an anonymous write is machinery until it
// says otherwise.
export let isPerson = (db: Sql, actor: string | null) =>
  !!actor && !!prep(db, `select 1 from person where ${byEid}`).get(actor)

// What this graph CALLS an entity, in its own words — the doc title on the
// row, empty when it has none. `human()` answers the id every door speaks;
// this answers the name a reader reads, which is what a byline needs.
export let titleOf = (db: Sql, eid: string): string =>
  String(
    (prep(db, `select title from doc where ${byEid}`).get(eid) as
      | { title?: string }
      | undefined)?.title ?? '',
  )

// A proposed memory: the memory row is on disk or in this batch, and the
// proposed stamp is on disk. Only a person may decide one.
let proposedMemory = (db: Sql, eid: string) =>
  !!prep(db, `select 1 from memory where ${byEid}`).get(eid) &&
  !!prep(db, `select 1 from proposed where ${byEid}`).get(eid)

// Who may SIGN a letter: the same chain, minus the one inference provenance
// is allowed to make. A tab at the owner's keyboard may be RECORDED as them;
// it may not SPEAK as them, because that is the fleet's highest-trust byline
// and exactly the tier a forged sender claimed (T-9511). Nothing resolved
// means nothing signed, and mail.ts refuses to deliver an unsigned letter.
export let senderActor = (
  db: Sql,
  writer?: string | null,
): string | null => actorFor(db, writer, false)

// The instrument stopped one step before writerActor's principal: a session
// label/eid, client eid, or runner eid resolves to that graph-visible writer.
// Direct actor writes have no reified instrument.
export let writerVia = (
  db: Sql,
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
// EFFECTIVE batch, composed to final state: a synthesized entity-null for every
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

// The current non-secret override for a catalog key, or undefined. The graph
// plane of config.resolve() — server code passes this as the reader so a value
// is read at the operation boundary, current as of the last committed write.
export let settingValue = (
  db: Sql,
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
  db: Sql,
  key: string,
): string | undefined =>
  (prep(
    db,
    'select o.eid as eid from setting join entity o on o.id = setting.entity where key = ?',
  ).get(key) as {
    eid?: string
  } | undefined)?.eid ?? undefined

// The writer's readiness guard: the predicate discovery uses, minus
// authorization. The approval pipeline is suspended (M-31946), so a filed task
// is claimable; an explicit proposal awaiting judgment or a declined verdict
// still refuses, and so does the lease.
let guardedWorkSql = `
select 1
  from entity
  ${workReadyJoinsSql}
 where entity.eid = ? and ${workReadyWhereSql()}`

let workClaimRefusal = (db: Sql, eid: string) => {
  let id = human(db, eid)
  let state = prep(
    db,
    `select task.entity is not null as task,
            completed.entity is not null as completed,
            cancelled.entity is not null as cancelled,
            quarantined.entity is not null as quarantined,
            blocked.entity is not null as has_block,
            blocked."on" as blocked,
            proposed.entity is not null as proposed,
            decided.entity is not null as decided,
            decided.verdict as verdict
       from entity
       left join task on task.entity = entity.id
       left join completed on completed.entity = entity.id
       left join cancelled on cancelled.entity = entity.id
       left join quarantined on quarantined.entity = entity.id
       left join blocked on blocked.entity = entity.id
       left join proposed on proposed.entity = entity.id
       left join decided on decided.entity = entity.id
      where entity.eid = ?`,
  ).get(eid) as
    | {
      task: number
      completed: number
      cancelled: number
      quarantined: number
      has_block: number
      blocked: string | null
      proposed: number
      decided: number
      verdict: string | null
    }
    | undefined
  if (!state?.task) return `${id} is not a task`
  if (state.quarantined) return `${id} is quarantined`
  if (state.completed) return `${id} is completed`
  if (state.cancelled) return `${id} is cancelled`
  if (state.has_block) {
    return `${id} is externally blocked${
      state.blocked ? `: ${state.blocked}` : ''
    }`
  }
  if (state.proposed && !state.decided) {
    return `${id} is proposed but not decided — approve it and claim atomically`
  }
  if (state.verdict == 'declined') {
    return `${id} was declined — revise or explicitly replace that decision before claiming`
  }
  let blocker = prep(
    db,
    `select child.eid as eid, dead.entity is not null as missing,
            hidden.entity is not null as hidden
       from (${sentences('requires')}) needed
       left join entity child on child.id = needed.child
       left join tombstone dead on dead.entity = child.id
       left join quarantined hidden on hidden.entity = child.id
       left join completed on completed.entity = child.id
       left join cancelled on cancelled.entity = child.id
      where needed.parent = (select id from entity where eid = ?)
        and (
          child.id is null or dead.entity is not null or
          (completed.entity is null and cancelled.entity is null)
        )
      order by needed.ord, child.num limit 1`,
  ).get(eid) as
    | { eid: string | null; missing: number; hidden: number }
    | undefined
  if (blocker) {
    if (blocker.hidden) {
      return `${id} requires something hidden and unresolved — ask an administrator to resolve it`
    }
    let child = blocker.eid ? human(db, blocker.eid) : 'a missing entity'
    return blocker.missing
      ? `${id} requires missing ${child} — restore it or drop the edge`
      : `${id} requires unresolved ${child} — complete or cancel it first`
  }
  // Every named refusal above covers a state the guard rejects; this is the
  // floor a tombstoned target lands on.
  return `${id} is not ready to claim`
}

let fleetGuardHost = (
  db: Sql,
  person: (actor?: string | null) => boolean = (actor) =>
    isPerson(db, actor === undefined ? writerActor(db, undefined) : actor),
): GuardHost => ({
  db,
  prepare: (sql) => prep(db, sql),
  name: (eid) => human(db, eid),
  bounce: (err) => {
    let label = prep(
      db,
      'select id from session where entity = (select id from entity where eid = ?)',
    ).get<{ id: string | null }>(err.holder)?.id
    return new Bounced(
      `${human(db, err.on)} already claimed by ${
        label ?? human(db, err.holder)
      }`,
      err.on,
      err.loser,
      err.holder,
    )
  },
  settle: (c, row) => {
    if (c.name == 'entity') return c
    if (c.comp == null) return (row ?? readComp(db, c.eid, c.name)) ? c : null
    let comp = settled(db, c.name, c.eid, c.comp, row)
    return comp ? { ...c, comp } : null
  },
  before: (changes) => {
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
    // An EDGE wearing `recalled{at}` is a sentence, not a log facet: the recall
    // of one memory, timed on its own entity (D-23820, T-32471). The rule below
    // guards entries, so it reads past anything this batch also makes an edge.
    let edged = new Set(
      changes.filter((c) => c.name == 'edge' && c.comp).map((c) => c.eid),
    )
    let existed = prep(
      db,
      'select 1 from entry where entity = (select id from entity where eid = ?)',
    )
    // A transcript entry is not the only thing a log fact can be a line OF
    // (T-35323). A tracked process is the other: the lines it writes are
    // `content{body, source}` naming it, and its ending is its own `exit{code}`.
    // The anchor there is a `process` row that already STANDS, not one named in
    // the same batch — a process's ending is necessarily later than its birth,
    // which is exactly what an entry may never be. Entries keep the stricter
    // rule below; this only says that a line off a stream is not a loose fact.
    let processed = prep(
      db,
      'select 1 from process where entity = (select id from entity where eid = ?)',
    )
    let streamed = (eid: string, comp: Change['comp']) =>
      !!processed.get(eid) ||
      (comp?.source != null && !!processed.get(String(comp.source)))
    for (let { eid, name, comp } of changes) {
      if (!facts.has(name) || edged.has(eid) || streamed(eid, comp)) continue
      // The one late mark: `prompt` may be ADDED to an existing turn, never
      // revised or removed. `task backfill prompt` re-reads the turn's own
      // transcript line for the tag ingest stamps at birth today; a tag is
      // content-free, so nothing about what was said changes.
      if (name == 'prompt' && comp != null && existed.get(eid)) continue
      if (existed.get(eid)) {
        throw new Error(`entry ${shortId(eid)} is immutable`)
      }
      if (name == 'entry' && !comp?.session) {
        throw new Error(`entry ${shortId(eid)} needs a session`)
      }
      // This half of the rule is about ATTACHING a fact, and a null attaches
      // nothing: the entity here has no entry (the immutable check above owns
      // that case), so clearing a log word off it removes something that
      // cannot be there. A supervisor's relaunch batch carries exactly such a
      // clear (`exit: null` beside the new `process`, T-35328), and demanding
      // an entry for it would be asking for a transcript nobody wrote.
      if (name != 'entry' && comp != null && !appends.has(eid)) {
        throw new Error(`${name} ${shortId(eid)} needs entry in its batch`)
      }
    }
  },
  // The package store can mint referenced spines; the fleet may not invent
  // dangling identities (except its deliberate spawn-request placeholder).
  // Judge these against FOUND + the batch's explicit births, before mutation.
  references: (changes) => {
    let births = new Set(
      changes.filter((c) => c.comp != null).map((c) => c.eid),
    )
    for (let { eid, name, comp } of changes) {
      if (!comp) continue
      let cols = (eidCols.get(name) ?? []).filter((col) => comp[col] != null)
      if (!cols.length || graveOf(db).get(eid)) continue
      for (let col of cols) {
        let target = String(comp[col])
        if (
          !graveOf(db).get(target) && (
            births.has(target) ||
            trustedRefs.some(([n, c]) => n == name && c == col)
          )
        ) continue
        refToId(db, name, eid, col, target)
      }
    }
  },
  after: (changes, created) => {
    // Typed references are judged against the final state: adding a target
    // kind later in the batch is legal; leaving a ref to a removed kind is not.
    for (let { eid, name, comp } of changes) {
      for (let ref of (comp == null ? refsTo : refsFrom).get(name) ?? []) {
        let refusal = comp?.[ref.col] != null
          ? refRefused(db, ref, eid)
          : comp == null
          ? refRefused(db, ref, undefined, eid)
          : null
        if (refusal) throw refusal
      }
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
    for (let key of created) {
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
          `task set ${id} .decided.verdict=approved (by defaults to you; ` +
          `name .decided.by=<person> only when relaying that person's ` +
          `explicit decision)`,
      )
    }
  },
  check: (change, changes, target, actor) => {
    let { eid, name, comp } = change
    // A target can have died earlier in this batch, after the precondition's
    // FOUND identity check. Tombstones never accept a fresh reference.
    for (let col of eidCols.get(name) ?? []) {
      if (
        comp?.[col] != null && graveOf(db).get(String(comp[col]))
      ) {
        refToId(db, name, eid, col, comp[col])
      }
    }
    if (
      name == 'claim' && comp && target == eid &&
      !prep(
        db,
        'select 1 from claim where entity = (select id from entity where eid = ?)',
      ).get(eid) &&
      !prep(db, guardedWorkSql).get(eid)
    ) {
      throw new Error(workClaimRefusal(db, eid))
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
        (!sessionActive.includes(String(s.status)) && !graph &&
          !advanceable(db, target).length)
      ) {
        throw new Error(
          `stop_request refused: session is ${
            s ? s.status ?? 'external' : 'gone'
          }`,
        )
      }
    }
    // A board IS its query (membership is never stored), so a query the
    // grammar can't parse is a board that will never match anything and
    // never say why. The parser already knows — `task list .zzz=1`
    // errors — so refuse at the door, while the typo is still in front
    // of whoever made it. Empty stays legal: it selects nothing.
    if (name == 'board' && comp?.query != null) {
      try {
        parseQuery(String(comp.query), vocabOf(db))
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
    // Reuse wears the CREATE shape, doc + comment on one eid; a `comment`
    // arriving alone moves `target` and displaces nothing — an ordinary
    // patch (M-17872), the retarget an aggregate tally follows.
    if (
      name == 'comment' && comp &&
      changes.some((c) => c.eid == eid && c.name == 'doc' && c.comp)
    ) {
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
    // Accepting a proposed memory is the decision an agent may not take
    // for itself: `decided` on one is a person's stamp only.
    if (
      name == 'decided' && comp && proposedMemory(db, eid) && !person(actor)
    ) {
      throw new Error(
        `${human(db, eid)} is a proposed memory — a person decides it ` +
          `(task set ${human(db, eid)} .decided.verdict=approved).`,
      )
    }
    if (name == 'entity' && comp == null) {
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
    }
  },
})

let fleetLifecycleHost = (db: Sql): LifecycleHost => ({
  db,
  prepare: (sql) => prep(db, sql),
  id: (eid) => refId(db, eid),
  component: (eid, name) =>
    name == 'entity'
      ? prep(db, 'select eid, num from entity where eid = ?').get(eid)
      : name == 'tombstone'
      ? prep(
        db,
        'select 1 from tombstone where entity = (select id from entity where eid = ?)',
      ).get(eid)
      : readComp(db, eid, name),
  venture: (cwd) => ventureAt(db, cwd),
  sender: (writer) => senderActor(db, writer),
  stamps,
  clocked,
  quote: sqlName,
  facetCols,
})

export let apply = (
  db: Sql,
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
  // A named worker-claim mutation supplies the one claim whose readiness must
  // be validated under this transaction's writer lock. Raw Change[] leaves it
  // absent and retains the administrative graph capability.
  workClaim?: { target: string; source?: Change[] },
  // The server-writer mode: the caller is trusted server code (a hosted
  // kernel reporting what a route threw), so server-owned components and
  // stamped columns are admitted and written. Every wire door passes
  // nothing; the Store object sets it from a kernel-only flag.
  server = false,
): Change[] => {
  let run = () => {
    writableVersion(db)
    return sync(
      fleetGraphOf(db).write(
        changes.flatMap((c) => {
          // Flat Change components are not pipeline metadata. Identity data
          // in a read-back row is storage-owned, not a caller's mint request.
          if (c.name.startsWith('$')) return []
          if (c.name == 'entity' && c.comp) {
            return Object.keys(c.comp).some((k) => k != 'eid')
              ? []
              : [{ entity: { eid: c.eid } }]
          }
          return [asBundle(c)]
        }),
        { writer, trace: t, imports, workClaim, server, resolve: true },
        { trusted: server },
      ),
    ).flatMap(asChanges)
  }
  try {
    return db.transaction(run, true)
  } catch (err) {
    auditBounce(db, err)
    throw err
  }
}

// Fleet-only projection, after core admission and the edit/wake/settings
// normalizers. The context belongs to the authenticated door, never metadata.
let projectFleet = (db: Sql, changes: Change[], context: FleetWrite) => {
  changes = dualSpawn(db, changes)
  changes = dualFacet(db, changes, 'worktree')
  changes = dualFacet(db, changes, 'runtime')
  // Client hooks and old claim clients cannot relocate a managed tree.
  // Check under the writer lock, after alias projection, so neither cwd
  // spelling (nor a worktree delete) bypasses ownership. Server regrow is
  // still allowed. A null branch is a swept tree we own, as in owns().
  if (!context.server) {
    let owned = new Set<string>()
    for (let c of changes) {
      if (c.name != 'session' && c.name != 'worktree') continue
      if (
        prep(
          db,
          `select 1 from session s
           join entity e on e.id = s.entity
           join worktree w on w.entity = s.entity
           where e.eid = ? and s.origin = 'managed'
             and (w.branch is null or w.branch = ''
               or w.branch = 'session/S-' || e.num)`,
        ).get(c.eid)
      ) owned.add(c.eid)
    }
    changes = changes.flatMap((c) => {
      if (!owned.has(c.eid)) return [c]
      if (c.name == 'worktree' && c.comp == null) return []
      if ((c.name != 'session' && c.name != 'worktree') || !c.comp) return [c]
      let { cwd: _cwd, ...comp } = c.comp
      return Object.keys(comp).length ? [{ ...c, comp }] : []
    })
  }
  changes = mirrorLineage(db, changes)
  // A write that engages a source-materialized entity graduates it — hydrates
  // its source comps into this batch (D-17790). After the dual* transforms so
  // a hydrated session.provider is never promoted to a spawn request; a
  // historical session must not launch an agent.
  if (hasSources()) changes = graduate(db, changes, context.workClaim?.source)
  // After graduation, so a claim on a just-hydrated session finds its
  // `worked` endpoint in the batch.
  changes = edgeWrites(db, changes)
  return fleetInput(db, changes)
}

// A bounced claim is worth remembering: the refusal carries the sides as
// eids, and the audit is written AFTER the rollback (an audit row can't ride
// the batch it condemns) as a conflict entity referencing the retained spine —
// a loser whose session was born in the rolled-back batch has none, and is
// null. Whoever owns the outermost transaction writes it: apply() itself, or
// claimWork() around a nested apply(), once its own rollback has run.
export class Bounced extends LeaseBounced {
  constructor(
    message: string,
    public target: string,
    loser: string,
    holder: string,
  ) {
    super(target, loser, holder)
    this.message = message
  }
}

let auditBounce = (db: Sql, e: unknown) => {
  if (!(e instanceof LeaseBounced) || db.inTransaction) return
  auditFleetBounce(db, fleetGraphOf(db), e)
}

// The Vocabulary doc — the schema, written INTO the graph it describes.
// Alias-keyed upsert (slug `vocabulary`), regenerated every boot with a
// body the caller rendered from the live structures (schema.ts), the
// FTS-heal pattern for documentation: stale by at most one restart. A
// no-op when the body already matches, so a quiet boot journals nothing.
// Anyone may edit the doc between boots; the next boot writes it back —
// server-minted, like every stamped column.
export let vocabularyDoc = (db: Sql, body: string): void => {
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

// The fields a component's after-image records: everything but `eid`, the
// row's own identity, already the change's entity (a server-synthesized
// change spells it inside comp for convenience; the wire keeps it, the
// journal does not).
let journalFields = (comp: Record<string, unknown>) =>
  Object.entries(comp).filter(([field]) => field != 'eid')

// Is this field's text content-addressed in the graph (doc.body, the one
// column apply() lands through textBlob)? Then the journal refs the blob
// instead of repeating the text; a null body is a present null like any.
let casField = (name: string, field: string, v: unknown): v is string =>
  name == 'doc' && field == 'body' && typeof v == 'string'

// The journal write (D-18860/D-18861): journal_tx keeps the batch's provenance
// and mints the transaction id -- an integer primary key, so the next rowid,
// which is the log's monotonic total order and the cursor delta clients hold;
// journal_change one ordered operation per Change; journal_field the ordered
// after-image, present rows for an upsert and tombstones for a removal. Derived
// wholly from `logged` plus the append-only field log itself, so it touches
// nothing in the change loop. Called inside the caller's transaction; the
// A failure propagates through apply()'s transaction, rolling graph and
// journal back together. Returns the transaction id.
let journalWrite = (
  db: Sql,
  ts: string,
  actor: string | null,
  via: string | null,
  trace: string | null,
  logged: Change[],
): number => {
  // Provenance and every change name spine ids, resolved here from the eids
  // the wire speaks: a death retains its spine row (D-18866), so each logged
  // eid resolves, and an actor or via resolves or is null (unowned).
  let tx = Number(
    prep(
      db,
      `insert into journal_tx (ts, actor, via, trace)
       values (?, ${spineId}, ${spineId}, ?)`,
    ).run(ts, actor, via, trace).lastInsertRowid,
  )
  let insChange = prep(
    db,
    `insert into journal_change (tx, ordinal, entity, component, operation)
     values (?, ?, ${spineId}, ?, ?)`,
  )
  let insField = prep(
    db,
    `insert into journal_field (change, ordinal, field, present, value, ref)
     values (?, ?, ?, ?, ?, ?)`,
  )
  // The fields (eid, component) still shows as present: newest after-image wins
  // — journal_field.id is monotonic, so the max-id row per field is the latest
  // in total order (and reads THIS batch's earlier upserts, uncommitted but
  // visible on the same connection).
  let present = prep(
    db,
    `select field from (
       select jf.field as field, jf.present as present,
              row_number() over (partition by jf.field order by jf.id desc) as rn
       from journal_field jf join journal_change jc on jc.id = jf.change
       where jc.entity = ${spineId} and jc.component = ?
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
        insField.run(change, i, field, 0, null, null)
      )
    } else {
      // An upsert records one present after-image per field, JSON-encoded so a
      // present null (present=1, value='null') stays distinct from a tombstone.
      // An empty component writes none — its journal_change alone marks presence.
      // A content-addressed text lands as a ref to its blob (the bytes the
      // graph already holds); an `eid` field is the change's entity, not a
      // field, and is not recorded.
      journalFields(comp).forEach(([field, v], i) =>
        casField(name, field, v)
          ? insField.run(change, i, field, 1, null, textBlob(db, v))
          : insField.run(change, i, field, 1, JSON.stringify(v), null)
      )
    }
  })
  return tx
}

// The journal door for a server STAMP — a write the wire may not carry
// (frozen_at and kin), made by direct SQL beside this call. delta()
// promises catch-up clients the same content the live cast carried, so
// a stamp must reach the journal too, or every tab that boots by replay
// silently loses the column (T-7437). The caller must own the transaction;
// a journal failure rolls back its SQL too. stamp() owns both for simple writers.
export let record = (
  db: Sql,
  changes: Change[],
  writer?: string | null,
  effects?: Trace,
) => {
  if (!db.inTransaction) throw new Error('record requires a write transaction')
  writableVersion(db)
  let now = new Date().toISOString()
  let actor = writerActor(db, writer)
  let via = writerVia(db, writer)
  // Most stamps carry no trace; the few effect-bearing lifecycle stamps pass
  // the process driver's trace so split ownership is preserved.
  journalWrite(
    db,
    now,
    actor,
    via,
    effects?.fed
      ? JSON.stringify({
        created: [...effects.created],
        removed: [...effects.removed],
      })
      : null,
    changes,
  )
}

// Server-owned SQL and its replay batch commit together. Keep casts and effects
// outside this callback so neither can publish a write that later rolls back.
export let stamp = (
  db: Sql,
  write: () => Change[],
  writer?: string | null,
  effects?: Trace,
): Change[] =>
  db.transaction(() => {
    writableVersion(db)
    let changes = write()
    if (changes.length) record(db, changes, writer, effects)
    return changes
  }, true)

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

// Every present after-image in the journal that carries the value, with the
// transaction it rode: journal_field is the one historical copy. The
// JSON-escaped spelling narrows the scan; the decoded compare is the authority,
// and only content columns count (scrubbable) -- a structural string that
// happens to contain the value is not forgotten, it is replay.
type RedactionHit = {
  id: number
  eid: string | null
  component: string
  field: string
  tx: number
  ts: string
  decoded: string
  // The content the field refs (its blob eid), when it carries no text of
  // its own — scrubbed by repointing, never by rewriting shared bytes.
  blob: string | null
}
let redactionHits = (db: Sql, value: string): RedactionHit[] => {
  let encoded = JSON.stringify(value).slice(1, -1)
  let rows = prep(
    db,
    `select jf.id as id, jf.value as value, bt.value as text, jf.field as field,
            ${refEid('jc.entity')} as eid, jc.component as component,
            ${refEid('jf.ref')} as blob, jt.id as tx, jt.ts as ts
       from journal_field jf
       join journal_change jc on jc.id = jf.change
       join journal_tx jt on jt.id = jc.tx
       left join blob_text bt on bt.entity = jf.ref
      where jf.present = 1
        and (instr(jf.value, ?) > 0 or instr(bt.value, ?) > 0)
      order by jf.id`,
  ).all(encoded, value) as (Omit<RedactionHit, 'decoded'> & {
    value: string | null
    text: string | null
  })[]
  return rows.flatMap(({ value: raw, text, ...f }) => {
    if (!scrubbable(f.component, f.field)) return []
    let decoded = text ?? JSON.parse(raw ?? 'null')
    return typeof decoded == 'string' && decoded.includes(value)
      ? [{ ...f, decoded }]
      : []
  })
}

// Garbage-collect unreferenced content-addressed text (D-18862/D-18864). A
// blob's in-db text backend (blob_text) holds the canonical bytes doc.body and
// text attachments share by content hash; forgetting a doc body repoints it at a
// clean blob, which can strand the old content with no live referrer. This
// collects the VALUE — the blob_text row — only when NOTHING needs it: no
// doc.body points at the blob, no attachment.blob does, no journal_field refs
// it (history reads its text through the same row), and it is not itself an
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
  db: Sql,
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
        and not exists (select 1 from journal_field where ref = bt.entity)
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
  db: Sql,
  id: string,
  selector: string,
  writer?: string | null,
): RedactionResult =>
  db.transaction(() => {
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

    let hits = redactionHits(db, value)
    let column: DocColumn
    if (named) {
      column = named
    } else {
      let columns = new Set<DocColumn>()
      for (let col of ['title', 'body'] as DocColumn[]) {
        if (doc?.[col]?.includes(value)) columns.add(col)
      }
      for (let h of hits) {
        if (h.eid != target || h.component != 'doc') continue
        if (h.field == 'title' || h.field == 'body') columns.add(h.field)
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

    // Scrub every after-image in place, in THIS transaction: the value must
    // leave the journal (every history/replay reader, and the backup dump) or
    // it leaks through the door that keeps history. Rows are kept, values
    // rewritten, so the tx/change chain stays navigable and reads [redacted].
    // A ref'd field is repointed at the clean content instead, and the blobs
    // it left are collected below once nothing else holds them.
    let scrubField = prep(db, 'update journal_field set value = ? where id = ?')
    let scrubRef = prep(db, 'update journal_field set ref = ? where id = ?')
    let txs = new Set<number>()
    let stranded = new Set<string>()
    let replacements = 0
    let firstSeen: string | undefined
    for (let h of hits) {
      let clean = h.decoded.replaceAll(value, REDACTED)
      if (h.blob) {
        scrubRef.run(textBlob(db, clean), h.id)
        stranded.add(h.blob)
      } else scrubField.run(JSON.stringify(clean), h.id)
      replacements += h.decoded.split(value).length - 1
      txs.add(h.tx)
      firstSeen ??= h.ts
    }
    let journalRows = txs.size
    if (stranded.size) collectBlobText(db, [...stranded])

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
    prep(db, 'delete from embedding where entity = ?').run(targetId)

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
    // The redaction AUDIT event is a fresh journaled transaction, like any
    // apply. An EMPTY trace, not null: redaction historically dispatched with
    // a fresh Trace (changed-handlers only — a role doc rewrite re-drives its
    // role), and the journal consumer reproduces that.
    journalWrite(db, now, actor, via, '{"created":[],"removed":[]}', logged)

    let changes: Change[] = [
      ...logged,
      created,
      ...(updated ? [updated] : []),
    ]
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
  }, true)

// A single entity's history, newest first: the transactions that touched the
// entity, each cut down to its changes -- a journal_change (entity, component)
// index seek, then the batch rebuilt from its field rows.
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
// The read side of the journal (D-18860/D-18861): the Change[] a batch
// applied, reconstructed from journal_change + journal_field — the record
// every history/replay/undo reader reads. An operation is `remove`
// (comp: null — a component removal, or entity death when component='entity')
// or `upsert` (comp rebuilt from its present after-image field rows, each
// JSON-decoded, in field order; an empty component has no field rows and
// rebuilds as {}). The one thing the JSON batch carried that this does NOT is
// `was` — apply()'s per-column CAS
// guard, a write-time precondition and never history (D-18861: canonical rows
// do not duplicate before-values). No reader reads `was` back (historyLine
// shows comp keys, delta column-merges, inverseBatch recomputes its own via
// wasOf), so its absence is behavior-neutral. Every reader below joins the
// spine to speak the eid the wire speaks; a change that names no entity (a
// purged spine, see the schema) has none and so is not read.
type ChangeRow = {
  id: number
  eid: string
  component: string
  operation: string
}
let changeRows = `select jc.id as id, e.eid as eid, jc.component as component,
          jc.operation as operation
   from journal_change jc join entity e on e.id = jc.entity`
let rebuildChanges = (db: Sql, rows: ChangeRow[]): Change[] => {
  // A ref'd field reads its text back through the content it names.
  let fieldsOf = prep(
    db,
    `select jf.field as field, jf.value as value, bt.value as text
     from journal_field jf left join blob_text bt on bt.entity = jf.ref
     where jf.change = ? and jf.present = 1 order by jf.ordinal`,
  )
  return rows.map((ch) => {
    if (ch.operation == 'remove') {
      return { eid: ch.eid, name: ch.component, comp: null }
    }
    let comp: Record<string, unknown> = {}
    for (
      let f of fieldsOf.all(ch.id) as {
        field: string
        value: string | null
        text: string | null
      }[]
    ) comp[f.field] = f.text ?? JSON.parse(f.value ?? 'null')
    return { eid: ch.eid, name: ch.component, comp }
  })
}

// One journaled batch reconstructed whole (all eids) or, with `eid`, screened
// to that entity's own changes — both in applied order (journal_change.ordinal).
let normalizedBatch = (
  db: Sql,
  tx: number,
  eid?: string,
): Change[] =>
  rebuildChanges(
    db,
    (eid == null
      ? prep(db, `${changeRows} where jc.tx = ? order by jc.ordinal`).all(tx)
      : prep(
        db,
        `${changeRows} where jc.tx = ? and e.eid = ? order by jc.ordinal`,
      ).all(tx, eid)) as ChangeRow[],
  )

export let journalOf = (
  db: Sql,
  eid: string,
  limit = 50,
): JournalEntry[] =>
  (prep(
    db,
    `select jc.tx as tx, jt.ts as ts, ${refEid('jt.actor')} as actor,
            ${refEid('jt.via')} as via
     from journal_change jc join journal_tx jt on jt.id = jc.tx
     where jc.entity = ${spineId}
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
  db: Sql,
  via: string,
  limit = 500,
): JournalEntry[] =>
  (prep(
    db,
    `select id, ts, ${refEid('actor')} as actor, ${refEid('via')} as via
     from journal_tx
     where via = ${spineId} order by id desc limit ?`,
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
  db: Sql,
  eid: string,
  before: number,
): Record<string, Record<string, unknown>> => {
  // This entity's own changes across every batch below `before`, oldest first
  // (journal_change (entity, component) index, then applied order) — per-entity
  // and bounded, never a whole-log scan. Reconstructed from the normalized
  // rows, so the corrupt-gap batch (no journal_change) is skipped like every
  // other reader.
  let changes = rebuildChanges(
    db,
    prep(
      db,
      `${changeRows} where jc.entity = ${spineId} and jc.tx < ?
       order by jc.tx, jc.ordinal`,
    ).all(eid, before) as ChangeRow[],
  )
  let state: Record<string, Record<string, unknown>> = {}
  for (let c of changes) {
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

// The guard tokens for the columns a change wrote: sha of each value AS READ
// BACK, null for a column it cleared. A bool reads back true/false whatever
// spelling the wire used (unbool), so hash it in that shape or the guard would
// refuse an unchanged column. apply() refuses the inverse if any token has
// moved since the batch wrote it.
let wasOf = (name: string, comp: Record<string, unknown>, keys: string[]) => {
  let types = (comps as Record<string, Record<string, unknown>>)[name] ?? {}
  let was: Record<string, string | null> = {}
  for (let k of keys) {
    let v = comp[k]
    was[k] = v == null ? null : sha(types[k] == 'bool' ? !!v : v)
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
export let inverseBatch = (db: Sql, id: number): Change[] => {
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
  // A content identity is storage, not intent: casBodies mints the blob a
  // doc.body refers to, deduped by hash, so a batch is merely the FIRST writer
  // of those bytes and any number of docs may already share them. Its lifetime
  // belongs to the collector (collectBlobText), never to undo — deleting it
  // strands blob_text's FK onto the blob row and every doc that adopted the
  // same content. So the inverse leaves content alone, born or written.
  let content = new Set(batch.filter((c) => c.name == 'blob').map((c) => c.eid))
  let born = new Set(
    batch.filter((c) => c.name == 'entity' && c.comp && !content.has(c.eid))
      .map((c) => c.eid),
  )
  let touchedSince = prep(
    db,
    `select 1 from journal_change where entity = ${spineId} and tx > ? limit 1`,
  )
  let priors = new Map<string, Record<string, Record<string, unknown>>>()
  let priorOf = (eid: string) => {
    let p = priors.get(eid)
    if (!p) priors.set(eid, p = stateBefore(db, eid, id))
    return p
  }

  // A born entity dies only once nothing points at it any more, so the
  // deletions land AFTER the column restores: a death cascades, and a cascade
  // that fires before the restore would clear the very column the restore
  // guards, refusing the whole undo.
  let deaths = [...born].map((eid) => {
    if (touchedSince.get(eid, id)) {
      throw new Error(
        `${human(db, eid)} was modified after #${id} — undo refused`,
      )
    }
    return { eid, name: 'entity', comp: null } as Change
  })

  let inverse: Change[] = []
  for (let c of batch) {
    // the delete covers a born entity; content is storage, left to the collector
    if (born.has(c.eid) || c.name == 'entity' || content.has(c.eid)) continue
    // An UNLINK is a component removal, which the general inverse below cannot
    // reverse: there is no column to guard and nothing to merge. An edge can be
    // reversed, because its prior state IS the whole sentence — undoing says it
    // again, both halves, exactly as it stood.
    if (!c.comp && (c.name == 'edge' || typeOf[c.name])) {
      let prior = priorOf(c.eid)[c.name]
      if (prior) inverse.push({ eid: c.eid, name: c.name, comp: prior })
      continue
    }
    // Empty writable markers carry intent in their presence, not columns.
    if (
      c.comp && Object.keys(c.comp).every((k) => k == 'eid') &&
      c.name == 'task' && !priorOf(c.eid)[c.name]
    ) {
      if (touchedSince.get(c.eid, id)) {
        throw new Error(
          `${human(db, c.eid)} was modified after #${id} — undo refused`,
        )
      }
      inverse.push({ eid: c.eid, name: c.name, comp: null })
      continue
    }
    // server-owned / derived
    if (!colsOf(db, c.name)?.length || !c.comp) continue
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
  return [...inverse, ...deaths]
}

// The one database mutation capability. Named mutations live here only when
// their read and guarded write must be indivisible; HTTP and in-process MCP
// both call this function, so transport cannot weaken that boundary.
let claimWork = (
  db: Sql,
  ask: WorkClaimMutation,
  trace?: Trace,
  via?: string | null,
) => {
  let allowed = new Set(['mutation', 'target', 'session', 'mode', 'cwd'])
  let unknown = Object.keys(ask).filter((key) => !allowed.has(key)).sort()[0]
  if (unknown) throw new Error(`claim_work unknown field: ${unknown}`)
  if (typeof ask.target != 'string' || !ask.target.trim()) {
    throw new Error('claim_work needs a target')
  }
  if (typeof ask.session != 'string' || !ask.session.trim()) {
    throw new Error('claim_work needs a session')
  }
  if (ask.mode != 'ready' && ask.mode != 'approve') {
    throw new Error('claim_work mode must be ready or approve')
  }
  if (ask.cwd !== undefined && typeof ask.cwd != 'string') {
    throw new Error('claim_work cwd must be a string')
  }
  if (ask.cwd !== undefined && !ask.cwd.trim()) {
    throw new Error('claim_work cwd must not be empty')
  }
  try {
    return db.transaction(() => {
      let target = resolveId(db, ask.target)
      if (!target) throw new Error(`no entity: ${ask.target}`)
      if (
        !prep(
          db,
          `select 1 from task
       where entity = (select id from entity where eid = ?)`,
        ).get(target)
      ) {
        throw new Error(`${human(db, target)} is not a task`)
      }
      let held = prep(
        db,
        `select holder.eid as session
         from claim
         join entity holder on holder.id = claim.session
        where claim.entity = (select id from entity where eid = ?)`,
      ).get(target) as { session: string } | undefined
      // A session address may be its graph id (S-3/eid/alias), its stable
      // session.id, or a pass-through Session owned by a registered source. A
      // persisted graph address is authoritative; a source address graduates at
      // its existing eid through apply() below instead of minting a lookalike.
      let sessionAddress = resolveId(db, ask.session)
      if (!sessionAddress && /^[A-Za-z]+-\d+$/.test(ask.session)) {
        throw new Error(`no entity: ${ask.session}`)
      }
      let storedAddress = sessionAddress && prep(
        db,
        'select 1 from entity where eid = ?',
      ).get(sessionAddress)
      let session = sessionAddress
        ? prep(
          db,
          `select owner.eid as eid, s.cwd, actor.eid as actor
           from session s
           join entity owner on owner.id = s.entity
           left join entity actor on actor.id = s.actor
          where owner.eid = ?`,
        ).get(sessionAddress) as
          | { eid: string; cwd: string | null; actor: string | null }
          | undefined
        : undefined
      if (sessionAddress && storedAddress && !session) {
        throw new Error(`${human(db, sessionAddress)} is not a session`)
      }
      if (!session) {
        session = prep(
          db,
          `select owner.eid as eid, s.cwd, actor.eid as actor
           from session s
           join entity owner on owner.id = s.entity
           left join entity actor on actor.id = s.actor
          where s.id = ?`,
        ).get(ask.session) as
          | { eid: string; cwd: string | null; actor: string | null }
          | undefined
      }
      let source: Change[] | undefined
      if (!session && sessionAddress) {
        source = sourceResolve(ask.session) ?? sourceResolve(sessionAddress)
        let facet = source?.find((change) =>
          change.eid == sessionAddress && change.name == 'session' &&
          change.comp
        )?.comp
        if (
          !source?.length || source.some((change) =>
            change.eid != sessionAddress
          ) ||
          !facet
        ) {
          throw new Error(`${human(db, sessionAddress)} is not a session`)
        }
        if (typeof facet.id != 'string' || !facet.id.trim()) {
          throw new Error(
            `source Session ${human(db, sessionAddress)} has no stable id`,
          )
        }
        session = {
          eid: sessionAddress,
          cwd: typeof facet.cwd == 'string' ? facet.cwd : null,
          actor: typeof facet.actor == 'string' ? facet.actor : null,
        }
      }
      // A replay by the same stable session is a true no-op: no stamp, journal
      // row, worked edge refresh, or cwd edit.
      if (session && held?.session == session.eid) return []
      let actor = prep(
        db,
        `select project.eid as eid from filed
       left join entity project on project.id = filed.project
       where filed.entity = (select id from entity where eid = ?)`,
      ).get(target) as { eid: string | null } | undefined
      let seid = session?.eid ?? uuid()
      let comp: Record<string, unknown> = session ? {} : { id: ask.session }
      // Claims establish a new identity, not its process coordinates. Only
      // the session's own hooks refresh an existing cwd/pid.
      if (!session && ask.cwd !== undefined) comp.cwd = ask.cwd
      if (actor?.eid && !session?.actor) comp.actor = actor.eid
      let changes: Change[] = [
        ...(Object.keys(comp).length
          ? [{ eid: seid, name: 'session', comp }]
          : []),
        ...(ask.mode == 'approve'
          ? [{ eid: target, name: 'decided', comp: {} } as Change]
          : []),
        { eid: target, name: 'claim', comp: { session: seid } },
      ]
      return apply(db, changes, trace, via, undefined, { target, source })
    }, true)
  } catch (e) {
    auditBounce(db, e)
    throw e
  }
}

export let mutate = <T extends Mutation>(
  db: Sql,
  mutation: T,
  trace?: Trace,
  via?: string | null,
  // apply()'s server-writer mode; only a trusted caller sets it.
  server = false,
): MutationOutput<T> => {
  if (Array.isArray(mutation)) {
    return apply(
      db,
      mutation,
      trace,
      via,
      undefined,
      undefined,
      server,
    ) as MutationOutput<T>
  }
  if ('mutation' in mutation && mutation.mutation == 'claim_work') {
    return claimWork(db, mutation, trace, via) as MutationOutput<T>
  }
  if ('mutation' in mutation && 'entities' in mutation) {
    throw new Error('a named mutation cannot include entities')
  }
  if ('entities' in mutation) {
    let plan = normalizeLiterals(mutation.entities, {
      resolve: (id) => resolveId(db, id),
      // A store with a vocabulary of its own admits its own words, and its
      // refusals say where a new one is declared.
      own: ownsVocab(db) ? vocabOf(db) : undefined,
    })
    return {
      changes: apply(
        db,
        plan.changes,
        trace,
        via,
        undefined,
        undefined,
        server,
      ),
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
export let lastBatch = (db: Sql, eid: string): number =>
  Number(
    (prep(
      db,
      `select max(tx) as id from journal_change where entity = ${spineId}`,
    ).get(eid) as { id: number | null } | undefined)?.id ?? 0,
  )

// History is paid for only by the explicit local backfill operation. The result is
// ordinary graph changes, so the caller can land and broadcast them through
// apply() rather than growing a second persistence path.
export let historicalWorked = (db: Sql): Change[] =>
  (prep(
    db,
    `
    select distinct
      json_extract(sess.value, '$') as parent,
      te.eid as child
    from journal_change jc
    join journal_field sess
      on sess.change = jc.id and sess.field = 'session' and sess.present = 1
    join entity se on se.eid = json_extract(sess.value, '$')
    join session s on s.entity = se.id
    join entity te on te.id = jc.entity
    join task t on t.entity = te.id
    left join (${sentences('worked')}) d
      on d.parent = se.id
     and d.child = te.id
    where jc.component = 'claim'
      and jc.operation = 'upsert'
      and d.parent is null
    order by parent, child
  `,
  ).all() as { parent: string; child: string }[])
    .flatMap((r) => link(r.parent, 'worked', r.child))

// Session entries are a lazy graph partition: root clients never receive
// their eids or any facets/provenance hung from them. A Session subscription
// still sees the unfiltered batch through maintain(), and keyed readers stay
// complete. A creation in this batch marks the eid even if a later batch has
// already deleted it — important when filtering a journal window.
export let rootChanges = (db: Sql, changes: Change[]): Change[] => {
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

export let journalSince = (db: Sql, since: number): JournalRow[] =>
  (prep(
    db,
    `select id, ts, ${refEid('actor')} as actor, ${refEid('via')} as via, trace
     from journal_tx
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
    else {
      touched.add(c.eid)
      // An edge is news at both its ends, as apply() has it.
      if (c.name == 'edge' && c.comp) {
        touched.add(String(c.comp.from))
        touched.add(String(c.comp.to))
      }
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
  db: Sql,
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
export let recast = (db: Sql, r: JournalRow): Change[] => {
  let out = rowChanges(r)
  let seen = new Set<string>()
  for (let { eid, name, comp } of r.batch) {
    if (!comp || name == 'entity') continue
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
  db: Sql,
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
        `select 1 from entity e where e.eid = ?
         and not exists (select 1 from tombstone t where t.entity = e.id)`,
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
      comp: reads(db, 'recall', 'where eid = ?').get(eid) as Change['comp'],
    })
    if (
      confirm &&
      prep(db, `update memory set last_confirmed_at = ? where ${byEid}`)
        .run(now, eid).changes
    ) {
      out.push({
        eid,
        name: 'memory',
        comp: reads(db, 'memory', 'where eid = ?').get(eid) as Change['comp'],
      })
    }
  }
  return out
}

// Full-text search over docs and content — including doc-less transcript
// entries, whose identity remains the entry, not its session. User words are quoted into FTS terms (AND semantics) so raw
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
export let findEid = (db: Sql, id: string): string | undefined =>
  resolveId(db, id)

// A door that reads the FTS5 mirrors says so on a store without them, rather
// than failing on a missing table deep inside a query.
let needFts = (db: Sql) => {
  if (!db.can.fts) throw new Error('search needs FTS5, which this store lacks')
}

// One row's exact TEXT membership for incremental subscription maintenance.
// The database tokenizer is the definition; JavaScript never approximates
// unicode61 (its diacritic behavior has boundary cases JS normalization lacks).
export let textMatches = (
  db: Sql,
  eid: string,
  pred: Pred,
): boolean => {
  needFts(db)
  return textMatchesAt(db, eid, pred.value)
}

// Search metadata and its package-gathered rows travel together. The query
// door must not gather a second time just to attach the rank component.
export let searchRead = (db: Sql, q: string, limit = 20, after?: number) => {
  needFts(db)
  let preds = parseQuery(q, vocabOf(db))
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
  let built = where(db, filters)
  let narrow = built && toSql(built)
  // A sparse facet may sit outside any fixed candidate window. Compile the
  // filter into the selection when possible; an exactness decline reads every
  // candidate so the JS definition below still decides before the result cap.
  let screen = narrow ? `and e.eid in (${narrow.sql})` : ''
  // A visible comment aimed at quarantined content is another route into the
  // same content. Keep it out before LIMIT so hidden hits cannot displace
  // visible ones.
  if (!reveal) {
    screen += ` and not exists (
      select 1 from comment c join quarantined q on q.entity = c.target
      where c.entity = e.id
    )`
  }
  let cap = narrow && !after && Number.isFinite(limit) ? 'limit ?' : ''
  let params = narrow?.params ?? []
  let match = ftsQuery(preds)
  if (!match && !filters.length) return { hits: [], byEid: new Map() }
  // Retirement must be ordered BEFORE the page cap. Sinking only the capped
  // hits changes the sequence between page one and a cursor continuation.
  let retired = `exists (
    select 1 from project p join archived a on a.entity = p.entity
    where p.entity = e.id or p.entity =
      (select project from filed where filed.entity = e.id)
  )`
  // These weights, recency and doc-over-content precedence are fleet policy,
  // not the relevance-only/min-per-index policy of @yaks/fts.find(). FTS5's
  // score/highlight/snippet must be read in the MATCH statement itself.
  // The bm25 weights read title 8, body 1, envelope 8: an address is
  // identity, so a letter to it outranks prose that merely mentions it.
  let rows = match
    ? prep(
      db,
      `
      select e.eid, d.title,
        highlight(doc_fts, 0, char(1), char(2)) as title_hit,
        snippet(doc_fts, 1, char(1), char(2), '…', 10) as snip,
        -(bm25(doc_fts, 8.0, 1.0, 8.0)
          - 2.0 / (1 + julianday('now') - julianday(coalesce(up.at, cr.at))))
          as score,
        e.num, ${retired} as retired
      from doc_fts
      join doc d on d.entity = doc_fts.rowid
      join entity e on e.id = d.entity
      left join updated up on up.entity = e.id
      left join created cr on cr.entity = e.id
      where doc_fts match ? ${screen}
      union all
      select e.eid, '' as title, '' as title_hit,
        snippet(content_fts, 0, char(1), char(2), '…', 10) as snip,
        -(bm25(content_fts)
          - 2.0 / (1 + julianday('now') - julianday(coalesce(up.at, cr.at))))
          as score,
        e.num, ${retired} as retired
      from content_fts
      join entity e on e.id = content_fts.rowid
      left join updated up on up.entity = e.id
      left join created cr on cr.entity = e.id
      where content_fts match ? ${screen}
        and e.id not in (select rowid from doc_fts where doc_fts match ?)
      order by retired, score desc, num
        ${cap}
    `,
    ).all(
      match,
      ...params,
      match,
      ...params,
      match,
      ...(cap ? [limit] : []),
    ) as (Omit<
      Hit,
      'kind' | 'open'
    >)[]
    : prep(
      db,
      `
      select e.eid, d.title, d.title as title_hit, '' as snip,
        coalesce(julianday(up.at), julianday(cr.at), 0) as score, e.num, ${retired} as retired
      from entity e
      left join doc d on d.entity = e.id
      left join updated up on up.entity = e.id
      left join created cr on cr.entity = e.id
      where 1 ${screen}
      order by retired, score desc, e.eid ${cap}
    `,
    ).all(...params, ...(cap ? [limit] : [])) as (Omit<
      Hit,
      'kind' | 'open'
    >)[]
  // An address is identity, not prose. Keep textual mentions behind the
  // entity the operator named, without giving ids a second search index.
  if (addressed) {
    let direct = prep(
      db,
      `
      select e.eid, d.title, d.title as title_hit, '' as snip,
        1000000000 as score, e.num, ${retired} as retired
      from doc d
      join entity e on e.id = d.entity
      where e.eid = ? ${screen}
    `,
    ).get(addressed, ...params) as
      | Omit<Hit, 'kind' | 'open'>
      | undefined
    if (direct) {
      rows = [direct, ...rows.filter((r) => r.eid != direct.eid)]
      rows = [
        ...rows.filter((r) => !r.retired),
        ...rows.filter((r) => r.retired),
      ]
    }
  }
  if (narrow) rows = pageRanked(rows, { limit, after })
  // Hydrate the candidate set through @yaks/sqlite once. Refinement only
  // follows keyed references on a compiler decline; exact screens already ran
  // before the cap. This also admits store-defined components without keeping
  // another application copy of component projection here.
  let byEid = new Map(
    rowsOf(db, rows.map((r) => r.eid)).map((r) => [r.eid, r.comps]),
  )
  let compsOf = (eid: string) => {
    if (!byEid.has(eid)) {
      byEid.set(eid, rowsOf(db, [eid])[0]?.comps ?? {})
    }
    return byEid.get(eid)!
  }
  if (!narrow) {
    let kids = (eid: string, comp: string, prop: string) =>
      referrersOf(db, [eid], { comp, prop }).map((k) => ({
        ...compsOf(k),
        entity: { eid: k },
      }))
    rows = pageRanked(
      rows.filter((r) =>
        matchQuery(
          compsOf(r.eid),
          filters,
          compsOf,
          undefined,
          kids,
          undefined,
          (eid, p) => textMatches(db, eid, p),
        )
      ),
      { limit, after },
    )
  }
  // Comment destinations are read as a SET too, never one statement per hit
  // per kind. Retirement remains a stable sink, not exclusion.
  let refs = new Set<string>()
  for (let r of rows) {
    let c = compsOf(r.eid)
    for (let eid of [c.comment?.target]) {
      if (typeof eid == 'string' && !byEid.has(eid)) refs.add(eid)
    }
  }
  for (let r of rowsOf(db, [...refs])) byEid.set(r.eid, r.comps)
  let hits: Hit[] = rows.map((r) => {
    let c = compsOf(r.eid)
    let target = c.comment?.target as string | undefined
    let at = target ? byEid.get(target) : undefined
    let { retired, ...hit } = r
    return {
      ...hit,
      title: r.title || String(at?.doc?.title ?? ''),
      kind: kindOf(c),
      open: target ?? r.eid,
      ...(target ? { open_id: human(db, target) } : {}),
      ...(retired ? { retired: true } : {}),
    }
  })
  return {
    hits: [...hits.filter((h) => !h.retired), ...hits.filter((h) => h.retired)],
    byEid,
  }
}

export let search = (db: Sql, q: string, limit = 20): Hit[] =>
  searchRead(db, q, limit).hits

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
let epochs = new WeakMap<Sql, string>()
export let epochOf = (db: Sql): string => {
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
// client can bridge to the catch-up delta. Read from journal_tx, the SAME
// id-space journalSince/delta seek, so the cursor and the reader can never
// drift apart. 0 on an empty journal.
export let cursorOf = (db: Sql): number =>
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
  db: Sql,
  epochHeld: string | null | undefined,
  vocabHeld: string | null | undefined,
  since: number,
): boolean =>
  epochHeld != epochOf(db) || vocabHeld != vocabHash || since > cursorOf(db)

// A SQL string literal, for a name the reader has to SAY rather than address —
// the component name each branch of the probe below returns as its answer.
let sqlText = (s: string) => `'${s.replaceAll("'", "''")}'`

// WHICH COMPONENTS a set of entities wears, in ONE statement. The graph
// declares ~140 components and an entity wears a handful, so a reader that
// visits every table to find out spends its whole cost on tables with nothing
// in them: a single-entity read was 143 statements, ~139 of them empty
// (T-35451). One compound `exists` answers for every table at once, each branch
// stopping at its first row, and the reads that follow are exactly the
// components the results carry.
//
// `drive` writes one branch's FROM, given the component table — and it must
// drive from the ENTITIES, never from the component table, because the entity
// set is small and a component table is not. Left to choose, the planner scans
// the table and probes the entities: a `join` spelling of the same branch made
// one /query on the live graph take minutes. `cross join` is SQLite's stated
// join order, which is the whole point here.
//
// The parameters a branch takes are repeated for every branch: the store seam
// binds positionally (store/sql.ts), so a value named once and read by 140
// branches is not something every backend can be asked for.
let worn = (
  db: Sql,
  drive: (table: string) => string,
  arg?: SqlValue,
): string[] => {
  let names = readNames(db).filter((n) => n != 'entity')
  if (!names.length) return []
  let sql = names.map((n) =>
    `select ${sqlText(n)} as c where exists (select 1 from ${
      drive(sqlName(n))
    })`
  ).join(' union all ')
  let has = new Set(
    (prep(db, sql).all(...(arg === undefined ? [] : names.map(() => arg))) as {
      c: string
    }[]).map((r) => r.c),
  )
  // In readNames order — the order a snapshot row's comps have always carried,
  // stated rather than left to the compound's evaluation order.
  return names.filter((n) => has.has(n))
}

// The keyed driver, shared with the write-side precondition reader.
let fromEid = (t: string) =>
  `entity o cross join ${t} c on c.entity = o.id where o.eid = ?`

// One entity's current components, keyed read — what subscription maintenance
// tests a touched eid against (design §2). Shaped like a snapshot row's comps
// (eid→comp, entity as {eid,num}); a missing spine returns {} (tombstoned or
// never minted), which reads as "not alive" to the matcher.
export let eager = (
  db: Sql,
  eid: string,
): Record<string, Record<string, unknown>> => {
  let spine = reads(db, 'entity', 'where eid = ?').get(eid)
  if (!spine) {
    // No persisted rows — a pass-through entity is hydrated from its source.
    if (hasSources()) {
      let batch = sourceResolve(eid)
      if (batch) return compsOf(batch)
    }
    return {}
  }
  let out: Record<string, Record<string, unknown>> = { entity: spine }
  for (let name of worn(db, fromEid, eid)) {
    let row = reads(db, name, 'where eid = ?').get(eid)
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
export let bodies = (db: Sql, eids: string[]): Change[] => {
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
export let correct = (db: Sql, sent: Change[]): Change[] => {
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
      if (c.name != 'entity' && !(c.name in comps)) {
        out.push({ eid, name: c.name, comp: null })
      }
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
let homes = (db: Sql, only = '') =>
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
type SnapHit = {
  local: number
  remote: number
  vocab: FleetVocab
  snap: Snapshot
}
let snapCache = new WeakMap<Sql, SnapHit>()

let snapKey = (db: Sql) => ({
  local: Number(
    (prep(db, 'select total_changes() as n').get() as { n: number }).n,
  ),
  remote: Number(
    (prep(db, 'pragma data_version').get() as { data_version: number })
      .data_version,
  ),
})

// A connection-scoped scratch table where the store has one; a hosted SQLite
// (workerd refuses `create temp table`) keeps it as an ordinary table, cleared
// before each use by the caller's `delete from`.
let scratch = (db: Sql, ddl: string) =>
  db.exec(`create ${db.can.temp ? 'temp ' : ''}table if not exists ${ddl}`)

// Materialize the lazy omit-set once for snapshot membership and edge reads.
// The indexed scratch table avoids repeating the large lazy-partition join;
// clearing it keeps prepared statements valid across snapshots. Every eid is
// non-null, so NOT IN cannot accidentally screen the entire eager partition.
let fillOmit = (db: Sql) => {
  scratch(db, '_omit(eid text primary key)')
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

// The bundle gatherer over @yaks/sqlite read() (T-36851), never the database.
// Browser boots are cold and subscription-shaped (T-21491; ~3.4 MB root canvas,
// formerly ~3.4 GB), not whole-db sync. Do not promote snapshot() into @yaks/*:
// read() owns the generic gather; handshake seeds, lazy paging and invalidation
// belong to @yaks/api subscriptions and @yaks/sync. The T-37031..T-37035 path
// (bounded retention floor, ready, leak-free subs, trimmed working set, then
// @yaks/client) makes this adapter dissolve, not an unbounded client cache.
export let snapshot = (db: Sql): Snapshot => {
  let cursor = cursorOf(db)
  let key = snapKey(db)
  let hit = snapCache.get(db)
  let vocab = fleetVocabOf(db)
  if (
    hit?.local == key.local && hit.remote == key.remote && hit.vocab === vocab
  ) {
    return hit.snap
  }
  fillOmit(db)
  // Membership belongs to the app (the eager partition); gathering belongs to
  // @yaks/sqlite. Keep the wire component-major, with explicit legacy ordering.
  let rows = readSet(db, {
    sql: 'select eid from entity where eid not in (select eid from _omit)',
    params: [],
  }, 'storage')
  let byName = new Map<string, Change[]>()
  for (let { eid, comps } of rows) {
    for (let [name, comp] of Object.entries(comps)) {
      let changes = byName.get(name)
      if (!changes) byName.set(name, changes = [])
      changes.push({ eid, name, comp })
    }
  }
  let changes = readNames(db).flatMap((name) => {
    let changes = byName.get(name) ?? []
    // The spine scan was in storage order; component reads drove from the eid
    // index. State those orders rather than inheriting a package query plan.
    if (name != 'entity') changes.sort((a, b) => cmp(a.eid, b.eid))
    return changes
  })
  // Edge endpoints are int ids in storage; project both back to their eids.
  // Both endpoints read the same `_omit` set the component walk used.
  let deps = (prep(
    db,
    `select p.eid as parent, d.type as type, c.eid as child, d.ord as ord
     from (${sentences()}) d
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
  // The omit scratch writes are ours, not a graph change. Cache the frontier
  // AFTER those writes so the very next unchanged read can actually hit it.
  snapCache.set(db, { ...snapKey(db), vocab, snap })
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
export let componentCounts = (db: Sql): Record<string, number> => {
  let out: Record<string, number> = {}
  let named: string[] = []
  for (let name of Object.keys(comps)) {
    if (columnsOf(db, name).size) named.push(name)
    else out[name] = 0
  }
  if (named.length) {
    let sql = 'select ' +
      named.map((n) => `(select count(*) from ${sqlName(n)}) as "${n}"`).join(
        ', ',
      )
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
  // Governed durable work/knowledge outside every project-rooted edge
  // closure. Human ids because doctor output is agent-facing.
  unrooted?: string[]
}

export type ProjectReachability = {
  reachable: string[]
  orphans: string[]
}

// One cycle-safe project-root closure over every semantic edge. UNION is the
// visited set: detached cycles terminate and remain outside the closure. The
// recursive step seeks `edge_from`; the nature is deliberately absent because
// no relation, including contains, is structural.
// The governed facet list is generated vocabulary shared with later readers and
// write gates, so the corpus boundary cannot drift between doors.
export let projectReachability = (db: Sql): ProjectReachability => {
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
       select d.child from (${links}) d join rooted r on r.entity = d.parent
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

export let scanAnomalies = (db: Sql): Anomalies => {
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
    // Orphaned component rows — a row whose owner eid has left the spine.
    if (cols.has(ownerCol)) {
      let n = count(t, missing(ownerCol))
      if (n) orphans[t] = n
    }
    // Dangling references — every {eid} column, an edge's own ends included.
    for (let c of cols) {
      if (c == ownerCol || !isRef(t, c)) continue
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
let vectorState = (db: Sql): Anomalies['vector'] => {
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
  db: Sql,
  eid: string,
  name: string,
): Record<string, unknown> | undefined =>
  readOf(db, name) ? reads(db, name, 'where eid = ?').get(eid) : undefined

// An id to an eid, through the index — client.ts `find()`'s rules (X-123 or a
// bare number by num, an eid verbatim or by its short handle, an alias slug)
// asked of SQLite instead of of a materialized graph. It exists so a query can
// resolve its own references without anyone building a snapshot first; keep the
// two readings of "what names an entity" in step. resolveId is that one
// reading (T-3684).
export let locate = (db: Sql, id: string): string | undefined =>
  resolveId(db, id)

// A tombstoned entity keeps its spine row and its name (C-19754#2), so locate
// still resolves it — naming a dead entity must keep working (human(), history).
// But it has LEFT the graph: the addressing doors (id=) exclude it, so a dead
// name reads as absent rather than as a spine with no components. Before the
// D-18866 flip, delete removed the spine and locate simply missed; the spine now
// survives, so the exclusion is explicit.
export let buried = (db: Sql, eid: string): boolean => !!graveOf(db).get(eid)

// Quarantined, keyed — what the deps and backlinks layers ask of every edge
// endpoint. Reading it off eager() cost a statement per component table per
// endpoint: 609 edges on one milestone task made `deps=1` a 1.6s fetch.
let hiddenOf = (db: Sql) =>
  prep(
    db,
    `select 1 from quarantined q join entity e on e.id = q.entity
     where e.eid = ?`,
  )
export let hidden = (db: Sql, eid: string): boolean => !!hiddenOf(db).get(eid)

// The page entity at a URL, keyed off the `web.url` index — a normalized
// address reaches the same row it minted (url.ts), so the browser-extension
// door finds-or-mints without materializing the graph (M-21143). The caller
// hands a NORMALIZED url, the same shape a write stores.
export let webAt = (db: Sql, url: string): string | undefined =>
  (prep(
    db,
    'select o.eid as eid from web t join entity o on o.id = t.entity where t.url = ?',
  ).get(url) as { eid: string } | undefined)?.eid

let clear = (db: Sql) => {
  scratch(db, 'hit (eid text primary key)')
  db.exec('delete from hit')
}

// The eids a keyed reader asks about, staged. A temp table rather than an
// `in (?,?,…)` list because a hit set has no ceiling (a query can match the
// whole graph) and a bound parameter list does. `hit` is filled and read out
// within one reader, never held across two.
let stage = (db: Sql, eids: string[]) => {
  clear(db)
  let put = prep(db, 'insert or ignore into hit (eid) values (?)')
  for (let e of eids) put.run(e)
}

// Package bundles have no component eid, and may carry computed columns.
// The fleet wire is its declared readable columns, not the package's bag of
// values. Cache that projection by vocabulary identity, so planting app words
// replaces both the gather vocabulary and the shaping rules on this handle.
let wireReads = new WeakMap<Sql, {
  vocab: FleetVocab
  derived: Derived
  rank: Map<string, number>
  shape: Map<
    string,
    (eid: string, comp: Record<string, unknown>) => Record<string, unknown>
  >
}>()
let wireRead = (db: Sql) => {
  let vocab = fleetVocabOf(db)
  let held = wireReads.get(db)
  if (held?.vocab === vocab) return held
  let shape = new Map(
    readNames(db).map((name) => {
      let cols = readOf(db, name)!
      let fix = unbool(db, name)
      return [name, (eid: string, comp: Record<string, unknown>) => {
        let row: Record<string, unknown> = {}
        for (let col of cols) row[col] = col == 'eid' ? eid : comp[col] ?? null
        return fix(row)
      }] as const
    }),
  )
  let entry = {
    vocab,
    // Only doc.body is CAS. Other body columns are inline, including an app's
    // own bodies. updated.at is computed for FILTERING but stored on the wire;
    // do not coalesce it with created.at here or synthesize task.status.
    derived: {
      'doc.body': blobRead(vocab, { key: 'entity' })['doc.body'],
      'updated.at': { tag: 'time' as const, expr: () => '"updated"."at"' },
    },
    shape,
    rank: new Map([...shape.keys()].map((name, i) => [name, i])),
  }
  wireReads.set(db, entry)
  return entry
}

// A composed membership statement is already lowered (including app screens,
// fallback candidates and windows). The `every` extension embeds that set as
// one IN subquery: SQLite evaluates it once, then the package gathers only its
// members, in bounded chunks with a sparse-table probe. No per-entity reader,
// no re-running the filter for every component, and no write to stage a read.
let readSet = (db: Sql, filter: Frag, sort = 'entity.eid') => {
  let { vocab, derived, shape, rank } = wireRead(db)
  let bundles = sqliteRead(
    readDriver(db),
    vocab,
    queryAnd(every(), order(sort)),
    {
      derived,
      extend: [{
        name: 'fleet/membership',
        compile: {
          every: () =>
            raw({
              sql: `"entity"."eid" in (${filter.sql})`,
              params: filter.params,
            }),
        },
        order: (name) => name == 'storage' ? '"entity"."id"' : null,
      }],
    },
  )
  return bundles.map((bundle: Bundle) => {
    let eid = bundle.entity.eid
    let comps: Record<string, Record<string, unknown>> = {}
    // Keep the app's component order, without walking the entire wide
    // vocabulary per entity just to sort the handful of facets it wears.
    let names = Object.keys(bundle).sort((a, b) =>
      (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity)
    )
    for (let name of names) {
      let project = shape.get(name)
      if (project) {
        comps[name] = project(eid, bundle[name] as Record<string, unknown>)
      }
    }
    return { eid, comps }
  })
}

let staged = (db: Sql) =>
  readSet(db, { sql: 'select eid from hit', params: [] })

// Every entity a compiled filter matches, with its components — the shape
// `rows(snapshot())` hands a matcher, restricted to the rows that matched.
export let matching = (
  db: Sql,
  filter: { sql: string; params: (string | number)[] },
): { eid: string; comps: Record<string, Record<string, unknown>> }[] => {
  let out = readSet(db, filter)
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
export let rowsOf = (db: Sql, eids: string[]) => {
  if (!eids.length) return []
  let out = readSet(db, {
    sql: 'select value as eid from json_each(?)',
    params: [JSON.stringify(eids)],
  })
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
  db: Sql,
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
export let entryOf = (db: Sql, eid: string) => {
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
  db: Sql,
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
  // Only a wholly file-backed partition falls through. A page beyond the end
  // of a real SQL partition must stay empty rather than replaying a provider
  // transcript over its durable rows.
  if (!index.length && hasSources() && through == null) {
    let stored = prep(
      db,
      `select 1 from entry t join entity s on s.id = t.session
       where s.eid = ? limit 1`,
    ).get(session)
    if (!stored) {
      let outcome = sourceEntriesOf(db, session, after, cap)
      if (outcome.state == 'found') return outcome.entries
    }
  }
  return entryRows(db, index)
}

// The explicit source-side answer for a Session partition. Persisted Sessions
// are located by both identities: their graph eid remains the partition owner,
// while session.id is merely the provider-store handle used to find bytes.
// Ephemeral sessions have no SQL metadata and retain the direct derived-eid
// lookup. Returned entry identities and source seqs are untouched; only the
// entry.session reference is projected to the requested persisted identity.
export let sourceEntriesOf = (
  db: Sql,
  session: string,
  after = 0,
  limit = 500,
): EntrySourceOutcome => {
  let meta = readComp(db, session, 'session')
  let providerId = typeof meta?.id == 'string' && meta.id ? meta.id : undefined
  let handles = [
    ...new Set([session, providerId].filter((x): x is string => !!x)),
  ]
  let outcome = sourceEntries(
    handles,
    after,
    Math.max(1, Math.min(limit, 5000)),
  )
  if (!outcome) {
    return providerId
      ? { state: 'failed', reason: 'missing' }
      : { state: 'undiscoverable' }
  }
  if (outcome.state != 'found') return outcome
  return {
    state: 'found',
    entries: outcome.entries.map((row) => ({
      ...row,
      comps: {
        ...row.comps,
        entry: { ...row.comps.entry, session },
      },
    })),
  }
}

// The lazy partition scanned ACROSS sessions, ordered (session, seq) and
// capped — the fallback universe for a lazy query that names no single session
// and whose predicate the index declined to compile. entriesOf is the keyed,
// per-session read; this is its unscoped sibling, bounded so an all-sessions
// scan can never be unbounded.
// The unscoped scan reads the partition's TAIL, newest first: a cross-session
// reader wants what was said last across the fleet (the owner's latest words,
// the newest prompts), never an arbitrary prefix of whichever session sorts
// first. Entity ids are minted in arrival order, so `t.entity desc` is time.
// `narrow` is the query's own compiled candidate statement (sql.ts whereSome
// over its preds), so the bound is spent on rows that can match rather than
// on every tool call between two user turns.
export let entriesScan = (
  db: Sql,
  after = 0,
  limit = 500,
  narrow?: Frag,
) => {
  let index = prep(
    db,
    `select o.eid as eid, t.seq as seq from entry t
     join entity o on o.id = t.entity
     where t.seq > ?${narrow ? ` and o.eid in (${narrow.sql})` : ''}
     order by t.entity desc limit ?`,
  ).all(
    after,
    ...(narrow?.params ?? []),
    Math.max(1, Math.min(limit, 5000)),
  ) as {
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

// WHICH edges are incident to the staged hits, as a FROM clause — the one
// place that decides it, shared by the read and the COUNT beside it, so a
// bounded delivery and the total it says it is a prefix of can only agree.
//
// C-19763's landmine is binding an eid VALUE to a base int column, which
// matches nothing in silence; the cure it prescribes is resolving eid→id
// BEFORE binding, which is what `myIds` does here. Filtering the projected
// p.eid/c.eid instead spans two joined copies of `entity`, so no single
// index answers the disjunction and sqlite SCANS all of entity, seeking the
// edge once per row. Naming the sentence's own endpoint columns keeps both
// halves on one table, which sqlite answers as a MULTI-INDEX OR: each half
// seeks its own index (`edge_from`, `edge_to`).
//
// The eager screen rides OUTSIDE the disjunction — an endpoint is lazy or it
// isn't, whichever side of the OR selected the row — so the multi-index OR is
// untouched and each NOT EXISTS is one more seek per candidate edge.
let MINE = `in (select eid from hit)`
let incidentFrom = (eagerOnly: boolean, type?: string) => {
  let myIds = `in (select e.id from entity e where e.eid ${MINE})`
  let live = eagerOnly ? notLazy('d.parent') + notLazy('d.child') : ''
  return `(${
    sentences(type, `g."from" ${myIds} or g."to" ${myIds}`)
  }) d where 1${live}`
}

// The canonical reading order of an edge set: by parent, verb, listed order,
// then child. A BOUNDED read picks its prefix by recency in SQL and is sorted
// back into this here, so a bounded answer and a whole one differ in length
// and never in shape.
let cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
let reading = (a: Dep, b: Dep) =>
  cmp(a.parent, b.parent) || cmp(a.type, b.type) ||
  (a.ord ?? 0) - (b.ord ?? 0) || cmp(a.child, b.child)

// Every edge touching these entities, both directions — the narrow reading of
// `snap.deps`, derived `reads` included. Losing those would make this door
// disagree with the graph-out one about what an entity's edges ARE, so the
// persona table is read here too, keyed the same way: personas homed at a hit,
// and a hit that is itself a persona.
//
// `eagerOnly` screens the answer to the entities a CLIENT can hold — see
// eagerDeps below. `limit` bounds it to the NEWEST that many stored sentences,
// and `type` to one verb.
let incident = (
  db: Sql,
  eids: string[],
  eagerOnly: boolean,
  limit?: number,
  type?: string,
): Dep[] => {
  if (!eids.length) return []
  stage(db, eids)
  let deps = (prep(
    db,
    `select p.eid as parent, d.type as type, c.eid as child, d.ord as ord
      from (select d.parent, d.type, d.child, d.ord from ${
      incidentFrom(eagerOnly, type)
    }
             order by d.edge desc${limit == null ? '' : ` limit ${limit}`}) d
      join entity p on p.id = d.parent
      join entity c on c.id = d.child`,
  ).all() as Dep[]).map(shedOrd).sort(reading)
  // Derived home reads are never bounded: there are twenty-odd of them in the
  // whole graph, they are computed rather than stored, and dropping them would
  // make this door disagree with the graph-out one about what an edge IS. So
  // the REMAINDER a bounded delivery leaves — the total minus the stored
  // sentences it carried — stays exact whether or not any of them ride.
  return [
    ...deps,
    ...homeReads(homes(db, `where h.eid ${MINE} or o.eid ${MINE}`), deps)
      .filter((d) => type == null || d.type == type),
  ]
}

export let depsOf = (db: Sql, eids: string[]): Dep[] =>
  incident(db, eids, false)

// How many stored edges a rider WOULD deliver unbounded — the same incidence
// and the same eager screen, counted without projecting a row. The remainder a
// bounded delivery leaves behind is this minus the stored sentences it carried.
export let eagerDepsCount = (
  db: Sql,
  eids: string[],
  type?: string,
): number => {
  if (!eids.length) return 0
  stage(db, eids)
  return Number(
    (prep(db, `select count(*) as n from ${incidentFrom(true, type)}`)
      .get() as { n: number }).n,
  )
}

// The same edges, screened to the EAGER graph: the edges a CLIENT may hold.
// A session-log entry's `referenced` edge points from an entity no cache will
// ever carry, so delivering it is a dangling triple — and `snapshot()` and the
// `allDeps` this replaced both dropped exactly those, so the `.edges!` rider has
// to agree with them or the wire says two different things about what an edge
// IS. Not a nicety: one card on a well-referenced task draws 522 incident edges,
// 469 of them from entries, and the rider would have shipped every one along
// with a projected peer row for each.
export let eagerDeps = (db: Sql, eids: string[], limit?: number): Dep[] =>
  incident(db, eids, true, limit)

// Stored edges incident to `eids` AFTER an optional endpoint
// projection. The projection is one vocabulary `{eid}` column: an endpoint
// wearing its component reads as the referenced entity, and membership is
// tested in that projected graph. `endpoint` is built from two indexed seeks —
// the member spine ids and the projection column's reverse index — then each
// half seeks the edge store by its own endpoint index. No component partition is
// enumerated.
export let selectedDeps = (
  db: Sql,
  eids: string[],
  select: EdgeSelector,
  limit?: number,
): Dep[] => {
  if (!eids.length) return []
  if (!select.via) return incident(db, eids, true, limit, select.type)
  stage(db, eids)
  let table = sqlName(select.via.comp)
  let col = sqlName(select.via.prop)
  // Several stored sentences collapse to ONE projected sentence, so the group
  // — not `distinct` — is the projected edge, and its recency is the newest
  // stored sentence proving it. A bound cuts by that and JS sorts the prefix
  // back into the canonical reading.
  //
  // `picked` names its endpoints `from`/`to` rather than parent/child on
  // purpose: sqlite resolves a GROUP BY name against the INPUT columns before
  // the output aliases, so grouping by `parent` would silently group by the
  // stored endpoint id and never collapse two entries citing one target.
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
     ), picked("from", verb, "to", listed, edge) as (
       select d.parent, d.type, d.child, d.ord, d.edge from (${
      sentences(select.type)
    }) d
        where d.parent in (select id from endpoint)
       union
       select d.parent, d.type, d.child, d.ord, d.edge from (${
      sentences(select.type)
    }) d
        where d.child in (select id from endpoint)
     )
     select coalesce(pp.eid, p.eid) as parent,
            d.verb as type,
            coalesce(pc.eid, c.eid) as child,
            d.listed as ord
       from picked d
       join entity p on p.id = d."from"
       join entity c on c.id = d."to"
       left join ${table} vp on vp.entity = d."from"
       left join entity pp on pp.id = vp.${col}
       left join ${table} vc on vc.entity = d."to"
       left join entity pc on pc.id = vc.${col}
      group by parent, type, child, ord
      order by max(d.edge) desc${limit == null ? '' : ` limit ${limit}`}`,
  ).all() as Dep[]
  return rows.map(shedOrd).sort(reading)
}

// The walk `.requires[<=N]->id` selects: the eids that reach `target` through
// the arrow, with an optional hop cap (sql.ts reachRows — one query, shared, so
// the two readers cannot drift). The default excludes the target; an explicit
// cap selects nonzero paths. This is the JS matcher's half of the same closure
// the compiler emits, so a query mixing a walk with a pred SQL declines still
// answers, and answers identically.
//
// There is no whole-graph edge reader beside it, deliberately: `allDeps` — the
// dump every joining client used to receive — is gone (T-22371). Edges are
// delivered SCOPED, by depsOf above, to whatever a subscription selected.
export let reaching = (db: Sql, target: string, r: Reach): string[] => {
  let rows = reachRows(r, target)
  return (prep(
    db,
    `select eid from entity where id in (${rows.sql})`,
  ).all(...rows.params) as { eid: string }[]).map((r) => r.eid)
}

// Who points AT these entities through a typed eid column — one keyed
// statement per column in the readable vocabulary (`stamped` included, so an
// association nobody may write still says who made it), where the graph-out
// reading walks every column of every row. `via` names the column. A column
// is a reference by its PropType, not its name, so `created.by` and
// `deliver.to` counts as surely as `project` — isRef reads the declared type.
export let refsOf = (db: Sql, eids: string[]) => {
  if (!eids.length) return []
  stage(db, eids)
  let out: { from: string; via: string; to: string }[] = []
  for (let [name, cols] of Object.entries(readable)) {
    // An edge's endpoints are not a reference like any other: the sentence is
    // reported by its VERB, once, beside the deps layer (graph_query layered).
    // Counting `edge.from`/`edge.to` here too would answer every stored edge
    // twice, in a spelling no client has ever been told (T-23824).
    if (name == 'edge') continue
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
  db: Sql,
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
  db: Sql,
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
