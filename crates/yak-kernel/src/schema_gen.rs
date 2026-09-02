// GENERATED — do not edit. Emitted by `deno task codegen` from the ordered
// schema DDL a fresh src/db.ts migrate() runs (SchemaOp), captured through
// the live SQLite driver. Refused by the gate stale check (`deno task
// codegen --check`). The Rust kernel replays this to own schema CREATE +
// additive migration (D-22804 §8); db.ts stays the one schema source.

use crate::schema::SchemaOp;

pub static SCHEMA: &[SchemaOp] = &[
    SchemaOp::Exec(r#"
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
  create table if not exists mail (
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
  );
  create table if not exists email (
    entity     integer primary key references entity(id),
    address text not null
  );
  create table if not exists conflict (
    entity integer primary key references entity(id),
    target integer not null,
    loser  integer references entity(id),
    holder integer references entity(id),
    at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
  create table if not exists tombstone (
    entity     integer primary key references entity(id),
    deleted_at text not null
  );
  create table if not exists dependency (
    parent integer not null references entity(id),
    type       text not null check (type in ('requires','contains','reads','about','supervises','delegates','recalled','supersedes','worked','referenced','wants','satisfies')),
    child  integer not null references entity(id),
    ord    integer,
    primary key (parent, type, child)
  );
  -- The journal (D-18860/D-18861) -- log data, not graph (like tool_call
  -- below): the record OF the wire, never part of it, written inside apply()'s
  -- transaction. Three append-only tables with no eid of their own, never in
  -- snapshot() or a client cache, not vocabulary components (so no
  -- xtask/codegen); read per-entity via journalOf(), per-batch via
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
  -- retained, D-18866), so every write names one; entity is nullable only for
  -- history whose spine an out-of-band purge removed before the retention rule
  -- -- those rows keep their tx and fields but name no entity, and every
  -- per-entity reader skips them.
  create table if not exists journal_change (
    id        integer primary key,
    tx        integer not null references journal_tx(id),
    ordinal   integer not null,
    entity    integer references entity(id),
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
  create table if not exists tool_call (
    ts         text not null
               default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    source     text not null check (source in ('mcp','http','web','srv','cli')),
    name       text not null,
    session_id text,
    ok         integer not null,
    ms         integer,
    error      text,
    detail     text
  );
  create table if not exists embedding (
    entity integer primary key references entity(id),
    model  text not null,
    hash   text not null,
    vec    blob not null,
    at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
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
"#),
    SchemaOp::Exec(r#"create table if not exists "project" (
    entity integer primary key references entity(id),
    "color" text
  );"#),
    SchemaOp::Exec(r#"create table if not exists "accept" (
    entity integer primary key references entity(id),
    "body" text
  );"#),
    SchemaOp::Exec(r#"create table if not exists "venture" (
    entity integer primary key references entity(id),
    "phase" text,
    "paused_from" text,
    "hold_from" text,
    "run_mode" text,
    "agent_model" text,
    "operated_by" text,
    "tagline" text,
    "site" text
  );"#),
    SchemaOp::Exec(r#"create table if not exists "board" (
    entity integer primary key references entity(id),
    "query" text
  );"#),
    SchemaOp::Exec(r#"create table if not exists "layout" (
    entity integer primary key references entity(id),
    "root" integer references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "design" (
    entity integer primary key references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "goal" (
    entity integer primary key references entity(id),
    "scope" integer
  );"#),
    SchemaOp::Exec(r#"create table if not exists "architecture" (
    entity integer primary key references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "canvas" (
    entity integer primary key references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "favorite" (
    entity integer primary key references entity(id),
    "at" text
  );"#),
    SchemaOp::Exec(r#"create table if not exists "worktree" (
    entity integer primary key references entity(id),
    "cwd" text,
    "branch" text,
    "base_revision" text
  );"#),
    SchemaOp::Exec(r#"create table if not exists "attention" (
    entity integer primary key references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "prompt" (
    entity integer primary key references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "task_context" (
    entity integer primary key references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "reasoning" (
    entity integer primary key references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "recalled" (
    entity integer primary key references entity(id),
    "source" integer
  );"#),
    SchemaOp::Exec(r#"create table if not exists "spawn" (
    entity integer primary key references entity(id),
    "provider" text,
    "model" text,
    "effort" text,
    "persona" integer references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "hook" (
    entity integer primary key references entity(id),
    "source" text,
    "event" text,
    "payload" text,
    "spool_id" text,
    "received_at" text,
    "method" text,
    "path" text,
    "headers" text,
    "sig_ok" integer
  );"#),
    SchemaOp::Exec(r#"create table if not exists "person" (
    entity integer primary key references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "persona" (
    entity integer primary key references entity(id),
    "home" integer references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "model" (
    entity integer primary key references entity(id),
    "name" text,
    "vendor" text,
    "grade" text
  );"#),
    SchemaOp::Exec(r#"create table if not exists "memory" (
    entity integer primary key references entity(id),
    "scope" integer,
    "last_confirmed_at" text
  );"#),
    SchemaOp::Exec(r#"create table if not exists "feedback" (
    entity integer primary key references entity(id),
    "by" integer
  );"#),
    SchemaOp::Exec(r#"create table if not exists "meta" (
    entity integer primary key references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "resume" (
    entity integer primary key references entity(id),
    "actor" integer,
    "at" text,
    "rank" real
  );"#),
    SchemaOp::Exec(r#"create table if not exists "chat" (
    entity integer primary key references entity(id),
    "actor" integer references entity(id),
    "target" integer references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "dream" (
    entity integer primary key references entity(id),
    "scope" integer references entity(id),
    "floor" text
  );"#),
    SchemaOp::Exec(r#"create table if not exists "notice" (
    entity integer primary key references entity(id),
    "target" integer references entity(id),
    "event" text
  );"#),
    SchemaOp::Exec(r#"create table if not exists "commit" (
    entity integer primary key references entity(id),
    "target" integer references entity(id),
    "sha" text,
    "repo" text,
    "message" text
  );"#),
    SchemaOp::Exec(r#"create table if not exists "deliver" (
    entity integer primary key references entity(id),
    "to" integer
  );"#),
    SchemaOp::Exec(r#"create table if not exists "delivered" (
    entity integer primary key references entity(id),
    "at" text,
    "via" text
  );"#),
    SchemaOp::Exec(r#"create table if not exists "error" (
    entity integer primary key references entity(id),
    "at" text,
    "message" text
  );"#),
    SchemaOp::Exec(r#"create table if not exists "exception" (
    entity integer primary key references entity(id),
    "at" text,
    "message" text,
    "stack" text
  );"#),
    SchemaOp::Exec(r#"create table if not exists "fixer" (
    entity integer primary key references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "verifier" (
    entity integer primary key references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "nofix" (
    entity integer primary key references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "noverify" (
    entity integer primary key references entity(id)
  );"#),
    SchemaOp::Exec(r#"create table if not exists "anchor" (
    entity integer primary key references entity(id),
    "paths" text,
    "sha" text,
    "symbol" text,
    "hunk" text,
    "start" real,
    "end" real
  );"#),
    SchemaOp::Exec(r#"create table if not exists "fork" (
    entity integer primary key references entity(id),
    "from" integer references entity(id)
  );"#),
    SchemaOp::AddColumn { table: "project", col: "color", sql: r#"alter table project add column "color" text"# },
    SchemaOp::AddColumn { table: "accept", col: "body", sql: r#"alter table accept add column "body" text"# },
    SchemaOp::AddColumn { table: "venture", col: "phase", sql: r#"alter table venture add column "phase" text"# },
    SchemaOp::AddColumn { table: "venture", col: "paused_from", sql: r#"alter table venture add column "paused_from" text"# },
    SchemaOp::AddColumn { table: "venture", col: "hold_from", sql: r#"alter table venture add column "hold_from" text"# },
    SchemaOp::AddColumn { table: "venture", col: "run_mode", sql: r#"alter table venture add column "run_mode" text"# },
    SchemaOp::AddColumn { table: "venture", col: "agent_model", sql: r#"alter table venture add column "agent_model" text"# },
    SchemaOp::AddColumn { table: "venture", col: "operated_by", sql: r#"alter table venture add column "operated_by" text"# },
    SchemaOp::AddColumn { table: "venture", col: "tagline", sql: r#"alter table venture add column "tagline" text"# },
    SchemaOp::AddColumn { table: "venture", col: "site", sql: r#"alter table venture add column "site" text"# },
    SchemaOp::AddColumn { table: "board", col: "query", sql: r#"alter table board add column "query" text"# },
    SchemaOp::AddColumn { table: "layout", col: "root", sql: r#"alter table layout add column "root" integer references entity(id)"# },
    SchemaOp::AddColumn { table: "goal", col: "scope", sql: r#"alter table goal add column "scope" integer"# },
    SchemaOp::AddColumn { table: "favorite", col: "at", sql: r#"alter table favorite add column "at" text"# },
    SchemaOp::AddColumn { table: "worktree", col: "cwd", sql: r#"alter table worktree add column "cwd" text"# },
    SchemaOp::AddColumn { table: "worktree", col: "branch", sql: r#"alter table worktree add column "branch" text"# },
    SchemaOp::AddColumn { table: "worktree", col: "base_revision", sql: r#"alter table worktree add column "base_revision" text"# },
    SchemaOp::AddColumn { table: "recalled", col: "source", sql: r#"alter table recalled add column "source" integer"# },
    SchemaOp::AddColumn { table: "spawn", col: "provider", sql: r#"alter table spawn add column "provider" text"# },
    SchemaOp::AddColumn { table: "spawn", col: "model", sql: r#"alter table spawn add column "model" text"# },
    SchemaOp::AddColumn { table: "spawn", col: "effort", sql: r#"alter table spawn add column "effort" text"# },
    SchemaOp::AddColumn { table: "spawn", col: "persona", sql: r#"alter table spawn add column "persona" integer references entity(id)"# },
    SchemaOp::AddColumn { table: "hook", col: "source", sql: r#"alter table hook add column "source" text"# },
    SchemaOp::AddColumn { table: "hook", col: "event", sql: r#"alter table hook add column "event" text"# },
    SchemaOp::AddColumn { table: "hook", col: "payload", sql: r#"alter table hook add column "payload" text"# },
    SchemaOp::AddColumn { table: "hook", col: "spool_id", sql: r#"alter table hook add column "spool_id" text"# },
    SchemaOp::AddColumn { table: "hook", col: "received_at", sql: r#"alter table hook add column "received_at" text"# },
    SchemaOp::AddColumn { table: "hook", col: "method", sql: r#"alter table hook add column "method" text"# },
    SchemaOp::AddColumn { table: "hook", col: "path", sql: r#"alter table hook add column "path" text"# },
    SchemaOp::AddColumn { table: "hook", col: "headers", sql: r#"alter table hook add column "headers" text"# },
    SchemaOp::AddColumn { table: "hook", col: "sig_ok", sql: r#"alter table hook add column "sig_ok" integer"# },
    SchemaOp::AddColumn { table: "persona", col: "home", sql: r#"alter table persona add column "home" integer references entity(id)"# },
    SchemaOp::AddColumn { table: "model", col: "name", sql: r#"alter table model add column "name" text"# },
    SchemaOp::AddColumn { table: "model", col: "vendor", sql: r#"alter table model add column "vendor" text"# },
    SchemaOp::AddColumn { table: "model", col: "grade", sql: r#"alter table model add column "grade" text"# },
    SchemaOp::AddColumn { table: "memory", col: "scope", sql: r#"alter table memory add column "scope" integer"# },
    SchemaOp::AddColumn { table: "memory", col: "last_confirmed_at", sql: r#"alter table memory add column "last_confirmed_at" text"# },
    SchemaOp::AddColumn { table: "feedback", col: "by", sql: r#"alter table feedback add column "by" integer"# },
    SchemaOp::AddColumn { table: "resume", col: "actor", sql: r#"alter table resume add column "actor" integer"# },
    SchemaOp::AddColumn { table: "resume", col: "at", sql: r#"alter table resume add column "at" text"# },
    SchemaOp::AddColumn { table: "resume", col: "rank", sql: r#"alter table resume add column "rank" real"# },
    SchemaOp::AddColumn { table: "chat", col: "actor", sql: r#"alter table chat add column "actor" integer references entity(id)"# },
    SchemaOp::AddColumn { table: "chat", col: "target", sql: r#"alter table chat add column "target" integer references entity(id)"# },
    SchemaOp::AddColumn { table: "dream", col: "scope", sql: r#"alter table dream add column "scope" integer references entity(id)"# },
    SchemaOp::AddColumn { table: "dream", col: "floor", sql: r#"alter table dream add column "floor" text"# },
    SchemaOp::AddColumn { table: "notice", col: "target", sql: r#"alter table notice add column "target" integer references entity(id)"# },
    SchemaOp::AddColumn { table: "notice", col: "event", sql: r#"alter table notice add column "event" text"# },
    SchemaOp::AddColumn { table: "commit", col: "target", sql: r#"alter table commit add column "target" integer references entity(id)"# },
    SchemaOp::AddColumn { table: "commit", col: "sha", sql: r#"alter table commit add column "sha" text"# },
    SchemaOp::AddColumn { table: "commit", col: "repo", sql: r#"alter table commit add column "repo" text"# },
    SchemaOp::AddColumn { table: "commit", col: "message", sql: r#"alter table commit add column "message" text"# },
    SchemaOp::AddColumn { table: "deliver", col: "to", sql: r#"alter table deliver add column "to" integer"# },
    SchemaOp::AddColumn { table: "delivered", col: "at", sql: r#"alter table delivered add column "at" text"# },
    SchemaOp::AddColumn { table: "delivered", col: "via", sql: r#"alter table delivered add column "via" text"# },
    SchemaOp::AddColumn { table: "error", col: "at", sql: r#"alter table error add column "at" text"# },
    SchemaOp::AddColumn { table: "error", col: "message", sql: r#"alter table error add column "message" text"# },
    SchemaOp::AddColumn { table: "exception", col: "at", sql: r#"alter table exception add column "at" text"# },
    SchemaOp::AddColumn { table: "exception", col: "message", sql: r#"alter table exception add column "message" text"# },
    SchemaOp::AddColumn { table: "exception", col: "stack", sql: r#"alter table exception add column "stack" text"# },
    SchemaOp::AddColumn { table: "anchor", col: "paths", sql: r#"alter table anchor add column "paths" text"# },
    SchemaOp::AddColumn { table: "anchor", col: "sha", sql: r#"alter table anchor add column "sha" text"# },
    SchemaOp::AddColumn { table: "anchor", col: "symbol", sql: r#"alter table anchor add column "symbol" text"# },
    SchemaOp::AddColumn { table: "anchor", col: "hunk", sql: r#"alter table anchor add column "hunk" text"# },
    SchemaOp::AddColumn { table: "anchor", col: "start", sql: r#"alter table anchor add column "start" real"# },
    SchemaOp::AddColumn { table: "anchor", col: "end", sql: r#"alter table anchor add column "end" real"# },
    SchemaOp::AddColumn { table: "fork", col: "from", sql: r#"alter table fork add column "from" integer references entity(id)"# },
    SchemaOp::AddColumn { table: "task", col: "project", sql: r#"alter table "task" add column project integer references entity(id)"# },
    SchemaOp::AddColumn { table: "task", col: "assignee", sql: r#"alter table "task" add column assignee integer references entity(id)"# },
    SchemaOp::AddColumn { table: "task", col: "domain", sql: r#"alter table "task" add column domain text"# },
    SchemaOp::AddColumn { table: "session", col: "pid", sql: r#"alter table "session" add column pid integer"# },
    SchemaOp::AddColumn { table: "session", col: "pane", sql: r#"alter table "session" add column pane text"# },
    SchemaOp::AddColumn { table: "session", col: "turn", sql: r#"alter table "session" add column turn text"# },
    SchemaOp::AddColumn { table: "session", col: "notice_at", sql: r#"alter table "session" add column notice_at text"# },
    SchemaOp::AddColumn { table: "session", col: "notice_accepted_at", sql: r#"alter table "session" add column notice_accepted_at text"# },
    SchemaOp::AddColumn { table: "session", col: "notice_token", sql: r#"alter table "session" add column notice_token text"# },
    SchemaOp::AddColumn { table: "session", col: "transcript", sql: r#"alter table "session" add column transcript text"# },
    SchemaOp::AddColumn { table: "session", col: "agent_type", sql: r#"alter table "session" add column agent_type text"# },
    SchemaOp::AddColumn { table: "session", col: "source", sql: r#"alter table "session" add column source text"# },
    SchemaOp::AddColumn { table: "session", col: "operator", sql: r#"alter table "session" add column operator integer"# },
    SchemaOp::AddColumn { table: "session", col: "parent", sql: r#"alter table "session" add column parent integer references entity(id)"# },
    SchemaOp::AddColumn { table: "session", col: "origin", sql: r#"alter table "session" add column origin text not null default 'external'"# },
    SchemaOp::AddColumn { table: "session", col: "provider", sql: r#"alter table "session" add column provider text"# },
    SchemaOp::AddColumn { table: "session", col: "model", sql: r#"alter table "session" add column model text"# },
    SchemaOp::AddColumn { table: "session", col: "effort", sql: r#"alter table "session" add column effort text"# },
    SchemaOp::AddColumn { table: "session", col: "persona", sql: r#"alter table "session" add column persona integer"# },
    SchemaOp::AddColumn { table: "session", col: "requested_task", sql: r#"alter table "session" add column requested_task integer"# },
    SchemaOp::AddColumn { table: "session", col: "role", sql: r#"alter table "session" add column role integer"# },
    SchemaOp::AddColumn { table: "session", col: "branch", sql: r#"alter table "session" add column branch text"# },
    SchemaOp::AddColumn { table: "session", col: "base_revision", sql: r#"alter table "session" add column base_revision text"# },
    SchemaOp::AddColumn { table: "session", col: "status", sql: r#"alter table "session" add column status text"# },
    SchemaOp::AddColumn { table: "session", col: "provider_session_id", sql: r#"alter table "session" add column provider_session_id text"# },
    SchemaOp::AddColumn { table: "session", col: "serving_model", sql: r#"alter table "session" add column serving_model text"# },
    SchemaOp::AddColumn { table: "session", col: "latest_seq", sql: r#"alter table "session" add column latest_seq integer not null default 0"# },
    SchemaOp::AddColumn { table: "session", col: "standing", sql: r#"alter table "session" add column standing text"# },
    SchemaOp::AddColumn { table: "session", col: "started_at", sql: r#"alter table "session" add column started_at text"# },
    SchemaOp::AddColumn { table: "session", col: "stop_requested_at", sql: r#"alter table "session" add column stop_requested_at text"# },
    SchemaOp::AddColumn { table: "session", col: "input_at", sql: r#"alter table "session" add column input_at text"# },
    SchemaOp::AddColumn { table: "session", col: "finished_at", sql: r#"alter table "session" add column finished_at text"# },
    SchemaOp::AddColumn { table: "session", col: "exit_code", sql: r#"alter table "session" add column exit_code integer"# },
    SchemaOp::AddColumn { table: "session", col: "stop_reason", sql: r#"alter table "session" add column stop_reason text"# },
    SchemaOp::AddColumn { table: "session", col: "final_text", sql: r#"alter table "session" add column final_text text"# },
    SchemaOp::AddColumn { table: "session", col: "usage_json", sql: r#"alter table "session" add column usage_json text"# },
    SchemaOp::AddColumn { table: "session", col: "stderr", sql: r#"alter table "session" add column stderr text"# },
    SchemaOp::AddColumn { table: "client", col: "actor", sql: r#"alter table "client" add column actor integer references entity(id)"# },
    SchemaOp::AddColumn { table: "session", col: "actor", sql: r#"alter table "session" add column actor integer references entity(id)"# },
    SchemaOp::Exec(r#"create index if not exists dependency_child on "dependency" ("child");"#),
    SchemaOp::Exec(r#"create index if not exists task_project on "task" ("project");"#),
    SchemaOp::Exec(r#"create index if not exists task_assignee on "task" ("assignee");"#),
    SchemaOp::Exec(r#"create index if not exists role_scope on "role" ("scope");"#),
    SchemaOp::Exec(r#"create index if not exists role_checkout on "role" ("checkout");"#),
    SchemaOp::Exec(r#"create index if not exists role_wake_target on "role" ("wake_target");"#),
    SchemaOp::Exec(r#"create index if not exists role_observed on "role" ("observed");"#),
    SchemaOp::Exec(r#"create index if not exists layout_root on "layout" ("root");"#),
    SchemaOp::Exec(r#"create index if not exists pane_layout on "pane" ("layout");"#),
    SchemaOp::Exec(r#"create index if not exists pane_parent on "pane" ("parent");"#),
    SchemaOp::Exec(r#"create index if not exists pane_content on "pane" ("content");"#),
    SchemaOp::Exec(r#"create index if not exists goal_scope on "goal" ("scope");"#),
    SchemaOp::Exec(r#"create index if not exists card_target on "card" ("target");"#),
    SchemaOp::Exec(r#"create index if not exists pin_canvas on "pin" ("canvas");"#),
    SchemaOp::Exec(r#"create index if not exists client_actor on "client" ("actor");"#),
    SchemaOp::Exec(r#"create unique index if not exists camera_client_canvas on "camera" ("client", "canvas");"#),
    SchemaOp::Exec(r#"create index if not exists camera_client on "camera" ("client");"#),
    SchemaOp::Exec(r#"create index if not exists camera_canvas on "camera" ("canvas");"#),
    SchemaOp::Exec(r#"create unique index if not exists fold_client_board on "fold" ("client", "board");"#),
    SchemaOp::Exec(r#"create index if not exists fold_client on "fold" ("client");"#),
    SchemaOp::Exec(r#"create index if not exists fold_board on "fold" ("board");"#),
    SchemaOp::Exec(r#"create unique index if not exists shelf_client on "shelf" ("client");"#),
    SchemaOp::Exec(r#"create unique index if not exists cursor_client on "cursor" ("client");"#),
    SchemaOp::Exec(r#"create index if not exists cursor_target on "cursor" ("target");"#),
    SchemaOp::Exec(r#"create index if not exists session_requested_task on "session" ("requested_task");"#),
    SchemaOp::Exec(r#"create index if not exists session_role on "session" ("role");"#),
    SchemaOp::Exec(r#"create index if not exists session_persona on "session" ("persona");"#),
    SchemaOp::Exec(r#"create index if not exists session_actor on "session" ("actor");"#),
    SchemaOp::Exec(r#"create index if not exists session_parent on "session" ("parent");"#),
    SchemaOp::Exec(r#"create unique index if not exists entry_session_seq on "entry" ("session", "seq");"#),
    SchemaOp::Exec(r#"create index if not exists entry_session on "entry" ("session");"#),
    SchemaOp::Exec(r#"create unique index if not exists generation_through on "generation" ("through");"#),
    SchemaOp::Exec(r#"create unique index if not exists output_source_key on "output" ("source", "key") where key is not null;"#),
    SchemaOp::Exec(r#"create index if not exists output_source on "output" ("source");"#),
    SchemaOp::Exec(r#"create unique index if not exists result_call on "result" ("call");"#),
    SchemaOp::Exec(r#"create index if not exists checkpoint_through on "checkpoint" ("through");"#),
    SchemaOp::Exec(r#"create index if not exists cancel_target on "cancel" ("target");"#),
    SchemaOp::Exec(r#"create index if not exists recalled_source on "recalled" ("source");"#),
    SchemaOp::Exec(r#"create index if not exists lease_holder on "lease" ("holder");"#),
    SchemaOp::Exec(r#"create index if not exists spawn_persona on "spawn" ("persona");"#),
    SchemaOp::Exec(r#"create index if not exists claim_session on "claim" ("session");"#),
    SchemaOp::Exec(r#"create index if not exists resume_actor on "resume" ("actor");"#),
    SchemaOp::Exec(r#"create unique index if not exists subscription_actor_target on "subscription" ("actor", "target");"#),
    SchemaOp::Exec(r#"create index if not exists subscription_actor on "subscription" ("actor");"#),
    SchemaOp::Exec(r#"create index if not exists subscription_target on "subscription" ("target");"#),
    SchemaOp::Exec(r#"create unique index if not exists chat_actor_target on "chat" ("actor", "target");"#),
    SchemaOp::Exec(r#"create index if not exists chat_actor on "chat" ("actor");"#),
    SchemaOp::Exec(r#"create index if not exists chat_target on "chat" ("target");"#),
    SchemaOp::Exec(r#"create index if not exists stop_request_target on "stop_request" ("target");"#),
    SchemaOp::Exec(r#"create index if not exists fork_from on "fork" ("from");"#),
    SchemaOp::Exec(r#"create index if not exists knock_target on "knock" ("target");"#),
    SchemaOp::Exec(r#"create index if not exists wake_target on "wake" ("target");"#),
    SchemaOp::Exec(r#"create index if not exists dream_scope on "dream" ("scope");"#),
    SchemaOp::Exec(r#"create index if not exists mail_target on "mail" ("target");"#),
    SchemaOp::Exec(r#"create index if not exists mail_reply_to on "mail" ("reply_to");"#),
    SchemaOp::Exec(r#"create index if not exists conflict_target on "conflict" ("target");"#),
    SchemaOp::Exec(r#"create index if not exists conflict_loser on "conflict" ("loser");"#),
    SchemaOp::Exec(r#"create index if not exists conflict_holder on "conflict" ("holder");"#),
    SchemaOp::Exec(r#"create index if not exists redaction_target on "redaction" ("target");"#),
    SchemaOp::Exec(r#"create index if not exists comment_target on "comment" ("target");"#),
    SchemaOp::Exec(r#"create index if not exists commit_target on "commit" ("target");"#),
    SchemaOp::Exec(r#"create index if not exists notice_target on "notice" ("target");"#),
    SchemaOp::Exec(r#"create index if not exists persona_home on "persona" ("home");"#),
    SchemaOp::Exec(r#"create index if not exists memory_scope on "memory" ("scope");"#),
    SchemaOp::Exec(r#"create index if not exists feedback_by on "feedback" ("by");"#),
    SchemaOp::Exec(r#"create index if not exists created_by on "created" ("by");"#),
    SchemaOp::Exec(r#"create index if not exists created_via on "created" ("via");"#),
    SchemaOp::Exec(r#"create index if not exists updated_by on "updated" ("by");"#),
    SchemaOp::Exec(r#"create index if not exists updated_via on "updated" ("via");"#),
    SchemaOp::Exec(r#"create index if not exists notified_by on "notified" ("by");"#),
    SchemaOp::Exec(r#"create index if not exists notified_via on "notified" ("via");"#),
    SchemaOp::Exec(r#"create index if not exists opened_by on "opened" ("by");"#),
    SchemaOp::Exec(r#"create index if not exists opened_via on "opened" ("via");"#),
    SchemaOp::Exec(r#"create index if not exists archived_by on "archived" ("by");"#),
    SchemaOp::Exec(r#"create index if not exists archived_via on "archived" ("via");"#),
    SchemaOp::Exec(r#"create index if not exists quarantined_by on "quarantined" ("by");"#),
    SchemaOp::Exec(r#"create index if not exists quarantined_via on "quarantined" ("via");"#),
    SchemaOp::Exec(r#"create index if not exists deliver_to on "deliver" ("to");"#),
    SchemaOp::Exec(r#"create index if not exists completed_at on "completed" ("at");"#),
    SchemaOp::Exec(r#"create index if not exists completed_by on "completed" ("by");"#),
    SchemaOp::Exec(r#"create index if not exists completed_via on "completed" ("via");"#),
    SchemaOp::Exec(r#"create index if not exists cancelled_by on "cancelled" ("by");"#),
    SchemaOp::Exec(r#"create index if not exists cancelled_via on "cancelled" ("via");"#),
    SchemaOp::Exec(r#"create index if not exists decided_by on "decided" ("by");"#),
    SchemaOp::Exec(r#"create index if not exists decided_via on "decided" ("via");"#),
    SchemaOp::Exec(r#"create index if not exists proposed_by on "proposed" ("by");"#),
    SchemaOp::Exec(r#"create index if not exists proposed_via on "proposed" ("via");"#),
    SchemaOp::Exec(r#"create unique index if not exists effect_jrow_handler on "effect" ("jrow", "handler");"#),
    SchemaOp::Exec(r#"drop index if exists subscription_one"#),
];
