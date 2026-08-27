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
// cwd) are ported here as the apply() tail (rung 5). Domains whose TS transforms
// are still NOT ported — entries (append/seq), spawn requests, wakes,
// stop_request, mail sender derivation, session facet aliases — REFUSE loudly or
// are documented gaps rather than half-applying: an unported semantic must never
// silently diverge between the two writers.

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

// Domains whose apply()-side transforms live in TS and are NOT ported: an
// entry's append/seq discipline, a wake's self-replacement, a spawn request's
// validation and effects, a stop_request's liveness gate. Half-applying any
// of these would diverge the two writers, so the kernel refuses them loudly.
// `session` is here for a subtler reason than the others: TS apply() mirrors
// every session write into its `spawn` twin (dualSpawn) and backfills actors;
// a bare session landed without those would silently diverge the copies.
const UNPORTED: [&str; 5] = ["entry", "stop_request", "wake", "spawn", "session"];

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
pub const NATIVE_COMPS: [&str; 8] =
    ["doc", "task", "board", "project", "comment", "dependency", "claim", "entity"];

// Can this whole batch commit through the rust kernel, or must the bridge proxy
// it to the Deno /apply? Whole-batch — apply() is atomic, so a batch that mixes
// a native comp with a transform-bearing one (or a claim, or an entity delete)
// proxies WHOLE. Empty batches proxy too (Deno owns that trivial answer). Biased
// hard to over-proxy: over-proxy is slow-but-correct, under-proxy is silent
// corruption (a transform skipped).
pub fn native_safe(changes: &[Change]) -> bool {
    !changes.is_empty() && changes.iter().all(|c| NATIVE_COMPS.contains(&c.name.as_str()))
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

pub fn default_gates() -> Vec<Box<dyn Gate>> {
    vec![Box::new(ClaimGate), Box::new(AliasGate)]
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

// writerActor's session/client/direct-actor arms. The venture-at-cwd,
// held-work-project and model fallbacks are session-plugin resolution and
// stay TS-side; a writer those would catch resolves to None here (an unowned
// write names no one — machinery is not a person).
fn writer_actor(conn: &Connection, writer: Option<&str>) -> Option<String> {
    let w = writer?;
    let s: Option<Option<String>> = conn
        .query_row(
            "select (select eid from entity where id = s.actor) from session s \
             where s.id = ?1 or s.entity = (select id from entity where eid = ?1)",
            [w],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    if let Some(actor) = s {
        return actor;
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
        return actor;
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
    let mut changes = normalize(conn, changes)?;
    // Unported domains refuse before any write (see UNPORTED above).
    for c in &changes {
        if UNPORTED.contains(&c.name.as_str()) {
            return Err(refuse(format!(
                "{} is not ported to the rust kernel write path yet — \
                 write through the TS door",
                c.name
            )));
        }
    }

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
            let created: Result<()> = (|| {
                if spine(conn, eid)? && !minted.contains(eid) {
                    minted.push(eid.clone());
                }
                if !sent.is_empty() {
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
        }
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
