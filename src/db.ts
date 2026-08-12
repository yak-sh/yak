// The fleet entity graph, in one SQLite file. Star ECS: `entity` holds the
// shared primary key (`eid`); component tables (`task`, `board`, `card`, …)
// hang off it by that same id; `dependency` rows are typed eid↔eid edges that
// read as sentences. This module owns the file, the seed, and the two wire
// operations: apply (patch batches in) and snapshot (the whole graph out).
// SERVER-ONLY — the browser reads the graph from its cache in live.ts.
//
// Ids: `eid` is a UUID so ANY side (client included) can mint entities;
// `num` is the server-minted human number (T-7 in the UI, one global counter).
import { DatabaseSync } from 'node:sqlite'
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
  type Hit,
  idOf,
  kindOrder,
  sessionActive,
  sessionComps,
  SHORT,
  shortId,
  slugsOf,
  type Snapshot,
  stamped,
  uuid,
} from './types.ts'
import { type Trace } from './effects.ts'
import { ancestorAt } from './client.ts'
import { homeReads } from './persona.ts'
import { leafOf, matchQuery, parseQuery, resolveRefs, TEXT } from './query.ts'
import { where } from './sql.ts'
import { derivedCols, indexDdl, tableDdl } from './ddl.ts'
import {
  bodyCols,
  isRef,
  normalizeChanges,
  parseProp,
  propAt,
  propOwners,
} from './props.ts'
import { fleetLocal } from './mailaddr.ts'

// The owner's live graph — the one path a test must never open (open() below
// refuses it under `deno test`). A function, not a constant, so it re-reads
// HOME and the guard that holds this can't drift from a stale literal.
export let liveDb = () => `${Deno.env.get('HOME')}/.tasks/tasks.db`

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
    parent text not null references entity(eid),
    type       text not null check (type in (${
  edges.map((e) => `'${e}'`).join(',')
})),
    child  text not null references entity(eid),
    primary key (parent, type, child)
  )`

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
// to_addr/sent_id/received_at stay as envelope DATA. Column order below is the
// live table's order AFTER migrateDelivery()/migrateDeliver() drop
// acted_at/error/to — mendMail's `insert select *` rebuild depends on the
// match.
let mailDdl = `create table if not exists mail (
    eid         text primary key references entity(eid),
    "from"      text,
    target  text,
    to_addr     text,
    message_id  text,
    received_at text,
    verified    integer,
    reply_to text,
    sent_id     text,
    in_reply_to text
  )`

// Named apart from `schema` for the same reason mail is: the sources are a
// baked CHECK, and a live db that shipped with the narrower list must be
// rebuilt around this one or record() drops every row it doesn't know —
// which would be exactly the rows nobody else reports (telemetry.ts `srv`).
let callDdl = `create table if not exists tool_call (
    ts         text not null
               default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    source     text not null check (source in ('mcp','http','web','srv')),
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
    eid         text primary key,
    num         integer not null unique
  );
  create table if not exists doc (
    eid   text primary key references entity(eid),
    title text not null,
    body  text not null default ''
  );
  create table if not exists task (
    eid    text primary key references entity(eid),
    status text not null default 'open',
    priority real not null default 0
  );
  create table if not exists repo (
    eid  text primary key references entity(eid),
    path text not null,
    url text,
    base_branch text not null default 'main',
    gate text,
    push integer not null default 0
  );
  create table if not exists role (
    eid          text primary key references entity(eid),
    state        text not null default 'stopped',
    surface      text not null default 'native',
    scope    text references entity(eid),
    applied_hash text,
    applied_at   text,
    stopped_at   text,
    retry_at     text
  );
  -- One pane: container (dir) or leaf (content/view). size is a
  -- weight among siblings; "order" quoted — an SQL keyword, like "to".
  create table if not exists pane (
    eid         text primary key references entity(eid),
    layout  text references entity(eid),
    parent  text references entity(eid),
    size        real not null default 1,
    "order"     real not null default 0,
    dir         text,
    content text references entity(eid),
    view        text
  );
  create table if not exists web (
    eid text primary key references entity(eid),
    url text not null,
    frozen_at text
  );
  create table if not exists card (
    eid        text primary key references entity(eid),
    target text not null references entity(eid),
    view       text not null
  );
  create table if not exists pin (
    eid        text primary key references card(eid),
    canvas text not null references entity(eid),
    x integer not null,
    y integer not null,
    w integer not null,
    h integer not null,
    z integer not null default 0
  );
  create table if not exists client (
    eid        text primary key references entity(eid),
    user_agent text not null default '',
    ip         text not null default ''
  );
  create table if not exists camera (
    eid        text primary key references entity(eid),
    client text not null references entity(eid),
    canvas text not null references entity(eid),
    x    real not null default 0,
    y    real not null default 0,
    zoom real not null default 1,
    w    real not null default 0,
    h    real not null default 0,
    unique (client, canvas)
  );
  create table if not exists fold (
    eid        text primary key references entity(eid),
    client text not null references entity(eid),
    board  text not null references entity(eid),
    statuses   text not null default '',
    unique (client, board)
  );
  create table if not exists shelf (
    eid        text primary key references entity(eid),
    client text not null references entity(eid),
    unique (client)
  );
  create table if not exists session (
    eid text primary key references entity(eid),
    id  text not null unique,
    cwd text
  );
  create table if not exists runtime (
    eid                 text primary key references entity(eid),
    pid                 integer,
    pane                text,
    transcript          text,
    provider_session_id text,
    serving_model       text
  );
  -- A Session's ordered graph-native log (D-15656). seq is assigned inside
  -- apply()'s write transaction; every other table below is an independent
  -- facet worn by the same entry entity.
  create table if not exists entry (
    eid     text primary key references entity(eid),
    session text not null references entity(eid),
    seq     integer not null,
    unique (session, seq)
  );
  create index if not exists entry_session_seq on entry (session, seq);
  -- The ingest coordinate (D-16704): where an imported entry came from. Both
  -- columns are server-owned (stamped through the trusted append path, refused
  -- from the wire) and immutable. source is a stable stream key (managed/
  -- native/an archive key, never a filesystem path); line is the 1-based
  -- SOURCE line, distinct from entry.seq. The set of (entry.session, source,
  -- line) present IS the durable ingest cursor — no mutable cursor row. A
  -- wholly new table, so create-if-not-exists is the additive add.
  create table if not exists imported (
    eid    text primary key references entity(eid),
    source text not null,
    line   integer not null
  );
  create table if not exists content (
    eid  text primary key references entity(eid),
    body text not null default ''
  );
  create table if not exists message (
    eid  text primary key references entity(eid),
    role text not null
  );
  create table if not exists generation (
    eid      text primary key references entity(eid),
    through  text not null,
    provider text not null,
    model    text not null,
    effort   text,
    serving_model text
  );
  create unique index if not exists generation_through
    on generation (through);
  create table if not exists output (
    eid    text primary key references entity(eid),
    source text not null,
    key    text,
    phase  text
  );
  create unique index if not exists output_source_key
    on output (source, key) where key is not null;
  create table if not exists call (
    eid text primary key references entity(eid),
    key text not null
  );
  create table if not exists bash (
    eid     text primary key references entity(eid),
    command text not null,
    cwd     text
  );
  create table if not exists fetch (
    eid    text primary key references entity(eid),
    url    text not null,
    method text not null
  );
  create table if not exists patch (
    eid  text primary key references entity(eid),
    path text not null,
    diff text not null
  );
  -- Provider-neutral named-tool facet (D-16704): an imported tool call with no
  -- first-class facet (bash/patch/fetch/task_context/graph_query/apply) keeps
  -- its real name and a one-line arg detail here. Wire-writable like the
  -- other tool facets; a wholly new table = create-if-not-exists.
  create table if not exists tool (
    eid    text primary key references entity(eid),
    name   text not null,
    detail text
  );
  create table if not exists graph_query (
    eid   text primary key references entity(eid),
    query text not null default ''
  );
  create table if not exists "apply" (
    eid     text primary key references entity(eid),
    changes text not null
  );
  create table if not exists result (
    eid  text primary key references entity(eid),
    call text not null
  );
  create unique index if not exists result_call on result (call);
  create table if not exists exit (
    eid  text primary key references entity(eid),
    code integer not null
  );
  create table if not exists response (
    eid    text primary key references entity(eid),
    status integer not null
  );
  create table if not exists headers (
    eid  text primary key references entity(eid),
    data text not null
  );
  create table if not exists stderr (
    eid  text primary key references entity(eid),
    text text not null
  );
  create table if not exists timeout (
    eid text primary key references entity(eid),
    ms  integer not null
  );
  create table if not exists checkpoint (
    eid     text primary key references entity(eid),
    through text not null
  );
  create table if not exists cancel (
    eid    text primary key references entity(eid),
    target text not null
  );
  create table if not exists opaque (
    eid    text primary key references entity(eid),
    format text not null,
    data   text not null
  );
  create table if not exists runner (
    eid  text primary key references entity(eid),
    name text not null
  );
  -- Runtime ownership and usage are server-only outcome facets. Their refs
  -- deliberately carry no FK: runner/generation history survives a target's
  -- tombstone, like every death:'keep' association.
  create table if not exists lease (
    eid    text primary key references entity(eid),
    holder text not null,
    at     text not null,
    until  text not null
  );
  create table if not exists usage (
    eid       text primary key references entity(eid),
    input     integer not null,
    cached    integer not null,
    output    integer not null,
    reasoning integer not null
  );
  create table if not exists claim (
    eid         text primary key references entity(eid),
    session text not null references entity(eid),
    claimed_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  -- An actor's standing instruction about one entity (watch / mute).
  -- One row per (actor, target); the unique index is what makes setting
  -- it twice idempotent rather than a pile.
  create table if not exists subscription (
    eid        text primary key references entity(eid),
    actor  text not null references entity(eid),
    target text not null references entity(eid),
    mode       text not null
  );
  create unique index if not exists subscription_one
    on subscription (actor, target);
  create table if not exists stop_request (
    eid        text primary key references entity(eid),
    target text not null references entity(eid)
  );
  -- A knock: bring target to the recipient's attention now (knock.ts
  -- resolves; WHO looks is the shared deliver.to below, the outcome the
  -- shared delivered/error facet — neither a column here).
  create table if not exists knock (
    eid        text primary key references entity(eid),
    target text not null references entity(eid)
  );
  -- A wake: mint that knock at 'at' (absolute, resolved at mint).
  -- wake.ts arms one timer at the earliest UNACTED row (no delivered/error)
  -- and reconciles at boot; WHO to wake is the shared deliver.to, the outcome
  -- the shared facet. target is nullable — absent means the wake is its
  -- own subject.
  create table if not exists wake (
    eid        text primary key references entity(eid),
    at         text not null,
    target text references entity(eid)
  );
  -- Self-healing's diagnosis facet (D-17077, heal.ts): a task auto-filed
  -- about a break. fault (kind + normalized message + stack head) is the dedup
  -- key a storm keys to; hits/last tally its recurrences in place. Column names
  -- are unique so dot-param routing stays unambiguous. Wire-writable, so it
  -- rides the ordinary apply() insert path like task/doc.
  create table if not exists bug (
    eid   text primary key references entity(eid),
    fault text,
    hits  integer,
    last  text
  );
  -- The BLOCK facet (D-17094): this task is stuck on something EXTERNAL — no
  -- entity, so a requires edge can't name it. "on" (a SQL keyword, so quoted)
  -- is the free-text reason and rides the wire; "since" is server-owned — the
  -- clock default stamps it on insert and it stays put on a re-word, so it
  -- reads as when the block began. A wholly new table = create-if-not-exists
  -- is the additive add; the entity-death cascade takes the row.
  create table if not exists blocked (
    eid    text primary key references entity(eid),
    "on"   text,
    since  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  ${mailDdl};
  create table if not exists email (
    eid     text primary key references entity(eid),
    address text not null
  );
  create table if not exists conflict (
    eid        text primary key references entity(eid),
    target text not null,
    loser      text not null,
    holder     text not null,
    at         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  create table if not exists comment (
    eid        text primary key references entity(eid),
    target text not null references entity(eid)
  );
  create table if not exists review (
    eid     text primary key references entity(eid),
    verdict text not null
  );
  create table if not exists alias (
    eid   text primary key references entity(eid),
    slug  text not null unique,
    slugs text
  );
  -- recall's not-null columns have no defaults ON PURPOSE: they refuse
  -- even apply()'s bare {} touch, so touch() below stays the one writer.
  create table if not exists recall (
    eid      text primary key references entity(eid),
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
    eid text primary key references entity(eid),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" text,
    via text
  );
  create table if not exists updated (
    eid text primary key references entity(eid),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" text,
    via text
  );
  -- Notification lifecycle (T-7006): presence IS the fact. Same shape as
  -- created/updated — "at" default-stamped then frozen, "by" the writing
  -- actor and "via" its instrument (no FKs; provenance outlives them). All
  -- are server-only (out of comps): the wire writes a bare row and apply()'s
  -- stampedPresence loop fills and returns the stamp.
  create table if not exists notified (
    eid text primary key references entity(eid),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" text,
    via text
  );
  create table if not exists opened (
    eid text primary key references entity(eid),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" text,
    via text
  );
  create table if not exists archived (
    eid text primary key references entity(eid),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" text,
    via text
  );
  create table if not exists quarantined (
    eid text primary key references entity(eid),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" text,
    via text
  );
  -- A fleet proposal awaiting a decision: like decided, its authored time
  -- and byline ride the wire while the server alone names the instrument.
  create table if not exists proposed (
    eid text primary key references entity(eid),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" text,
    via text
  );
  -- A decision taken (T-12574): the same three columns, but "at" and "by"
  -- arrive on the WIRE — a decision is often written up after the fact, so
  -- the default clock is only the fallback. Only "via" is stamped.
  create table if not exists decided (
    eid text primary key references entity(eid),
    at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    "by" text,
    via text
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
  create virtual table if not exists doc_fts using fts5(
    title, body, content='doc', content_rowid='rowid'
  );
  create trigger if not exists doc_fts_ai after insert on doc begin
    insert into doc_fts (rowid, title, body)
    values (new.rowid, new.title, new.body);
  end;
  create trigger if not exists doc_fts_ad after delete on doc begin
    insert into doc_fts (doc_fts, rowid, title, body)
    values ('delete', old.rowid, old.title, old.body);
  end;
  create trigger if not exists doc_fts_au after update on doc begin
    insert into doc_fts (doc_fts, rowid, title, body)
    values ('delete', old.rowid, old.title, old.body);
    insert into doc_fts (rowid, title, body)
    values (new.rowid, new.title, new.body);
  end;
  -- The SUBSTRING index, and the reason it cannot be doc_fts: doc_fts indexes
  -- TOKENS, so a search for idget finds none of the rows holding widget — a
  -- prefix search is a strict subset of a substring one and loses rows
  -- silently. The trigram tokenizer indexes every 3-character window instead,
  -- which is what lets SQLite answer LIKE %x% from an index (sql.ts) rather
  -- than by lowercasing every body in the graph. Derived like doc_fts: never
  -- on the wire, never dumped (bin/backup), healed by the same check below.
  create virtual table if not exists doc_gram using fts5(
    title, body, content='doc', content_rowid='rowid', tokenize='trigram'
  );
  create trigger if not exists doc_gram_ai after insert on doc begin
    insert into doc_gram (rowid, title, body)
    values (new.rowid, new.title, new.body);
  end;
  create trigger if not exists doc_gram_ad after delete on doc begin
    insert into doc_gram (doc_gram, rowid, title, body)
    values ('delete', old.rowid, old.title, old.body);
  end;
  create trigger if not exists doc_gram_au after update on doc begin
    insert into doc_gram (doc_gram, rowid, title, body)
    values ('delete', old.rowid, old.title, old.body);
    insert into doc_gram (rowid, title, body)
    values (new.rowid, new.title, new.body);
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
  'canvas',
  'worktree',
  'attention',
  'task_context',
  'reasoning',
  'spawn',
  'hook',
  'person',
  'persona',
  'memory',
  'feedback',
  'deliver',
  'delivered',
  'error',
  'exception',
  'fixer',
  'nofix',
]

// Insert a bare entity spine — the eid, and nothing else. num is NOT minted
// here (T-3684): it is a kind-driven UI label, and this fires at FIRST-TOUCH,
// before any component says what KIND the entity is. mintNum() assigns it
// once the components land (apply()'s late pass, seed(), addressEntity()), or
// leaves it NULL for a numberless kind. No kind column: an entity is what its
// components make it. Birth time is the `created` component's business
// (T-6670), stamped by apply() from the batch's one clock — not taken here.
let spine = (db: DatabaseSync, eid: string) =>
  db.prepare('insert or ignore into entity (eid) values (?)').run(eid)

// The kinds that get a human number. The exclusion is EMPTY today, so every
// kind is numbered and part 1 changes nothing about WHICH entities get a num
// (T-3684). Cheap/bulk kinds — log lines, lazy-partition rows (T-3683) — join
// `unnumbered` as they arrive, and only then does a NULL num appear.
let unnumbered = new Set(['entry'])
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
  if (unnumbered.size) {
    let kind = kindOrder.find((k) =>
      db.prepare(`select 1 from ${k} where eid = ?`).get(eid)
    ) ?? 'entity'
    if (!numbered(kind)) {
      return
    }
  }
  let { n } = db.prepare(
    `select coalesce(max(num), 0) + 1 as n from
       (select num from entity union all select num from tombstone)`,
  ).get() as { n: number }
  db.prepare('update entity set num = ? where eid = ? and num is null')
    .run(n, eid)
}

// Mint a bare entity; components hang off the returned eid.
let ent = (db: DatabaseSync) => {
  let eid = crypto.randomUUID()
  spine(db, eid)
  return eid
}

let doc = (db: DatabaseSync, eid: string, title: string, body = '') =>
  db.prepare('insert into doc (eid, title, body) values (?, ?, ?)')
    .run(eid, title, body)

let addTask = (db: DatabaseSync, title: string, status: string, body = '') => {
  let eid = ent(db)
  doc(db, eid, title, body)
  db.prepare('insert into task (eid, status) values (?, ?)').run(eid, status)
  return eid
}

let addProject = (db: DatabaseSync, title: string) => {
  let eid = ent(db)
  doc(db, eid, title)
  db.prepare('insert into project (eid) values (?)').run(eid)
  return eid
}

let addBoard = (db: DatabaseSync, title: string) => {
  let eid = ent(db)
  doc(db, eid, title)
  db.prepare('insert into board (eid) values (?)').run(eid)
  return eid
}

// A card views one entity through one lens; pinning places it on a canvas.
let addCard = (db: DatabaseSync, target: string, view: string) => {
  let eid = ent(db)
  db.prepare('insert into card (eid, target, view) values (?, ?, ?)')
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
  db.prepare(
    'insert into pin (eid, canvas, x, y, w, h) values (?, ?, ?, ?, ?, ?)',
  ).run(card, canvas, x, y, w, h)

let link = (db: DatabaseSync, parent: string, type: string, child: string) =>
  db.prepare(
    'insert into dependency (parent, type, child) values (?, ?, ?)',
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
  db.prepare('update task set project = ?').run(proj)

  let canvas = ent(db)
  db.prepare('insert into canvas (eid) values (?)').run(canvas)
  pin(db, canvas, addCard(db, board, 'Board'), 0, 0, 640, 0)
  pin(db, canvas, addCard(db, view, 'Full'), 664, 0, 320, 0)
  // These direct inserts bypass apply()'s late mint pass, so number the demo
  // entities now their components exist — in creation (rowid) order, so the
  // ids read 1, 2, 3… exactly as spine() used to hand them out (T-3684).
  for (
    let { eid } of db.prepare(
      'select eid from entity where num is null order by rowid',
    ).all() as { eid: string }[]
  ) mintNum(db, eid)
}

// A baked constraint can't be changed in place: rebuild the table around
// its current ddl, rows copied whole (column ORDER must match — additive
// columns always append, so a ddl listing them in shipping order does).
// Does this table still carry that column? The one question both schema
// guards ask, and the gate on every backfill that reads a retired column:
// once the drop lands, the read that fed it must stop compiling away.
export let hasCol = (db: DatabaseSync, table: string, col: string) =>
  (db.prepare(`select name from pragma_table_info('${table}')`)
    .all() as { name: string }[]).some((c) => c.name == col)

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
    ? db.prepare('select eid, query from board where query is not null')
      .all() as {
        eid: string
        query: string
      }[]
    : []
  let staleBoards = boards.map((r) => ({ ...r, next: renameFilter(r.query) }))
    .filter((r) => r.next != r.query)
  let kinds = ['memory', 'persona'].filter((table) => hasCol(db, table, 'eid'))
  let teachings = hasCol(db, 'doc', 'body') && kinds.length
    ? db.prepare(
      `select eid, title, body from doc where ${
        kinds.map((table) =>
          `exists (select 1 from ${table} where ${table}.eid = doc.eid)`
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
  db.exec('begin')
  try {
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
    let writeBoard = db.prepare('update board set query = ? where eid = ?')
    for (let r of staleBoards) writeBoard.run(r.next, r.eid)
    let writeDoc = db.prepare(
      'update doc set title = ?, body = ? where eid = ?',
    )
    for (let r of staleDocs) writeDoc.run(r.nextTitle, r.nextBody, r.eid)
    db.exec('commit')
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}

// Journal bytes are audit history, so the migration never rewrites them. A
// reader translates former active keys at the boundary, keeping history and
// replay on the vocabulary spoken by this process.
let canonicalChanges = (changes: Change[]): Change[] => {
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
  (db.prepare(
    `select sql from sqlite_master where type = 'table' and name = ?`,
  ).get(name) as { sql: string } | undefined)?.sql
let rebuild = (db: DatabaseSync, name: string, ddl: string) => {
  db.exec('begin')
  db.exec(`alter table ${name} rename to ${name}_stale`)
  db.exec(ddl)
  db.exec(`insert into ${name} select * from ${name}_stale`)
  db.exec(`drop table ${name}_stale`)
  db.exec('commit')
}

// mail.target shipped wearing an FK to entity(eid) — but it's a
// death-'keep' column, and tombstoning deletes the spine row, so the
// kept reference vetoed the whole delete batch (T-4593). Rebuild around
// the FK-free ddl; no-ops once healed. Exported as the migration's seam.
export let mendMail = (db: DatabaseSync) => {
  if (ddlOf(db, 'mail')?.includes('target text references')) {
    rebuild(db, 'mail', mailDdl)
  }
}

// The same shape for tool_call's source list: a row the CHECK doesn't know
// is dropped with a warning, and record() is by contract silent about its
// own failures — so an unwidened live table would swallow the very reports
// nobody else makes. No-ops once healed.
export let mendCalls = (db: DatabaseSync) => {
  if (!ddlOf(db, 'tool_call')?.includes("'srv'")) {
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
  db.exec('begin')
  try {
    db.exec('update apply set change = json_array(json(change))')
    db.exec('alter table apply rename column change to changes')
    db.exec('commit')
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}

// The read→opened migration (T-7006): seed `opened` from every letter the
// old mail.read_at column already marked read. `insert or ignore` on the pk
// is idempotent, so a re-boot never moves an existing stamp. A no-op once
// the column is gone — the stamp has been the only read-state since.
export let backfillOpened = (db: DatabaseSync) => {
  if (!hasCol(db, 'mail', 'read_at')) return
  db.exec(
    `insert or ignore into opened (eid, at)
       select eid, read_at from mail where read_at is not null`,
  )
}

// Lift component-specific instruments into the universal register once
// (T-7113). Each half is guarded on its own source column: the register is
// the only home, and these reads are the last thing the columns are for.
export let backfillVia = (db: DatabaseSync) => {
  if (hasCol(db, 'comment', 'author_eid')) {
    db.exec(
      `update created set via = (
         select author_eid from comment where comment.eid = created.eid
       )
       where via is null and exists (
         select 1 from comment
         where comment.eid = created.eid and author_eid is not null
       )`,
    )
  }
  if (hasCol(db, 'memory', 'source_eid')) {
    db.exec(
      `update created set via = (
         select source_eid from memory where memory.eid = created.eid
       )
       where via is null and exists (
         select 1 from memory
         where memory.eid = created.eid and source_eid is not null
       )`,
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
export let retireMemoryType = (db: DatabaseSync) => {
  if (!hasCol(db, 'memory', 'type')) return
  db.exec(
    `insert or ignore into feedback (eid)
       select eid from memory where type = 'feedback'`,
  )
  db.exec('alter table memory drop column type')
}

// task.proposal → the universal proposal stamp. The old boolean had no
// provenance of its own, so its filing stamp is the only authored fact it can
// preserve. The board rewrite is independently guarded: a database interrupted
// between old deployments may have lost the column while retaining its query.
export let retireProposal = (db: DatabaseSync) => {
  let legacy = hasCol(db, 'task', 'proposal')
  let stale = db.prepare(
    "select 1 from board where instr(query, '.proposal=true') > 0 limit 1",
  ).get()
  if (!legacy && !stale) return
  db.exec('begin')
  try {
    if (legacy) {
      db.exec(`
        insert or ignore into proposed (eid, at, "by", via)
        select t.eid,
          coalesce(c.at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          c."by", c.via
        from task t left join created c on c.eid = t.eid
        where t.proposal != 0
      `)
    }
    db.exec(`update board
      set query = replace(query, '.proposal=true', '.proposed~=')
      where instr(query, '.proposal=true') > 0`)
    if (legacy) db.exec('alter table task drop column proposal')
    db.exec('commit')
  } catch (e) {
    db.exec('rollback')
    throw e
  }
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
  let boards = db.prepare(
    'select eid, query from board where query is not null',
  )
    .all() as { eid: string; query: string }[]
  let stale = boards.map((r) => ({ ...r, next: retireFilter(r.query) }))
    .filter((r) => r.next != r.query)
  if (!legacy && !stale.length) return
  db.exec('begin')
  try {
    if (legacy) {
      db.exec(`insert or ignore into archived (eid, at)
        select eid, retired_at from project where retired_at is not null`)
    }
    let write = db.prepare('update board set query = ? where eid = ?')
    for (let r of stale) write.run(r.next, r.eid)
    if (legacy) db.exec('alter table project drop column retired_at')
    db.exec('commit')
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}

// Give every session its canonical launch facet before graph-out can observe
// the handle, then mirror canonical values back for a rollback process. An
// existing canonical row wins — including explicit null — on every open.
export let backfillSpawn = (db: DatabaseSync) => {
  let cols = ['provider', 'model', 'effort', 'persona']
  db.exec('begin')
  try {
    db.exec(
      `insert or ignore into spawn (eid, provider, model, effort, persona)
         select eid, provider, model, effort, persona from session`,
    )
    db.exec(
      `update session set ${
        cols.map((col) =>
          `${sqlName(col)} = (select ${sqlName(col)} from spawn
            where spawn.eid = session.eid)`
        ).join(', ')
      } where exists (select 1 from spawn where spawn.eid = session.eid)`,
    )
    let different = cols.map((col) =>
      `s.${sqlName(col)} is not p.${sqlName(col)}`
    ).join(' or ')
    let missed = db.prepare(`
      select 1 from session s join spawn p on p.eid = s.eid
      where ${different} limit 1
    `).get()
    if (missed) throw new Error('spawn backfill did not verify')
    db.exec('commit')
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}

// Lift the execution axes without inventing facets for sessions that never
// carried either one. An existing canonical row wins — including its nulls —
// so an interrupted rolling deploy can never revive a cleared legacy alias.
export let backfillSessionFacets = (db: DatabaseSync) => {
  db.exec('begin')
  try {
    db.exec(`
      insert or ignore into worktree (eid, cwd, branch, base_revision)
      select eid, cwd, branch, base_revision from session
      where cwd is not null or branch is not null or base_revision is not null
    `)
    db.exec(`
      insert or ignore into runtime (
        eid, pid, pane, transcript, provider_session_id, serving_model
      )
      select eid, pid, pane, transcript, provider_session_id, serving_model
      from session
      where pid is not null or pane is not null or transcript is not null
        or provider_session_id is not null or serving_model is not null
    `)
    let facets = {
      worktree: ['cwd', 'branch', 'base_revision'],
      runtime: [
        'pid',
        'pane',
        'transcript',
        'provider_session_id',
        'serving_model',
      ],
    }
    for (let [table, cols] of Object.entries(facets)) {
      db.exec(
        `update session set ${
          cols.map((col) =>
            `${sqlName(col)} = (select ${sqlName(col)} from ${table}
            where ${table}.eid = session.eid)`
          ).join(', ')
        } where exists (select 1 from ${table} where ${table}.eid = session.eid)`,
      )
      let different = cols.map((col) =>
        `s.${sqlName(col)} is not f.${sqlName(col)}`
      ).join(' or ')
      let missed = db.prepare(`
        select 1 from session s join ${table} f on f.eid = s.eid
        where ${different} limit 1
      `).get()
      if (missed) throw new Error(`${table} backfill did not verify`)
    }
    db.exec('commit')
  } catch (e) {
    db.exec('rollback')
    throw e
  }
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
  db.exec('begin')
  try {
    for (let table of tables) {
      db.exec(
        `insert into error (eid, at, message)
           select eid, ${at[table]}, error from ${table}
           where error is not null
         on conflict(eid) do update set
           at = coalesce(excluded.at, error.at),
           message = excluded.message`,
      )
    }
    for (let table of tables) {
      let missed = db.prepare(
        `select 1 from ${table} source
         left join error target on target.eid = source.eid
         where source.error is not null
           and target.message is not source.error limit 1`,
      ).get()
      if (missed) throw new Error(`${table} error migration did not verify`)
    }
    for (let table of tables) db.exec(`alter table ${table} drop column error`)
    db.exec('commit')
  } catch (e) {
    db.exec('rollback')
    throw e
  }
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
      `insert or ignore into delivered (eid, at, via)
         select eid, acted_at, ${via} from ${table}
         where acted_at is not null` +
        (hasCol(db, table, 'error') ? ` and error is null` : ``),
    )
    if (hasCol(db, table, 'error')) {
      db.exec(
        `insert or ignore into error (eid, at, message)
           select eid, acted_at, error from ${table} where error is not null`,
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
    (db.prepare('select eid from entity where num = ?').get(n) as
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
    return (db.prepare('select eid from entity where eid = ?').get(low) as
      | { eid: string }
      | undefined)?.eid
  }
  if (SHORT.test(id)) {
    let hits = db.prepare(
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
  return (db.prepare(
    `select eid from alias where slug = ?
       or instr(' ' || coalesce(slugs, '') || ' ', ' ' || ? || ' ') > 0`,
  ).get(id, id) as
    | { eid: string }
    | undefined)?.eid
}

// The write doors' reference resolver — resolveId under its old name, kept
// because the boot migration and apply()'s normalize both reach for it.
let ident = resolveId

// ident's inverse: eid → the human id every other door speaks (T-7) — the
// raw eid when there is none to speak. Every agent-facing message owes
// this. Inputs accept both spellings; outputs speak human, or a caller
// that typed `M-10276` is handed back an identifier it has no index for,
// at the one moment (a refusal) it most wants to open the entity.
// A tombstone keeps its num but not its components, so its kind — and
// with it the prefix — died with them: it stays the raw eid rather than
// wear a guessed one.
export let human = (db: DatabaseSync, eid: string): string => {
  let row = db.prepare('select num from entity where eid = ?').get(eid) as
    | { num: number }
    | undefined
  if (!row?.num) return shortId(eid)
  let kind =
    kindOrder.find((k) =>
      db.prepare(`select 1 from ${k} where eid = ?`).get(eid)
    ) ?? 'entity'
  return idOf({ eid, kind, num: row.num })
}

let ADDR = /@/
let UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The entity already wearing this address: an address-book `email`, or an
// id-shaped fleet address naming one by its human id (S-31@<fleet> → that
// session). Mirrors mail.ts wearer()/named() — inlined because mail.ts imports
// db.ts, and this is the pre-mint half of the same resolution: an address the
// graph already knows must NOT get a second entity minted for it (that would
// SHADOW the real one in homeOf).
let addressed = (db: DatabaseSync, addr: string): string | undefined => {
  let a = addr.trim()
  let worn =
    (db.prepare('select eid from email where address = ? collate nocase')
      .get(a) as { eid: string } | undefined)?.eid
  if (worn) return worn
  let m = /^([A-Za-z]+-(\d+))$/i.exec(fleetLocal(a) ?? '')
  if (!m) return undefined
  let row = db.prepare('select eid from entity where num = ?')
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
  let found = addressed(db, addr)
  if (found) return found
  let a = addr.trim()
  let eid = uuid()
  spine(db, eid)
  db.prepare('insert into email (eid, address) values (?, ?)').run(eid, a)
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
  let ins = db.prepare(
    'insert or ignore into deliver (eid, "to") values (?, ?)',
  )
  for (let table of ['knock', 'wake']) {
    if (!hasCol(db, table, 'to_eid')) continue
    db.exec(
      `insert or ignore into deliver (eid, "to")
         select eid, to_eid from ${table} where to_eid is not null`,
    )
    db.exec(`alter table ${table} drop column to_eid`)
  }
  if (hasCol(db, 'mail', 'to')) {
    let rows = db.prepare(
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
          db.prepare('update mail set to_addr = ? where eid = ?')
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
  let rows = db.prepare(
    `select m.eid, em.address from mail m
       join deliver d on d.eid = m.eid
       join email em on em.eid = d."to"
     where m.received_at is not null and m.sent_id is null
       and (m.to_addr is null or m.to_addr = '')`,
  ).all() as { eid: string; address: string }[]
  for (let { eid, address } of rows) {
    db.prepare('update mail set to_addr = ? where eid = ?').run(address, eid)
    db.prepare('delete from deliver where eid = ?').run(eid)
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
    let a = addr.trim()
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
    let info = db.prepare(
      'select name, "notnull" as required from pragma_table_info(?)',
    ).all(table) as { name: string; required: number }[]
    for (let [col] of Object.entries(declared)) {
      let required = info.find((c) => c.name == col)?.required
      let prop = propAt(table, col)
      if (!prop || required == null) {
        throw new Error(`declared column missing: ${table}.${col}`)
      }
      let rows = db.prepare(
        `select eid, ${sqlName(col)} as value from ${sqlName(table)}
         where ${sqlName(col)} is not null`,
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
  db.exec('begin')
  try {
    for (let fix of fixes) {
      db.prepare(
        `update ${sqlName(fix.table)} set ${
          sqlName(fix.col)
        } = ? where eid = ?`,
      ).run(fix.value, fix.eid)
    }
    db.exec('commit')
  } catch (e) {
    db.exec('rollback')
    throw e
  }
  return { changed: fixes.length, invalid }
}

// Open the file, migrate it in place, plant missing schema, and seed once if
// the graph is empty. Returns a live handle held for the process lifetime.
export let open = (path = file) => {
  // A test must NEVER open the owner's live graph. Under `deno test` the main
  // module is always a *_test.ts file; reaching the live path there means a
  // caller forgot DB_PATH (the `test` task sets :memory:). Refuse before we
  // mkdir/migrate/lock it — loudly, so the next module-scope import that would
  // reintroduce this footgun fails at the door instead of quietly reseeding
  // the owner's board (T-14260).
  if (
    Deno.mainModule.endsWith('_test.ts') &&
    resolve(path) === resolve(liveDb())
  ) {
    throw new Error(
      `refusing to open the live graph (${path}) under a test — set DB_PATH`,
    )
  }
  Deno.mkdirSync(dirname(path), { recursive: true })
  let db = new DatabaseSync(path)
  // Listener handoff overlaps two server processes. SQLite serializes their
  // brief boot/write collision; waiting keeps a mutation on its accepting
  // process instead of making the caller guess whether to replay it.
  db.exec('pragma busy_timeout = 5000')
  // Durability is tunable for throwaway graphs (TASKS_SYNC, like TASKS_BACKOFF):
  // the default (unset) leaves SQLite's own `full`, which fsyncs every DDL
  // statement — and open() runs ~200 of them (schema + migrations), so a
  // fresh file on real disk costs ~2s. A test graph is ephemeral and never
  // survives a crash, so the test task sets `off` and every file-backed open
  // drops from ~2s to ~10ms. Production never sets it and stays fully durable.
  let sync = Deno.env.get('TASKS_SYNC')
  if (sync) db.exec(`pragma synchronous = ${sync}`)
  // This must precede schema: an old table may not yet have the canonical
  // columns named by a newly added index in the current DDL.
  migrateRefs(db)
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
  for (let comp of derived) for (let ix of indexDdl(comp)) db.exec(ix + ';')
  // num is a UI label, not identity (T-3684): a cheap/bulk entity (T-3683)
  // needs none, so the spine's num goes NULLABLE. One in-place ALTER on SQLite
  // 3.53+ (ALTER COLUMN landed in 3.53.0), guarded on the notnull flag so it
  // runs once. UNIQUE stays — SQLite treats NULLs as distinct, so num-less
  // entities coexist. No rebuild, no backfill: existing nums are untouched.
  if (
    (db.prepare(
      `select "notnull" as nn from pragma_table_info('entity') where name = 'num'`,
    ).get() as { nn: number } | undefined)?.nn
  ) {
    db.exec('alter table entity alter column num drop not null')
  }
  // Retired by the per-comment `notified` stamp, which is per item and so
  // cannot advance past an unserved sibling the way a cursor could.
  dropCol('session', 'acked_at')
  addCol('task', 'project', 'project text references entity(eid)')
  addCol('task', 'assignee', 'assignee text references entity(eid)')
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
  // The crash-loop breaker's fresh-start fence (types.ts, src/roles.ts).
  addCol('role', 'retry_at', 'retry_at text')
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
  addCol('session', 'parent', 'parent text references entity(eid)')
  for (let table of ['created', 'updated', 'notified', 'opened', 'archived']) {
    addCol(table, 'via', 'via text')
  }
  addCol('journal', 'via', 'via text')
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
      'persona text',
      'requested_task text',
      'role text',
      'branch text',
      'base_revision text',
      'status text',
      'provider_session_id text',
      'serving_model text',
      'latest_seq integer not null default 0',
      'started_at text',
      'stop_requested_at text',
      'input_at text',
      'finished_at text',
      'exit_code integer',
      'stop_reason text',
      'final_text text',
      'usage_json text',
    ]
  ) addCol('session', ddl.split(' ')[0], ddl)
  backfillSpawn(db)
  backfillSessionFacets(db)
  // The identity chain (types.ts): instruments point at who they act for.
  addCol('client', 'actor', 'actor text references entity(eid)')
  // Inbound provenance (inbound.ts): the fleet sweep's idempotency key
  // (and the never-send mark), arrival time, and the edge's DKIM verdict
  // — see stamped.mail in types.ts.
  addCol('mail', 'message_id', 'message_id text')
  addCol('mail', 'received_at', 'received_at text')
  addCol('mail', 'verified', 'verified integer')
  // Threading (mail.ts): the mail this one answers — no FK, like
  // target (death 'keep' + tombstoned spines veto FK'd deletes,
  // T-4593). sent_id is the sender-assigned Message-ID, server-stamped.
  addCol('mail', 'reply_to', 'reply_to text')
  addCol('mail', 'sent_id', 'sent_id text')
  addCol('mail', 'in_reply_to', 'in_reply_to text')
  addCol('session', 'actor', 'actor text references entity(eid)')
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
  // The per-type delivery receipts become the shared delivered/error
  // components, and the per-type recipient columns the shared deliver.to.
  // Both before mendMail: a mail rebuild must see the trimmed shape.
  migrateErrors(db)
  migrateDelivery(db)
  migrateDeliver(db)
  mendMail(db)
  // Mend the inbound letters an earlier migrateDeliver stranded in deliver{to}
  // (T-15110). After mendMail so it reads the rebuilt mail table.
  healInboundDeliver(db)
  mendCalls(db)
  mendApply(db)
  // A mail was briefly a 'send_request' (the intent idiom over-applied —
  // the artifact deserved its name). Adopt the old table's rows once;
  // `create if not exists mail` above already made the empty successor,
  // so copy across and drop the stale name.
  let sr = db.prepare(
    `select 1 from sqlite_master where type = 'table' and name = 'send_request'`,
  ).get()
  if (sr) {
    db.exec('begin')
    db.exec('insert into mail select * from send_request')
    db.exec('drop table send_request')
    db.exec('commit')
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
    (db.prepare(`select count(*) as n from ${t}`).get() as { n: number }).n
  let sound = (t: string) => {
    try {
      db.exec(`insert into ${t} (${t}, rank) values ('integrity-check', 1)`)
      return count(t) == count('doc')
    } catch {
      return false
    }
  }
  for (let t of ['doc_fts', 'doc_gram']) {
    if (!sound(t)) db.exec(`insert into ${t} (${t}) values ('rebuild')`)
  }
  let { n } = db.prepare('select count(*) as n from task').get() as {
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
  healStored(db)
  return db
}

// The one live handle — the server shares it for the process lifetime.
export let db = open()

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

let edgeCols = ['type', 'child', 'gone']

// What the SCHEMA has, as opposed to what the wire may write — the
// authority for telling a name that EXISTS from a name that doesn't.
// Memoized per table; an empty set means no such table.
let stored: Record<string, Set<string>> = {}
let columnsOf = (table: string): Set<string> =>
  stored[table] ??= new Set(
    (db.prepare('select name from pragma_table_info(?)').all(table) as {
      name: string
    }[]).map((c) => c.name),
  )

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
let admitted = (change: Change): Change | undefined => {
  let table = change.name
  let cols = table == 'dependency' ? edgeCols : cmps[table]
  if (!cols) return
  // These component rows are outcomes minted by the runner. Empty writable
  // declarations keep them in generic read/delete machinery, but never grant
  // the wire authority to create, patch, or remove one. `imported` is the
  // ingest coordinate — server-stamped through apply()'s `imports` path in
  // the same transaction as its entry (D-16704), refused here so no wire
  // client can pre-stamp a coordinate and poison the ingester's dedup.
  if (table == 'lease' || table == 'usage' || table == 'imported') return
  if (change.comp == null) return change
  let sent = Object.entries(change.comp)
  let real = columnsOf(table)
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
      db.prepare('select 1 from session where eid = ?').get(eid)
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
      db.prepare('select 1 from session where eid = ?').get(eid)
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
    let current = db.prepare(
      `select ${cols.map(sqlName).join(', ')} from ${sqlName(name)}
       where eid = ?`,
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
      if (!db.prepare('select 1 from session where eid = ?').get(eid)) continue
      let row = db.prepare(
        `select ${cols.map(sqlName).join(', ')} from ${sqlName(name)}
         where eid = ?`,
      ).get(eid) as Record<string, unknown> | undefined
      let spec = row ?? Object.fromEntries(cols.map((col) => [col, null]))
      db.prepare(
        `update session set ${
          cols.map((col) => `${sqlName(col)} = ?`).join(', ')
        }
         where eid = ?`,
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

let select = (name: string) =>
  `select ${readable[name].map(sqlName).join(', ')} from ${sqlName(name)}`

let bound = (
  name: string,
  col: string,
  value: unknown,
): string | number | null =>
  comps[name]?.[col] == 'bool' && typeof value == 'boolean'
    ? Number(value)
    : value as string | number | null

// The stamp family (notified/opened/archived/decided/proposed): a
// client-requested act
// the server signs, whose WHOLE component is one {at, by, via} stamp. That
// shape is the discriminator — derived, not hand-listed, so a new stamp joins
// with zero edits — and `recall` (stamped {count…}, no at) and `conflict` (no
// by: a server-minted audit, never wire-created) fall out on it.
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
    !comps[c].via && stamped[c]?.via && all.at && all.by &&
    Object.keys(all).length == 3
})

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
  let bad = (db.prepare(
    `select "from" as col, "table" as t, coalesce("to", 'eid') as pk
     from pragma_foreign_key_list(?)`,
  ).all(name) as { col: string; t: string; pk: string }[])
    .filter((f) =>
      given[f.col] != null &&
      !db.prepare(`select 1 from ${f.t} where ${f.pk} = ?`).get(
        given[f.col] as string,
      )
    )
    .map((f) =>
      `${f.col} → ${human(db, given[f.col] as string)} (${
        db.prepare('select 1 from tombstone where eid = ?')
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

let refRefused = (
  db: DatabaseSync,
  ref: Ref,
  eid?: string,
  target?: string,
) => {
  let to = ref.target // always a specific component table (refs excludes 'entity')
  let args: string[] = []
  if (eid) args.push(eid)
  if (target) args.push(target)
  let bad = db.prepare(`
    select r.eid, r."${ref.col}" as target
    from ${ref.name} r
    left join ${to} t on t.eid = r."${ref.col}"
    where r."${ref.col}" is not null and t.eid is null
      ${eid ? 'and r.eid = ?' : ''}
      ${target ? `and r."${ref.col}" = ?` : ''}
    limit 1
  `).get(...args) as
    | { eid: string; target: string }
    | undefined
  if (!bad) return null
  let gone = db.prepare('select 1 from tombstone where eid = ?')
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
  let people = db.prepare('select eid from person').all() as { eid: string }[]
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
  let repos = db.prepare('select eid, path from repo').all() as {
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

// The actor a write acts FOR, resolved from the writer the door named — a
// session id (the CLI's x-via, a reified agent), a client eid (a browser
// tab), or nothing. A session speaks as its own actor, else the venture it
// stands in; a client as its person. Never the raw label the journal used
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
  let s = db.prepare(
    'select cwd, actor from session where id = ? or eid = ?',
  ).get(writer, writer) as
    | { cwd: string | null; actor: string | null }
    | undefined
  if (s) return s.actor ?? ventureAt(db, s.cwd) ?? null
  let c = db.prepare('select actor from client where eid = ?')
    .get(writer) as { actor: string | null } | undefined
  if (c) return c.actor ?? (human ? ownerActor(db) : null)
  // A writer naming an actor entity (person or project) directly stands
  // for itself — the CLI's own operator eid, or a hand-set x-via.
  let a = db.prepare(
    'select eid from person where eid = ? union select eid from project where eid = ?',
  ).get(writer, writer) as { eid: string } | undefined
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
  let s = db.prepare('select eid from session where id = ? or eid = ?')
    .get(writer, writer) as { eid: string } | undefined
  if (s) return s.eid
  let c = db.prepare('select eid from client where eid = ?')
    .get(writer) as { eid: string } | undefined
  if (c) return c.eid
  let r = db.prepare('select eid from runner where eid = ?')
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

// An actor has one cadence clock: minting its next untargeted wake removes
// every pending predecessor in the same transaction. A target makes a wake a
// reminder about that entity, so those stay independent of the cadence and of
// one another. The rule lives at apply(), where concurrent doors serialize;
// command-side replacement would let two stale snapshots both survive.
let replaceWakes = (db: DatabaseSync, changes: Change[]): Change[] => {
  let exists = db.prepare('select 1 from wake where eid = ?')
  // Unacted = neither outcome component present (D-14945); the wake's own
  // receipt columns moved to the shared delivered/error tables. The recipient
  // moved too — to the `deliver {to}` facet, joined here and named in the same
  // batch, since a fresh self-wake always mints its deliver alongside.
  let pending = db.prepare(`
    select wake.eid from wake join deliver on deliver.eid = wake.eid
    where deliver."to" = ? and wake.target is null and wake.eid != ?
      and not exists (select 1 from delivered where delivered.eid = wake.eid)
      and not exists (select 1 from error where error.eid = wake.eid)
  `)
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
  changes = normalizeChanges(changes, {
    now: Date.now(),
    resolve: (id) => ident(db, id),
  }).flatMap((change) => {
    let kept = admitted(change)
    return kept ? [kept] : []
  })
  let dead = db.prepare('select 1 from tombstone where eid = ?')
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
  let took = (eid: string, name: string) =>
    t?.removed.set(eid, [...(t.removed.get(eid) ?? []), name])
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
    changes = replaceWakes(db, changes)
    changes = dualSpawn(db, changes)
    changes = dualFacet(db, changes, 'worktree')
    changes = dualFacet(db, changes, 'runtime')
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
    let existed = db.prepare('select 1 from entry where eid = ?')
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
        // Both spines checked HERE for the friendlier message (node:sqlite
        // enforces FKs by default, but its bounce names no column): an
        // edge may only join entities that exist.
        let spines = db.prepare(
          'select count(*) as n from entity where eid in (?, ?)',
        ).get(eid, String(comp.child)) as { n: number }
        if (spines.n != 2) {
          console.warn(`sync: edge for ${eid} dropped — missing endpoint`)
          continue
        }
        db.exec('savepoint change')
        try {
          if (comp.gone) {
            db.prepare(`
              delete from dependency
              where parent = ? and type = ? and child = ?
            `).run(eid, String(comp.type), String(comp.child))
          } else {
            db.prepare(`
              insert or ignore into dependency (parent, type, child)
              values (?, ?, ?)
            `).run(eid, String(comp.type), String(comp.child))
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
        let row = db.prepare(
          `select * from ${sqlName(name)} where eid = ?`,
        ).get(eid) as
          | Record<string, unknown>
          | undefined
        let real = columnsOf(name)
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
        let cur = db.prepare(`
          select c.session, s.id from claim c
          left join session s on s.eid = c.session
          where c.eid = ?
        `).get(eid) as { session: string; id: string | null } | undefined
        if (cur && cur.session != comp.session) {
          let loser = db.prepare('select id from session where eid = ?')
            .get(String(comp.session)) as { id: string } | undefined
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
      }
      // A stop_request is a lever, not a note: it may only be pulled on a
      // managed session that is still going — anything else is refused
      // loudly, like a bounced claim. (The stop itself is an EFFECT,
      // post-commit; this gate is the rule half.)
      if (name == 'stop_request' && comp?.target) {
        let s = db.prepare('select origin, status from session where eid = ?')
          .get(String(comp.target)) as
            | { origin: string; status: string | null }
            | undefined
        let graph = !!db.prepare(
          `select 1 from entry e where e.session = ? and (
             exists (select 1 from lease l where l.eid = e.eid)
             or (
               not exists (select 1 from imported i where i.eid = e.eid)
               and not exists (select 1 from error x where x.eid = e.eid)
               and not exists (select 1 from cancel z where z.target = e.eid)
               and (
                 (exists (select 1 from generation g where g.eid = e.eid)
                  and not exists (
                    select 1 from delivered d where d.eid = e.eid
                  ))
                 or
                 (exists (select 1 from call c where c.eid = e.eid)
                  and not exists (
                    select 1 from result r where r.call = e.eid
                  ))
               )
             )
           ) limit 1`,
        ).get(String(comp.target))
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
        let cur = db.prepare('select slug, slugs from alias where eid = ?')
          .get(eid) as { slug: string; slugs: string | null } | undefined
        let slug = (comp.slug ?? cur?.slug ?? null) as string | null
        let extra = (comp.slugs !== undefined ? comp.slugs : cur?.slugs) as
          | string
          | null
        let seen = new Set<string>()
        for (let s of slugsOf({ slug, slugs: extra })) {
          if (seen.has(s)) throw new Error(`alias ${s} is listed twice`)
          seen.add(s)
          let owner = db.prepare(
            `select eid from alias where eid != ? and (slug = ?
               or instr(' ' || coalesce(slugs, '') || ' ', ' ' || ? || ' ') > 0)`,
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
      // of whoever made it. Empty stays legal: it means every task.
      if (name == 'board' && comp?.query != null) {
        try {
          parseQuery(String(comp.query))
        } catch (e) {
          throw new Error(
            `board query refused: ${e instanceof Error ? e.message : e}`,
          )
        }
      }
      if (comp == null) {
        if (name != 'entity') {
          if (
            db.prepare(`delete from ${sqlName(name)} where eid = ?`).run(eid)
              .changes
          ) {
            took(eid, name)
          }
          continue
        }
        // Death spreads to entities that exist ABOUT the dead one — cards
        // viewing it, comments aimed at it, pins and cameras on a dead
        // canvas or client. The worklist walks that closure first; then
        // soft references let go (claims by a dead session, tasks of a
        // dead project); then every component row goes in reverse
        // declaration order (dependents before their referents), and only
        // then the spines — a spine can't drop while any row still aims
        // at it. Every casualty is tombstoned: nothing resurrects.
        let doomed = [eid]
        for (let i = 0; i < doomed.length; i++) {
          for (let [t, col] of AIMED) {
            let rows = db.prepare(`select eid from ${t} where ${col} = ?`)
              .all(doomed[i]) as { eid: string }[]
            for (let r of rows) {
              if (!doomed.includes(r.eid)) doomed.push(r.eid)
            }
          }
        }
        for (let d of doomed) {
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
            let freed = db.prepare(`select eid from ${t} where ${col} = ?`)
              .all(d) as { eid: string }[]
            db.prepare(`delete from ${t} where ${col} = ?`).run(d)
            for (let { eid: held } of freed) {
              if (doomed.includes(held)) continue
              took(held, t)
              touched.add(held)
              extra.push({ eid: held, name: t, comp: null })
            }
          }
          for (let [t, col] of DETACHED) {
            let homed = db.prepare(`select eid from ${t} where ${col} = ?`)
              .all(d) as { eid: string }[]
            db.prepare(`update ${t} set ${col} = null where ${col} = ?`).run(d)
            for (let { eid: orphan } of homed) {
              if (doomed.includes(orphan)) continue
              touched.add(orphan)
              extra.push({ eid: orphan, name: t, comp: { [col]: null } })
            }
          }
          for (let c of Object.keys(cmps).toReversed()) {
            if (c != 'entity') {
              if (db.prepare(`delete from ${c} where eid = ?`).run(d).changes) {
                took(d, c)
              }
            }
          }
          db.prepare(
            'delete from dependency where parent = ? or child = ?',
          ).run(d, d)
        }
        for (let d of doomed) {
          db.prepare(
            // The num rides into the grave: a dead entity keeps its name
            // answerable, and the allocator's high-water mark survives it.
            `insert or ignore into tombstone (eid, num, deleted_at)
             values (?, (select num from entity where eid = ?), ?)`,
          ).run(d, d, new Date().toISOString())
          db.prepare('delete from entity where eid = ?').run(d)
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
      let vals = sent.map((c) => bound(name, c, comp[c]))
      // Update first (a patch can't re-satisfy not-null columns an insert
      // would demand). An existing row implies an existing spine. An FK
      // bounce here fails the batch with its offender named — the outer
      // catch rolls everything back, like the claim lease.
      let hit: number | bigint = 0
      if (sent.length) {
        try {
          hit = db.prepare(
            `update ${sqlName(name)} set ${
              sent.map((c) => `${sqlName(c)} = ?`).join(', ')
            }
             where eid = ?`,
          ).run(...vals, eid).changes
        } catch (e) {
          throw refused(db, name, eid, comp, e) ?? e
        }
      }
      if (hit) continue
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
          let { seq } = db.prepare(
            `select coalesce(max(seq), 0) + 1 as seq from entry
             where session = ?`,
          ).get(session) as { seq: number }
          db.prepare(
            'insert into entry (eid, session, seq) values (?, ?, ?)',
          ).run(eid, session, seq)
          // A graph-native session has no log FILE to tail, so its summary
          // is advanced here at the single door that assigns seq — same
          // transaction, so entry.seq and session.latest_seq cannot drift.
          // Not cast (like the JSONL tail, T-7063): it rides the snapshot's
          // whole-row select, not a per-entry broadcast.
          db.prepare('update session set latest_seq = ? where eid = ?')
            .run(seq, session)
          createdComps.add(`${name} ${eid}`)
          t?.created.add(`${name} ${eid}`)
          extra.push({ eid, name: 'entry', comp: { eid, seq } })
        } else if (sent.length) {
          db.prepare(
            `insert into ${sqlName(name)} (eid${
              sent.map((c) => `, ${sqlName(c)}`).join('')
            })
             values (?${', ?'.repeat(sent.length)})`,
          ).run(eid, ...vals)
          createdComps.add(`${name} ${eid}`)
          t?.created.add(`${name} ${eid}`)
        } else {
          // A bare {} touch: create with defaults if possible, else no-op.
          let made = db.prepare(
            `insert or ignore into ${sqlName(name)} (eid) values (?)`,
          ).run(eid).changes
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
    let request = db.prepare(
      'select requested_task from session where eid = ?',
    )
    let pending = db.prepare(`
      select 1 from proposed p
      left join decided d on d.eid = p.eid
      where p.eid = ? and d.eid is null
    `)
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
    // A session that RAN somewhere but names no actor gets one from where
    // it stands — the writing identity is never blank (T-6669). Resolved
    // from the session row's CURRENT cwd (not a client's stale snapshot,
    // the bug that left real sessions blank when cwd and reify split across
    // batches): the venture whose repo holds the cwd, else the box owner.
    // actor stays wire-writable — a batch that named an actor keeps it;
    // the server only fills the gap, and only for a session with a cwd (a
    // real run, never an abstract fixture), so the fill heals old blanks on
    // their next touch. It rides the return so caches hear it.
    let fill = db.prepare('update session set actor = ? where eid = ?')
    let has = db.prepare('select cwd, actor from session where eid = ?')
    for (let eid of touched) {
      let s = has.get(eid) as
        | { cwd: string | null; actor: string | null }
        | undefined
      if (!s || s.actor || !s.cwd) continue
      let a = ventureAt(db, s.cwd)
      if (a) {
        fill.run(a, eid)
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
    // savepoint) has no spine — the guard, like the births select below.
    let alive = db.prepare('select 1 from entity where eid = ?')
    let cNew = db.prepare(
      'insert or ignore into created (eid, at, "by", via) values (?, ?, ?, ?)',
    )
    let cVia = db.prepare('update created set at = ?, via = ? where eid = ?')
    let cRow = db.prepare(
      'select eid, at, "by", via from created where eid = ?',
    )
    for (let eid of minted) {
      if (!alive.get(eid)) continue
      if (saidCreator.has(eid)) cVia.run(now, via, eid)
      else cNew.run(eid, now, actor, via)
      let row = cRow.get(eid) as Change['comp'] | undefined
      if (row) extra.push({ eid, name: 'created', comp: row })
    }
    let uSet = db.prepare(
      `insert into updated (eid, at, "by", via) values (?, ?, ?, ?)
       on conflict(eid) do update set at = excluded.at, "by" = excluded."by",
       via = excluded.via`,
    )
    let uAt = db.prepare('update updated set at = ?, via = ? where eid = ?')
    let uRow = db.prepare(
      'select eid, at, "by", via from updated where eid = ?',
    )
    for (let eid of touched) {
      if (minted.has(eid) || !alive.get(eid)) continue // birth writes created
      if (saidEditor.has(eid)) uAt.run(now, via, eid)
      else uSet.run(eid, now, actor, via)
      let row = uRow.get(eid) as Change['comp'] | undefined
      if (row) extra.push({ eid, name: 'updated', comp: row })
    }
    // The ingest coordinate (D-16704), stamped beside the entry it marks so
    // the pair (entry, imported) commits atomically. Only the trusted append
    // path passes `imports`; the wire never does. It rides `extra` (not the
    // `echoed` set below), so it reaches the journal and every replaying
    // cache — the coordinate is the durable cursor and must not be lost.
    if (imports) {
      let stampImported = db.prepare(
        'insert into imported (eid, source, line) values (?, ?, ?)',
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
        db.prepare(
          `update ${name} set "by" = coalesce("by", ?), via = ? where eid = ?`,
        ).run(actor, via, eid)
      }
      let row = db.prepare(
        `select eid, at, "by", via from ${name} where eid = ?`,
      )
        .get(eid) as Change['comp'] | undefined
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
    let addrOf = db.prepare('select address from email where eid = ?')
    let sender = db.prepare('update mail set "from" = ? where eid = ?')
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
      let row = db.prepare(
        `select ${cols.map(sqlName).join(', ')} from ${sqlName(name)}
         where eid = ?`,
      ).get(eid) as Change['comp'] | undefined
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
    let born = db.prepare('select eid, num from entity where eid = ?')
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
      let echoed = new Set(['created', 'updated', ...stamps])
      let logged = [...changes, ...extra.filter((c) => !echoed.has(c.name))]
      if (logged.length) {
        db.prepare(
          'insert into journal (ts, actor, via, batch) values (?, ?, ?, ?)',
        )
          .run(
            now,
            actor, // the resolved writing actor (T-6669), same as the by-default
            via,
            JSON.stringify(logged),
          )
      }
    } catch (e) {
      console.warn('journal skipped —', e)
    }
    db.exec('commit')
    return [...changes, ...extra]
  } catch (e) {
    db.exec('rollback')
    if (bounced) {
      try {
        db.exec('begin')
        let ceid = crypto.randomUUID()
        spine(db, ceid)
        db.prepare(
          `insert into conflict (eid, target, loser, holder)
           values (?, ?, ?, ?)`,
        ).run(ceid, bounced.target, bounced.loser, bounced.holder)
        mintNum(db, ceid) // spine no longer numbers at birth (T-3684)
        db.exec('commit')
      } catch (audit) {
        db.exec('rollback')
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
  let cur = db.prepare(`
    select a.eid, d.body from alias a
    left join doc d on d.eid = a.eid
    where a.slug = 'vocabulary'
  `).get() as { eid: string; body: string | null } | undefined
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
    db.prepare('insert into journal (actor, via, batch) values (?, ?, ?)').run(
      writerActor(db, writer),
      writerVia(db, writer),
      JSON.stringify(changes),
    )
  } catch (e) {
    console.warn('journal skipped —', e)
  }
}

// A single entity's history, newest first: the journal rows that touched
// the eid, each cut down to its changes. The batch is JSON and json_each
// does the walking — v0 reads are fine at this scale; a seek index
// arrives with the lazy-partition work (T-3683) if logs outgrow it.
export type JournalEntry = {
  ts: string
  actor: string | null
  via: string | null
  changes: Change[]
}
export let journalOf = (
  db: DatabaseSync,
  eid: string,
  limit = 50,
): JournalEntry[] =>
  (db.prepare(`
    select distinct j.rowid, j.ts, j.actor, j.via, j.batch
    from journal j, json_each(j.batch) je
    where json_extract(je.value, '$.eid') = ?
    order by j.rowid desc limit ?
  `).all(eid, limit) as {
    ts: string
    actor: string | null
    via: string | null
    batch: string
  }[])
    .map((r) => ({
      ts: r.ts,
      actor: r.actor,
      via: r.via,
      changes: canonicalChanges(JSON.parse(r.batch) as Change[])
        .filter((c) => c.eid == eid),
    }))

// The same record cut by instrument instead of what: every batch a session
// or client wrote, whole (no per-eid filtering — a wrap ledger wants the
// batch's full sentence). Newest first, like journalOf.
export let journalBy = (
  db: DatabaseSync,
  via: string,
  limit = 500,
): JournalEntry[] =>
  (db.prepare(`
    select ts, actor, via, batch from journal
    where via = ? order by rowid desc limit ?
  `).all(via, limit) as {
    ts: string
    actor: string | null
    via: string | null
    batch: string
  }[])
    .map((r) => ({
      ts: r.ts,
      actor: r.actor,
      via: r.via,
      changes: canonicalChanges(JSON.parse(r.batch) as Change[]),
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
  let isEntry = db.prepare('select 1 from entry where eid = ?')
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
export let delta = (
  db: DatabaseSync,
  since: number,
): { changes: Change[]; cursor: number } => {
  let log = db.prepare(
    `select rowid, ts, actor, via, batch from journal
     where rowid > ? order by rowid`,
  ).all(since) as {
    rowid: number
    ts: string
    actor: string | null
    via: string | null
    batch: string
  }[]
  let changes: Change[] = []
  let cursor = since
  for (let r of log) {
    cursor = r.rowid
    let batch = canonicalChanges(JSON.parse(r.batch) as Change[])
    for (let c of batch) changes.push(c)
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
    for (let c of batch) {
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
  }
  return { changes: rootChanges(db, changes), cursor }
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
    if (!db.prepare('select 1 from entity where eid = ?').get(eid)) continue
    db.prepare(`
      insert into recall (eid, first_at, last_at) values (?, ?, ?)
      on conflict (eid) do update
      set count = count + 1, last_at = excluded.last_at
    `).run(eid, now, now)
    out.push({
      eid,
      name: 'recall',
      comp: db.prepare('select * from recall where eid = ?')
        .get(eid) as Change['comp'],
    })
    if (
      confirm &&
      db.prepare('update memory set last_confirmed_at = ? where eid = ?')
        .run(now, eid).changes
    ) {
      out.push({
        eid,
        name: 'memory',
        comp: db.prepare('select * from memory where eid = ?')
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
  let screen = built ? `and d.eid in (${built.sql})` : ''
  // A visible comment aimed at quarantined content is another route into the
  // same content. Keep it out before LIMIT so hidden hits cannot displace
  // visible ones.
  if (!reveal) {
    screen += ` and not exists (
      select 1 from comment c join quarantined q on q.eid = c.target
      where c.eid = d.eid
    )`
  }
  let cap = built ? 'limit ?' : ''
  let params = built?.params ?? []
  let match = preds.filter((p) => p.op == TEXT)
    .map((p) => {
      let word = p.value.replace(/\*+$/, '').replaceAll('"', '')
      return word && `"${word}"*`
    })
    .filter(Boolean).join(' ')
  if (!match && !filters.length) return []
  // Filters screen AFTER the rank, so cast a wider net before the cap.
  let rows = match
    ? db.prepare(`
      select d.eid, d.title,
        highlight(doc_fts, 0, char(1), char(2)) as title_hit,
        snippet(doc_fts, 1, char(1), char(2), '…', 10) as snip,
        e.num
      from doc_fts
      join doc d on d.rowid = doc_fts.rowid
      join entity e on e.eid = d.eid
      left join updated up on up.eid = e.eid
      left join created cr on cr.eid = e.eid
      where doc_fts match ? ${screen}
      order by bm25(doc_fts, 8.0, 1.0)
        - 2.0 / (1 + julianday('now') - julianday(coalesce(up.at, cr.at)))
        ${cap}
    `).all(match, ...params, ...(cap ? [limit] : [])) as (Omit<
      Hit,
      'kind' | 'open' | 'retired'
    >)[]
    : db.prepare(`
      select d.eid, d.title, d.title as title_hit, '' as snip, e.num
      from doc d
      join entity e on e.eid = d.eid
      left join updated up on up.eid = e.eid
      left join created cr on cr.eid = e.eid
      where 1 ${screen}
      order by coalesce(up.at, cr.at) desc ${cap}
    `).all(...params, ...(cap ? [limit] : [])) as (Omit<
      Hit,
      'kind' | 'open' | 'retired'
    >)[]
  // An address is identity, not prose. Keep textual mentions behind the
  // entity the operator named, without giving ids a second search index.
  if (addressed) {
    let direct = db.prepare(`
      select d.eid, d.title, d.title as title_hit, '' as snip, e.num
      from doc d
      join entity e on e.eid = d.eid
      where d.eid = ? ${screen}
    `).get(addressed, ...params) as
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
    let names = [
      ...new Set(filters.flatMap((p) => [
        ...owners(p.comp, p.prop),
        ...(p.at ?? []).flatMap((h) => owners(h.comp, h.prop)),
      ])),
    ]
    let get = new Map(
      names.map((c) => [c, db.prepare(`select * from ${c} where eid = ?`)]),
    )
    let compsOf = (eid: string) => {
      let comps: Record<string, Record<string, unknown> | undefined> = {}
      for (let [c, s] of get) {
        comps[c] = s.get(eid) as Record<string, unknown> | undefined
      }
      return comps
    }
    rows = rows.filter((r) => matchQuery(compsOf(r.eid), filters, compsOf))
      .slice(0, limit)
  }
  let is = kindOrder.map((k) =>
    [k, db.prepare(`select 1 from ${k} where eid = ?`)] as const
  )
  let aim = db.prepare(`
    select c.target, d.title from comment c
    left join doc d on d.eid = c.target
    where c.eid = ?
  `)
  // Retirement sinks a hit, never hides it: a hit that IS a retired
  // project, or a task filed under one, keeps its rank order among the
  // sunk — they all queue behind the last live hit, flagged for the
  // renderers to mark.
  let sank = db.prepare(`
    select 1 from project p
    join archived a on a.eid = p.eid
    left join task t on t.eid = ?1
    where p.eid in (?1, t.project)
  `)
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
// `since`. `epoch` is minted once at process start: a db restore/reseed
// restarts the journal rowids, so a fresh epoch forces every stale cursor to
// full-resnapshot. `vocabHash` fingerprints graph-out's writable and stamped
// declarations — a shape change (new component, renamed column) shifts it,
// so a delta derived against the old shape is refused and the client reseeds.
// Both declarations are insertion-ordered, so their JSON (and the hash) is
// stable across boots of the same code.
export let epoch = crypto.randomUUID()
export let vocabHashOf = (
  writable: Record<string, Record<string, unknown>>,
  stamped: Record<string, Record<string, unknown>>,
) =>
  createHash('sha1')
    .update(JSON.stringify({ writable, stamped })).digest('hex').slice(0, 16)

export let vocabHash = vocabHashOf(comps, stamped)

// The journal's current rowid — the cursor a snapshot, a delta, or a live
// subscription frame is current as of (T-6823/T-3683). A client stamps its
// next `since` from it; a subscription rides it on every pushed frame so a
// client can bridge to the catch-up delta. 0 on an empty journal.
export let cursorOf = (db: DatabaseSync): number =>
  (db.prepare('select max(rowid) as m from journal')
    .get() as { m: number | null }).m ?? 0

// One entity's current components, keyed read — what subscription maintenance
// tests a touched eid against (design §2). Shaped like a snapshot row's comps
// (eid→comp, entity as {eid,num}); a missing spine returns {} (tombstoned or
// never minted), which reads as "not alive" to the matcher.
export let eager = (
  db: DatabaseSync,
  eid: string,
): Record<string, Record<string, unknown>> => {
  let spine = db.prepare(`${select('entity')} where eid = ?`)
    .get(eid) as Record<string, unknown> | undefined
  if (!spine) return {}
  let out: Record<string, Record<string, unknown>> = { entity: spine }
  for (let name of Object.keys(readable)) {
    if (name == 'entity') continue
    let row = db.prepare(`${select(name)} where eid = ?`)
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
    let rows = db.prepare(
      `select eid, ${cut.map(sqlName).join(', ')} from ${sqlName(name)}
       where eid in (${holes})`,
    ).all(...eids) as Record<string, unknown>[]
    for (let row of rows) out.push({ eid: String(row.eid), name, comp: row })
  }
  return out
}

// The home each persona names — homeReads' whole input, twenty-odd rows off
// its own table, where reading it out of a materialized graph costs the graph.
// `only` is a where clause, so the narrow door asks the same question keyed.
let homes = (db: DatabaseSync, only = '') =>
  db.prepare(`select eid, home as home from persona ${only}`)
    .all() as { eid: string; home: unknown }[]

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
    (db.prepare('select total_changes() as n').get() as { n: number }).n,
  ),
  remote: Number(
    (db.prepare('pragma data_version').get() as { data_version: number })
      .data_version,
  ),
})

export let snapshot = (db: DatabaseSync): Snapshot => {
  let cursor = cursorOf(db)
  let key = snapKey(db)
  let hit = snapCache.get(db)
  if (hit?.local == key.local && hit.remote == key.remote) return hit.snap
  let changes: Change[] = []
  for (let name of Object.keys(readable)) {
    for (
      let row of db.prepare(
        `${select(name)} where eid not in (select eid from entry)`,
      ).all() as Record<string, unknown>[]
    ) {
      changes.push({ eid: row.eid as string, name, comp: row })
    }
  }
  let deps = db.prepare(
    `select parent as parent, type, child as child from dependency
     where parent not in (select eid from entry)
       and child not in (select eid from entry)`,
  ).all() as Dep[]
  // A project's specialist personas ride derived `reads` edges (homeReads):
  // home is the one truth, so these compute here on the graph-out door
  // and can never drift from ownership — nothing to store, nothing to sync.
  let snap: Snapshot = {
    changes,
    deps: [...deps, ...homeReads(homes(db), deps)],
    cursor,
    epoch,
    vocabHash,
    capabilities,
  }
  snapCache.set(db, { ...key, snap })
  return snap
}

// `deno task seed` (or a direct run) bootstraps the file without the server.
if (import.meta.main) {
  let n = (q: string) => (db.prepare(q).get() as { n: number }).n
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
  let put = db.prepare('insert or ignore into hit (eid) values (?)')
  for (let e of eids) put.run(e)
}

// The comps of whatever `hit` holds, shaped as `rows(snapshot())` shapes them.
let staged = (db: DatabaseSync) => {
  let out = new Map<string, Record<string, Record<string, unknown>>>()
  let only = `where eid in (select eid from hit)`
  let spine = db.prepare(`${select('entity')} ${only}`)
    .all() as Record<string, unknown>[]
  for (let r of spine) out.set(String(r.eid), { entity: r })
  if (!out.size) return []
  for (let name of Object.keys(readable)) {
    if (name == 'entity') continue
    let rows = db.prepare(`${select(name)} ${only}`)
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
  db.prepare(`insert or ignore into hit (eid) ${filter.sql}`)
    .run(...filter.params)
  return staged(db)
}

// The same rows for a KNOWN set of eids — what a backlinks layer needs to
// NAME its sources (an id and a title come off the whole row, since kind is
// derived from which components are there). One eager() each would cost a
// statement per component per row; this costs one per component.
export let rowsOf = (db: DatabaseSync, eids: string[]) => {
  if (!eids.length) return []
  stage(db, eids)
  return staged(db)
}

let entryRows = (
  db: DatabaseSync,
  index: { eid: string; seq: number }[],
) => {
  if (!index.length) return []
  stage(db, index.map((e) => e.eid))
  let byEid = new Map(staged(db).map((e) => [e.eid, e.comps]))
  return index.map(({ eid, seq }) => ({ eid, seq, comps: byEid.get(eid)! }))
}

// One entry by identity. Hosted work names its call directly; its Session
// partition is unrelated to locating or hydrating that immutable row.
export let entryOf = (db: DatabaseSync, eid: string) => {
  let row = db.prepare('select eid, seq from entry where eid = ?').get(eid) as
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
  let index = (through == null
    ? db.prepare(
      `select eid, seq from entry where session = ? and seq > ?
       order by seq limit ?`,
    ).all(session, after, cap)
    : db.prepare(
      `select eid, seq from entry
       where session = ? and seq > ? and seq <= ?
       order by seq limit ?`,
    ).all(session, after, through, cap)) as {
      eid: string
      seq: number
    }[]
  return entryRows(db, index)
}

// The lazy partition scanned ACROSS sessions, ordered (session, seq) and
// capped — the fallback universe for a lazy query that names no single session
// and whose predicate the index declined to compile. entriesOf is the keyed,
// per-session read; this is its unscoped sibling, bounded so an all-sessions
// scan can never be unbounded.
export let entriesScan = (db: DatabaseSync, after = 0, limit = 500) => {
  let index = db.prepare(
    `select eid, seq from entry where seq > ?
     order by session, seq limit ?`,
  ).all(after, Math.max(1, Math.min(limit, 5000))) as {
    eid: string
    seq: number
  }[]
  if (!index.length) return []
  stage(db, index.map((e) => e.eid))
  let byEid = new Map(staged(db).map((e) => [e.eid, e.comps]))
  return index.map(({ eid, seq }) => ({ eid, seq, comps: byEid.get(eid)! }))
}

// Every edge touching these entities, both directions — the narrow reading of
// `snap.deps`, derived `reads` included. Losing those would make this door
// disagree with the graph-out one about what an entity's edges ARE, so the
// persona table is read here too, keyed the same way: personas homed at a hit,
// and a hit that is itself a persona.
export let depsOf = (db: DatabaseSync, eids: string[]): Dep[] => {
  if (!eids.length) return []
  stage(db, eids)
  let mine = `in (select eid from hit)`
  let deps = db.prepare(
    `select parent as parent, type, child as child from dependency
      where parent ${mine} or child ${mine}`,
  ).all() as Dep[]
  return [
    ...deps,
    ...homeReads(homes(db, `where home ${mine} or eid ${mine}`), deps),
  ]
}

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
      let rows = db.prepare(
        `select eid, ${sqlName(col)} as at from ${sqlName(name)}
          where ${sqlName(col)} in (select eid from hit)`,
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
    let rows = db.prepare(
      `select eid from ${sqlName(name)}
        where ${sqlName(prop)} in (select eid from hit)`,
    ).all() as { eid: string }[]
    for (let row of rows) out.add(row.eid)
  }
  return [...out]
}
