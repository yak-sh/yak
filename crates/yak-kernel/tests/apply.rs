// apply() semantics against an in-memory subset of the real schema — the
// same DDL shapes db.ts declares for the tables these tests touch. The full
// schema lives with the TS migrator; the parity harness (scripts/parity)
// drives both writers over a REAL migrated file. Here: the rules, sub-ms.

use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use yak_kernel::change::Change;
use yak_kernel::edge::edge_eid;
use yak_kernel::feed::{cursor_of, journal_since, row_changes, Feed};
use yak_kernel::write::{
    apply, claim_work, default_gates, human, native_safe, ApplyError, ApplyOpts, ClaimWork,
    WriteStore,
};

const SCHEMA: &str = "
  create table entity (
    id  integer primary key,
    eid text not null unique,
    num integer unique
  );
  create table tombstone (
    entity     integer primary key references entity(id),
    deleted_at text not null
  );
  create table dependency (
    parent integer not null references entity(id),
    type   text not null,
    child  integer not null references entity(id),
    ord    integer,
    primary key (parent, type, child)
  );
  create index dependency_child on dependency(child);
  create table journal_tx (
    id integer primary key, ts text not null,
    actor integer references entity(id), via integer references entity(id),
    trace text
  );
  create table journal_change (
    id integer primary key, tx integer not null references journal_tx(id),
    ordinal integer not null, entity integer not null references entity(id),
    component text not null, operation text not null
  );
  create table journal_field (
    id integer primary key, change integer not null references journal_change(id),
    ordinal integer not null, field text not null, present integer not null,
    value text, ref integer references entity(id)
  );
  create index journal_change_tx on journal_change(tx, ordinal);
  create index journal_change_ent on journal_change(entity, component);
  create index journal_field_change on journal_field(change, ordinal);
  create index journal_field_ref on journal_field(ref) where ref is not null;
  create table blob (
    entity integer primary key references entity(id),
    bytes integer not null
  );
  create table blob_text (
    entity integer primary key references blob(entity),
    value text not null
  );
  create table doc (
    entity integer primary key references entity(id),
    title text not null,
    body  integer not null references blob(entity)
  );
  create view doc_value as
    select d.entity as rowid, d.entity, d.title, b.value as body
    from doc d join blob_text b on b.entity = d.body;
  create table task (
    entity integer primary key references entity(id),
    priority real not null default 0,
    project integer,
    assignee integer,
    domain text
  );
  create table design (
    entity integer primary key references entity(id)
  );
  create table completed (
    entity integer primary key references entity(id),
    at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    \"by\" integer,
    via integer
  );
  create table cancelled (
    entity integer primary key references entity(id),
    at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    \"by\" integer,
    reason text,
    via integer
  );
  create table proposed (
    entity integer primary key references entity(id),
    at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    \"by\" integer, via integer
  );
  create table decided (
    entity integer primary key references entity(id),
    at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    \"by\" integer, via integer, verdict text
  );
  create table blocked (
    entity integer primary key references entity(id),
    \"on\" text,
    since text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  create table quarantined (
    entity integer primary key references entity(id),
    at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    \"by\" integer, via integer
  );
  create table project (
    entity integer primary key references entity(id),
    color text
  );
  create table session (
    entity integer primary key references entity(id),
    id text unique,
    cwd text,
    actor integer,
    persona integer,
    requested_task integer,
    serving_model text,
    provider text,
    model text,
    effort text,
    pid integer,
    pane text,
    transcript text,
    parent integer,
    branch text,
    base_revision text,
    provider_session_id text,
    latest_seq integer not null default 0,
    origin text,
    status text
  );
  create table spawn (
    entity  integer primary key references entity(id),
    provider text, model text, effort text, persona integer
  );
  create table worktree (
    entity integer primary key references entity(id),
    cwd text, branch text, base_revision text
  );
  create table runtime (
    entity integer primary key references entity(id),
    pid integer, pane text, transcript text,
    provider_session_id text, serving_model text
  );
  create table model (
    entity integer primary key references entity(id),
    name   text not null
  );
  create table person (
    entity integer primary key references entity(id)
  );
  create table mail (
    entity      integer primary key references entity(id),
    target      integer references entity(id),
    reply_to    integer references entity(id),
    \"from\"      text,
    to_addr     text,
    message_id  text,
    received_at text,
    verified    integer,
    sent_id     text,
    in_reply_to text,
    headers     text
  );
  create table claim (
    entity integer primary key references entity(id),
    session integer not null,
    claimed_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  create table conflict (
    entity integer primary key references entity(id),
    target integer not null,
    loser integer references entity(id),
    holder integer references entity(id),
    at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  create table comment (
    entity integer primary key references entity(id),
    target integer not null references entity(id)
  );
  create table alias (
    entity integer primary key references entity(id),
    slug text not null unique,
    slugs text
  );
  create table created (
    entity integer primary key references entity(id),
    at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    \"by\" integer, via integer
  );
  create table updated (
    entity integer primary key references entity(id),
    at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    \"by\" integer, via integer
  );
  create table resume (
    entity integer primary key references entity(id),
    actor integer,
    at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    rank real
  );
  create table email (
    entity  integer primary key references entity(id),
    address text not null
  );
  create table deliver (
    entity integer primary key references entity(id),
    \"to\"   integer references entity(id)
  );
  create table entry (
    entity  integer primary key references entity(id),
    session integer not null references entity(id),
    seq     integer not null,
    unique (session, seq)
  );
  create table wake (
    entity integer primary key references entity(id),
    at     text,
    target integer references entity(id),
    note   text
  );
  create table stop_request (
    entity integer primary key references entity(id),
    target integer not null references entity(id)
  );
  create table delivered (entity integer primary key references entity(id));
  create table error (entity integer primary key references entity(id));
  create table lease (entity integer primary key references entity(id));
  create table imported (entity integer primary key references entity(id));
  create table cancel (
    entity integer primary key references entity(id),
    target integer references entity(id)
  );
  create table generation (entity integer primary key references entity(id));
  create table call (entity integer primary key references entity(id));
  create table result (
    entity integer primary key references entity(id),
    call   integer references entity(id)
  );
  create table setting (
    entity integer primary key references entity(id),
    key   text not null unique,
    value text
  );
  -- The SENTENCE store beside `dependency` (D-23820): an edge is an entity
  -- wearing its two ends and one nature comp. Every nature is here because
  -- stored_edge asks each table which verb an eid wears.
  create table edge (
    entity integer primary key references entity(id),
    \"from\" integer references entity(id),
    \"to\"   integer references entity(id),
    ord    real
  );
  create table requires   (entity integer primary key references entity(id));
  create table contains   (entity integer primary key references entity(id));
  create table reads      (entity integer primary key references entity(id));
  create table about      (entity integer primary key references entity(id));
  create table supervises (entity integer primary key references entity(id));
  create table delegates  (entity integer primary key references entity(id));
  create table supersedes (entity integer primary key references entity(id));
  create table worked     (entity integer primary key references entity(id));
  create table \"references\" (entity integer primary key references entity(id));
  create table wants      (entity integer primary key references entity(id));
  create table satisfies  (entity integer primary key references entity(id));
  create table recalled (
    entity integer primary key references entity(id),
    source integer,
    at     text
  );
";

fn store() -> WriteStore {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(SCHEMA).unwrap();
    WriteStore::from_conn(conn)
}

fn ch(eid: &str, name: &str, comp: Value) -> Change {
    let comp = match comp {
        Value::Null => None,
        Value::Object(m) => Some(m),
        _ => panic!("comp must be an object or null"),
    };
    Change::new(eid, name, comp)
}

fn run(s: &WriteStore, changes: Vec<Change>) -> Vec<Change> {
    apply(s, changes, &ApplyOpts::default(), &default_gates()).unwrap()
}

#[test]
fn retired_instruction_marker_is_not_admitted() {
    let s = store();
    let out = run(&s, vec![ch(A, "instruction", json!({}))]);
    assert!(out.is_empty());
    assert_eq!(
        s.conn
            .query_row("select 1 from entity where eid = ?1", [A], |r| r.get::<_, i64>(0))
            .optional()
            .unwrap(),
        None,
    );
}

// Seed a session row by SQL — a pre-existing session the facet mirrors read
// (dual_spawn/dual_facet consult the `session` table), distinct from a session
// CREATE that arrives as a wire change (now native, rung 7c).
fn seed_session(s: &WriteStore, eid: &str, label: &str) {
    s.conn.execute("insert into entity (eid) values (?1)", [eid]).unwrap();
    s.conn
        .execute(
            "insert into session (entity, id) values \
             ((select id from entity where eid = ?1), ?2)",
            [eid, label],
        )
        .unwrap();
}

// A where-clause naming one entity by eid — the sentence store is keyed by the
// spine id, so every edge assertion joins through it.
fn of(eid: &str) -> String {
    format!("entity = (select id from entity where eid = '{eid}')")
}

fn one<T: rusqlite::types::FromSql>(s: &WriteStore, sql: &str) -> T {
    s.conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

const A: &str = "aaaaaaaa-0000-4000-8000-000000000001";
const B: &str = "aaaaaaaa-0000-4000-8000-000000000002";
const C: &str = "aaaaaaaa-0000-4000-8000-000000000003";
const D: &str = "aaaaaaaa-0000-4000-8000-000000000004";

#[test]
fn create_stamps_numbers_and_journals() {
    let s = store();
    let out = run(&s, vec![ch(A, "doc", json!({"title": "Hello"})), ch(A, "task", json!({}))]);
    // num minted, created stamped, births + provenance ride the return
    let num: i64 = one(&s, "select num from entity where eid like 'aaaa%'");
    assert_eq!(num, 1);
    assert!(out.iter().any(|c| c.name == "entity" && c.comp.is_some()));
    assert!(out.iter().any(|c| c.name == "created"));
    // journal: one tx; created/updated echoes LEFT OUT; created comps are
    // completed to the persisted shape (body default rides the batch)
    let txs: i64 = one(&s, "select count(*) from journal_tx");
    assert_eq!(txs, 1);
    // A doc body is journaled by reference to its content blob, never inline.
    let body: String = one(
        &s,
        "select bt.value from journal_field jf join journal_change jc on jc.id = jf.change \
         join blob_text bt on bt.entity = jf.ref \
         where jc.component = 'doc' and jf.field = 'body' and jf.value is null",
    );
    assert_eq!(body, "");
    let echoed: i64 = one(&s, "select count(*) from journal_change where component = 'created'");
    assert_eq!(echoed, 0);
    // trace is null unless the caller fed the journal
    let trace: Option<String> = one(&s, "select trace from journal_tx");
    assert!(trace.is_none());
    // the batch touched the document and its synthesized empty-body blob.
    let touched: i64 = one(&s, "select count(distinct entity) from journal_change");
    assert_eq!(touched, 2);
}

#[test]
fn doc_bodies_share_content_identity_but_read_as_text() {
    let s = store();
    let out = run(
        &s,
        vec![
            ch(A, "doc", json!({"title": "one", "body": "shared body"})),
            ch(B, "doc", json!({"title": "two", "body": "shared body"})),
        ],
    );
    let refs: i64 = one(&s, "select count(distinct body) from doc");
    assert_eq!(refs, 1);
    let bodies: i64 = one(&s, "select count(*) from doc_value where body = 'shared body'");
    assert_eq!(bodies, 2);
    let content = yak_kernel::write::sha(&json!("shared body"));
    assert!(out.iter().any(|c| c.eid == content && c.name == "blob"));
    let num: Option<i64> = s
        .conn
        .query_row("select num from entity where eid = ?1", [&content], |r| r.get(0))
        .unwrap();
    assert_eq!(num, None);
}

#[test]
fn native_safe_routes_plain_graph_and_proxies_the_rest() {
    // The bridge's divergence predicate (D-22804 rung 4): a batch commits
    // natively only if EVERY change names a transform-free NATIVE_COMPS comp.
    let ok = |cs: Vec<Change>| native_safe(&cs);
    // plain-graph creates/updates/edges → native.
    assert!(ok(vec![ch(A, "doc", json!({"title": "x"})), ch(A, "task", json!({}))]));
    assert!(ok(vec![ch(A, "board", json!({"query": ".task!"}))]));
    assert!(ok(vec![ch(A, "project", json!({}))]));
    assert!(ok(vec![ch(A, "comment", json!({"target": B}))]));
    assert!(ok(vec![ch(A, "dependency", json!({"type": "requires", "child": B}))]));
    // claim + entity delete joined NATIVE_COMPS at rung 5 (resume stack + actor
    // backfill ported): a claim take/release and an entity delete commit native.
    assert!(ok(vec![ch(A, "claim", json!({"session": B}))]));
    assert!(ok(vec![ch(A, "entity", Value::Null)]));
    // email + deliver joined NATIVE_COMPS at rung 6 (address canonicalization
    // ported): an email.address write and a deliver.to write commit native.
    assert!(ok(vec![ch(A, "email", json!({"address": "x@y.com"}))]));
    assert!(ok(vec![ch(A, "deliver", json!({"to": B}))]));
    // entry + wake + stop_request joined NATIVE_COMPS at rung 7a (entry seq,
    // replaceWakes, the stop_request gate ported): they commit native.
    assert!(ok(vec![ch(A, "entry", json!({"session": B}))]));
    assert!(ok(vec![ch(A, "wake", json!({"at": "soon"}))]));
    assert!(ok(vec![ch(A, "stop_request", json!({"target": B}))]));
    // mail joined NATIVE_COMPS at rung 7b (the sender-actor from-derivation
    // ported): a mail create commits native and derives its `from`.
    assert!(ok(vec![ch(A, "mail", json!({"target": B}))]));
    // session + spawn + the worktree/runtime facets joined NATIVE_COMPS at rung
    // 7c (the facet-mirroring cluster ported — dual_spawn/dual_facet/
    // mirror_lineage/sync_facet_aliases): every door into the mirror is native.
    assert!(ok(vec![ch(A, "session", json!({"id": "S-1"}))]));
    assert!(ok(vec![ch(A, "spawn", json!({"provider": "codex"}))]));
    assert!(ok(vec![ch(A, "worktree", json!({"cwd": "/tmp/x"}))]));
    assert!(ok(vec![ch(A, "runtime", json!({"pid": 5}))]));
    // setting joined NATIVE_COMPS at rung 6b — the LAST comp to leave the proxy
    // default — once guardSettings + the WHATWG url canonicalization were ported.
    assert!(ok(vec![ch(A, "setting", json!({"key": "OLLAMA_BASE_URL", "value": "https://x/"}))]));
    // With setting admitted the allowlist spans EVERY wire comp; only a NEW
    // vocabulary word absent from the list still proxies.
    assert!(!ok(vec![ch(A, "invented_comp", json!({"x": 1}))]));
    // a MIXED batch with an unknown comp proxies WHOLE — apply() is atomic.
    assert!(!ok(vec![
        ch(A, "doc", json!({"title": "x"})),
        ch(A, "invented_comp", json!({"x": 1}))
    ]));
    // an empty batch proxies (Deno owns the trivial answer).
    assert!(!ok(vec![]));
}

#[test]
fn email_write_canonicalizes_the_address() {
    use yak_kernel::write::{canon, mail_domain};
    let s = store();
    let d = mail_domain();
    // a non-canonical fleet address (uppercase + underscore) must land in its
    // deliverable spelling (db.ts canonEmail).
    let input = format!("Foo_Bar@{d}");
    run(&s, vec![ch(A, "email", json!({ "address": input.clone() }))]);
    let stored: String = one(&s, "select address from email");
    assert_eq!(stored, canon(&input));
    assert_eq!(stored, format!("foobar@{d}"));
}

#[test]
fn deliver_at_address_mints_email_and_rewrites_to() {
    use yak_kernel::write::{canon, mail_domain};
    let s = store();
    let d = mail_domain();
    // a raw @-address in deliver.to is folded into a find-or-minted email entity
    // wearing the CANONICAL address, and the ref is rewritten to point at it.
    let addr = format!("New_Corr@{d}");
    run(&s, vec![ch(A, "deliver", json!({ "to": addr.clone() }))]);
    let minted: String = one(&s, "select address from email");
    assert_eq!(minted, canon(&addr));
    let to_eid: String = one(&s, "select o.eid from deliver dv join entity o on o.id = dv.\"to\"");
    let email_eid: String = one(&s, "select o.eid from email e join entity o on o.id = e.entity");
    assert_eq!(to_eid, email_eid, "deliver.to points at the minted email entity");
    // find-or-mint: a second deliver to the SAME address (any spelling that
    // canonicalizes equal) reuses the entity — no second email is minted.
    run(&s, vec![ch(B, "deliver", json!({ "to": format!("new_corr@{d}") }))]);
    let emails: i64 = one(&s, "select count(*) from email");
    assert_eq!(emails, 1, "the canonical address is minted once");
}

// A helper: the refusal message a bounced batch carries (db.ts Invalid → 400).
fn err_msg(s: &WriteStore, changes: Vec<Change>) -> String {
    apply(s, changes, &ApplyOpts::default(), &default_gates()).unwrap_err().to_string()
}

#[test]
fn setting_write_normalizes_a_url_value_in_place() {
    let s = store();
    // A url-typed setting's value is canonicalized through WHATWG new URL()
    // (guardSettings): default port stripped, trailing slash dropped — both in
    // STORAGE and in the ECHOED batch (normalize-in-place).
    let out = run(
        &s,
        vec![ch(
            A,
            "setting",
            json!({ "key": "OLLAMA_BASE_URL", "value": "HTTP://Example.COM:80/v1/" }),
        )],
    );
    let stored: String = one(&s, "select value from setting");
    assert_eq!(stored, "http://example.com/v1");
    let echoed = out[0].comp.as_ref().unwrap().get("value").unwrap().as_str().unwrap();
    assert_eq!(echoed, "http://example.com/v1", "the echoed batch is canonical too");
    // A value-only patch resolves its key from the existing row and re-normalizes.
    run(&s, vec![ch(A, "setting", json!({ "value": "https://ollama.yak.sh/" }))]);
    let stored: String = one(&s, "select value from setting");
    assert_eq!(stored, "https://ollama.yak.sh");
}

#[test]
fn setting_write_trims_a_text_value() {
    let s = store();
    // A text-typed setting is trimmed, not url-normalized (config.ts validate).
    run(&s, vec![ch(A, "setting", json!({ "key": "DISPATCH_SLOTS", "value": "  3  " }))]);
    let stored: String = one(&s, "select value from setting");
    assert_eq!(stored, "3");
}

#[test]
fn setting_write_bounces_an_invalid_url_with_the_deno_message() {
    let s = store();
    // An invalid url-typed value bounces the WHOLE batch (atomic) with the
    // byte-identical config.ts message — the 400 body a client reads.
    let msg = err_msg(
        &s,
        vec![
            ch(B, "doc", json!({ "title": "rides along" })),
            ch(A, "setting", json!({ "key": "OLLAMA_BASE_URL", "value": "ftp://nope/" })),
        ],
    );
    assert_eq!(msg, "Use an http or https URL.");
    // The batch rolled back: neither the doc nor the setting landed.
    let docs: i64 = one(&s, "select count(*) from doc_value");
    let settings: i64 = one(&s, "select count(*) from setting");
    assert_eq!((docs, settings), (0, 0), "an invalid setting rolls the batch back");
}

#[test]
fn setting_write_refuses_secret_unknown_and_keyless() {
    let s = store();
    // A secret key can never enter the graph (validate) — note the trailing period.
    assert_eq!(
        err_msg(&s, vec![ch(A, "setting", json!({ "key": "OLLAMA_API_KEY", "value": "sk" }))]),
        "OLLAMA_API_KEY is a secret and cannot be stored in the graph.",
    );
    // An unknown key with a value refuses through validate (capital U, period).
    assert_eq!(
        err_msg(&s, vec![ch(A, "setting", json!({ "key": "NOPE", "value": "x" }))]),
        "Unknown setting \"NOPE\".",
    );
    // A key-only create must still be a known, non-secret catalog key — the
    // guardSettings message (lowercase, no period).
    assert_eq!(
        err_msg(&s, vec![ch(A, "setting", json!({ "key": "NOPE" }))]),
        "unknown setting \"NOPE\"",
    );
    // A value-only patch to an eid with no existing setting row names no key.
    assert_eq!(
        err_msg(&s, vec![ch(A, "setting", json!({ "value": "x" }))]),
        format!("setting {} names no catalog key", &A[..8]),
    );
}

// Seed an entity wearing an address-book `email` comp — the shape the sender-
// actor from-derivation looks the signer's address up in (D-14945).
fn seed_email(s: &WriteStore, eid: &str, addr: &str) {
    s.conn.execute("insert or ignore into entity (eid) values (?1)", [eid]).unwrap();
    s.conn
        .execute(
            "insert into email (entity, address) values \
             ((select id from entity where eid = ?1), ?2)",
            rusqlite::params![eid, addr],
        )
        .unwrap();
}

// Point a session column (actor / persona) at a seeded entity.
fn set_session_ref(s: &WriteStore, sess: &str, col: &str, target: &str) {
    s.conn
        .execute(
            &format!(
                "update session set {col} = (select id from entity where eid = ?2) \
                 where entity = (select id from entity where eid = ?1)"
            ),
            rusqlite::params![sess, target],
        )
        .unwrap();
}

fn run_via(s: &WriteStore, writer: &str, changes: Vec<Change>) -> Vec<Change> {
    apply(
        s,
        changes,
        &ApplyOpts { writer: Some(writer), fed: false, ..Default::default() },
        &default_gates(),
    )
    .unwrap()
}

fn mail_from(s: &WriteStore, eid: &str) -> Option<String> {
    one(
        s,
        &format!(
            "select \"from\" from mail m join entity o on o.id = m.entity where o.eid = '{eid}'"
        ),
    )
}

#[test]
fn mail_from_derives_through_session_actor() {
    let s = store();
    // an actor P wearing an address-book email, a session S standing for it.
    seed_email(&s, A, "pp@bot.yak.sh");
    seed_session(&s, B, "S-sender");
    set_session_ref(&s, B, "actor", A);
    // a mail created BY session S signs from P's address (senderActor actor arm),
    // and the derived `from` rides the echoed change so a live cache hears it.
    let out = run_via(&s, B, vec![ch(C, "mail", json!({ "target": A }))]);
    assert_eq!(mail_from(&s, C).as_deref(), Some("pp@bot.yak.sh"));
    let echoed = out.iter().any(|c| {
        c.name == "mail"
            && c.comp.as_ref().and_then(|m| m.get("from")).and_then(|v| v.as_str())
                == Some("pp@bot.yak.sh")
    });
    assert!(echoed, "the derived from rides the return batch");
}

#[test]
fn mail_from_derives_from_persona_only_session() {
    let s = store();
    // A persona N wearing an address book email; the session names N as its
    // persona and ALSO an actor with a DIFFERENT address. senderActor resolves
    // `persona ?? actor`, so the letter must sign as the PERSONA — the case that
    // would silently diverge if the chain stopped at the actor arm.
    seed_email(&s, A, "persona@bot.yak.sh");
    seed_email(&s, D, "actor@bot.yak.sh");
    seed_session(&s, B, "S-persona");
    set_session_ref(&s, B, "persona", A);
    set_session_ref(&s, B, "actor", D);
    run_via(&s, B, vec![ch(C, "mail", json!({ "target": A }))]);
    assert_eq!(
        mail_from(&s, C).as_deref(),
        Some("persona@bot.yak.sh"),
        "a persona-only session signs from the persona, not the actor"
    );
}

#[test]
fn mail_from_stays_empty_when_the_signer_has_no_address() {
    let s = store();
    // A session whose actor wears NO address-book email: the mail lands, but
    // `from` stays empty (the refusal to send belongs at delivery, not apply).
    s.conn.execute("insert into entity (eid) values (?1)", [A]).unwrap();
    seed_session(&s, B, "S-addrless");
    set_session_ref(&s, B, "actor", A);
    run_via(&s, B, vec![ch(C, "mail", json!({ "target": A }))]);
    assert_eq!(mail_from(&s, C), None, "no address ⇒ no from, batch still commits");
}

#[test]
fn fed_trace_serializes_created_and_removed() {
    let s = store();
    let opts = ApplyOpts { writer: None, fed: true, ..Default::default() };
    apply(&s, vec![ch(A, "doc", json!({"title": "x"}))], &opts, &default_gates()).unwrap();
    apply(&s, vec![ch(A, "doc", Value::Null)], &opts, &default_gates()).unwrap();
    let traces: Vec<String> = {
        let mut st = s.conn.prepare("select trace from journal_tx order by id").unwrap();
        let rows = st.query_map([], |r| r.get(0)).unwrap();
        rows.flatten().collect()
    };
    assert!(traces[0].contains(&format!("doc {A}")));
    let t: Value = serde_json::from_str(&traces[1]).unwrap();
    assert_eq!(t["removed"][0][0], json!(A));
    assert_eq!(t["removed"][0][1][0], json!("doc"));
}

#[test]
fn was_guard_passes_and_refuses() {
    let s = store();
    run(&s, vec![ch(A, "doc", json!({"title": "v1"}))]);
    // guarded patch with the read value's hash passes
    let mut c = ch(A, "doc", json!({"title": "v2"}));
    let mut was = Map::new();
    was.insert("title".into(), Value::from(yak_kernel::write::sha(&json!("v1"))));
    c.was = Some(was.clone());
    run(&s, vec![c]);
    let title: String = one(&s, "select title from doc_value");
    assert_eq!(title, "v2");
    // the same stale hash now refuses the whole batch
    let mut c = ch(A, "doc", json!({"title": "v3"}));
    c.was = Some(was);
    let err = apply(&s, vec![c], &ApplyOpts::default(), &default_gates());
    assert!(matches!(err, Err(ApplyError::Stale { .. })));
    let title: String = one(&s, "select title from doc_value");
    assert_eq!(title, "v2");
}

#[test]
fn was_on_unknown_column_fails_closed() {
    let s = store();
    run(&s, vec![ch(A, "doc", json!({"title": "x"}))]);
    let mut c = ch(A, "doc", json!({"title": "y"}));
    let mut was = Map::new();
    was.insert("titel".into(), Value::from("deadbeef"));
    c.was = Some(was);
    let err = apply(&s, vec![c], &ApplyOpts::default(), &default_gates());
    assert!(err.unwrap_err().to_string().contains("unknown column: doc.titel"));
}

#[test]
fn unknown_column_refuses_server_owned_drops() {
    let s = store();
    let err = apply(
        &s,
        vec![ch(A, "task", json!({"statuss": "done"}))],
        &ApplyOpts::default(),
        &default_gates(),
    );
    assert!(err.unwrap_err().to_string().contains("unknown column"));
    // a server-owned comp is dropped in silence: nothing lands, no journal
    let out = run(&s, vec![ch(A, "resume", json!({"rank": 1}))]);
    assert!(out.is_empty());
    let n: i64 = one(&s, "select count(*) from journal_tx");
    assert_eq!(n, 0);
}

#[test]
fn enum_refuses_out_of_domain() {
    // task.status is DERIVED now (D-24102), so venture.phase is the enum column
    // that exercises domain validation.
    let s = store();
    let err = apply(
        &s,
        vec![ch(A, "venture", json!({"phase": "livee"}))],
        &ApplyOpts::default(),
        &default_gates(),
    );
    assert!(err.unwrap_err().to_string().contains("expects one of"));
}

// rung 7c: a session CREATE bearing a launch spec commits natively and mirrors
// the spawn fields into a minted `spawn` twin (dual_spawn), while the session
// columns keep the same spec — both doors read the same launch.
#[test]
fn session_create_mirrors_spawn_twin() {
    let s = store();
    let out = run(
        &s,
        vec![ch(A, "session", json!({"id": "S-9", "provider": "codex", "model": "gpt-5"}))],
    );
    // the session row carries the spec…
    let prov: String = one(
        &s,
        "select provider from session s join entity e on e.id = s.entity where e.eid = '\
            aaaaaaaa-0000-4000-8000-000000000001'",
    );
    assert_eq!(prov, "codex");
    // …and a spawn twin was minted with the same spec (same eid, a facet).
    let sp: String = one(
        &s,
        "select provider from spawn s join entity e on e.id = s.entity where e.eid = '\
            aaaaaaaa-0000-4000-8000-000000000001'",
    );
    assert_eq!(sp, "codex");
    // the effective batch (echo) carries the spawn twin change.
    assert!(out.iter().any(|c| c.name == "spawn" && c.eid == A));
}

// rung 7c: a session.parent write links the `parent delegates child` edge
// (mirror_lineage), so edge readers see lineage from the column write.
#[test]
fn session_parent_links_delegates_edge() {
    let s = store();
    seed_session(&s, B, "parent");
    run(&s, vec![ch(A, "session", json!({"id": "S-child", "parent": B}))]);
    let n: i64 = one(&s, "select count(*) from dependency where type = 'delegates'");
    assert_eq!(n, 1);
}

#[test]
fn edges_link_and_unlink() {
    let s = store();
    run(&s, vec![ch(A, "task", json!({})), ch(B, "task", json!({}))]);
    // BOTH stores, one write (T-32530): the row lands and so does the sentence
    // entity, content-addressed from `from|nature|to`.
    let said = edge_eid(A, "requires", B);
    run(&s, vec![ch(A, "dependency", json!({"type": "requires", "child": B}))]);
    let n: i64 = one(&s, "select count(*) from dependency where type = 'requires'");
    assert_eq!(n, 1);
    assert_eq!(one::<i64>(&s, &format!("select count(*) from edge where {}", of(&said))), 1);
    assert_eq!(one::<i64>(&s, &format!("select count(*) from requires where {}", of(&said))), 1);
    // an edge is bulk, never typed by a human, so its spine carries no num
    assert_eq!(
        s.conn
            .query_row("select num from entity where eid = ?1", [&said], |r| r
                .get::<_, Option<i64>>(0))
            .unwrap(),
        None,
    );
    // Unlinking is not a DEATH: the comps go, the spine stays, so the same
    // sentence can be said again — a tombstone would forbid it forever.
    run(&s, vec![ch(A, "dependency", json!({"type": "requires", "child": B, "gone": true}))]);
    let n: i64 = one(&s, "select count(*) from dependency where type = 'requires'");
    assert_eq!(n, 0);
    assert_eq!(one::<i64>(&s, &format!("select count(*) from edge where {}", of(&said))), 0);
    assert_eq!(one::<i64>(&s, &format!("select count(*) from requires where {}", of(&said))), 0);
    assert_eq!(one::<i64>(&s, "select count(*) from tombstone"), 0);
    run(&s, vec![ch(A, "dependency", json!({"type": "requires", "child": B}))]);
    assert_eq!(one::<i64>(&s, &format!("select count(*) from edge where {}", of(&said))), 1);
    // an unknown edge word refuses in normalize, like TS parseProp
    let err = apply(
        &s,
        vec![ch(A, "dependency", json!({"type": "zzz", "child": B}))],
        &ApplyOpts::default(),
        &default_gates(),
    );
    assert!(err.unwrap_err().to_string().contains("expects one of"));
}

#[test]
fn claim_lease_bounces_and_audits() {
    let s = store();
    run(&s, vec![ch(A, "task", json!({}))]);
    seed_session(&s, B, "sess-b");
    seed_session(&s, C, "sess-c");
    run(&s, vec![ch(A, "claim", json!({"session": B}))]);
    // a claim IS wip now (D-24102): the claim row is the derived wip, and the
    // worked edge lands
    let claims: i64 = one(&s, "select count(*) from claim");
    assert_eq!(claims, 1);
    let n: i64 = one(&s, "select count(*) from dependency where type = 'worked'");
    assert_eq!(n, 1);
    // and the sentence beside it — the claim gate's row and dual_edge's entity
    let said = edge_eid(B, "worked", A);
    assert_eq!(one::<i64>(&s, &format!("select count(*) from edge where {}", of(&said))), 1);
    assert_eq!(one::<i64>(&s, &format!("select count(*) from worked where {}", of(&said))), 1);
    // a second session's claim bounces the batch and mints a conflict audit
    let err = apply(
        &s,
        vec![ch(A, "claim", json!({"session": C}))],
        &ApplyOpts::default(),
        &default_gates(),
    );
    assert!(err.unwrap_err().to_string().contains("already claimed by sess-b"));
    let holder: String = one(&s, "select (select eid from entity where id = holder) from conflict");
    assert_eq!(holder, B);
    let loser: String = one(&s, "select (select eid from entity where id = loser) from conflict");
    assert_eq!(loser, C);
    // the same session re-claiming is a no-op refresh
    run(&s, vec![ch(A, "claim", json!({"session": B}))]);
}

#[allow(clippy::result_large_err)]
fn take<'a>(
    s: &WriteStore,
    target: &'a str,
    session: &'a str,
    approve: bool,
) -> Result<Vec<Change>, ApplyError> {
    claim_work(
        s,
        &ClaimWork { target, session, approve, recursive: true, cwd: Some("/work") },
        &ApplyOpts::default(),
        &default_gates(),
    )
}

#[test]
fn guarded_worker_claim_approves_inherits_replays_and_rolls_back() {
    let s = store();
    run(
        &s,
        vec![
            ch(A, "task", json!({})),
            ch(A, "proposed", json!({})),
            ch(B, "task", json!({})),
            ch(B, "decided", json!({})),
            ch(C, "task", json!({})),
            ch(B, "dependency", json!({"type": "requires", "child": C})),
        ],
    );
    take(&s, A, "approver", true).unwrap();
    assert_eq!(one::<i64>(&s, "select count(*) from decided where entity = (select id from entity where eid = 'aaaaaaaa-0000-4000-8000-000000000001')"), 1);
    take(&s, C, "inherited", false).unwrap();
    let journals = one::<i64>(&s, "select count(*) from journal_tx");
    assert!(take(&s, C, "inherited", false).unwrap().is_empty());
    let human_session: String = one(
        &s,
        "select 'S-' || e.num from session join entity e on e.id = session.entity \
         where session.id = 'inherited'",
    );
    assert!(take(&s, C, &human_session, false).unwrap().is_empty());
    assert_eq!(one::<i64>(&s, "select count(*) from journal_tx"), journals);

    let blocked = store();
    run(
        &blocked,
        vec![
            ch(A, "task", json!({})),
            ch(A, "proposed", json!({})),
            ch(A, "blocked", json!({"on": "owner"})),
        ],
    );
    let err = take(&blocked, A, "rolled-back", true).unwrap_err().to_string();
    assert!(err.contains("is externally blocked: owner"));
    assert_eq!(one::<i64>(&blocked, "select count(*) from decided"), 0);
    assert_eq!(one::<i64>(&blocked, "select count(*) from session"), 0);
    assert_eq!(one::<i64>(&blocked, "select count(*) from claim"), 0);
}

#[test]
fn guarded_worker_claim_rejects_wrong_kinds_and_ambiguous_aliases_without_a_trace() {
    let s = store();
    run(
        &s,
        vec![
            ch(A, "task", json!({})),
            ch(A, "decided", json!({})),
            ch(B, "task", json!({})),
            ch(B, "alias", json!({"slug": "alias-a"})),
            ch(C, "design", json!({})),
            ch(C, "alias", json!({"slug": "alias-b"})),
            ch(D, "comment", json!({"target": A})),
        ],
    );
    s.conn.execute("update alias set slugs = 'ambiguous-worker'", []).unwrap();
    let journals = one::<i64>(&s, "select count(*) from journal_tx");
    for wrong in [B, C, D] {
        let id = human(&s.conn, wrong);
        let err = take(&s, A, &id, false).unwrap_err().to_string();
        assert!(err.contains(&format!("{id} is not a session")), "{err}");
    }
    let err = take(&s, A, "ambiguous-worker", false).unwrap_err().to_string();
    assert!(err.contains("ambiguous-worker is an ambiguous alias"), "{err}");
    assert_eq!(one::<i64>(&s, "select count(*) from session"), 0);
    assert_eq!(one::<i64>(&s, "select count(*) from claim"), 0);
    assert_eq!(one::<i64>(&s, "select count(*) from journal_tx"), journals);

    let target = human(&s.conn, D);
    let err = take(&s, &target, "wrong-target", false).unwrap_err().to_string();
    assert!(err.contains(&format!("{target} is not a task")), "{err}");
    assert_eq!(one::<i64>(&s, "select count(*) from session"), 0);
    assert_eq!(one::<i64>(&s, "select count(*) from journal_tx"), journals);
}

#[test]
fn guarded_worker_claim_mints_unknown_uuid_resumes_exact_session_and_rejects_empty_cwd() {
    let s = store();
    run(&s, vec![ch(A, "task", json!({})), ch(A, "decided", json!({}))]);
    let sid = "ffffffff-0000-4000-8000-000000000099";
    take(&s, A, sid, false).unwrap();
    let session: String = one(
        &s,
        "select e.eid from session join entity e on e.id = session.entity \
         where session.id = 'ffffffff-0000-4000-8000-000000000099'",
    );
    let journals = one::<i64>(&s, "select count(*) from journal_tx");
    assert!(take(&s, A, sid, false).unwrap().is_empty());
    assert!(take(&s, A, &human(&s.conn, &session), false).unwrap().is_empty());
    assert_eq!(one::<i64>(&s, "select count(*) from journal_tx"), journals);

    let err = claim_work(
        &s,
        &ClaimWork { target: A, session: sid, approve: false, recursive: true, cwd: Some(" ") },
        &ApplyOpts::default(),
        &default_gates(),
    )
    .unwrap_err()
    .to_string();
    assert!(err.contains("claim_work cwd must not be empty"), "{err}");
}

#[test]
fn guarded_worker_claim_preserves_decline_and_conflict_audit() {
    let s = store();
    run(
        &s,
        vec![
            ch(A, "task", json!({})),
            ch(A, "decided", json!({"verdict": "declined"})),
            ch(B, "task", json!({})),
            ch(B, "decided", json!({})),
        ],
    );
    let err = take(&s, A, "declined", true).unwrap_err().to_string();
    assert!(err.contains("was declined"));
    assert_eq!(one::<String>(&s, "select verdict from decided where entity = (select id from entity where eid = 'aaaaaaaa-0000-4000-8000-000000000001')"), "declined");
    assert_eq!(one::<i64>(&s, "select count(*) from session"), 0);

    take(&s, B, "winner", false).unwrap();
    let err = take(&s, B, "loser", false).unwrap_err().to_string();
    assert!(err.contains("already claimed by winner"));
    assert_eq!(one::<i64>(&s, "select count(*) from conflict"), 1);
    assert_eq!(one::<i64>(&s, "select count(*) from session where id = 'loser'"), 0);
}

#[test]
fn delete_cascades_by_death_word() {
    let s = store();
    run(
        &s,
        vec![
            ch(D, "project", json!({})),
            ch(A, "task", json!({"project": D})),
            ch(B, "doc", json!({"title": "note"})),
            ch(B, "comment", json!({"target": A})),
        ],
    );
    seed_session(&s, C, "sess");
    run(&s, vec![ch(A, "claim", json!({"session": C}))]);
    // deleting the task: the comment ABOUT it dies (cascade), the claim ON it
    // releases, and the return carries the casualties + the release
    let out = run(&s, vec![ch(A, "entity", Value::Null)]);
    assert!(out.iter().any(|c| c.eid == B && c.name == "entity" && c.comp.is_none()));
    // The task, the comment about it, and the `C worked A` SENTENCE the claim
    // minted: an edge exists ABOUT both its ends, so an endpoint's death reaps
    // the whole edge entity through edge.from/edge.to's cascade.
    let dead: i64 = one(&s, "select count(*) from tombstone");
    assert_eq!(dead, 3);
    assert_eq!(one::<i64>(&s, "select count(*) from edge"), 0);
    let comments: i64 = one(&s, "select count(*) from comment");
    assert_eq!(comments, 0);
    let claims: i64 = one(&s, "select count(*) from claim");
    assert_eq!(claims, 0);
    // deleting the project detaches the surviving pointer column
    const E: &str = "aaaaaaaa-0000-4000-8000-000000000005";
    run(&s, vec![ch(E, "task", json!({"project": D}))]);
    let out = run(&s, vec![ch(D, "entity", Value::Null)]);
    assert!(out.iter().any(|c| {
        c.eid == E
            && c.name == "task"
            && c.comp.as_ref().map(|m| m.get("project") == Some(&Value::Null)).unwrap_or(false)
    }));
    let orphaned: Option<i64> = s
        .conn
        .query_row(
            "select project from task where entity = (select id from entity where eid = ?1)",
            [E],
            |r| r.get(0),
        )
        .unwrap();
    assert!(orphaned.is_none());
    // a tombstoned eid voids every later touch
    let out = run(&s, vec![ch(A, "doc", json!({"title": "ghost"}))]);
    assert!(out.iter().all(|c| c.name != "created"));
}

// Point a seeded session at an actor entity (and optionally a cwd), the way a
// reified session carries them — the resume push reads the holder's actor here.
fn session_actor(s: &WriteStore, session: &str, actor: &str) {
    s.conn
        .execute(
            "update session set actor = (select id from entity where eid = ?1) \
             where entity = (select id from entity where eid = ?2)",
            [actor, session],
        )
        .unwrap();
}

#[test]
fn release_pushes_resume_retake_and_settle_pop() {
    let s = store();
    run(&s, vec![ch(D, "project", json!({}))]); // D is the holder's actor
    seed_session(&s, C, "sess");
    session_actor(&s, C, D);
    run(&s, vec![ch(A, "task", json!({}))]);
    // claim (open → wip); no resume row is owed yet
    run(&s, vec![ch(A, "claim", json!({"session": C}))]);
    assert_eq!(one::<i64>(&s, "select count(*) from resume"), 0);
    // RELEASE while unsettled → a resume row is pushed for D at rank 1, and the
    // echo carries the resume comp with actor=eid, rank=integer.
    let out = run(&s, vec![ch(A, "claim", Value::Null)]);
    assert_eq!(one::<i64>(&s, "select count(*) from resume"), 1);
    assert_eq!(one::<f64>(&s, "select rank from resume"), 1.0);
    let pushed = out.iter().find(|c| c.name == "resume" && c.eid == A).unwrap();
    let comp = pushed.comp.as_ref().unwrap();
    assert_eq!(comp.get("actor"), Some(&json!(D)));
    assert_eq!(comp.get("rank"), Some(&json!(1)));
    // the stored actor is the int id, projected back on read
    let stored: String = one(&s, "select e.eid from resume r join entity e on e.id = r.actor");
    assert_eq!(stored, D);
    // RE-TAKE pops it (a claim change whose task still holds a final claim)
    run(&s, vec![ch(A, "claim", json!({"session": C}))]);
    assert_eq!(one::<i64>(&s, "select count(*) from resume"), 0);
    // release again → rank is max(current rows)+1, and the pop emptied the table,
    // so it resets to 1 rather than climbing (db.ts reads max off the live table)
    run(&s, vec![ch(A, "claim", Value::Null)]);
    assert_eq!(one::<f64>(&s, "select rank from resume"), 1.0);
    // SETTLING the task pops it — a `completed` mark now, not a status write (D-24102)
    let out = run(&s, vec![ch(A, "completed", json!({}))]);
    assert_eq!(one::<i64>(&s, "select count(*) from resume"), 0);
    assert!(out.iter().any(|c| c.name == "resume" && c.eid == A && c.comp.is_none()));
}

#[test]
fn deleting_a_session_releases_its_claim_and_pushes_resume() {
    let s = store();
    run(&s, vec![ch(D, "project", json!({}))]); // the holder's actor
    seed_session(&s, C, "sess");
    session_actor(&s, C, D);
    run(&s, vec![ch(A, "task", json!({}))]);
    run(&s, vec![ch(A, "claim", json!({"session": C}))]);
    // deleting the SESSION releases its claim (claim.session death=release), and
    // the now-claimless unsettled task pushes onto the resume stack for D.
    let out = run(&s, vec![ch(C, "entity", Value::Null)]);
    assert_eq!(one::<i64>(&s, "select count(*) from claim"), 0);
    assert_eq!(one::<i64>(&s, "select count(*) from resume"), 1);
    let pushed = out.iter().find(|c| c.name == "resume" && c.eid == A).unwrap();
    assert_eq!(pushed.comp.as_ref().unwrap().get("actor"), Some(&json!(D)));
}

#[test]
fn alias_gate_refuses_a_taken_slug() {
    let s = store();
    run(&s, vec![ch(A, "doc", json!({"title": "one"})), ch(A, "alias", json!({"slug": "one"}))]);
    let err = apply(
        &s,
        vec![ch(B, "doc", json!({"title": "two"})), ch(B, "alias", json!({"slug": "one"}))],
        &ApplyOpts::default(),
        &default_gates(),
    );
    assert!(err.unwrap_err().to_string().contains("already names"));
}

#[test]
fn ghost_reference_refuses() {
    let s = store();
    let err = apply(
        &s,
        vec![ch(A, "comment", json!({"target": B}))],
        &ApplyOpts::default(),
        &default_gates(),
    );
    assert!(err.unwrap_err().to_string().contains("no such entity"));
}

// A session with an explicit origin + status, for the stop_request gate.
fn seed_managed(
    s: &WriteStore,
    eid: &str,
    label: &str,
    origin: Option<&str>,
    status: Option<&str>,
) {
    s.conn.execute("insert into entity (eid) values (?1)", [eid]).unwrap();
    s.conn
        .execute(
            "insert into session (entity, id, origin, status) values \
             ((select id from entity where eid = ?1), ?2, ?3, ?4)",
            rusqlite::params![eid, label, origin, status],
        )
        .unwrap();
}

fn seq_of(s: &WriteStore, eid: &str) -> i64 {
    s.conn
        .query_row(
            "select seq from entry where entity = (select id from entity where eid = ?1)",
            [eid],
            |r| r.get(0),
        )
        .unwrap()
}

fn is_dead(s: &WriteStore, eid: &str) -> bool {
    s.conn
        .query_row(
            "select 1 from tombstone t join entity e on e.id = t.entity where e.eid = ?1",
            [eid],
            |_| Ok(()),
        )
        .optional()
        .unwrap()
        .is_some()
}

#[test]
fn entry_create_assigns_per_session_seq() {
    let s = store();
    seed_session(&s, A, "S-1");
    // two entries appended to the same session get seq 1 then 2, and
    // session.latest_seq advances in lockstep (db.ts:4761-4782).
    let out1 = run(&s, vec![ch(B, "entry", json!({ "session": A }))]);
    let out2 = run(&s, vec![ch(C, "entry", json!({ "session": A }))]);
    assert_eq!(seq_of(&s, B), 1);
    assert_eq!(seq_of(&s, C), 2);
    let latest: i64 = one(&s, "select latest_seq from session where id = 'S-1'");
    assert_eq!(latest, 2);
    // the {eid, seq} echo rides the effective batch (a graph-native summary the
    // snapshot reads back), distinct from the entry change rewritten to {session}.
    assert!(out1.iter().any(
        |c| c.name == "entry" && c.comp.as_ref().and_then(|m| m.get("seq")) == Some(&json!(1))
    ));
    assert!(out2.iter().any(
        |c| c.name == "entry" && c.comp.as_ref().and_then(|m| m.get("seq")) == Some(&json!(2))
    ));
    // a second session numbers from 1 again — seq is per-session.
    seed_session(&s, D, "S-2");
    let e2 = "aaaaaaaa-0000-4000-8000-000000000005";
    run(&s, vec![ch(e2, "entry", json!({ "session": D }))]);
    assert_eq!(seq_of(&s, e2), 1);
}

#[test]
fn replace_wakes_supersedes_pending_untargeted() {
    let s = store();
    // an actor to address the self-wakes to.
    run(&s, vec![ch(A, "project", json!({}))]);
    // a pending untargeted self-wake to A (wake + its deliver, born together).
    run(
        &s,
        vec![
            ch(B, "wake", json!({ "at": "2099-01-01T00:00:00.000Z" })),
            ch(B, "deliver", json!({ "to": A })),
        ],
    );
    assert_eq!(one::<i64>(&s, "select count(*) from wake"), 1);
    // a fresh untargeted self-wake to A supersedes the predecessor in the same
    // transaction (db.ts replaceWakes, M-7323): B is tombstoned, only C remains.
    let out = run(
        &s,
        vec![
            ch(C, "wake", json!({ "at": "2099-02-01T00:00:00.000Z" })),
            ch(C, "deliver", json!({ "to": A })),
        ],
    );
    assert_eq!(one::<i64>(&s, "select count(*) from wake"), 1);
    assert!(is_dead(&s, B), "the superseded wake is tombstoned");
    assert!(!is_dead(&s, C), "the fresh wake survives");
    // the effective batch carries B's synthesized entity-null (the cascade).
    assert!(out.iter().any(|c| c.eid == B && c.name == "entity" && c.comp.is_none()));
}

#[test]
fn replace_wakes_spares_targeted_and_acted() {
    let s = store();
    run(&s, vec![ch(A, "project", json!({}))]);
    // a pending untargeted wake to A.
    run(
        &s,
        vec![
            ch(B, "wake", json!({ "at": "2099-01-01T00:00:00.000Z" })),
            ch(B, "deliver", json!({ "to": A })),
        ],
    );
    // a TARGETED wake to A does NOT supersede it (only untargeted self-wakes do).
    run(
        &s,
        vec![
            ch(C, "wake", json!({ "at": "2099-02-01T00:00:00.000Z", "target": A })),
            ch(C, "deliver", json!({ "to": A })),
        ],
    );
    assert!(!is_dead(&s, B), "a targeted wake spares the pending untargeted one");
    // mark B acted (a delivered facet — server-owned, seeded by SQL), then a new
    // untargeted wake to A must SPARE it: replaceWakes only drops unacted wakes.
    s.conn
        .execute(
            "insert into delivered (entity) values ((select id from entity where eid = ?1))",
            [B],
        )
        .unwrap();
    run(
        &s,
        vec![
            ch(D, "wake", json!({ "at": "2099-03-01T00:00:00.000Z" })),
            ch(D, "deliver", json!({ "to": A })),
        ],
    );
    assert!(!is_dead(&s, B), "an already-delivered wake is not superseded");
}

// The gate closure returns the deliberately-unboxed ApplyError (see write.rs).
#[test]
#[allow(clippy::result_large_err)]
fn stop_request_gate_guards_liveness() {
    let s = store();
    let gate = |eid: &str, target: &str| {
        apply(
            &s,
            vec![ch(eid, "stop_request", json!({ "target": target }))],
            &ApplyOpts::default(),
            &default_gates(),
        )
    };
    // a gone session (no row): refused.
    let gone = gate(A, B).unwrap_err().to_string();
    assert!(gone.contains("session is gone"), "got: {gone}");
    // an external session: refused (origin != managed), named by its status/external.
    seed_managed(&s, C, "S-ext", Some("external"), None);
    let ext = gate(A, C).unwrap_err().to_string();
    assert!(ext.contains("session is external"), "got: {ext}");
    // a managed session STILL GOING (active status): the stop_request commits.
    seed_managed(&s, D, "S-run", Some("managed"), Some("running"));
    let ok = run(&s, vec![ch(A, "stop_request", json!({ "target": D }))]);
    assert!(ok.iter().any(|c| c.name == "stop_request"));
    assert_eq!(one::<i64>(&s, "select count(*) from stop_request"), 1);
    // a managed session that FINISHED with no live entry: refused, named by status.
    let e5 = "aaaaaaaa-0000-4000-8000-000000000006";
    seed_managed(&s, e5, "S-dead", Some("managed"), Some("exited"));
    let e6 = "aaaaaaaa-0000-4000-8000-000000000007";
    let dead = gate(e6, e5).unwrap_err().to_string();
    assert!(dead.contains("session is exited"), "got: {dead}");
}

#[test]
fn feed_hands_each_row_once_and_replays_provenance() {
    let s = store();
    let mut feed = Feed::from_tip(&s.conn);
    run(&s, vec![ch(A, "doc", json!({"title": "x"}))]);
    run(&s, vec![ch(A, "doc", json!({"title": "y"}))]);
    let mut seen: Vec<i64> = vec![];
    feed.settle(&s.conn, &mut |r| seen.push(r.rowid));
    assert_eq!(seen.len(), 2);
    feed.settle(&s.conn, &mut |_| panic!("row handed twice"));
    // rowChanges: a birth replays as created, a later touch as updated
    let rows = journal_since(&s.conn, 0);
    let first = row_changes(&rows[0]);
    assert!(first.iter().any(|c| c.name == "created" && c.eid == A));
    let second = row_changes(&rows[1]);
    assert!(second.iter().any(|c| c.name == "updated" && c.eid == A));
    assert_eq!(cursor_of(&s.conn), 2);
}
