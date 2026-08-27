// The app-plane READ answerers (D-22920 rung 1) — the pure functions the trivial
// graph-authority routes wrap, each shaped to the Deno server's exact bytes so
// the parity harness diffs them one-for-one:
//
//   /census    → component_counts()  (db.ts componentCounts): one COUNT per
//                component table in vocabulary order, 0 for a comp with no table.
//   /integrity → anomalies()         (db.ts scanAnomalies): orphaned component
//                rows + dangling {eid} refs over the RAW tables, plus the ANN
//                index's maintenance state — the doctor's raw-scan door.
//   /body      → bodies()            (db.ts bodies): the deferred doc bodies for
//                a set of eids, shaped as a Change batch (a patch).
//   /resolve   → resolve_named()     (db.ts resolveId + eager + kindOf): an
//                id/num/uuid/short-eid/slug → {eid,num,kind}, the naming-only
//                fallback door — 400 on an ambiguous short-eid prefix, 404 for
//                no such entity (M-16612's honest Lost, never a spinner).
//   /telemetry → telemetry_recent()/telemetry_stats(): the tool_call log, read
//                through the kernel's telemetry.rs (which already matches the
//                SQL, percentiles included) and serialized to the TS row shape.
//
// These read app-plane state the data-plane snap/read never touch; they live
// here in the bridge (not the kernel) because they ARE the route bodies, and
// they lean on the kernel's Store + vocab like every other read.

use serde_json::{Map, Value};
use yak_kernel::telemetry;
use yak_kernel::vocab::{vocab, PropType};
use yak_kernel::Store;

// A SQLite identifier, double-quoted (kernel store::q, restated — it is private).
fn q(id: &str) -> String {
    format!("\"{}\"", id.replace('"', "\"\""))
}

// componentCounts (db.ts): one COUNT per component table, authoritative for
// eager AND entry-partition comps the cache omits. A comp whose table is absent
// counts 0 — and, as in TS, those zeros are emitted FIRST (the first pass writes
// them; the present tables' counts are appended after the batch query), so the
// key order matches byte-for-byte even on a partial schema. On a full live
// schema every table exists, so the order is plain vocabulary order.
pub fn component_counts(store: &Store) -> Value {
    let v = vocab();
    let mut named: Vec<&str> = vec![];
    let mut out = Map::new();
    for (name, _) in &v.comps {
        if store.has_table(name) {
            named.push(name);
        } else {
            out.insert(name.clone(), Value::from(0));
        }
    }
    if !named.is_empty() {
        let sql = format!(
            "select {}",
            named
                .iter()
                .map(|n| format!("(select count(*) from {})", q(n)))
                .collect::<Vec<_>>()
                .join(", ")
        );
        if let Ok(mut st) = store.conn.prepare(&sql) {
            let counts: Option<Vec<i64>> = st
                .query_row([], |r| {
                    let mut v = Vec::with_capacity(named.len());
                    for i in 0..named.len() {
                        v.push(r.get::<_, i64>(i)?);
                    }
                    Ok(v)
                })
                .ok();
            if let Some(counts) = counts {
                for (name, n) in named.iter().zip(counts) {
                    out.insert((*name).to_string(), Value::from(n));
                }
            }
        }
    }
    Value::Object(out)
}

// The graph tables scanAnomalies walks: the spine, the edge table, then every
// component table — db.ts graphTables().
fn graph_tables() -> Vec<String> {
    let mut t = vec!["entity".to_string(), "dependency".to_string()];
    for (name, _) in &vocab().comps {
        t.push(name.clone());
    }
    t
}

fn col_names(store: &Store, table: &str) -> Vec<String> {
    let sql = "select name from pragma_table_info(?1)";
    yak_kernel::store::collect(&store.conn, sql, [table], |r| r.get::<_, String>(0))
}

fn count_where(store: &Store, table: &str, where_: &str) -> i64 {
    let sql = format!("select count(*) from {} t where {}", q(table), where_);
    yak_kernel::store::one(&store.conn, &sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0)
}

// scanAnomalies (db.ts): orphaned component rows (a row whose owner has no
// spine) and dangling {eid} references (a stored ref to an entity that no longer
// exists), counted over the RAW tables — both wire-invisible, which is why the
// doctor reads this raw scan instead of /query. Shape-agnostic: it reads an
// id-keyed graph (owner col `entity`, spine key `id`) or the pre-cutover
// eid-keyed one (`eid`/`eid`) by probing the spine's columns, exactly as TS does.
pub fn anomalies(store: &Store) -> Value {
    let id_keyed = col_names(store, "entity").iter().any(|c| c == "id");
    let spine_key = if id_keyed { "id" } else { "eid" };
    let owner_col = if id_keyed { "entity" } else { "eid" };
    // A cell that names an entity the spine does not hold (null cells are legal
    // absence — only a non-null value with no matching spine row is an anomaly).
    let missing = |col: &str| {
        format!(
            "{col} is not null and not exists \
             (select 1 from entity e where e.{spine_key} = t.{col})"
        )
    };
    let v = vocab();
    let mut orphans = Map::new();
    let mut dangling = Map::new();
    for t in graph_tables() {
        if t == "entity" || !store.has_table(&t) {
            continue;
        }
        let cols = col_names(store, &t);
        // Orphaned component rows — dependency has no owner key, only endpoints.
        if t != "dependency" && cols.iter().any(|c| c == owner_col) {
            let n = count_where(store, &t, &missing(owner_col));
            if n != 0 {
                orphans.insert(t.clone(), Value::from(n));
            }
        }
        // Dangling references — every {eid} column, plus dependency parent/child.
        for c in &cols {
            let dep_ref = t == "dependency" && (c == "parent" || c == "child");
            let is_ref = v.prop_type(&t, c).map(|pt| pt.is_ref()).unwrap_or(false);
            if c == owner_col || !(is_ref || dep_ref) {
                continue;
            }
            let n = count_where(store, &t, &missing(&q(c)));
            if n != 0 {
                dangling.insert(format!("{t}.{c}"), Value::from(n));
            }
        }
    }
    let mut out = Map::new();
    out.insert("orphans".into(), Value::Object(orphans));
    out.insert("dangling".into(), Value::Object(dangling));
    if let Some(vector) = vector_state(store) {
        out.insert("vector".into(), vector);
    }
    Value::Object(out)
}

// The ANN index's maintenance state (db.ts vectorState), read from plain tables
// — the split-brain tell (T-22622). Absent on a graph too old to carry the
// tables, in which case the `vector` key is omitted entirely (TS `vector?`).
fn vector_state(store: &Store) -> Option<Value> {
    if !store.has_table("embedding") || !store.has_table("embedding_index") {
        return None;
    }
    let dirty: i64 = yak_kernel::store::one(
        &store.conn,
        "select dirty from embedding_index where id = 1",
        [],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0);
    let (rows, newest): (i64, Option<String>) =
        yak_kernel::store::one(&store.conn, "select count(*), max(at) from embedding", [], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .unwrap_or((0, None));
    let mut m = Map::new();
    m.insert("dirty".into(), Value::from(dirty != 0));
    m.insert("rows".into(), Value::from(rows));
    m.insert("newest".into(), newest.map(Value::from).unwrap_or(Value::Null));
    Some(Value::Object(m))
}

// bodies (db.ts): the body columns a bodyless payload deferred, for the given
// eids — the answer IS a Change batch, so it lands through the client's ordinary
// applyLocal. One statement per component that declares a body column, in
// vocabulary order; each change's `comp` carries the owner eid plus the body
// columns (nulls included, exactly as the raw select returns them). Wrapped as
// `{changes:[…]}` by the route.
pub fn bodies(store: &Store, eids: &[String]) -> Value {
    let mut changes: Vec<Value> = vec![];
    if !eids.is_empty() {
        let v = vocab();
        let holes = std::iter::repeat_n("?", eids.len()).collect::<Vec<_>>().join(", ");
        for (name, cols) in &v.comps {
            if !store.has_table(name) {
                continue;
            }
            let body_cols: Vec<&String> =
                cols.iter().filter(|(_, t)| matches!(t, PropType::Body)).map(|(c, _)| c).collect();
            if body_cols.is_empty() {
                continue;
            }
            let sel = body_cols
                .iter()
                .map(|c| format!("t.{} as {}", q(c), q(c)))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "select o.eid as eid, {sel} from {} t \
                 join entity o on o.id = t.entity where o.eid in ({holes})",
                q(name)
            );
            let Ok(mut st) = store.conn.prepare(&sql) else { continue };
            let rows = st.query_map(rusqlite::params_from_iter(eids.iter()), |r| {
                let eid: String = r.get("eid")?;
                let mut comp = Map::new();
                comp.insert("eid".into(), Value::from(eid.clone()));
                for c in &body_cols {
                    let val = match r.get_ref((*c).as_str())? {
                        rusqlite::types::ValueRef::Null => Value::Null,
                        rusqlite::types::ValueRef::Integer(n) => Value::from(n),
                        rusqlite::types::ValueRef::Real(f) => Value::from(f),
                        rusqlite::types::ValueRef::Text(s) => {
                            Value::from(String::from_utf8_lossy(s).to_string())
                        }
                        rusqlite::types::ValueRef::Blob(_) => Value::Null,
                    };
                    comp.insert((*c).to_string(), val);
                }
                Ok((eid, comp))
            });
            if let Ok(rows) = rows {
                for (eid, comp) in rows.flatten() {
                    let mut change = Map::new();
                    change.insert("eid".into(), Value::from(eid));
                    change.insert("name".into(), Value::from(name.clone()));
                    change.insert("comp".into(), Value::Object(comp));
                    changes.push(Value::Object(change));
                }
            }
        }
    }
    let mut out = Map::new();
    out.insert("changes".into(), Value::Array(changes));
    Value::Object(out)
}

// The outcome of a /resolve lookup: the naming triple, an ambiguous-prefix
// refusal (400), or nothing (404).
pub enum Resolved {
    Found(Value),
    Ambiguous(String),
    None,
}

// resolveId + eager + kindOf (db.ts /resolve): a token → {eid,num,kind}, the
// naming-only facts a link or crumb needs. Faithful to resolveId's grammar
// (prefixed num, bare num, full uuid, short-eid prefix, alias slug/slugs), and
// to its ONE throw: an ambiguous short-eid prefix is the typist's news (400),
// distinct from no-entity (404). No quarantine/tombstone screen — TS eager reads
// the spine straight, so a tombstoned-but-resolvable id answers {…,kind:entity}
// rather than 404, matching the Deno door exactly.
pub fn resolve_named(store: &Store, id: &str) -> Resolved {
    let eid = match resolve_id(store, id) {
        Ok(Some(eid)) => eid,
        Ok(None) => return Resolved::None,
        Err(msg) => return Resolved::Ambiguous(msg),
    };
    // num: Number(comps.entity?.num ?? 0) || null — 0 or absent becomes null.
    let num: Option<i64> =
        yak_kernel::store::one(&store.conn, "select num from entity where eid = ?1", [&eid], |r| {
            r.get::<_, Option<i64>>(0)
        })
        .flatten()
        .filter(|n| *n != 0);
    let v = vocab();
    let kind = v
        .kind_order
        .iter()
        .find(|k| has_comp(store, k, &eid))
        .cloned()
        .unwrap_or_else(|| "entity".into());
    let mut out = Map::new();
    out.insert("eid".into(), Value::from(eid));
    out.insert("num".into(), num.map(Value::from).unwrap_or(Value::Null));
    out.insert("kind".into(), Value::from(kind));
    Resolved::Found(Value::Object(out))
}

fn has_comp(store: &Store, comp: &str, eid: &str) -> bool {
    if !store.has_table(comp) {
        return false;
    }
    let sql = format!(
        "select 1 from {} t join entity o on o.id = t.entity where o.eid = ?1 limit 1",
        q(comp)
    );
    yak_kernel::store::one(&store.conn, &sql, [eid], |r| r.get::<_, i64>(0)).is_some()
}

fn short_id(eid: &str) -> String {
    eid.chars().take(8).collect()
}

// succ (db.ts): the last char bumped, for the sargable short-eid range.
fn succ(p: &str) -> String {
    let mut chars: Vec<char> = p.chars().collect();
    if let Some(last) = chars.last_mut() {
        *last = char::from_u32(*last as u32 + 1).unwrap_or(*last);
    }
    chars.into_iter().collect()
}

// resolveId (db.ts), faithful — including the ambiguous-prefix throw (mapped to
// Err here). Pass-through sources do not exist in the bridge, so the `hasSources`
// tails are simply absent.
fn resolve_id(store: &Store, id: &str) -> Result<Option<String>, String> {
    let conn = &store.conn;
    let num_of = |n: i64| -> Option<String> {
        yak_kernel::store::one(conn, "select eid from entity where num = ?1", [n], |r| r.get(0))
    };
    // ^[A-Za-z]+-(\d+)$ — a prefixed num is num-only.
    if let Some((pre, rest)) = id.split_once('-') {
        if !pre.is_empty()
            && pre.chars().all(|c| c.is_ascii_alphabetic())
            && !rest.is_empty()
            && rest.chars().all(|c| c.is_ascii_digit())
        {
            if let Ok(n) = rest.parse::<i64>() {
                return Ok(num_of(n));
            }
        }
    }
    // ^(\d+)$ — a bare num; a miss falls through (may be a short eid).
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
        if let Ok(n) = id.parse::<i64>() {
            if let Some(hit) = num_of(n) {
                return Ok(Some(hit));
            }
        }
    }
    let low = id.to_lowercase();
    // UUIDRE
    if is_uuid(&low) {
        if let Some(hit) =
            yak_kernel::store::one(conn, "select eid from entity where eid = ?1", [&low], |r| {
                r.get::<_, String>(0)
            })
        {
            return Ok(Some(hit));
        }
    }
    // SHORT = ^[0-9a-f]{6,8}$ — an indexed prefix range; unique resolves,
    // ambiguous throws naming the collision (git-style).
    if is_short(&low) {
        let hi = succ(&low);
        let hits: Vec<String> = yak_kernel::store::collect(
            conn,
            "select eid from entity where eid >= ?1 and eid < ?2 limit 2",
            [&low, &hi],
            |r| r.get(0),
        );
        if hits.len() > 1 {
            return Err(format!(
                "{id} is an ambiguous id — matches {} and more; use more characters",
                hits.iter().map(|h| short_id(h)).collect::<Vec<_>>().join(", ")
            ));
        }
        if hits.len() == 1 {
            return Ok(Some(hits[0].clone()));
        }
    }
    // An alias slug — the primary slug OR any whole word of the `slugs` set.
    if store.has_table("alias") {
        let hit = yak_kernel::store::one(
            conn,
            "select o.eid from alias a join entity o on o.id = a.entity \
             where a.slug = ?1 \
                or instr(' ' || coalesce(a.slugs, '') || ' ', ' ' || ?2 || ' ') > 0",
            [id, id],
            |r| r.get::<_, String>(0),
        );
        if let Some(hit) = hit {
            return Ok(Some(hit));
        }
    }
    Ok(None)
}

fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, &c)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}

fn is_short(s: &str) -> bool {
    let n = s.len();
    (6..=8).contains(&n) && s.bytes().all(|c| c.is_ascii_hexdigit())
}

// --- telemetry serialization -------------------------------------------------
//
// The kernel's telemetry.rs already reads the tool_call log with the SQL the TS
// server runs (cohorting, percentile_cont interpolation). These two functions
// shape its rows into the exact JSON `Response.json(recent(...))` /
// `Response.json(stats(...))` emit — the byte surface the harness diffs.

// A JS number: an integer-valued float prints without a decimal (JSON.stringify
// drops `.0`), so an ms value stored as `Math.round(...)` reads back `123`, not
// `123.0`. Everything else prints as the shortest round-trip float, which serde
// (ryu) and V8 agree on.
fn js_num(f: f64) -> Value {
    if f.is_finite() && f.fract() == 0.0 && f.abs() < 9.007_199_254_740_992e15 {
        Value::from(f as i64)
    } else {
        Value::from(f)
    }
}

fn opt_str(s: Option<&str>) -> Value {
    s.map(Value::from).unwrap_or(Value::Null)
}

// recent() rows, in the TS `Log` key order: ts, source, name, session_id, ok
// (0/1), ms, error, detail — and, for a collapsed error cohort (count > 1), the
// trailing count / first / last (last is the represented row's own ts).
pub fn telemetry_recent(
    store: &Store,
    since: Option<&str>,
    limit: Option<usize>,
    only_errors: bool,
) -> Value {
    let rows = telemetry::recent(store, since, limit, only_errors);
    let out: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            let mut m = Map::new();
            m.insert("ts".into(), Value::from(r.ts.clone()));
            m.insert("source".into(), Value::from(r.source));
            m.insert("name".into(), Value::from(r.name));
            m.insert("session_id".into(), opt_str(r.session_id.as_deref()));
            m.insert("ok".into(), Value::from(if r.ok { 1 } else { 0 }));
            m.insert("ms".into(), r.ms.map(js_num).unwrap_or(Value::Null));
            m.insert("error".into(), opt_str(r.error.as_deref()));
            m.insert("detail".into(), opt_str(r.detail.as_deref()));
            if let Some(count) = r.count {
                m.insert("count".into(), Value::from(count));
                m.insert("first".into(), opt_str(r.first.as_deref()));
                m.insert("last".into(), Value::from(r.ts));
            }
            Value::Object(m)
        })
        .collect();
    Value::Array(out)
}

// stats() rows: source, name, n, p50, p95, p99 — the latency distribution, read
// through the kernel's telemetry.rs (its Rust percentile_cont, since the bridge's
// linked libsqlite3 does NOT carry the percentile extension the server's build
// does). The percentiles print the JS-number way (round(x,1) yields REALs V8
// prints without a trailing `.0`).
pub fn telemetry_stats(store: &Store, since: Option<&str>, only_errors: bool) -> Value {
    let rows = telemetry::stats(store, since, only_errors);
    let out: Vec<Value> = rows
        .into_iter()
        .map(|s| {
            let mut m = Map::new();
            m.insert("source".into(), Value::from(s.source));
            m.insert("name".into(), Value::from(s.name));
            m.insert("n".into(), Value::from(s.n));
            m.insert("p50".into(), js_num(s.p50));
            m.insert("p95".into(), js_num(s.p95));
            m.insert("p99".into(), js_num(s.p99));
            Value::Object(m)
        })
        .collect();
    Value::Array(out)
}
