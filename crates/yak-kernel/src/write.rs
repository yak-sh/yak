// The kernel write path: apply() ported from src/db.ts (T-22550, D-22530 §1).
// One batch, one `begin immediate` transaction; the same semantics for every
// writer in every language, because the FILE is the coordination point:
//   - normalization (renames, the value language, the column allowlist)
//   - `was` preconditions — per-column SHA-256 against the projected row,
//     refusing the whole batch when a guarded value has moved
//   - edge triples, tombstone cascade (death words off the vocabulary),
//   - provenance stamps (created/updated + the stamp/clocked families)
//   - the journal row with its trace, so the TS catchup feed broadcasts a
//     Rust write exactly as it broadcasts its own — THAT interop is the
//     point of this module.
//
// Domain rules ride the GATE REGISTRY (D-22530): in-transaction validators a
// plugin registers against its comps. The claim lease (bounce + worked edge +
// wip drag + conflict audit) and alias uniqueness ship as the first gates. The
// resume stack (a release pushes the freed task, a re-take/settle pops it) and
// actor backfill (a cwd-bearing session with no actor gets the venture at its
// cwd) are ported here as the apply() tail (rung 5). Every in-apply TS transform
// is now ported — entry append/seq, replaceWakes, the stop_request gate, the
// mail sender derivation, and the session-facet mirroring cluster (dual_spawn /
// dual_facet / mirror_lineage) — so NATIVE_COMPS spans every wire comp but the
// one deliberate hold-out (`setting`, rung 6b), and nothing refuses mid-write.
// The bridge still PROXIES a batch touching a non-native comp; the allowlist,
// not a refusal, is what keeps an unported semantic from diverging.

use crate::change::{batch_json, Change};
use crate::store::resolve;
use crate::vocab::{vocab, PropType, Vocab};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fmt;

pub struct WriteStore {
    pub conn: Connection,
}

impl WriteStore {
    // Read-write on an EXISTING file: a library client never creates, never
    // migrates, never takes the writer baton (schema changes stay under it,
    // D-22530 §1). busy_timeout + apply's `begin immediate` are what let this
    // writer queue politely behind the server's short batches.
    pub fn open(path: &str) -> rusqlite::Result<WriteStore> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_URI,
        )?;
        conn.busy_timeout(std::time::Duration::from_millis(5000))?;
        Ok(WriteStore { conn })
    }

    pub fn from_conn(conn: Connection) -> WriteStore {
        let _ = conn.busy_timeout(std::time::Duration::from_millis(5000));
        WriteStore { conn }
    }
}

#[derive(Debug)]
pub enum ApplyError {
    Refused(String),
    // A refused precondition, carrying what is stored NOW (db.ts Stale).
    Stale { eid: String, comp: String, col: String, value: Value, id: String },
    Db(rusqlite::Error),
}

impl fmt::Display for ApplyError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            ApplyError::Refused(m) => write!(f, "{m}"),
            ApplyError::Stale { comp, col, id, value, .. } => {
                // Byte-identical to db.ts `Stale` (src/db.ts): after the lead
                // line the refusal shows `was:` the SHA of the value it prints
                // (a caller can merge into it and re-guard without re-reading —
                // it cannot hash for itself), then the current value in JS
                // `String()` form under a header. A null value hashes to the
                // literal `null` and prints as the empty tail (`value ?? ''`).
                let was = if value.is_null() { "null".to_string() } else { sha(value) };
                let shown = if value.is_null() { String::new() } else { js_string(value) };
                write!(
                    f,
                    "{comp}.{col} on {id} has moved since you read it — batch \
                     refused. Merge into the current value below and retry with \
                     its hash.\nwas: {was}\n--- current {comp}.{col} ---\n{shown}"
                )
            }
            ApplyError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl From<rusqlite::Error> for ApplyError {
    fn from(e: rusqlite::Error) -> ApplyError {
        ApplyError::Db(e)
    }
}

type Result<T> = std::result::Result<T, ApplyError>;

fn refuse(m: impl Into<String>) -> ApplyError {
    ApplyError::Refused(m.into())
}

fn q(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

// What a precondition compares (src/sha.ts): SHA-256 of String(value), null
// never hashed — it IS the "I read no value" sentinel.
pub fn sha(v: &Value) -> String {
    let mut h = Sha256::new();
    h.update(js_string(v).as_bytes());
    format!("{:x}", h.finalize())
}

// String(v) as JS spells it for the scalar column types a comp cell holds.
fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else {
                let f = n.as_f64().unwrap_or(0.0);
                if f == f.trunc() && f.abs() < 1e21 {
                    format!("{}", f as i64)
                } else {
                    format!("{f}")
                }
            }
        }
        Value::Null => "null".into(),
        other => other.to_string(),
    }
}

fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

// A JS number: an integral float prints (and journals) as an integer —
// JSON.stringify(2.0) is "2" — so REAL cells and parsed numbers carry the
// same JSON both sides of the language seam.
fn js_number(f: f64) -> Value {
    if f == f.trunc() && f.abs() < 9e15 {
        Value::from(f as i64)
    } else {
        Value::from(f)
    }
}

// ---- small readers against the write connection ----

fn to_id(conn: &Connection, eid: &str) -> Option<i64> {
    conn.query_row("select id from entity where eid = ?1", [eid], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

fn is_dead(conn: &Connection, eid: &str) -> bool {
    conn.query_row("select 1 from tombstone where eid = ?1", [eid], |r| {
        r.get::<_, i64>(0)
    })
    .optional()
    .ok()
    .flatten()
    .is_some()
}

// A file may lack a plugin's tables (D-22530 §2: readable-but-inert); the
// generic machinery — cascade walks, comp deletes — skips what isn't there
// rather than erroring.
fn has_table(conn: &Connection, t: &str) -> bool {
    conn.query_row(
        "select 1 from sqlite_master where type = 'table' and name = ?1",
        [t],
        |r| r.get::<_, i64>(0),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

fn has_col(conn: &Connection, t: &str, c: &str) -> bool {
    has_table(conn, t)
        && conn
            .query_row(
                "select 1 from pragma_table_info(?1) where name = ?2",
                [t, c],
                |r| r.get::<_, i64>(0),
            )
            .optional()
            .ok()
            .flatten()
            .is_some()
}

fn table_cols(conn: &Connection, cache: &mut HashMap<String, HashSet<String>>, t: &str) -> HashSet<String> {
    if let Some(hit) = cache.get(t) {
        return hit.clone();
    }
    let mut out = HashSet::new();
    if let Ok(mut st) = conn.prepare("select name from pragma_table_info(?1)") {
        if let Ok(rows) = st.query_map([t], |r| r.get::<_, String>(0)) {
            for c in rows.flatten() {
                out.insert(c);
            }
        }
    }
    cache.insert(t.into(), out.clone());
    out
}

// db.ts human(): the spoken id — prefix-num when numbered, short eid else.
pub fn human(conn: &Connection, eid: &str) -> String {
    let v = vocab();
    let num: Option<i64> = conn
        .query_row("select num from entity where eid = ?1", [eid], |r| r.get(0))
        .optional()
        .ok()
        .flatten();
    match num {
        Some(n) => {
            let kind = v
                .kind_order
                .iter()
                .find(|k| {
                    conn.query_row(
                        &format!(
                            "select 1 from {} where entity = \
                             (select id from entity where eid = ?1)",
                            q(k)
                        ),
                        [eid],
                        |r| r.get::<_, i64>(0),
                    )
                    .optional()
                    .ok()
                    .flatten()
                    .is_some()
                })
                .cloned()
                .unwrap_or_else(|| "entity".into());
            v.id_of(&kind, eid, Some(n))
        }
        None => eid.chars().take(8).collect(),
    }
}

// readComp: the projected row — eid first, then every readable column
// (references joined back to their target's eid), nulls kept as nulls the way
// node:sqlite hands TS the row.
fn read_comp(conn: &Connection, name: &str, eid: &str) -> Option<Map<String, Value>> {
    let v = vocab();
    if name == "entity" {
        let row: Option<(String, Option<i64>)> = conn
            .query_row(
                "select eid, num from entity where eid = ?1",
                [eid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .ok()
            .flatten();
        let (e, n) = row?;
        let mut m = Map::new();
        m.insert("eid".into(), Value::from(e));
        m.insert("num".into(), n.map(Value::from).unwrap_or(Value::Null));
        return Some(m);
    }
    let cols = v.readable(name);
    let mut joins = String::new();
    let mut sel: Vec<String> = vec!["__o.eid".into()];
    for (i, (cname, t)) in cols.iter().enumerate() {
        if t.is_ref() {
            let a = format!("__r{i}");
            joins.push_str(&format!(" left join entity {a} on {a}.id = t.{}", q(cname)));
            sel.push(format!("{a}.eid"));
        } else {
            sel.push(format!("t.{}", q(cname)));
        }
    }
    let sql = format!(
        "select {} from {} t join entity __o on __o.id = t.entity{} where __o.eid = ?1",
        sel.join(", "),
        q(name),
        joins
    );
    let mut st = conn.prepare(&sql).ok()?;
    st.query_row([eid], |r| {
        let mut m = Map::new();
        m.insert("eid".into(), Value::from(r.get::<_, String>(0)?));
        for (i, (cname, _)) in cols.iter().enumerate() {
            let v: Value = match r.get_ref(i + 1)? {
                rusqlite::types::ValueRef::Null => Value::Null,
                rusqlite::types::ValueRef::Integer(n) => Value::from(n),
                rusqlite::types::ValueRef::Real(f) => js_number(f),
                rusqlite::types::ValueRef::Text(s) => {
                    Value::from(String::from_utf8_lossy(s).to_string())
                }
                rusqlite::types::ValueRef::Blob(_) => Value::Null,
            };
            m.insert(cname.clone(), v);
        }
        Ok(m)
    })
    .optional()
    .ok()
    .flatten()
}

// ---- normalization: the value language + the column allowlist ----

fn resolve_eid(conn: &Connection, s: &str) -> Result<String> {
    if crate::store::is_uuid(&s.to_lowercase()) {
        return Ok(s.to_string());
    }
    resolve(conn, s).ok_or_else(|| refuse(format!("expects a human id / alias / UUID — got '{s}'")))
}

// The parseProp subset this kernel speaks. Times take canonical ISO stamps
// only — the word grammar ("now", "1 hour ago") is not ported and refuses
// loudly rather than storing a word a reader would take for a date.
fn parse_value(conn: &Connection, t: &PropType, name: &str, v: &Value) -> Result<Value> {
    if v.is_null() {
        return Ok(Value::Null);
    }
    match t {
        PropType::Enum(vals) => {
            let s = v.as_str().unwrap_or_default();
            if vals.iter().any(|x| x == s) {
                Ok(Value::from(s))
            } else {
                Err(refuse(format!("{name} expects one of {} — got '{s}'", vals.join(", "))))
            }
        }
        PropType::Priority => match v {
            Value::Number(n) => Ok(js_number(n.as_f64().unwrap_or(0.0))),
            Value::String(s) => {
                let raw = s.strip_prefix('P').unwrap_or(s);
                raw.parse::<f64>()
                    .map(Value::from)
                    .map_err(|_| refuse(format!("{name} expects a priority — got '{s}'")))
            }
            _ => Err(refuse(format!("{name} expects a priority"))),
        },
        PropType::Bool => match v {
            Value::Bool(b) => Ok(Value::from(*b)),
            Value::Number(n) => Ok(Value::from(n.as_i64() == Some(1))),
            Value::String(s) if s == "true" => Ok(Value::from(true)),
            Value::String(s) if s == "false" => Ok(Value::from(false)),
            _ => Err(refuse(format!("{name} expects a bool"))),
        },
        PropType::Eid(_) => {
            let s = v.as_str().ok_or_else(|| refuse(format!("{name} expects an id")))?;
            resolve_eid(conn, s).map(Value::from)
        }
        PropType::Time => {
            let s = v.as_str().unwrap_or_default();
            let iso = s.len() >= 10
                && s.as_bytes()[..4].iter().all(|b| b.is_ascii_digit())
                && s.as_bytes()[4] == b'-';
            if iso {
                Ok(Value::from(s))
            } else {
                Err(refuse(format!(
                    "{name}: time words are not ported to the rust kernel — \
                     pass an ISO stamp"
                )))
            }
        }
        PropType::Number => match v {
            Value::Number(n) => Ok(js_number(n.as_f64().unwrap_or(0.0))),
            Value::String(s) => s
                .parse::<f64>()
                .map(Value::from)
                .map_err(|_| refuse(format!("{name} expects a number — got '{s}'"))),
            _ => Err(refuse(format!("{name} expects a number"))),
        },
        _ => Ok(v.clone()),
    }
}

// Components the wire may not touch, whoever the caller (db.ts serverOwned):
// their data is written only by trusted server code beside its own journal
// record. Dropped from the batch in silence, delete included.
const SERVER_OWNED: [&str; 8] = [
    "lease", "usage", "imported", "resume", "delivered", "error", "exception", "redaction",
];

// There is no longer an UNPORTED refuse list: at rung 7c the LAST unported
// cluster — the session-facet mirroring transforms (dual_spawn / dual_facet /
// mirror_lineage above) — joined the native path, so `session` and `spawn` moved
// into NATIVE_COMPS below and every wire comp now commits natively or PROXIES by
// the allowlist, never refuses mid-write. The shape space that carved this rung
// (T-22867 → T-22872) — create-by-session-col, create-by-facet-col, one-side
// worktree/runtime updates, facet delete, parent link/unlink/rewrite, canonical-
// wins conflict, and mint-missing (the twin absent) — is proven byte-identical by
// the write-parity harness before session/spawn were admitted (M-14769: a half-
// ported facet mirror on the fleet's most central entity is exactly the silent
// divergence the allowlist exists to prevent).

// The comps the rust kernel commits NATIVELY, and the routing predicate the
// bridge derives its Deno-vs-native decision from (D-22804 rung 4). Every comp
// here is transform-free in db.ts apply() — none is read or rewritten by
// mintAddresses/canonEmail, guardSettings, dualSpawn/dualFacet/mirrorLineage,
// the resume-stack push, or actor backfill — AND proven byte-identical to the
// Deno door by the write-parity harness (crates/yak-bridge/tests/parity.rs).
//
// This is an ALLOWLIST on purpose, and the allowlist is the anti-rot structure
// M-14769 asks for rather than a denylist that silently rots: the DEFAULT for
// every other comp is PROXY-to-Deno, so a comp cannot drift into an unguarded
// native commit. A NEW vocabulary word is absent here and proxies; ADDING a
// db.ts transform to a listed comp turns this harness's parity gate red. A comp
// LEAVES the proxy default (joins this list) only when its transform is ported
// and its three-surface parity case is green — the later rungs' work.
//
// `claim` and `entity` joined the list at rung 5, once db.ts's resume-stack
// rebuild and actor backfill were ported here (the resume push a release owes,
// and the cascade→release→resume consequence of an entity delete). A claim
// take/release and an entity delete now commit natively, byte-identical to Deno.
//
// `email` and `deliver` joined at rung 6, once db.ts's address canonicalization
// was ported here (`canon`, `canon_email`, `mint_addresses` below): an
// `email.address` write is canonicalized to its deliverable spelling, and a
// `deliver.to` bearing an @-address is folded into its find-or-minted address-
// book `email` entity. `setting` is still absent by design: its guardSettings
// validates a url-typed value through WHATWG `new URL()` (default-port + dot-
// segment + IPv4/IPv6/IDNA host canonicalization), a transform a faithful port
// needs a full WHATWG URL parser for (T-22862, rung 6b) — it still PROXIES, so
// no half-ported transform ever commits natively.
//
// `entry`, `wake`, and `stop_request` joined at rung 7a, once the session/entry/
// wake cluster's self-contained in-apply pieces were ported here: an `entry`
// create assigns its per-session `seq` and advances `session.latest_seq`; an
// untargeted `wake` create tombstones every pending untargeted predecessor
// addressed to the same actor (`replace_wakes`, M-7323); a `stop_request` is
// gated to a live managed session (`StopRequestGate`).
//
// `mail` joined at rung 7b, once its ONE in-apply transform — the server-owned
// `from` derived through the session sender-actor chain — was ported here
// (`sender_actor`/`actor_for`, the full persona/actor/venture/held-work/model
// cascade the mail create-completion loop stamps). A `mail` create signs from
// its writer's address book entry byte-identically to Deno for every session
// shape, the persona-only session included.
//
// `session`, `spawn`, `worktree`, and `runtime` joined at rung 7c, once the
// facet-mirroring cluster was ported here (`dual_spawn`/`dual_facet`/
// `mirror_lineage`/`sync_facet_aliases` above): a session or facet write mirrors
// the launch spec between the `session` columns and the `spawn`/`worktree`/
// `runtime` facets both ways under one lock, syncs the facet's final row onto the
// session aliases, and a `session.parent` write links the `delegates` lineage
// edge — byte-identical to Deno across create-by-session-col, create-by-facet-col,
// one-side facet updates, facet delete, parent link/unlink/rewrite, canonical-wins
// conflict, and mint-missing. All four ride together because every one of them is
// a door into the same mirror: a bare `worktree`/`runtime` write drives dualFacet
// exactly as a `session` write does, so admitting session/spawn without them would
// route half the cluster's writes to Deno. With them the divergence list is EMPTY:
// every wire comp is native or proxies by this allowlist. `setting` is the lone
// comp still absent by design (rung 6b, T-22862).
pub const NATIVE_COMPS: [&str; 18] = [
    "doc", "task", "board", "project", "comment", "dependency", "claim", "entity", "email",
    "deliver", "entry", "wake", "stop_request", "mail", "session", "spawn", "worktree", "runtime",
];

// Can this whole batch commit through the rust kernel, or must the bridge proxy
// it to the Deno /apply? Whole-batch — apply() is atomic, so a batch that mixes
// a native comp with a transform-bearing one (or a claim, or an entity delete)
// proxies WHOLE. Empty batches proxy too (Deno owns that trivial answer). Biased
// hard to over-proxy: over-proxy is slow-but-correct, under-proxy is silent
// corruption (a transform skipped).
pub fn native_safe(changes: &[Change]) -> bool {
    !changes.is_empty() && changes.iter().all(|c| NATIVE_COMPS.contains(&c.name.as_str()))
}

// ---- fleet mail address canonicalization (src/mailaddr.ts, rung 6) ----
//
// The address book stores only the DELIVERABLE spelling of a fleet address:
// Cloudflare Email Routing rejects an underscore in the fleet domain's local-
// part at RCPT, so an `email.address` write and a `deliver.to` @-address are
// canonicalized (lowercase, underscores shed) on the way in — the same rule the
// TS door applies, so a book entry Cloudflare would bounce can never be stored.
// Every off-domain address (the owner's own, a customer's) passes untouched.

// The fleet mail domain — TASKS_MAIL_DOMAIN or the default (mailaddr.ts
// mailDomain). Read per call, matching the TS reader (no cached env).
pub fn mail_domain() -> String {
    std::env::var("TASKS_MAIL_DOMAIN")
        .ok()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "bot.yak.sh".to_string())
}

// The local-part of a fleet address, or None off-domain (mailaddr.ts fleetLocal):
// exactly one `@`, both halves non-empty, the domain (case-insensitively) ours.
fn fleet_local(address: &str) -> Option<String> {
    let parts: Vec<&str> = address.trim().split('@').collect();
    if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty()
        && parts[1].to_lowercase() == mail_domain()
    {
        Some(parts[0].to_string())
    } else {
        None
    }
}

// The canonical, deliverable form of a fleet address (mailaddr.ts canon):
// lowercase and shed underscores in the local-part; leave every other domain
// untouched. Idempotent, so re-canonicalizing a stored value is a no-op.
pub fn canon(to: &str) -> String {
    match fleet_local(to) {
        Some(local) => format!("{}@{}", local.to_lowercase().replace('_', ""), mail_domain()),
        None => to.to_string(),
    }
}

// `[A-Za-z]+-\d+` anchored (db.ts addressed's id-shape regex): the entity num
// behind a fleet address that names one by its human id (`S-31@<fleet>`).
fn id_local_num(local: &str) -> Option<i64> {
    let (pre, num) = local.split_once('-')?;
    if pre.is_empty() || !pre.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    if num.is_empty() || !num.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    num.parse::<i64>().ok()
}

// The entity already wearing this address (db.ts addressed): an address-book
// `email` (case-insensitive), or an id-shaped fleet address (`S-31@<fleet>`)
// naming one by its human id — so a mint never SHADOWS an entity the graph
// already knows. Read-only; runs before the write transaction like its TS twin.
fn addressed(conn: &Connection, addr: &str) -> Option<String> {
    let a = addr.trim();
    let worn: Option<String> = conn
        .query_row(
            "select o.eid from email e join entity o on o.id = e.entity \
             where e.address = ?1 collate nocase",
            [a],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    if worn.is_some() {
        return worn;
    }
    let local = fleet_local(a)?;
    let num = id_local_num(&local)?;
    let eid: String = conn
        .query_row("select eid from entity where num = ?1", [num], |r| r.get(0))
        .optional()
        .ok()
        .flatten()?;
    (human(conn, &eid).to_lowercase() == local.to_lowercase()).then_some(eid)
}

// A raw @-address in `deliver.to` names no eid the parser could resolve
// (db.ts mintAddresses, D-14945) — fold it into its address-book `email` entity
// (find-or-mint) and inject that mint so the reference lands with provenance.
// Canonicalized before the dedup lookup AND the mint, so an underscore spelling
// finds the canonical book entry and a fresh mint is born deliverable. Deduped
// within the batch so two letters to one new address mint it once. knock/wake
// never carry an @, so only outbound mail's deliver rows are ever touched.
fn mint_addresses(conn: &Connection, changes: Vec<Change>) -> Vec<Change> {
    let mut mints: Vec<Change> = vec![];
    let mut seen: HashMap<String, String> = HashMap::new();
    let mut out: Vec<Change> = Vec::with_capacity(changes.len());
    for mut c in changes {
        let addr = if c.name == "deliver" {
            c.comp
                .as_ref()
                .and_then(|m| m.get("to"))
                .and_then(|v| v.as_str())
                .filter(|s| s.contains('@'))
                .map(String::from)
        } else {
            None
        };
        if let Some(addr) = addr {
            let a = canon(addr.trim());
            let key = a.to_lowercase();
            let eid = match seen.get(&key) {
                Some(hit) => hit.clone(),
                None => {
                    let eid = addressed(conn, &a).unwrap_or_else(|| {
                        let e = uuid::Uuid::new_v4().to_string();
                        let mut m = Map::new();
                        m.insert("address".into(), Value::from(a.clone()));
                        mints.push(Change::new(&e, "email", Some(m)));
                        e
                    });
                    seen.insert(key, eid.clone());
                    eid
                }
            };
            if let Some(m) = c.comp.as_mut() {
                m.insert("to".into(), Value::from(eid));
            }
        }
        out.push(c);
    }
    if mints.is_empty() {
        out
    } else {
        [mints, out].concat()
    }
}

// The address book stores only the deliverable spelling: an `email.address`
// write is canonicalized here (db.ts canonEmail). Complements mint_addresses,
// which canons the addresses it mints; this covers the direct address-book write
// (a venture, a person) and re-canons the mints (idempotent).
fn canon_email(changes: Vec<Change>) -> Vec<Change> {
    changes
        .into_iter()
        .map(|mut c| {
            if c.name == "email" {
                let canoned = c
                    .comp
                    .as_ref()
                    .and_then(|m| m.get("address"))
                    .and_then(|v| v.as_str())
                    .map(canon);
                if let (Some(v), Some(m)) = (canoned, c.comp.as_mut()) {
                    m.insert("address".into(), Value::from(v));
                }
            }
            c
        })
        .collect()
}

// ---- the untargeted-wake self-replacement (db.ts replaceWakes, M-7323) ----
//
// A fresh untargeted self-wake supersedes every pending untargeted wake already
// addressed to the same actor: one alarm clock, not a growing stack. An
// untargeted wake create (a `wake` with a null target, born alongside a
// `deliver.to` in the SAME batch) prepends an entity-delete for each prior
// pending wake to that `to` — the death cascade then tombstones it, exactly as a
// wire delete would. "Pending" = unacted (neither a `delivered` nor an `error`
// facet, D-14945) and still addressed to that `to`; a due row (one a timer is
// about to fire) is NOT special-cased here — schedule.ts guards that upstream.
// An UPDATE to an existing wake (its row already present) never replaces, only a
// create does — matching TS's `exists.get(change.eid)` guard. Runs inside the
// transaction on normalized changes, where a `deliver.to` value is still an eid.
fn replace_wakes(conn: &Connection, changes: Vec<Change>) -> Vec<Change> {
    if !has_table(conn, "wake") || !has_table(conn, "deliver") {
        return changes;
    }
    // The `to` each entity's deliver names in THIS batch (a self-wake mints its
    // deliver beside the wake), keyed by owner eid.
    let mut to_of: HashMap<String, String> = HashMap::new();
    for c in &changes {
        if c.name == "deliver" {
            if let Some(to) = c.comp.as_ref().and_then(|m| m.get("to")).and_then(|v| v.as_str()) {
                to_of.insert(c.eid.clone(), to.to_string());
            }
        }
    }
    let mut out: Vec<Change> = Vec::with_capacity(changes.len());
    for change in changes {
        let to = to_of.get(&change.eid).cloned();
        let is_untargeted_wake = change.name == "wake"
            && change.comp.as_ref().is_some_and(|m| {
                m.get("target").map(|v| v.is_null()).unwrap_or(true)
            });
        let already: bool = conn
            .query_row(
                "select 1 from wake where entity = (select id from entity where eid = ?1)",
                [&change.eid],
                |_| Ok(()),
            )
            .optional()
            .ok()
            .flatten()
            .is_some();
        match to {
            Some(to) if is_untargeted_wake && !already => {
                let mut st = conn
                    .prepare(
                        "select o.eid from wake w \
                         join entity o on o.id = w.entity \
                         join deliver dl on dl.entity = w.entity \
                         where dl.\"to\" = (select id from entity where eid = ?1) \
                           and w.target is null and o.eid != ?2 \
                           and not exists (select 1 from delivered d where d.entity = w.entity) \
                           and not exists (select 1 from error e where e.entity = w.entity)",
                    )
                    .expect("replace_wakes pending query");
                let drops: Vec<String> = st
                    .query_map([&to, &change.eid], |r| r.get::<_, String>(0))
                    .map(|rows| rows.flatten().collect())
                    .unwrap_or_default();
                for eid in drops {
                    out.push(Change::new(&eid, "entity", None));
                }
                out.push(change);
            }
            _ => out.push(change),
        }
    }
    out
}

// ---- the session/spawn facet mirroring cluster (db.ts dualSpawn / dualFacet /
// mirrorLineage, rung 7c) --------------------------------------------------
//
// One session launch spec, several rolling-release homes. During a rolling
// release the old session door writes launch fields onto the `session` row
// (`session.provider`, `session.cwd`, `session.pid` …) while the new door
// writes the canonical facets (`spawn`, `worktree`, `runtime`). apply() sees
// the whole batch under one write lock, so it projects each aspect BOTH ways —
// the canonical facet wins a conflict, then the same value is written back to
// the session-column aliases — and a rollback server reading either door sees
// the same launch. Coalesced so `created(session)` effects key off ONE Trace
// row and fire once. This is the mirror image of the read-side backfill; the
// column retires only when the rolling release proves out (T-16412).
//
// These run INSIDE the transaction on already-normalized changes (so a ref
// value is an eid, a facet column is real), matching db.ts apply()'s order:
// replaceWakes → [guardSettings, proxied] → dualSpawn → dualFacet(worktree) →
// dualFacet(runtime) → mirrorLineage.

// An insertion-ordered set of eids — JS `Set` semantics: `add` appends only
// when absent (an existing member keeps its position), `delete` removes. The
// per-session loops below iterate in this order, so the effective batch — and
// thus the journal — matches db.ts change-for-change.
struct EidSet {
    order: Vec<String>,
    seen: HashSet<String>,
}
impl EidSet {
    fn new() -> EidSet {
        EidSet { order: vec![], seen: HashSet::new() }
    }
    fn add(&mut self, eid: &str) {
        if self.seen.insert(eid.to_string()) {
            self.order.push(eid.to_string());
        }
    }
    fn delete(&mut self, eid: &str) {
        if self.seen.remove(eid) {
            self.order.retain(|e| e != eid);
        }
    }
}

// The wire-writable columns of one comp, in vocabulary declaration order
// (db.ts `Object.keys(comps[name])`).
fn wire_col_names(v: &Vocab, name: &str) -> Vec<String> {
    v.comp(name).map(|c| c.iter().map(|(n, _)| n.clone()).collect()).unwrap_or_default()
}

// A facet's full column set: its wire columns then its server-stamped ones, in
// declaration order and NOT deduped (db.ts `facetCols` — the sets never
// overlap). These are what dualFacet projects between the facet row and its
// session-column aliases.
fn facet_cols(v: &Vocab, name: &str) -> Vec<String> {
    let mut out = wire_col_names(v, name);
    if let Some(s) = v.stamped.get(name) {
        for (n, _) in s {
            out.push(n.clone());
        }
    }
    out
}

fn has_session(conn: &Connection, eid: &str) -> bool {
    conn.query_row(
        "select 1 from session where entity = (select id from entity where eid = ?1)",
        [eid],
        |_| Ok(()),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

// The eids this batch mirrors: every eid a session (or the paired facet) change
// names that IS a session — a row already present, or created by a session
// change in THIS batch (a create joins). A facet-only write to a non-session
// eid never mints a session (db.ts "a task hint can never mint session"); a
// session delete or an entity delete drops the eid.
fn mirror_sessions(conn: &Connection, out: &[Change], paired: &str) -> EidSet {
    let mut sessions = EidSet::new();
    for c in out {
        if (c.name == "session" || c.name == paired) && has_session(conn, &c.eid) {
            sessions.add(&c.eid);
        }
    }
    let mut killed: HashSet<String> = HashSet::new();
    for c in out {
        if c.name == "entity" && c.comp.is_none() {
            killed.insert(c.eid.clone());
            sessions.delete(&c.eid);
        }
        if killed.contains(&c.eid) || c.name != "session" {
            continue;
        }
        if c.comp.is_none() {
            sessions.delete(&c.eid);
        } else {
            sessions.add(&c.eid);
        }
    }
    sessions
}

// dualSpawn (db.ts:3203-3268): mirror the launch spec (provider/model/effort/
// persona) between the `session` columns and the `spawn` facet. The canonical
// spawn fields win a conflict; every mirrored session grows a spawn twin (minted
// when absent), and the twin's fields are echoed back onto the session columns —
// so both doors read the same spec. A spawn delete clears the columns rather
// than tombstoning the facet.
fn dual_spawn(conn: &Connection, v: &Vocab, changes: Vec<Change>) -> Vec<Change> {
    let mut out = changes;
    let spawn_cols = wire_col_names(v, "spawn");
    let sessions = mirror_sessions(conn, &out, "spawn");
    for eid in sessions.order.clone() {
        let mut si: Vec<usize> = vec![];
        let mut pi: Vec<usize> = vec![];
        let mut legacy: Map<String, Value> = Map::new();
        let mut canonical: Map<String, Value> = Map::new();
        let mut spawn_gone = false;
        let mut spawn_at: Option<usize> = None;
        for (i, c) in out.iter().enumerate() {
            if c.eid != eid {
                continue;
            }
            if c.name == "session" {
                if let Some(comp) = &c.comp {
                    si.push(i);
                    for col in &spawn_cols {
                        if let Some(val) = comp.get(col) {
                            legacy.insert(col.clone(), val.clone());
                        }
                    }
                }
            }
            if c.name == "spawn" {
                spawn_at = Some(i);
                match &c.comp {
                    Some(comp) => {
                        pi.push(i);
                        for col in &spawn_cols {
                            if let Some(val) = comp.get(col) {
                                canonical.insert(col.clone(), val.clone());
                            }
                        }
                        spawn_gone = false;
                    }
                    None => {
                        canonical = Map::new();
                        for col in &spawn_cols {
                            canonical.insert(col.clone(), Value::Null);
                        }
                        spawn_gone = true;
                    }
                }
            }
        }
        let mut spec: Map<String, Value> = Map::new();
        for (k, val) in &legacy {
            spec.insert(k.clone(), val.clone());
        }
        for (k, val) in &canonical {
            spec.insert(k.clone(), val.clone());
        }
        for &i in si.iter().chain(pi.iter()) {
            if let Some(comp) = out[i].comp.as_mut() {
                for col in &spawn_cols {
                    comp.remove(col);
                }
            }
        }
        let mut session_idx = si.last().copied();
        if session_idx.is_none() && !canonical.is_empty() {
            out.push(Change::new(&eid, "session", Some(Map::new())));
            session_idx = Some(out.len() - 1);
        }
        if let Some(idx) = session_idx {
            let comp = out[idx].comp.get_or_insert_with(Map::new);
            for (k, val) in &spec {
                comp.insert(k.clone(), val.clone());
            }
        }
        let mut spawn_idx = if spawn_gone { spawn_at } else { pi.last().copied() };
        if spawn_gone {
            if let Some(idx) = spawn_idx {
                out[idx].comp = Some(Map::new());
            }
        }
        if spawn_idx.is_none() {
            out.push(Change::new(&eid, "spawn", Some(Map::new())));
            spawn_idx = Some(out.len() - 1);
        }
        if let Some(idx) = spawn_idx {
            let comp = out[idx].comp.get_or_insert_with(Map::new);
            for (k, val) in &spec {
                comp.insert(k.clone(), val.clone());
            }
        }
    }
    out
}

// The existing facet row's columns as a map (db.ts `current`) — the base a
// one-column facet update projects the untouched columns from. Absent row ⇒
// empty, matching JS `{...undefined}`.
fn read_facet_row(conn: &Connection, name: &str, eid: &str, cols: &[String]) -> Map<String, Value> {
    let sql = format!(
        "select {} from {} where entity = (select id from entity where eid = ?1)",
        cols.iter().map(|c| q(c)).collect::<Vec<_>>().join(", "),
        q(name),
    );
    conn.query_row(&sql, [eid], |row| {
        let mut m = Map::new();
        for (i, col) in cols.iter().enumerate() {
            let val = match row.get_ref(i) {
                Ok(rusqlite::types::ValueRef::Null) | Err(_) => Value::Null,
                Ok(rusqlite::types::ValueRef::Integer(n)) => Value::from(n),
                Ok(rusqlite::types::ValueRef::Real(f)) => Value::from(f),
                Ok(rusqlite::types::ValueRef::Text(t)) => {
                    Value::from(String::from_utf8_lossy(t).to_string())
                }
                Ok(rusqlite::types::ValueRef::Blob(b)) => Value::from(String::from_utf8_lossy(b).to_string()),
            };
            m.insert(col.clone(), val);
        }
        Ok(m)
    })
    .optional()
    .ok()
    .flatten()
    .unwrap_or_default()
}

// dualFacet worktree/runtime (db.ts:3320-3407): project one facet (worktree or
// runtime) between its canonical component and the matching session columns,
// both directions, under one lock. The canonical facet write wins; its columns
// that ARE session columns are echoed onto the session (aliases), the wire-
// writable facet columns are (re)written from the merged spec, and untouched
// columns come from the existing row (`current`). A facet delete nulls every
// session alias and tombstones the facet component.
fn dual_facet(conn: &Connection, v: &Vocab, changes: Vec<Change>, name: &str) -> Vec<Change> {
    if !has_table(conn, name) {
        return changes;
    }
    let mut out = changes;
    let cols = facet_cols(v, name);
    let session_cols = wire_col_names(v, "session");
    let facet_wire = wire_col_names(v, name);
    let sessions = mirror_sessions(conn, &out, name);
    for eid in sessions.order.clone() {
        let current = read_facet_row(conn, name, &eid, &cols);
        let mut si: Vec<usize> = vec![];
        let mut fi: Vec<usize> = vec![];
        let mut legacy: Map<String, Value> = Map::new();
        let mut canonical: Map<String, Value> = Map::new();
        let mut legacy_touched = false;
        let mut canonical_touched = false;
        let mut gone = false;
        for (i, c) in out.iter().enumerate() {
            if c.eid != eid {
                continue;
            }
            if c.name == "session" {
                if let Some(comp) = &c.comp {
                    si.push(i);
                    for col in &cols {
                        if let Some(val) = comp.get(col) {
                            legacy.insert(col.clone(), val.clone());
                            legacy_touched = true;
                        }
                    }
                }
            }
            if c.name != name {
                continue;
            }
            fi.push(i);
            canonical_touched = true;
            match &c.comp {
                Some(comp) => {
                    for col in &cols {
                        if let Some(val) = comp.get(col) {
                            canonical.insert(col.clone(), val.clone());
                        }
                    }
                    gone = false;
                }
                None => {
                    canonical = Map::new();
                    for col in &cols {
                        canonical.insert(col.clone(), Value::Null);
                    }
                    gone = true;
                }
            }
        }
        if !legacy_touched && !canonical_touched {
            continue;
        }
        let mut spec: Map<String, Value> = Map::new();
        for (k, val) in &current {
            spec.insert(k.clone(), val.clone());
        }
        for (k, val) in &legacy {
            spec.insert(k.clone(), val.clone());
        }
        for (k, val) in &canonical {
            spec.insert(k.clone(), val.clone());
        }
        for &i in &si {
            if let Some(comp) = out[i].comp.as_mut() {
                for col in &cols {
                    comp.remove(col);
                }
            }
        }
        let mut aliases: Map<String, Value> = Map::new();
        for col in &session_cols {
            if let Some(val) = spec.get(col) {
                aliases.insert(col.clone(), val.clone());
            }
        }
        let mut session_idx = si.last().copied();
        if session_idx.is_none() {
            out.push(Change::new(&eid, "session", Some(Map::new())));
            session_idx = Some(out.len() - 1);
        }
        if let Some(idx) = session_idx {
            let comp = out[idx].comp.get_or_insert_with(Map::new);
            for (k, val) in &aliases {
                comp.insert(k.clone(), val.clone());
            }
        }
        let facet_idx = fi.last().copied();
        if gone {
            if let Some(idx) = facet_idx {
                out[idx].comp = None;
            }
            continue;
        }
        let facet_idx = match facet_idx {
            Some(idx) => idx,
            None => {
                out.push(Change::new(&eid, name, Some(Map::new())));
                out.len() - 1
            }
        };
        let mut writable: Map<String, Value> = Map::new();
        for col in &facet_wire {
            if let Some(val) = spec.get(col) {
                writable.insert(col.clone(), val.clone());
            }
        }
        let comp = out[facet_idx].comp.get_or_insert_with(Map::new);
        for (k, val) in &writable {
            comp.insert(k.clone(), val.clone());
        }
    }
    out
}

// mirrorLineage (db.ts:3283-3314): a `session.parent` write also links (or, on a
// rewrite/clear, unlinks) the `parent delegates child` edge, so edge readers see
// lineage no matter which door wrote the column. The PRE-batch parent names the
// outgoing edge — safe because apply() holds the whole batch under one lock.
fn mirror_lineage(conn: &Connection, changes: Vec<Change>) -> Vec<Change> {
    // The last parent each touched session names, in first-touch order (JS Map).
    let mut order: Vec<String> = vec![];
    let mut last: HashMap<String, Option<String>> = HashMap::new();
    for c in &changes {
        if c.name != "session" {
            continue;
        }
        if let Some(comp) = &c.comp {
            if !comp.contains_key("parent") {
                continue;
            }
        }
        let next = c
            .comp
            .as_ref()
            .and_then(|m| m.get("parent"))
            .and_then(|v| v.as_str())
            .map(String::from);
        if !last.contains_key(&c.eid) {
            order.push(c.eid.clone());
        }
        last.insert(c.eid.clone(), next);
    }
    if order.is_empty() {
        return changes;
    }
    let mut out = changes;
    for eid in &order {
        let next = last.get(eid).cloned().flatten();
        let prior: Option<String> = conn
            .query_row(
                "select p.eid from session s join entity p on p.id = s.parent \
                 where s.entity = (select id from entity where eid = ?1)",
                [eid],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        if let Some(prior_eid) = &prior {
            if Some(prior_eid) != next.as_ref() {
                let mut m = Map::new();
                m.insert("type".into(), Value::from("delegates"));
                m.insert("child".into(), Value::from(eid.as_str()));
                m.insert("gone".into(), Value::from(true));
                out.push(Change::new(prior_eid, "dependency", Some(m)));
            }
        }
        if let Some(next_eid) = &next {
            if prior.as_ref() != Some(next_eid) {
                let mut m = Map::new();
                m.insert("type".into(), Value::from("delegates"));
                m.insert("child".into(), Value::from(eid.as_str()));
                out.push(Change::new(next_eid, "dependency", Some(m)));
            }
        }
    }
    out
}

// syncFacetAliases (db.ts:3409-3440): the POST-write half of the mirror. After
// every component patch lands, each facet a batch TOUCHED has its FINAL row
// (every facet column, stamped branch/base_revision/provider_session_id/
// serving_model included) mirrored onto the session's alias columns and echoed
// as a `session` change — so a rollback server and an old client read the same
// launch without the facet gaining stamp authority. A deleted facet syncs
// all-null. This is why dualFacet only aliases the WRITABLE session columns
// while this covers the stamped ones too, off the persisted row. Runs on the
// effective batch, before mint_num, so the echo lands ahead of the birth stamps.
fn sync_facet_aliases(
    conn: &Connection,
    v: &Vocab,
    changes: &[Change],
    extra: &mut Vec<Change>,
) -> Result<()> {
    for name in ["worktree", "runtime"] {
        if !has_table(conn, name) {
            continue;
        }
        let cols = facet_cols(v, name);
        // eids a facet-name change touched, in first-appearance order (JS Set).
        let mut eids: Vec<String> = vec![];
        let mut seen: HashSet<String> = HashSet::new();
        for c in changes {
            if c.name == name && seen.insert(c.eid.clone()) {
                eids.push(c.eid.clone());
            }
        }
        for eid in eids {
            if !has_session(conn, &eid) {
                continue;
            }
            // The facet's final row, every column present (null when the row is
            // gone) so the session aliases and the echo carry the full spec.
            let row = read_facet_row(conn, name, &eid, &cols);
            let mut spec: Map<String, Value> = Map::new();
            for col in &cols {
                spec.insert(col.clone(), row.get(col).cloned().unwrap_or(Value::Null));
            }
            let set = cols
                .iter()
                .enumerate()
                .map(|(i, c)| format!("{} = ?{}", q(c), i + 1))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "update session set {} where entity = (select id from entity where eid = ?{})",
                set,
                cols.len() + 1
            );
            let mut params: Vec<Value> = cols.iter().map(|c| spec[c].clone()).collect();
            params.push(Value::from(eid.as_str()));
            exec_change(conn, &sql, &params)?;
            extra.push(Change::new(&eid, "session", Some(spec)));
        }
    }
    Ok(())
}

fn renamed(v: &Vocab, change: Change) -> Result<Change> {
    let map = v.prop_renames();
    if map.is_empty() {
        return Ok(change);
    }
    let mut name = map.get(&change.name).cloned().unwrap_or(change.name.clone());
    let comp = match change.comp {
        None => None,
        Some(m) => {
            let mut out = Map::new();
            for (col, val) in m {
                match map.get(&format!("{}.{col}", change.name)) {
                    None => {
                        out.insert(col, val);
                    }
                    Some(to) => {
                        let (dc, dcol) = match to.split_once('.') {
                            Some((a, b)) => (a.to_string(), b.to_string()),
                            None => (name.clone(), to.clone()),
                        };
                        if dc != name {
                            if name != change.name {
                                return Err(refuse(format!(
                                    "rename splits {} across {name}, {dc}",
                                    change.name
                                )));
                            }
                            name = dc;
                        }
                        out.insert(dcol, val);
                    }
                }
            }
            Some(out)
        }
    };
    Ok(Change { eid: change.eid, name, comp, was: change.was })
}

const EDGE_COLS: [&str; 4] = ["type", "child", "ord", "gone"];

// The wire allowlist for one component. `entity` is the spine: known to the
// wire with NO writable columns (db.ts cmps merges `entity: []` by hand —
// num is server-owned), so a bare touch mints and a comp:null deletes, while
// a num write drops like any unwritable column.
fn wire_cols(v: &Vocab, name: &str) -> Option<Vec<String>> {
    if name == "entity" {
        return Some(vec![]);
    }
    v.comp(name).map(|c| c.iter().map(|(n, _)| n.clone()).collect())
}

fn admitted(
    conn: &Connection,
    cache: &mut HashMap<String, HashSet<String>>,
    change: Change,
) -> Result<Option<Change>> {
    let v = vocab();
    let change = renamed(v, change)?;
    let table = change.name.clone();
    let dep = table == "dependency";
    let cols: Vec<String> = if dep {
        EDGE_COLS.iter().map(|s| s.to_string()).collect()
    } else {
        match wire_cols(v, &table) {
            Some(c) => c,
            None => return Ok(None), // unknown comp — a newer client's seam
        }
    };
    if SERVER_OWNED.contains(&table.as_str()) {
        return Ok(None);
    }
    let Some(comp) = change.comp else { return Ok(Some(change)) };
    let sent: Vec<(String, Value)> = comp.into_iter().filter(|(n, _)| n != "eid").collect();
    let real = table_cols(conn, cache, &table);
    let alien: Vec<String> = sent
        .iter()
        .filter(|(n, _)| !cols.contains(n) && !real.contains(n))
        .map(|(n, _)| format!("{table}.{n}"))
        .collect();
    if !alien.is_empty() {
        let s = if alien.len() > 1 { "s" } else { "" };
        return Err(refuse(format!("unknown column{s}: {}", alien.join(", "))));
    }
    let kept: Vec<(String, Value)> =
        sent.iter().filter(|(n, _)| cols.contains(n)).cloned().collect();
    if !sent.is_empty() && kept.is_empty() {
        return Ok(None);
    }
    let mut m = Map::new();
    for (n, val) in kept {
        m.insert(n, val);
    }
    Ok(Some(Change { comp: Some(m), ..change }))
}

fn normalize(conn: &Connection, changes: Vec<Change>) -> Result<Vec<Change>> {
    let v = vocab();
    let mut cache = HashMap::new();
    let mut out = vec![];
    for change in changes {
        let eid = resolve_eid(conn, &change.eid)?;
        let comp = match &change.comp {
            None => None,
            Some(m) => {
                let mut parsed = Map::new();
                for (col, val) in m {
                    let t = if change.name == "dependency" {
                        match col.as_str() {
                            "type" => Some(PropType::Enum(v.edges.clone())),
                            "child" => Some(PropType::Eid("entity".into())),
                            "gone" => Some(PropType::Bool),
                            _ => None,
                        }
                    } else {
                        v.comp(&change.name)
                            .and_then(|cols| cols.iter().find(|(n, _)| n == col))
                            .map(|(_, t)| t.clone())
                    };
                    let val = match t {
                        Some(t) => parse_value(
                            conn,
                            &t,
                            &format!("{}.{col}", change.name),
                            val,
                        )?,
                        None => val.clone(),
                    };
                    parsed.insert(col.clone(), val);
                }
                Some(parsed)
            }
        };
        let change = Change { eid, comp, ..change };
        if let Some(kept) = admitted(conn, &mut cache, change)? {
            out.push(kept);
        }
    }
    Ok(out)
}

// ---- the gate registry (D-22530): in-transaction validators per comp ----

pub struct Bounce {
    pub target: String,
    pub loser: String,
    pub holder: String,
}

pub struct GateCx<'a> {
    pub conn: &'a Connection,
    pub change: &'a Change,
    pub extra: Vec<Change>,
    pub touch: Vec<String>,
    pub bounce: Option<Bounce>,
}

pub trait Gate {
    fn on_change(&self, cx: &mut GateCx) -> Result<()>;
}

// The claim LEASE (sessions plugin's rule, registered by default until the
// plugin split): taking another session's claim fails the whole batch loudly;
// a landing claim writes the durable `worked` edge and drags an open task to
// wip, exactly as db.ts does.
pub struct ClaimGate;

impl Gate for ClaimGate {
    fn on_change(&self, cx: &mut GateCx) -> Result<()> {
        let c = cx.change;
        if c.name != "claim" {
            return Ok(());
        }
        let Some(comp) = &c.comp else { return Ok(()) };
        let session = comp.get("session").and_then(|v| v.as_str()).unwrap_or_default();
        let cur: Option<(Option<String>, Option<String>)> = cx
            .conn
            .query_row(
                "select cs.eid, s.id from claim c \
                 left join session s on s.entity = c.session \
                 left join entity cs on cs.id = c.session \
                 where c.entity = (select id from entity where eid = ?1)",
                [&c.eid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((holder_eid, holder_id)) = cur {
            let holder_eid = holder_eid.unwrap_or_default();
            if holder_eid != session {
                let loser: Option<String> = cx
                    .conn
                    .query_row(
                        "select s.id from session s join entity o on o.id = s.entity \
                         where o.eid = ?1",
                        [session],
                        |r| r.get(0),
                    )
                    .optional()?;
                let holder_label = holder_id
                    .clone()
                    .unwrap_or_else(|| human(cx.conn, &holder_eid));
                cx.bounce = Some(Bounce {
                    target: c.eid.clone(),
                    loser: loser.unwrap_or_else(|| session.to_string()),
                    holder: holder_id.unwrap_or(holder_eid),
                });
                return Err(refuse(format!(
                    "{} already claimed by {holder_label}",
                    human(cx.conn, &c.eid)
                )));
            }
        }
        // The durable edge, echoed on first landing only.
        let sid = to_id(cx.conn, session);
        let tid = to_id(cx.conn, &c.eid);
        if let (Some(sid), Some(tid)) = (sid, tid) {
            let n = cx.conn.execute(
                "insert or ignore into dependency (parent, type, child) \
                 values (?1, 'worked', ?2)",
                [sid, tid],
            )?;
            if n > 0 {
                cx.touch.push(session.to_string());
                cx.touch.push(c.eid.clone());
                let mut m = Map::new();
                m.insert("type".into(), Value::from("worked"));
                m.insert("child".into(), Value::from(c.eid.as_str()));
                cx.extra.push(Change::new(session, "dependency", Some(m)));
            }
        }
        // A claim implies wip: open → wip in the same transaction.
        let status: Option<String> = cx
            .conn
            .query_row(
                "select status from task where entity = \
                 (select id from entity where eid = ?1)",
                [&c.eid],
                |r| r.get(0),
            )
            .optional()?;
        if status.as_deref() == Some("open") {
            cx.conn.execute(
                "update task set status = 'wip' where entity = \
                 (select id from entity where eid = ?1)",
                [&c.eid],
            )?;
            cx.touch.push(c.eid.clone());
            let mut m = Map::new();
            m.insert("status".into(), Value::from("wip"));
            cx.extra.push(Change::new(&c.eid, "task", Some(m)));
        }
        Ok(())
    }
}

// Alias uniqueness (a kernel comp): every member of the set must be free or
// already this eid's.
pub struct AliasGate;

impl Gate for AliasGate {
    fn on_change(&self, cx: &mut GateCx) -> Result<()> {
        let c = cx.change;
        if c.name != "alias" {
            return Ok(());
        }
        let Some(comp) = &c.comp else { return Ok(()) };
        let cur: Option<(Option<String>, Option<String>)> = cx
            .conn
            .query_row(
                "select slug, slugs from alias where entity = \
                 (select id from entity where eid = ?1)",
                [&c.eid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (cur_slug, cur_slugs) = cur.unwrap_or((None, None));
        let slug = comp
            .get("slug")
            .and_then(|v| v.as_str().map(String::from))
            .or(cur_slug);
        let extra = if comp.contains_key("slugs") {
            comp.get("slugs").and_then(|v| v.as_str().map(String::from))
        } else {
            cur_slugs
        };
        let mut set: Vec<String> = vec![];
        if let Some(s) = slug {
            set.push(s);
        }
        if let Some(s) = extra {
            set.extend(s.split_whitespace().map(String::from));
        }
        let mut seen = HashSet::new();
        for s in set {
            if !seen.insert(s.clone()) {
                return Err(refuse(format!("alias {s} is listed twice")));
            }
            let owner: Option<String> = cx
                .conn
                .query_row(
                    "select o.eid from alias a join entity o on o.id = a.entity \
                     where o.eid != ?1 and (a.slug = ?2 or instr(' ' || \
                     coalesce(a.slugs, '') || ' ', ' ' || ?2 || ' ') > 0)",
                    [&c.eid, &s],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(owner) = owner {
                return Err(refuse(format!(
                    "alias {s} already names {}",
                    human(cx.conn, &owner)
                )));
            }
        }
        Ok(())
    }
}

// The statuses a managed session counts as "still going" (types.ts
// sessionActive). A stop_request is a lever only these — or a live graph-native
// entry — may be pulled on.
const SESSION_ACTIVE: [&str; 3] = ["starting", "running", "stopping"];

// The stop_request LIVENESS gate (db.ts:4477-4528): a stop_request is a lever,
// not a note — it may only be pulled on a MANAGED session that is still going
// (an active status, OR a live graph-native entry the run has not yet settled).
// Anything else — a gone session, an external one, a finished managed one with
// no live entry — bounces the whole batch loudly, like a taken claim. The stop
// itself is a post-commit EFFECT; this is only the rule half.
pub struct StopRequestGate;

impl Gate for StopRequestGate {
    fn on_change(&self, cx: &mut GateCx) -> Result<()> {
        let c = cx.change;
        if c.name != "stop_request" {
            return Ok(());
        }
        let Some(comp) = &c.comp else { return Ok(()) };
        let Some(target) = comp.get("target").and_then(|v| v.as_str()) else {
            return Ok(());
        };
        // origin + status of the target session (its own eid names its row).
        let s: Option<(Option<String>, Option<String>)> = cx
            .conn
            .query_row(
                "select s.origin, s.status from session s \
                 join entity o on o.id = s.entity where o.eid = ?1",
                [target],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        // A managed session that is NOT active is still stoppable if it has a
        // live graph-native entry — an unsettled generation or an open call, and
        // not imported/errored/cancelled. Computed only when the status gate does
        // not already pass, so a plugin-less file never needs the entry tables.
        let active = matches!(&s, Some((Some(origin), Some(status)))
            if origin == "managed" && SESSION_ACTIVE.contains(&status.as_str()));
        let managed = matches!(&s, Some((Some(origin), _)) if origin == "managed");
        let graph = if managed && !active && has_table(cx.conn, "entry") {
            cx.conn
                .query_row(
                    "select 1 from entry e \
                     where e.session = (select id from entity where eid = ?1) and ( \
                       exists (select 1 from lease l where l.entity = e.entity) \
                       or ( \
                         not exists (select 1 from imported i where i.entity = e.entity) \
                         and not exists (select 1 from error x where x.entity = e.entity) \
                         and not exists (select 1 from cancel z where z.target = e.entity) \
                         and ( \
                           (exists (select 1 from generation g where g.entity = e.entity) \
                            and not exists (select 1 from delivered d where d.entity = e.entity)) \
                           or \
                           (exists (select 1 from call k where k.entity = e.entity) \
                            and not exists (select 1 from result r where r.call = e.entity)) \
                         ) \
                       ) \
                     ) limit 1",
                    [target],
                    |_| Ok(()),
                )
                .optional()?
                .is_some()
        } else {
            false
        };
        if !managed || (!active && !graph) {
            let desc = match &s {
                Some((_, status)) => status.clone().unwrap_or_else(|| "external".to_string()),
                None => "gone".to_string(),
            };
            return Err(refuse(format!("stop_request refused: session is {desc}")));
        }
        Ok(())
    }
}

pub fn default_gates() -> Vec<Box<dyn Gate>> {
    vec![Box::new(ClaimGate), Box::new(AliasGate), Box::new(StopRequestGate)]
}

// ---- apply ----

pub struct ApplyOpts<'a> {
    // Who's writing, when the door knows — a session id/eid, a client eid,
    // or an actor eid standing for itself. Resolved for the journal and the
    // provenance defaults, never trusted for auth.
    pub writer: Option<&'a str>,
    // fed: the caller defers effect dispatch to the journal feed, so the
    // Trace is serialized into journal.trace (ecc2c5f). false = no effects
    // journaled — a foreign writer with no effect owner of its own.
    pub fed: bool,
}

impl Default for ApplyOpts<'_> {
    fn default() -> Self {
        ApplyOpts { writer: None, fed: false }
    }
}

// The box owner, IF there is exactly one person (db.ts ownerActor): the sole
// human a bare browser tab is recorded as. With several people it goes dark
// rather than guess; an agent or the server's own machinery never reaches it.
fn owner_actor(conn: &Connection) -> Option<String> {
    let mut st = conn
        .prepare("select o.eid from person p join entity o on o.id = p.entity")
        .ok()?;
    let people: Vec<String> = st.query_map([], |r| r.get(0)).ok()?.flatten().collect();
    if people.len() == 1 { people.into_iter().next() } else { None }
}

// The project a session's WORK names when its cwd doesn't (db.ts workProject,
// D-21308): the project of a task it holds (newest lease first), else of the
// task it was spawned for. `sid` is the session's `entity` int id, which is
// what claim.session and session.requested_task key on.
fn work_project(conn: &Connection, sid: i64) -> Option<String> {
    let held: Option<Option<String>> = conn
        .query_row(
            "select (select eid from entity where id = t.project) \
             from claim c join task t on t.entity = c.entity \
             where c.session = ?1 and t.project is not null \
             order by c.rowid desc limit 1",
            [sid],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    if let Some(eid) = held {
        return eid;
    }
    conn.query_row(
        "select (select eid from entity where id = t.project) \
         from session s join task t on t.entity = s.requested_task \
         where s.entity = ?1 and t.project is not null",
        [sid],
        |r| r.get(0),
    )
    .optional()
    .ok()
    .flatten()
    .flatten()
}

// The cascade's terminal (db.ts modelActor, D-21308): the model ENTITY whose
// name matches the wire spelling a session's model columns speak. A lookup,
// never a mint — an unknown spelling leaves attribution None.
fn model_actor(conn: &Connection, name: Option<&str>) -> Option<String> {
    let name = name?;
    conn.query_row(
        "select (select eid from entity where id = m.entity) from model m \
         where m.name = ?1 order by m.entity limit 1",
        [name],
        |r| r.get(0),
    )
    .optional()
    .ok()
    .flatten()
    .flatten()
}

// The actor a write acts FOR, resolved from the writer the door named (db.ts
// actorFor). A session speaks as the D-21308 attribution cascade: the most
// specific persona in force, else its explicit actor, else the project it
// stands in (its cwd's venture, then the project of the work it holds), else
// the model that ran — persona and model backed by the spawn twin. A client
// speaks as its person; a browser tab that named nobody resolves to the box
// owner ONLY when `human` (provenance's inference — a signature is not allowed
// it, T-9511). A writer naming an actor entity directly stands for itself.
// A write that resolves to nobody stays blank — machinery is not a person.
fn actor_for(conn: &Connection, writer: Option<&str>, human: bool) -> Option<String> {
    let w = writer?;
    struct Sess {
        sid: i64,
        cwd: Option<String>,
        actor: Option<String>,
        persona: Option<String>,
        served: Option<String>,
        model: Option<String>,
    }
    let s: Option<Sess> = conn
        .query_row(
            "select s.entity, s.cwd, \
                    (select eid from entity where id = s.actor), \
                    (select eid from entity where id = coalesce(s.persona, sp.persona)), \
                    s.serving_model, \
                    coalesce(s.model, sp.model) \
             from session s left join spawn sp on sp.entity = s.entity \
             where s.id = ?1 or s.entity = (select id from entity where eid = ?1)",
            [w],
            |r| {
                Ok(Sess {
                    sid: r.get(0)?,
                    cwd: r.get(1)?,
                    actor: r.get(2)?,
                    persona: r.get(3)?,
                    served: r.get(4)?,
                    model: r.get(5)?,
                })
            },
        )
        .optional()
        .ok()
        .flatten();
    if let Some(Sess { sid, cwd, actor, persona, served, model }) = s {
        return persona
            .or(actor)
            .or_else(|| venture_at(conn, cwd.as_deref()))
            .or_else(|| work_project(conn, sid))
            .or_else(|| model_actor(conn, served.as_deref()))
            .or_else(|| model_actor(conn, model.as_deref()));
    }
    let c: Option<Option<String>> = conn
        .query_row(
            "select (select eid from entity where id = c.actor) from client c \
             where c.entity = (select id from entity where eid = ?1)",
            [w],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    if let Some(actor) = c {
        return actor.or_else(|| if human { owner_actor(conn) } else { None });
    }
    let a: Option<i64> = conn
        .query_row(
            "select 1 from person where entity = (select id from entity where eid = ?1) \
             union select 1 from project where entity = (select id from entity where eid = ?1)",
            [w],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    a.map(|_| w.to_string())
}

// writerActor: who a write is RECORDED as (created.by, journal.actor). A bare
// tab may be recorded as the box owner.
fn writer_actor(conn: &Connection, writer: Option<&str>) -> Option<String> {
    actor_for(conn, writer, true)
}

// senderActor: who a letter SIGNS as (mail.from). The same chain minus the
// owner inference — the fleet's highest-trust byline, which a tab may not
// claim (T-9511). Nothing resolved means nothing signed, and mail.ts refuses
// to deliver an unsigned letter.
fn sender_actor(conn: &Connection, writer: Option<&str>) -> Option<String> {
    actor_for(conn, writer, false)
}

fn writer_via(conn: &Connection, writer: Option<&str>) -> Option<String> {
    let w = writer?;
    for sql in [
        "select (select eid from entity where id = s.entity) from session s \
         where s.id = ?1 or s.entity = (select id from entity where eid = ?1)",
        "select (select eid from entity where id = c.entity) from client c \
         where c.entity = (select id from entity where eid = ?1)",
        "select (select eid from entity where id = r.entity) from runner r \
         where r.entity = (select id from entity where eid = ?1)",
    ] {
        let hit: Option<Option<String>> =
            conn.query_row(sql, [w], |r| r.get(0)).optional().ok().flatten();
        if let Some(eid) = hit.flatten() {
            return Some(eid);
        }
    }
    None
}

fn spine(conn: &Connection, eid: &str) -> Result<bool> {
    Ok(conn.execute("insert or ignore into entity (eid) values (?1)", [eid])? > 0)
}

const UNNUMBERED: [&str; 2] = ["entry", "wake"];

fn mint_num(conn: &Connection, eid: &str) -> Result<()> {
    let v = vocab();
    let kind = v
        .kind_order
        .iter()
        .find(|k| {
            conn.query_row(
                &format!(
                    "select 1 from {} where entity = \
                     (select id from entity where eid = ?1)",
                    q(k)
                ),
                [eid],
                |r| r.get::<_, i64>(0),
            )
            .optional()
            .ok()
            .flatten()
            .is_some()
        })
        .cloned()
        .unwrap_or_else(|| "entity".into());
    if UNNUMBERED.contains(&kind.as_str()) {
        return Ok(());
    }
    let n: i64 = conn.query_row(
        "select coalesce(max(num), 0) + 1 from \
         (select num from entity union all select num from tombstone)",
        [],
        |r| r.get(0),
    )?;
    conn.execute("update entity set num = ?1 where eid = ?2 and num is null", (n, eid))?;
    Ok(())
}

fn push_touch(touched: &mut Vec<String>, eid: &str) {
    if !touched.iter().any(|t| t == eid) {
        touched.push(eid.to_string());
    }
}

// The stamp family (db.ts stamps): wire lacks via, stamped has via, union
// has at + by — created/updated named out.
fn stamp_family(v: &Vocab) -> Vec<String> {
    v.comps
        .iter()
        .filter(|(name, cols)| {
            if name == "created" || name == "updated" {
                return false;
            }
            let wire_via = cols.iter().any(|(n, _)| n == "via");
            let Some(st) = v.stamped.get(name) else { return false };
            let st_via = st.iter().any(|(n, _)| n == "via");
            let union_has = |k: &str| {
                cols.iter().any(|(n, _)| n == k) || st.iter().any(|(n, _)| n == k)
            };
            !wire_via && st_via && union_has("at") && union_has("by")
        })
        .map(|(n, _)| n.clone())
        .collect()
}

fn clocked_family(v: &Vocab) -> Vec<String> {
    v.comps
        .iter()
        .filter(|(name, cols)| {
            cols.is_empty()
                && v.stamped
                    .get(name)
                    .map(|s| s.len() == 1 && s[0].0 == "at")
                    .unwrap_or(false)
        })
        .map(|(n, _)| n.clone())
        .collect()
}

fn ref_to_id(
    conn: &Connection,
    name: &str,
    owner: &str,
    col: &str,
    v: &Value,
) -> Result<Value> {
    if v.is_null() {
        return Ok(Value::Null);
    }
    let eid = v.as_str().unwrap_or_default();
    let id = to_id(conn, eid);
    let gone = is_dead(conn, eid);
    match id {
        Some(id) if !gone => Ok(Value::from(id)),
        _ => Err(refuse(format!(
            "{name} {} refused: {col} → {} ({})",
            human(conn, owner),
            human(conn, eid),
            if gone { "tombstoned" } else { "no such entity" }
        ))),
    }
}

// A bound VALUE for storage: bools land as ints, everything else as itself.
fn bind_value(t: Option<&PropType>, v: &Value) -> Value {
    match (t, v) {
        (Some(PropType::Bool), Value::Bool(b)) => Value::from(*b as i64),
        _ => v.clone(),
    }
}

fn exec_change(
    conn: &Connection,
    sql: &str,
    params: &[Value],
) -> rusqlite::Result<usize> {
    let mut st = conn.prepare_cached(sql)?;
    let bind: Vec<Box<dyn rusqlite::ToSql>> = params
        .iter()
        .map(|v| -> Box<dyn rusqlite::ToSql> {
            match v {
                Value::Null => Box::new(rusqlite::types::Null),
                Value::Bool(b) => Box::new(*b as i64),
                Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        Box::new(i)
                    } else {
                        Box::new(n.as_f64().unwrap_or(0.0))
                    }
                }
                Value::String(s) => Box::new(s.clone()),
                other => Box::new(other.to_string()),
            }
        })
        .collect();
    let refs: Vec<&dyn rusqlite::ToSql> = bind.iter().map(|b| b.as_ref()).collect();
    st.execute(refs.as_slice())
}

// ---- the resume stack + actor backfill (db.ts apply() tail) ----

// A settled task is off every stack (types.ts settled): done or cancelled.
fn settled(status: &str) -> bool {
    status == "done" || status == "cancelled"
}

// A claim as it stood BEFORE this batch — captured at the top of the
// transaction so a release (the claim row gone by commit) still knows who held
// it, from where, and in what nested order (db.ts priorClaims, src/db.ts:4183).
#[derive(Clone)]
struct PriorClaim {
    eid: String,        // the CLAIMED entity (a task), keyed on resume.entity
    claimed_at: String, // the lease's stamp — the outer sort key
    claim_order: i64,   // the claim row's rowid — the tiebreak within one stamp
    actor: Option<String>, // the holder session's actor eid, or None
    cwd: Option<String>,   // the holder session's cwd, for the ventureAt fallback
}

fn prior_claims(conn: &Connection) -> Vec<PriorClaim> {
    if !has_table(conn, "claim") {
        return vec![];
    }
    let mut st = match conn.prepare(
        "select co.eid, c.claimed_at, c.rowid, act.eid, s.cwd \
         from claim c \
         join entity co on co.id = c.entity \
         left join session s on s.entity = c.session \
         left join entity act on act.id = s.actor",
    ) {
        Ok(st) => st,
        Err(_) => return vec![],
    };
    let rows = st.query_map([], |r| {
        Ok(PriorClaim {
            eid: r.get(0)?,
            claimed_at: r.get(1)?,
            claim_order: r.get(2)?,
            actor: r.get(3)?,
            cwd: r.get(4)?,
        })
    });
    match rows {
        Ok(rows) => rows.flatten().collect(),
        Err(_) => vec![],
    }
}

fn task_status(conn: &Connection, eid: &str) -> Option<String> {
    conn.query_row(
        "select status from task where entity = (select id from entity where eid = ?1)",
        [eid],
        |r| r.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

// Path helpers mirroring node's, enough for ventureAt (client.ts ancestorAt +
// db.ts worktreeGitdir). Fleet cwds are absolute, so `resolve` is normalize.
fn clean_path(p: &str) -> String {
    let t = p.trim_end_matches('/');
    if t.is_empty() {
        "/".into()
    } else {
        t.into()
    }
}

fn dirname(p: &str) -> String {
    let c = clean_path(p);
    match c.rfind('/') {
        Some(0) => "/".into(),
        Some(i) => c[..i].into(),
        None => c,
    }
}

// path.resolve(base, rel): an absolute rel wins outright, else it joins onto
// base (fleet .git files carry an absolute gitdir, so the first arm is the one
// taken).
fn resolve_path(base: &str, rel: &str) -> String {
    if rel.starts_with('/') {
        clean_path(rel)
    } else {
        clean_path(&format!("{}/{}", clean_path(base), rel))
    }
}

// The deepest repo-root prefix of a path (client.ts ancestorAt).
fn ancestor_at(roots: &[String], path: &str) -> Option<String> {
    let mut best: Option<String> = None;
    for root in roots {
        let root = clean_path(root);
        if (path == root || path.starts_with(&format!("{root}/")))
            && root.len() > best.as_deref().map(str::len).unwrap_or(0)
        {
            best = Some(root);
        }
    }
    best
}

// db.ts worktreeGitdir: walk up from cwd for a `.git` FILE naming a linked
// worktree's gitdir. A `.git` DIRECTORY (the main checkout) has no `gitdir:`
// line, so the walk continues past it, exactly as the TS `read().match` does.
fn worktree_gitdir(cwd: &str) -> Option<String> {
    let mut at = clean_path(cwd);
    loop {
        let content = std::fs::read_to_string(format!("{at}/.git")).unwrap_or_default();
        let gitdir = content
            .lines()
            .find_map(|l| l.trim_start().strip_prefix("gitdir:").map(|s| s.trim()));
        if let Some(g) = gitdir {
            return Some(resolve_path(&at, g));
        }
        let parent = dirname(&at);
        if parent == at {
            return None;
        }
        at = parent;
    }
}

// db.ts ventureAt: the repo a cwd stands in — the repo whose path prefixes it,
// else the repo whose gitdir owns the linked worktree. Returns the repo's eid.
// The one filesystem read in the write path, and it fires only for the venture
// fallback of a session with a cwd but no actor.
fn venture_at(conn: &Connection, cwd: Option<&str>) -> Option<String> {
    let cwd = cwd.filter(|c| !c.is_empty())?;
    if !has_table(conn, "repo") {
        return None;
    }
    let mut st = conn
        .prepare("select o.eid, r.path from repo r join entity o on o.id = r.entity")
        .ok()?;
    let repos: Vec<(String, String)> = st
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .ok()?
        .flatten()
        .collect();
    let paths: Vec<String> = repos.iter().map(|(_, p)| p.clone()).collect();
    if let Some(at) = ancestor_at(&paths, cwd) {
        return repos.iter().find(|(_, p)| clean_path(p) == at).map(|(e, _)| e.clone());
    }
    let gitdir = worktree_gitdir(cwd)?;
    let roots: Vec<String> =
        repos.iter().map(|(_, p)| resolve_path(p, ".git/worktrees")).collect();
    let common = ancestor_at(&roots, &gitdir)?;
    repos
        .iter()
        .find(|(_, p)| resolve_path(p, ".git/worktrees") == common)
        .map(|(e, _)| e.clone())
}

pub fn apply(
    store: &WriteStore,
    changes: Vec<Change>,
    opts: &ApplyOpts,
    gates: &[Box<dyn Gate>],
) -> Result<Vec<Change>> {
    let conn = &store.conn;
    let v = vocab();
    // Pre-normalize address canonicalization (db.ts apply() head, rung 6): a raw
    // @-address in `deliver.to` becomes its find-or-minted address-book `email`
    // entity, then every `email.address` (the mints included) is canonicalized.
    // Both run before normalize so the injected mints and rewritten refs pass
    // through the value language and column allowlist like any other change.
    let changes = mint_addresses(conn, changes);
    let changes = canon_email(changes);
    let mut changes = normalize(conn, changes)?;

    let mut extra: Vec<Change> = vec![];
    let mut touched: Vec<String> = vec![];
    let mut minted: Vec<String> = vec![];
    let mut created_comps: Vec<String> = vec![];
    let mut removed_log: Vec<(String, Vec<String>)> = vec![];
    let mut said_creator: HashSet<String> = HashSet::new();
    let mut said_editor: HashSet<String> = HashSet::new();
    let mut bounce: Option<Bounce> = None;
    let took = |log: &mut Vec<(String, Vec<String>)>, eid: &str, name: &str| {
        match log.iter_mut().find(|(e, _)| e == eid) {
            Some((_, names)) => names.push(name.to_string()),
            None => log.push((eid.to_string(), vec![name.to_string()])),
        }
    };

    conn.execute_batch("begin immediate").map_err(ApplyError::Db)?;
    let out: Result<Vec<Change>> = (|| {
        // Snapshot the claims as they stand BEFORE this batch mutates them, so a
        // release (its claim row gone by commit) still knows who held it — the
        // resume-stack rebuild below reads this against the FINAL claims.
        let prior = prior_claims(conn);
        // An untargeted self-wake supersedes its pending predecessors in the same
        // transaction (db.ts replaceWakes) — prepend their entity-deletes so the
        // spine/kill pass and the cascade below see them like any wire delete.
        changes = replace_wakes(conn, changes);
        // The session-facet mirroring cluster (db.ts apply() order: after
        // replaceWakes and the proxied guardSettings): mirror the launch spec
        // between the `session` columns and the `spawn`/`worktree`/`runtime`
        // facets both ways under one lock, and link/unlink the lineage edge a
        // `session.parent` write implies. On normalized changes, so a facet
        // column and a `parent` ref are already values.
        changes = dual_spawn(conn, v, changes);
        changes = dual_facet(conn, v, changes, "worktree");
        changes = dual_facet(conn, v, changes, "runtime");
        changes = mirror_lineage(conn, changes);
        // Mint spines in first-touch order before writing components.
        let mut killed: HashSet<String> = HashSet::new();
        for c in &changes {
            if c.name == "entity" && c.comp.is_none() {
                killed.insert(c.eid.clone());
                continue;
            }
            let known = c.name == "dependency" || wire_cols(v, &c.name).is_some();
            if c.comp.is_none() || c.name == "dependency" || !known
                || killed.contains(&c.eid) || is_dead(conn, &c.eid)
            {
                continue;
            }
            if spine(conn, &c.eid)? && !minted.contains(&c.eid) {
                minted.push(c.eid.clone());
            }
        }
        // Track kind-constrained reference writes for the post-pass check.
        let kind_refs: Vec<(String, String, String)> = v
            .deaths
            .iter()
            .filter_map(|(name, col, _)| {
                match v.prop_type(name, col) {
                    Some(PropType::Eid(target)) if target != "entity" => {
                        Some((name.clone(), col.clone(), target))
                    }
                    _ => None,
                }
            })
            .collect();
        let mut ref_writes: Vec<(usize, String)> = vec![]; // (kind_refs idx, owner eid)
        let mut target_drops: Vec<(usize, String)> = vec![]; // (kind_refs idx, dropped eid)

        for ci in 0..changes.len() {
            let change = changes[ci].clone();
            let Change { eid, name, comp, was } = &change;
            // ---- edges: a TRIPLE, not a row ----
            if name == "dependency" {
                let Some(comp) = comp else { continue };
                let child = comp.get("child").and_then(|c| c.as_str()).unwrap_or_default();
                if is_dead(conn, eid) || is_dead(conn, child) {
                    continue;
                }
                let n: i64 = conn.query_row(
                    "select count(*) from entity where eid in (?1, ?2)",
                    [eid, child],
                    |r| r.get(0),
                )?;
                if n != 2 {
                    eprintln!("sync: edge for {eid} dropped — missing endpoint");
                    continue;
                }
                let pid = to_id(conn, eid).unwrap_or_default();
                let cid = to_id(conn, child).unwrap_or_default();
                let typ = comp.get("type").and_then(|t| t.as_str()).unwrap_or_default();
                conn.execute_batch("savepoint change")?;
                let done: rusqlite::Result<()> = (|| {
                    if comp.get("gone").map(truthy).unwrap_or(false) {
                        conn.execute(
                            "delete from dependency where parent = ?1 and type = ?2 \
                             and child = ?3",
                            rusqlite::params![pid, typ, cid],
                        )?;
                    } else if comp.contains_key("ord") {
                        let ord = comp.get("ord").cloned().unwrap_or(Value::Null);
                        exec_change(
                            conn,
                            "insert into dependency (parent, type, child, ord) \
                             values (?1, ?2, ?3, ?4) on conflict(parent, type, child) \
                             do update set ord = excluded.ord",
                            &[Value::from(pid), Value::from(typ), Value::from(cid), ord],
                        )?;
                    } else {
                        conn.execute(
                            "insert or ignore into dependency (parent, type, child) \
                             values (?1, ?2, ?3)",
                            rusqlite::params![pid, typ, cid],
                        )?;
                    }
                    Ok(())
                })();
                match done {
                    Ok(()) => {
                        conn.execute_batch("release change")?;
                        push_touch(&mut touched, eid);
                        push_touch(&mut touched, child);
                    }
                    Err(e) => {
                        conn.execute_batch("rollback to change; release change")?;
                        eprintln!("sync: edge for {eid} dropped — {e}");
                    }
                }
                continue;
            }
            let cols: Vec<(String, PropType)> = if name == "entity" {
                vec![]
            } else {
                match v.comp(name) {
                    Some(c) => c.clone(),
                    None => continue,
                }
            };
            push_touch(&mut touched, eid);
            if let Some(m) = comp {
                if m.contains_key("by") {
                    if name == "created" {
                        said_creator.insert(eid.clone());
                    }
                    if name == "updated" {
                        said_editor.insert(eid.clone());
                    }
                }
            }
            // A deleted entity stays deleted.
            if is_dead(conn, eid) {
                continue;
            }
            for (i, (rname, rcol, target)) in kind_refs.iter().enumerate() {
                let wrote = comp
                    .as_ref()
                    .and_then(|m| m.get(rcol))
                    .map(|x| !x.is_null())
                    .unwrap_or(false);
                if rname == name && wrote {
                    ref_writes.push((i, eid.clone()));
                }
                if target == name && comp.is_none() {
                    target_drops.push((i, eid.clone()));
                }
            }
            // ---- the precondition: the graph's --ff-only ----
            if let Some(was) = was {
                let row = read_comp(conn, name, eid);
                let mut real: HashSet<String> = HashSet::from(["eid".to_string()]);
                for (n, _) in v.readable(name) {
                    real.insert(n);
                }
                for (col, want) in was {
                    if !real.contains(col) {
                        return Err(refuse(format!("unknown column: {name}.{col}")));
                    }
                    let cur = row
                        .as_ref()
                        .and_then(|r| r.get(col))
                        .cloned()
                        .unwrap_or(Value::Null);
                    let want = want.as_str().map(String::from);
                    let have = if cur.is_null() { None } else { Some(sha(&cur)) };
                    if have == want {
                        continue;
                    }
                    return Err(ApplyError::Stale {
                        eid: eid.clone(),
                        comp: name.clone(),
                        col: col.clone(),
                        value: cur,
                        id: human(conn, eid),
                    });
                }
            }
            // ---- gates: the plugins' in-transaction rules ----
            for g in gates {
                let mut cx = GateCx {
                    conn,
                    change: &change,
                    extra: vec![],
                    touch: vec![],
                    bounce: None,
                };
                let r = g.on_change(&mut cx);
                for t in cx.touch {
                    push_touch(&mut touched, &t);
                }
                extra.extend(cx.extra);
                if cx.bounce.is_some() {
                    bounce = cx.bounce;
                }
                r?;
            }
            // ---- deletes ----
            if comp.is_none() {
                if name != "entity" {
                    let n = conn.execute(
                        &format!(
                            "delete from {} where entity = \
                             (select id from entity where eid = ?1)",
                            q(name)
                        ),
                        [eid],
                    )?;
                    if n > 0 {
                        took(&mut removed_log, eid, name);
                    }
                    continue;
                }
                // A redaction audit may not be erased.
                let redacted: Option<i64> = conn
                    .query_row(
                        "select 1 from redaction where entity = \
                         (select id from entity where eid = ?1)",
                        [eid],
                        |r| r.get(0),
                    )
                    .optional()
                    .unwrap_or(None);
                if redacted.is_some() {
                    return Err(refuse(format!(
                        "{} is a permanent redaction audit",
                        human(conn, eid)
                    )));
                }
                // Death spreads to entities that exist ABOUT the dead one.
                let aimed = v.deaths_of("cascade");
                let released = v.deaths_of("release");
                let detached = v.deaths_of("detach");
                let mut doomed: Vec<String> = vec![eid.clone()];
                let mut i = 0;
                while i < doomed.len() {
                    let did = to_id(conn, &doomed[i]);
                    i += 1;
                    let Some(did) = did else { continue };
                    for (t, col) in &aimed {
                        if !has_col(conn, t, col) {
                            continue;
                        }
                        let mut st = conn.prepare_cached(&format!(
                            "select o.eid from {} r join entity o on o.id = r.entity \
                             where r.{} = ?1",
                            q(t),
                            q(col)
                        ))?;
                        let rows: Vec<String> =
                            st.query_map([did], |r| r.get(0))?.flatten().collect();
                        for r in rows {
                            if !doomed.contains(&r) {
                                doomed.push(r);
                            }
                        }
                    }
                }
                for d in doomed.clone() {
                    let Some(did) = to_id(conn, &d) else { continue };
                    for (t, col) in &released {
                        if !has_col(conn, t, col) {
                            continue;
                        }
                        let mut st = conn.prepare_cached(&format!(
                            "select o.eid from {} r join entity o on o.id = r.entity \
                             where r.{} = ?1",
                            q(t),
                            q(col)
                        ))?;
                        let freed: Vec<String> =
                            st.query_map([did], |r| r.get(0))?.flatten().collect();
                        conn.execute(
                            &format!("delete from {} where {} = ?1", q(t), q(col)),
                            [did],
                        )?;
                        for held in freed {
                            if doomed.contains(&held) {
                                continue;
                            }
                            took(&mut removed_log, &held, t);
                            push_touch(&mut touched, &held);
                            extra.push(Change::new(&held, t, None));
                        }
                    }
                    for (t, col) in &detached {
                        if !has_col(conn, t, col) {
                            continue;
                        }
                        let mut st = conn.prepare_cached(&format!(
                            "select o.eid from {} r join entity o on o.id = r.entity \
                             where r.{} = ?1",
                            q(t),
                            q(col)
                        ))?;
                        let homed: Vec<String> =
                            st.query_map([did], |r| r.get(0))?.flatten().collect();
                        conn.execute(
                            &format!("update {} set {} = null where {} = ?1", q(t), q(col), q(col)),
                            [did],
                        )?;
                        for orphan in homed {
                            if doomed.contains(&orphan) {
                                continue;
                            }
                            push_touch(&mut touched, &orphan);
                            let mut m = Map::new();
                            m.insert(col.clone(), Value::Null);
                            extra.push(Change::new(&orphan, t, Some(m)));
                        }
                    }
                    for (cname, _) in v.comps.iter().rev() {
                        if cname == "entity" {
                            continue;
                        }
                        let n = conn
                            .execute(
                                &format!("delete from {} where entity = ?1", q(cname)),
                                [did],
                            )
                            .unwrap_or(0);
                        if n > 0 {
                            took(&mut removed_log, &d, cname);
                        }
                    }
                    // stamped-only tables (created/updated/…) go with the
                    // entity too — they are not in comps but their rows
                    // belong to it.
                    for cname in v.stamped.keys() {
                        if v.comp(cname).is_some() {
                            continue;
                        }
                        let _ = conn.execute(
                            &format!("delete from {} where entity = ?1", q(cname)),
                            [did],
                        );
                    }
                    conn.execute(
                        "delete from dependency where parent = ?1 or child = ?1",
                        [did],
                    )?;
                }
                let stamp = now_iso();
                for d in doomed {
                    conn.execute(
                        "insert or ignore into tombstone (eid, num, deleted_at) \
                         values (?1, (select num from entity where eid = ?1), ?2)",
                        [&d, &stamp],
                    )?;
                    if d != *eid {
                        extra.push(Change::new(&d, "entity", None));
                    }
                }
                continue;
            }
            // ---- entity bare touch mints the spine ----
            if name == "entity" {
                if spine(conn, eid)? && !minted.contains(eid) {
                    minted.push(eid.clone());
                }
                continue;
            }
            // ---- component write: update first, then create ----
            let comp = comp.as_ref().unwrap();
            let mut sent: Vec<String> =
                cols.iter().map(|(n, _)| n.clone()).filter(|c| comp.contains_key(c)).collect();
            let mut vals: Vec<Value> = vec![];
            for c in &sent {
                let t = cols.iter().find(|(n, _)| n == c).map(|(_, t)| t);
                let raw = comp.get(c).unwrap();
                let bound = match t {
                    Some(PropType::Eid(_)) => ref_to_id(conn, name, eid, c, raw)?,
                    other => bind_value(other, raw),
                };
                vals.push(bound);
            }
            let mut hit = 0usize;
            if !sent.is_empty() {
                let sql = format!(
                    "update {} set {} where entity = (select id from entity where eid = ?{})",
                    q(name),
                    sent.iter()
                        .enumerate()
                        .map(|(i, c)| format!("{} = ?{}", q(c), i + 1))
                        .collect::<Vec<_>>()
                        .join(", "),
                    sent.len() + 1
                );
                let mut params = vals.clone();
                params.push(Value::from(eid.as_str()));
                hit = exec_change(conn, &sql, &params).map_err(|e| {
                    refuse(format!("{name} {} refused: {e}", human(conn, eid)))
                })?;
            }
            if hit > 0 {
                continue;
            }
            // doc is title-optional on CREATE (T-10397): supply the empty
            // title at the sole doc writer.
            if name == "doc" && !comp.contains_key("title") {
                sent.insert(0, "title".into());
                vals.insert(0, Value::from(""));
            }
            conn.execute_batch("savepoint change")?;
            // An entry create assigns its per-session seq below; the echo of
            // {eid, seq} is pushed to `extra` after the savepoint closes.
            let mut entry_echo: Option<(String, i64)> = None;
            let created: Result<()> = (|| {
                if spine(conn, eid)? && !minted.contains(eid) {
                    minted.push(eid.clone());
                }
                if name == "entry" && !sent.is_empty() {
                    // A log entry is an append-only fact (db.ts:4761-4782): seq =
                    // max(seq)+1 for the session, and session.latest_seq advances
                    // in the SAME transaction so the two can never drift. The
                    // graph-native summary rides the snapshot's whole-row select,
                    // not a per-entry broadcast — so only {eid, seq} is echoed.
                    let session_eid =
                        comp.get("session").and_then(|v| v.as_str()).unwrap_or_default();
                    let sid = to_id(conn, session_eid);
                    let seq: i64 = conn.query_row(
                        "select coalesce(max(seq), 0) + 1 from entry where session = ?1",
                        [sid],
                        |r| r.get(0),
                    )?;
                    conn.execute(
                        "insert into entry (entity, session, seq) values \
                         ((select id from entity where eid = ?1), ?2, ?3)",
                        rusqlite::params![eid, sid, seq],
                    )
                    .map_err(|e| refuse(format!("entry {} refused: {e}", human(conn, eid))))?;
                    conn.execute(
                        "update session set latest_seq = ?1 where entity = ?2",
                        rusqlite::params![seq, sid],
                    )?;
                    created_comps.push(format!("{name} {eid}"));
                    entry_echo = Some((eid.clone(), seq));
                } else if !sent.is_empty() {
                    let sql = format!(
                        "insert into {} (entity{}) values \
                         ((select id from entity where eid = ?{}){})",
                        q(name),
                        sent.iter().map(|c| format!(", {}", q(c))).collect::<String>(),
                        sent.len() + 1,
                        (0..sent.len()).map(|i| format!(", ?{}", i + 1)).collect::<String>(),
                    );
                    let mut params = vals.clone();
                    params.push(Value::from(eid.as_str()));
                    exec_change(conn, &sql, &params).map_err(|e| {
                        refuse(format!("{name} {} refused: {e}", human(conn, eid)))
                    })?;
                    created_comps.push(format!("{name} {eid}"));
                } else {
                    let n = conn.execute(
                        &format!(
                            "insert or ignore into {} (entity) values \
                             ((select id from entity where eid = ?1))",
                            q(name)
                        ),
                        [eid],
                    )?;
                    if n > 0 {
                        created_comps.push(format!("{name} {eid}"));
                    }
                }
                Ok(())
            })();
            match created {
                Ok(()) => conn.execute_batch("release change")?,
                Err(e) => {
                    conn.execute_batch("rollback to change; release change")?;
                    return Err(e);
                }
            }
            // The entry's seq echo rides `extra` (the generic completion loop
            // later rewrites this entry change's own comp to {session}).
            if let Some((e, seq)) = entry_echo {
                let mut m = Map::new();
                m.insert("eid".into(), Value::from(e.as_str()));
                m.insert("seq".into(), Value::from(seq));
                extra.push(Change::new(&e, "entry", Some(m)));
            }
        }
        // Canonical session facets are the read truth: mirror each touched
        // facet's final row onto the session aliases and echo it (db.ts
        // syncFacetAliases), after every patch and before the birth stamps.
        sync_facet_aliases(conn, v, &changes, &mut extra)?;
        // Components have landed: assign human numbers to this batch's births.
        for eid in &minted {
            mint_num(conn, eid)?;
        }
        // Kind-constrained references must point at rows wearing the target
        // comp (db.ts refRefused).
        for (i, owner) in &ref_writes {
            let (name, col, target) = &kind_refs[*i];
            check_ref(conn, name, col, target, Some(owner), None)?;
        }
        for (i, dropped) in &target_drops {
            let (name, col, target) = &kind_refs[*i];
            check_ref(conn, name, col, target, None, Some(dropped))?;
        }
        // One clock for the whole batch.
        let now = now_iso();
        let actor = writer_actor(conn, opts.writer);
        let via = writer_via(conn, opts.writer);
        let actor_id = actor.as_deref().and_then(|a| to_id(conn, a));
        let via_id = via.as_deref().and_then(|a| to_id(conn, a));
        let alive = |eid: &str| -> bool {
            to_id(conn, eid).is_some() && !is_dead(conn, eid)
        };
        // ---- the resume stack (db.ts:4877-4936) ----
        // Taking a task again pops it; settling one removes it; releasing an
        // unsettled task pushes it for the holder's actor. Guarded on the table
        // existing so a plugin-less file simply skips it.
        if has_table(conn, "resume") {
            let final_claims: HashSet<String> = {
                let mut st = conn
                    .prepare("select co.eid from claim c join entity co on co.id = c.entity")?;
                let set = st
                    .query_map([], |r| r.get::<_, String>(0))?
                    .flatten()
                    .collect();
                set
            };
            // Every claim/task the batch named: taken-again pops, settled pops;
            // a released-and-unsettled one is left for the push below.
            let mut clear: Vec<String> = vec![];
            for c in &changes {
                if (c.name == "claim" || c.name == "task") && !clear.contains(&c.eid) {
                    clear.push(c.eid.clone());
                }
            }
            for eid in &clear {
                let task = task_status(conn, eid);
                let released_unsettled = !final_claims.contains(eid)
                    && task.as_deref().map(|s| !settled(s)).unwrap_or(false);
                if released_unsettled {
                    continue;
                }
                let n = conn.execute(
                    "delete from resume where entity = \
                     (select id from entity where eid = ?1)",
                    [eid],
                )?;
                if n > 0 {
                    took(&mut removed_log, eid, "resume");
                    extra.push(Change::new(eid, "resume", None));
                }
            }
            // The released set: prior claims whose task lost its claim and is
            // unsettled, keyed by claimed_at then the claim's nested order.
            let mut released: Vec<PriorClaim> = prior
                .iter()
                .filter(|c| !final_claims.contains(&c.eid))
                .filter(|c| task_status(conn, &c.eid).map(|s| !settled(&s)).unwrap_or(false))
                .map(|c| {
                    let actor =
                        c.actor.clone().or_else(|| venture_at(conn, c.cwd.as_deref()));
                    PriorClaim { actor, ..c.clone() }
                })
                .filter(|c| c.actor.is_some())
                .collect();
            released.sort_by(|a, b| {
                a.claimed_at.cmp(&b.claimed_at).then(a.claim_order.cmp(&b.claim_order))
            });
            let mut top: i64 = conn
                .query_row("select coalesce(max(rank), 0) from resume", [], |r| {
                    r.get::<_, f64>(0)
                })
                .map(|f| f as i64)
                .unwrap_or(0);
            for item in released {
                top += 1;
                let actor = item.actor.unwrap();
                let actor_id = to_id(conn, &actor);
                exec_change(
                    conn,
                    "insert into resume (entity, actor, at, rank) values \
                     ((select id from entity where eid = ?1), ?2, ?3, ?4) \
                     on conflict(entity) do update set actor = excluded.actor, \
                     at = excluded.at, rank = excluded.rank",
                    &[
                        Value::from(item.eid.as_str()),
                        actor_id.map(Value::from).unwrap_or(Value::Null),
                        Value::from(now.as_str()),
                        Value::from(top),
                    ],
                )?;
                let mut m = Map::new();
                m.insert("actor".into(), Value::from(actor));
                m.insert("at".into(), Value::from(now.as_str()));
                m.insert("rank".into(), Value::from(top));
                extra.push(Change::new(&item.eid, "resume", Some(m)));
            }
        }
        // ---- actor backfill (db.ts:4946-4967) ----
        // A session that RAN somewhere but named no actor gets one from where it
        // stands — the writing identity is never blank. Only a session with a
        // cwd (a real run), and only to FILL a gap; a named actor is kept.
        if has_table(conn, "session") {
            for eid in &touched {
                let row: Option<(Option<String>, Option<String>)> = conn
                    .query_row(
                        "select s.cwd, (select eid from entity where id = s.actor) \
                         from session s join entity o on o.id = s.entity \
                         where o.eid = ?1",
                        [eid],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()?;
                let Some((cwd, actor)) = row else { continue };
                if actor.is_some() || cwd.is_none() {
                    continue;
                }
                if let Some(a) = venture_at(conn, cwd.as_deref()) {
                    let aid = to_id(conn, &a);
                    conn.execute(
                        "update session set actor = ?1 where entity = \
                         (select id from entity where eid = ?2)",
                        rusqlite::params![aid, eid],
                    )?;
                    let mut m = Map::new();
                    m.insert("actor".into(), Value::from(a));
                    extra.push(Change::new(eid, "session", Some(m)));
                }
            }
        }
        for eid in &minted {
            if !alive(eid) {
                continue;
            }
            if said_creator.contains(eid) {
                exec_change(
                    conn,
                    "update created set at = ?1, via = ?2 where entity = \
                     (select id from entity where eid = ?3)",
                    &[
                        Value::from(now.as_str()),
                        via_id.map(Value::from).unwrap_or(Value::Null),
                        Value::from(eid.as_str()),
                    ],
                )?;
            } else {
                exec_change(
                    conn,
                    "insert or ignore into created (entity, at, \"by\", via) \
                     values ((select id from entity where eid = ?1), ?2, ?3, ?4)",
                    &[
                        Value::from(eid.as_str()),
                        Value::from(now.as_str()),
                        actor_id.map(Value::from).unwrap_or(Value::Null),
                        via_id.map(Value::from).unwrap_or(Value::Null),
                    ],
                )?;
            }
            if let Some(row) = read_comp(conn, "created", eid) {
                extra.push(Change::new(eid, "created", Some(row)));
            }
        }
        for eid in &touched {
            if minted.contains(eid) || !alive(eid) {
                continue;
            }
            if said_editor.contains(eid) {
                exec_change(
                    conn,
                    "update updated set at = ?1, via = ?2 where entity = \
                     (select id from entity where eid = ?3)",
                    &[
                        Value::from(now.as_str()),
                        via_id.map(Value::from).unwrap_or(Value::Null),
                        Value::from(eid.as_str()),
                    ],
                )?;
            } else {
                exec_change(
                    conn,
                    "insert into updated (entity, at, \"by\", via) values \
                     ((select id from entity where eid = ?1), ?2, ?3, ?4) \
                     on conflict(entity) do update set at = excluded.at, \
                     \"by\" = excluded.\"by\", via = excluded.via",
                    &[
                        Value::from(eid.as_str()),
                        Value::from(now.as_str()),
                        actor_id.map(Value::from).unwrap_or(Value::Null),
                        via_id.map(Value::from).unwrap_or(Value::Null),
                    ],
                )?;
            }
            if let Some(row) = read_comp(conn, "updated", eid) {
                extra.push(Change::new(eid, "updated", Some(row)));
            }
        }
        // The stamp + clocked families: fill the actor gap on insert only,
        // then re-read so an optimistic cache never keeps a blank stamp.
        let stamps = stamp_family(v);
        let clocked = clocked_family(v);
        for c in &changes {
            if c.comp.is_none() || !stamps.contains(&c.name) || !alive(&c.eid) {
                continue;
            }
            if created_comps.contains(&format!("{} {}", c.name, c.eid)) {
                exec_change(
                    conn,
                    &format!(
                        "update {} set \"by\" = coalesce(\"by\", ?1), via = ?2 \
                         where entity = (select id from entity where eid = ?3)",
                        q(&c.name)
                    ),
                    &[
                        actor_id.map(Value::from).unwrap_or(Value::Null),
                        via_id.map(Value::from).unwrap_or(Value::Null),
                        Value::from(c.eid.as_str()),
                    ],
                )?;
            }
            if let Some(row) = read_comp(conn, &c.name, &c.eid) {
                extra.push(Change::new(&c.eid, &c.name, Some(row)));
            }
        }
        for c in &changes {
            if c.comp.is_none() || !clocked.contains(&c.name) || !alive(&c.eid) {
                continue;
            }
            if created_comps.contains(&format!("{} {}", c.name, c.eid)) {
                exec_change(
                    conn,
                    &format!(
                        "update {} set at = ?1 where entity = \
                         (select id from entity where eid = ?2)",
                        q(&c.name)
                    ),
                    &[Value::from(now.as_str()), Value::from(c.eid.as_str())],
                )?;
            }
            if let Some(row) = read_comp(conn, &c.name, &c.eid) {
                extra.push(Change::new(&c.eid, &c.name, Some(row)));
            }
        }
        // The mail SENDER, derived (db.ts:5093-5112). `from` is off the wire
        // (types.ts), so this is its only writer: a created mail speaks as the
        // actor that WROTE it — senderActor, created.by's chain MINUS the owner
        // inference (T-9511: a tab may be RECORDED as the owner but never SIGN
        // as them). An actor with no address book entry leaves `from` empty
        // rather than failing the batch — the refusal to send belongs at
        // delivery, where mailed() stamps the error, not here. Runs after the
        // stamp/clocked echoes and before the create-completion pass, so the
        // `mail`-from echo lands in `extra` exactly where Deno pushes it.
        if has_table(conn, "mail") && has_table(conn, "email") {
            if let Some(addr) = sender_actor(conn, opts.writer).and_then(|signer| {
                conn.query_row(
                    "select address from email where entity = \
                     (select id from entity where eid = ?1)",
                    [signer.as_str()],
                    |r| r.get::<_, String>(0),
                )
                .optional()
                .ok()
                .flatten()
            }) {
                for key in &created_comps {
                    let Some(eid) = key.strip_prefix("mail ") else { continue };
                    if !alive(eid) {
                        continue;
                    }
                    conn.execute(
                        "update mail set \"from\" = ?1 where entity = \
                         (select id from entity where eid = ?2)",
                        rusqlite::params![addr, eid],
                    )?;
                    let mut m = Map::new();
                    m.insert("eid".into(), Value::from(eid));
                    m.insert("from".into(), Value::from(addr.as_str()));
                    extra.push(Change::new(eid, "mail", Some(m)));
                }
            }
        }
        // A create may omit columns SQLite defaults; make the last write for
        // that new component complete, so caches see the persisted shape.
        for key in &created_comps {
            let Some(cut) = key.find(' ') else { continue };
            let (name, eid) = (&key[..cut], &key[cut + 1..]);
            let Some(cols) = v.comp(name) else { continue };
            if cols.is_empty() {
                continue;
            }
            let Some(full) = read_comp(conn, name, eid) else { continue };
            let mut row = Map::new();
            for (cname, _) in cols {
                if let Some(val) = full.get(cname) {
                    row.insert(cname.clone(), val.clone());
                }
            }
            if let Some(i) = changes
                .iter()
                .rposition(|c| c.eid == eid && c.name == name && c.comp.is_some())
            {
                changes[i].comp = Some(row);
            }
        }
        // Births ride the return AFTER stamping, so the spine arrives final.
        for eid in &minted {
            let born: Option<(String, Option<i64>)> = conn
                .query_row(
                    "select eid, num from entity e where e.eid = ?1 and not exists \
                     (select 1 from tombstone t where t.eid = e.eid)",
                    [eid],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if let Some((e, n)) = born {
                let mut m = Map::new();
                m.insert("eid".into(), Value::from(e));
                m.insert("num".into(), n.map(Value::from).unwrap_or(Value::Null));
                extra.push(Change::new(eid, "entity", Some(m)));
            }
        }
        // ---- the journal: the wire's record, inside the transaction ----
        let echoed: HashSet<String> = ["created".to_string(), "updated".to_string()]
            .into_iter()
            .chain(stamps.iter().cloned())
            .chain(clocked.iter().cloned())
            .collect();
        let logged: Vec<Change> = changes
            .iter()
            .cloned()
            .chain(extra.iter().filter(|c| !echoed.contains(&c.name)).cloned())
            .collect();
        if !logged.is_empty() {
            let trace = if opts.fed {
                let t = serde_json::json!({
                    "created": created_comps,
                    "removed": removed_log
                        .iter()
                        .map(|(e, names)| serde_json::json!([e, names]))
                        .collect::<Vec<_>>(),
                });
                Value::from(t.to_string())
            } else {
                Value::Null
            };
            let jrow = {
                exec_change(
                    conn,
                    "insert into journal (ts, actor, via, batch, trace) \
                     values (?1, ?2, ?3, ?4, ?5)",
                    &[
                        Value::from(now.as_str()),
                        actor.as_deref().map(Value::from).unwrap_or(Value::Null),
                        via.as_deref().map(Value::from).unwrap_or(Value::Null),
                        Value::from(batch_json(&logged)),
                        trace,
                    ],
                )?;
                conn.last_insert_rowid()
            };
            let mut seen = HashSet::new();
            for c in &logged {
                if seen.insert(c.eid.clone()) {
                    conn.execute(
                        "insert into journal_touch (jrow, eid) values (?1, ?2)",
                        rusqlite::params![jrow, c.eid],
                    )?;
                }
            }
        }
        conn.execute_batch("commit")?;
        let mut out = changes;
        out.extend(extra.clone());
        Ok(out)
    })();
    match out {
        Ok(v) => Ok(v),
        Err(e) => {
            let _ = conn.execute_batch("rollback");
            // A bounced claim is worth remembering — the audit row can't ride
            // the batch it condemns, so it lands in its own transaction.
            if let Some(b) = bounce {
                let audit: rusqlite::Result<()> = (|| {
                    conn.execute_batch("begin")?;
                    let ceid = uuid::Uuid::new_v4().to_string();
                    conn.execute(
                        "insert or ignore into entity (eid) values (?1)",
                        [&ceid],
                    )?;
                    conn.execute(
                        "insert into conflict (entity, target, loser, holder) values \
                         ((select id from entity where eid = ?1), \
                          (select id from entity where eid = ?2), ?3, ?4)",
                        [&ceid, &b.target, &b.loser, &b.holder],
                    )?;
                    let _ = mint_num(conn, &ceid);
                    conn.execute_batch("commit")?;
                    Ok(())
                })();
                if audit.is_err() {
                    let _ = conn.execute_batch("rollback");
                    eprintln!("conflict audit failed");
                }
            }
            Err(e)
        }
    }
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
        Value::String(s) => !s.is_empty(),
        _ => false,
    }
}

// db.ts refRefused: a kind-constrained reference must name a row wearing the
// target comp; absent means tombstoned or never that kind.
fn check_ref(
    conn: &Connection,
    name: &str,
    col: &str,
    target: &str,
    owner: Option<&str>,
    dropped: Option<&str>,
) -> Result<()> {
    let mut sql = format!(
        "select o.eid, rr.eid from {} r \
         join entity o on o.id = r.entity \
         left join entity rr on rr.id = r.{c} \
         left join {} tt on tt.entity = r.{c} \
         where r.{c} is not null and tt.entity is null",
        q(name),
        q(target),
        c = q(col)
    );
    let mut params: Vec<&str> = vec![];
    if let Some(o) = owner {
        sql.push_str(" and o.eid = ?1");
        params.push(o);
    }
    if let Some(d) = dropped {
        sql.push_str(&format!(" and rr.eid = ?{}", params.len() + 1));
        params.push(d);
    }
    sql.push_str(" limit 1");
    let bad: Option<(String, String)> = conn
        .query_row(&sql, rusqlite::params_from_iter(params), |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    if let Some((owner_eid, target_eid)) = bad {
        let gone = is_dead(conn, &target_eid);
        return Err(refuse(format!(
            "{name} {} refused: {col} → {} ({})",
            human(conn, &owner_eid),
            human(conn, &target_eid),
            if gone { "tombstoned".into() } else { format!("no such {target}") }
        )));
    }
    Ok(())
}

// Pure address-canonicalization tests (rung 6). Private helpers are visible
// here; the apply()-level wiring (mint + rewrite) is covered in tests/apply.rs,
// and the full three-surface byte-parity in crates/yak-bridge/tests/parity.rs.
#[cfg(test)]
mod canon_tests {
    use super::*;

    // A domain guaranteed NOT to be the fleet domain, whatever the ambient env,
    // so the off-domain cases are deterministic without mutating a shared env.
    fn off_domain() -> String {
        let fleet = mail_domain();
        for d in ["example.invalid", "other.invalid"] {
            if d != fleet {
                return d.to_string();
            }
        }
        unreachable!()
    }

    #[test]
    fn canon_lowercases_and_sheds_underscores_on_the_fleet_domain() {
        let d = mail_domain();
        assert_eq!(canon(&format!("Foo_Bar@{d}")), format!("foobar@{d}"));
        assert_eq!(canon(&format!("S_11310@{d}")), format!("s11310@{d}"));
        // idempotent: a canonical address re-canonicalizes to itself.
        let once = canon(&format!("A_B_c@{d}"));
        assert_eq!(canon(&once), once);
    }

    #[test]
    fn canon_leaves_off_domain_addresses_untouched() {
        let o = off_domain();
        // underscores and case are preserved off-domain — only the fleet domain
        // is normalized (the Cloudflare RCPT rule is fleet-only).
        assert_eq!(canon(&format!("Jeff_Doe@{o}")), format!("Jeff_Doe@{o}"));
        // not an address at all → passthrough.
        assert_eq!(canon("holdco"), "holdco");
    }

    #[test]
    fn fleet_local_requires_exactly_one_at_and_our_domain() {
        let d = mail_domain();
        assert_eq!(fleet_local(&format!("bot@{d}")), Some("bot".to_string()));
        // case-insensitive on the domain half.
        assert_eq!(fleet_local(&format!("bot@{}", d.to_uppercase())), Some("bot".to_string()));
        assert_eq!(fleet_local(&format!("a@b@{d}")), None); // two @
        assert_eq!(fleet_local(&format!("@{d}")), None); // empty local
        assert_eq!(fleet_local("bot@"), None); // empty domain
        assert_eq!(fleet_local(&format!("x@{}", off_domain())), None); // off-domain
    }

    // The decisive cross-impl proof: these expected values are the byte output
    // of the REAL TS `canon` (src/mailaddr.ts) over this corpus, captured with
    // `deno run` at authoring. Rust `canon` must reproduce each exactly — the
    // same address-normalization the write-parity harness exercises end to end.
    // Skipped under a non-default TASKS_MAIL_DOMAIN (the fleet corpus is bot.yak.sh);
    // the env-agnostic rules are covered by the tests above.
    #[test]
    fn canon_matches_ts_byte_for_byte() {
        if mail_domain() != "bot.yak.sh" {
            return;
        }
        let cases: &[(&str, &str)] = &[
            ("Foo_Bar@bot.yak.sh", "foobar@bot.yak.sh"),
            ("S_11310@bot.yak.sh", "s11310@bot.yak.sh"),
            ("plain@bot.yak.sh", "plain@bot.yak.sh"),
            ("MiXeD@BOT.YAK.SH", "mixed@bot.yak.sh"),
            ("  spaced@bot.yak.sh  ", "spaced@bot.yak.sh"),
            ("S-31@bot.yak.sh", "s-31@bot.yak.sh"),
            ("jeff@yak.sh", "jeff@yak.sh"),
            ("Jeff_Doe@example.com", "Jeff_Doe@example.com"),
            ("holdco", "holdco"),
            ("a@b@bot.yak.sh", "a@b@bot.yak.sh"),
            ("@bot.yak.sh", "@bot.yak.sh"),
            ("bot@", "bot@"),
            ("__@bot.yak.sh", "@bot.yak.sh"),
        ];
        for (input, want) in cases {
            assert_eq!(&canon(input), want, "canon({input:?})");
        }
    }

    #[test]
    fn id_local_num_matches_only_the_prefix_dash_digits_shape() {
        assert_eq!(id_local_num("S-31"), Some(31));
        assert_eq!(id_local_num("M-4066"), Some(4066));
        assert_eq!(id_local_num("S31"), None); // no dash
        assert_eq!(id_local_num("S-3-1"), None); // trailing non-digit run
        assert_eq!(id_local_num("AB12-3"), None); // digits in the prefix
        assert_eq!(id_local_num("-31"), None); // empty prefix
        assert_eq!(id_local_num("S-"), None); // empty num
    }
}
