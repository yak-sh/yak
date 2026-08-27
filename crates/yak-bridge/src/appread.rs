// The explicit app-plane service answerers that are not graph queries:
// storage integrity, non-secret configuration, and telemetry. Each reads
// through the kernel Store but remains here because its response is service
// data rather than an entity selection.

use serde_json::{Map, Value};
use yak_kernel::telemetry;
use yak_kernel::vocab::vocab;
use yak_kernel::Store;

// A SQLite identifier, double-quoted (kernel store::q, restated — it is private).
fn q(id: &str) -> String {
    format!("\"{}\"", id.replace('"', "\"\""))
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
pub fn anomalies(store: &Store) -> Result<Value, String> {
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
    let reach = yak_kernel::rooted::project_reachability(&store.conn)
        .map_err(|e| format!("project reachability: {e}"))?;
    let unrooted = reach
        .orphans
        .iter()
        .map(|eid| Value::from(yak_kernel::write::human(&store.conn, eid)))
        .collect::<Vec<_>>();
    out.insert("unrooted".into(), Value::Array(unrooted));
    Ok(Value::Object(out))
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

// --- /config/settings (config.ts) --------------------------------------------
//
// The non-secret setting catalog, resolved over three planes and shaped for the
// config panel. A faithful port of config.ts: the SAME catalog (secret keys
// filtered OUT — plainKeys only, so no secret bytes cross this door), the SAME
// precedence (graph override > process environment > catalog default, where an
// empty string at a higher plane reads as unset), and the SAME wire shape with
// its conditional `default`/`value`/`eid` keys. `setting.key` is UNIQUE, so the
// eid is the override row a client save targets.

struct SettingSpec {
    key: &'static str,
    label: &'static str,
    group: &'static str,
    // 'url' | 'text' — carried as the wire string; the bridge never validates
    // (that is the WRITE boundary, config.validate).
    type_: &'static str,
    help: &'static str,
    // The catalog default (`None` only for a secret — but secrets never reach
    // this list, so every plainKey here carries a default, `Some("")` included).
    default: Option<&'static str>,
}

// plainKeys, in catalog order — config.ts `catalog` with the sensitive
// OLLAMA_API_KEY dropped (never emitted; the write-guard also refuses to store
// it). Help/label/default are byte-identical to config.ts.
const CATALOG: &[SettingSpec] = &[
    SettingSpec {
        key: "OLLAMA_BASE_URL",
        label: "Ollama base URL",
        group: "ollama",
        type_: "url",
        default: Some("https://ollama.yak.sh/"),
        help: "Base URL for the Ollama-compatible Responses API. An origin gets the \
               OpenAI-compatible /v1 path appended; a URL already ending in /v1 is \
               used as-is.",
    },
    SettingSpec {
        key: "OLLAMA_EMBED_MODEL",
        label: "Ollama embedding model",
        group: "ollama",
        type_: "text",
        default: Some("qwen3-embedding:0.6b"),
        help: "The model the embed transport asks the Ollama server (/api/embed) for. \
               Folds into every stored vector row (embed.ts hash + model column), so a \
               change invalidates the corpus and the async sweep re-embeds it — an \
               incomparable space, so this must move in lockstep with the KNN model \
               filter. The output is MRL-truncated to the fixed vector DIM (384).",
    },
    SettingSpec {
        key: "DISPATCH_SLOTS",
        label: "Dispatch slots",
        group: "dispatch",
        type_: "text",
        default: Some("2"),
        help: "How many auto-dispatched sessions may run at once (T-21323). The \
               dispatch sweep spawns one session per approved, unblocked open task \
               while live dispatched sessions number fewer than this.",
    },
    SettingSpec {
        key: "DISPATCH_RECURSIVE",
        label: "Recursive dispatch",
        group: "dispatch",
        type_: "text",
        default: Some(""),
        help: "When on, the dispatch sweep descends an APPROVED but gated open \
               task into its unblocked, unclaimed requires-children and spawns them \
               too — approval inherits down the requires tree, so an approved umbrella \
               authorizes its blockers (T-21452, D-21448 Piece 3). Off by default: it \
               expands autonomous token spend, so it stays a deliberate opt-in until \
               the whole park→wake loop is verified end to end (T-21453). Any of \
               '1'/'true'/'on'/'yes' enables it.",
    },
];

// The graph plane (db.ts settingValue): the override for a key, or None. A NULL
// or absent row is None; an empty string is Some("") and resolve() treats it as
// unset, exactly as the TS `over !== ''` guard does.
fn setting_value(store: &Store, key: &str) -> Option<String> {
    if !store.has_table("setting") {
        return None;
    }
    yak_kernel::store::one(&store.conn, "select value from setting where key = ?1", [key], |r| {
        r.get::<_, Option<String>>(0)
    })
    .flatten()
}

// db.ts settingEid: the `setting` entity holding a key's override, or None.
fn setting_eid(store: &Store, key: &str) -> Option<String> {
    if !store.has_table("setting") {
        return None;
    }
    yak_kernel::store::one(
        &store.conn,
        "select o.eid as eid from setting join entity o on o.id = setting.entity \
         where key = ?1",
        [key],
        |r| r.get::<_, String>(0),
    )
}

// A higher plane answers only with a non-null, non-empty value (config.ts
// `over != null && over !== ''`).
fn plane(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.is_empty())
}

pub fn setting_rows(store: &Store) -> Value {
    let rows: Vec<Value> = CATALOG
        .iter()
        .map(|spec| {
            // resolve(): graph > environment > default, and which plane answered.
            let (value, source) = if let Some(v) = plane(setting_value(store, spec.key)) {
                (Some(v), "graph")
            } else if let Some(v) = plane(std::env::var(spec.key).ok()) {
                (Some(v), "environment")
            } else {
                // default source: the effective value IS the catalog default
                // (Some for every plainKey), so `value` rides too.
                (spec.default.map(String::from), "default")
            };
            let mut m = Map::new();
            m.insert("key".into(), Value::from(spec.key));
            m.insert("label".into(), Value::from(spec.label));
            m.insert("group".into(), Value::from(spec.group));
            m.insert("type".into(), Value::from(spec.type_));
            m.insert("help".into(), Value::from(spec.help));
            // `default` only when the spec carries one (always, here).
            if let Some(d) = spec.default {
                m.insert("default".into(), Value::from(d));
            }
            // `value` only when the resolved value is non-null.
            if let Some(v) = value {
                m.insert("value".into(), Value::from(v));
            }
            m.insert("source".into(), Value::from(source));
            // `eid` only when an override row exists.
            if let Some(eid) = setting_eid(store, spec.key) {
                m.insert("eid".into(), Value::from(eid));
            }
            Value::Object(m)
        })
        .collect();
    Value::Array(rows)
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

#[cfg(test)]
mod tests {
    use super::*;
    use yak_kernel::Store;

    // The graph plane of /config/settings, proven end to end: a `setting`
    // override wins over env and default (config.ts precedence), and the row
    // carries `source:"graph"`, the override `value`, and the override entity's
    // `eid` — the shape a client save targets. The live probe carries no setting
    // rows, so this exercises the plane the HTTP parity test cannot reach.
    #[test]
    fn setting_override_takes_the_graph_plane() {
        let path = std::env::temp_dir().join(format!(
            "yak-bridge-setting-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let p = path.to_str().unwrap();
        {
            let conn = rusqlite::Connection::open(p).unwrap();
            conn.execute_batch(
                "create table entity(id integer primary key, eid text, num integer);
                 create table setting(entity integer, key text, value text);
                 insert into entity(id, eid, num) values (1, 'e-override-uuid', 7);
                 insert into setting(entity, key, value)
                   values (1, 'OLLAMA_BASE_URL', 'https://probe.example/');",
            )
            .unwrap();
        }
        let store = Store::open(p).unwrap();
        let rows = setting_rows(&store);
        let arr = rows.as_array().unwrap();
        let row = arr.iter().find(|r| r["key"] == "OLLAMA_BASE_URL").expect("OLLAMA_BASE_URL row");
        assert_eq!(row["value"].as_str(), Some("https://probe.example/"), "graph value wins");
        assert_eq!(row["source"].as_str(), Some("graph"), "source is the graph plane");
        assert_eq!(row["eid"].as_str(), Some("e-override-uuid"), "override eid rides");
        // A key with no override falls through to its catalog default.
        let slots = arr.iter().find(|r| r["key"] == "DISPATCH_SLOTS").unwrap();
        assert_eq!(slots["source"].as_str(), Some("default"));
        // The secret OLLAMA_API_KEY is NEVER emitted (plainKeys only).
        assert!(
            arr.iter().all(|r| r["key"] != "OLLAMA_API_KEY"),
            "a secret key must never cross this door"
        );
        let _ = std::fs::remove_file(p);
    }
}
