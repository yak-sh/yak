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

// --- /references (referenced.ts) ---------------------------------------------
//
// The `referenced`-edge neighborhood of one entity, exactly as referenced.ts
// builds it: OUTGOING = the children of `referenced` edges this eid is the
// parent of, PLUS the citations made BY the entries this eid owns as a session;
// INCOMING = the parents of `referenced` edges this eid is the child of. Every
// endpoint is projected to its owning SESSION when it is an `entry` row
// (`coalesce(s.eid, p.eid)`), so a citation from inside a session's log reads as
// the session, not the buried entry. Each list is deduped first-seen and shaped
// `[{eid}]`; the answer is `{out, in}`, that key order. Reads a raw eid (no
// resolveId) — the route 400s an empty one before we are called.
pub fn references(store: &Store, eid: &str) -> Value {
    // direct(side): the far endpoint of every `referenced` edge whose NEAR side
    // is this eid — session-projected. side='child' returns children of edges we
    // parent (OUTGOING); side='parent' returns parents of edges we child (IN).
    let direct = |side: &str| -> Vec<String> {
        let near = if side == "parent" { "child" } else { "parent" };
        let sql = format!(
            "select distinct coalesce(s.eid, p.eid) as eid \
             from dependency d \
             join entity p on p.id = d.{side} \
             left join entry x on x.entity = d.{side} \
             left join entity s on s.id = x.session \
             where d.type = 'referenced' \
               and d.{near} = (select id from entity where eid = ?1)"
        );
        yak_kernel::store::collect(&store.conn, &sql, [eid], |r| r.get::<_, String>(0))
    };
    // own: the `referenced` citations made by the entries this session owns.
    let own: Vec<String> = if store.has_table("entry") {
        yak_kernel::store::collect(
            &store.conn,
            "select distinct c.eid as eid \
             from entry x \
             join dependency d on d.parent = x.entity and d.type = 'referenced' \
             join entity c on c.id = d.child \
             where x.session = (select id from entity where eid = ?1)",
            [eid],
            |r| r.get::<_, String>(0),
        )
    } else {
        vec![]
    };
    // named(): dedup by eid, first-seen order, each `{eid}`.
    let named = |eids: Vec<String>| -> Value {
        let mut seen = std::collections::HashSet::new();
        let out: Vec<Value> = eids
            .into_iter()
            .filter(|e| seen.insert(e.clone()))
            .map(|e| {
                let mut m = Map::new();
                m.insert("eid".into(), Value::from(e));
                Value::Object(m)
            })
            .collect();
        Value::Array(out)
    };
    let mut out_eids = direct("child");
    out_eids.extend(own);
    let mut m = Map::new();
    m.insert("out".into(), named(out_eids));
    m.insert("in".into(), named(direct("parent")));
    Value::Object(m)
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

// --- /search (db.ts search) --------------------------------------------------
//
// The FTS + dot-filter search, serialized in `jsonOf`/Hit key order. The kernel
// search.rs runs the ranked query, applies the quarantine and filter screens,
// floats an addressed hit, sinks retired ones — this shapes each Hit as
// `{eid, title, title_hit, snip, num, kind, open, [open_id], [retired]}`, the two
// tail keys present exactly when Deno's object spread adds them (open_id on a
// comment hit that opens its target, retired:true on a hit sunk under an archived
// project). A malformed filter is the typist's news (Err → the route's 400).
pub fn search(store: &Store, q: &str, limit: usize) -> Result<Value, String> {
    let hits = yak_kernel::search::search(store, q, limit)?;
    let out: Vec<Value> = hits
        .into_iter()
        .map(|h| {
            let mut m = Map::new();
            m.insert("eid".into(), Value::from(h.eid));
            m.insert("title".into(), Value::from(h.title));
            m.insert("title_hit".into(), Value::from(h.title_hit));
            m.insert("snip".into(), Value::from(h.snip));
            m.insert("num".into(), h.num.map(Value::from).unwrap_or(Value::Null));
            m.insert("kind".into(), Value::from(h.kind));
            m.insert("open".into(), Value::from(h.open));
            if let Some(oid) = h.open_id {
                m.insert("open_id".into(), Value::from(oid));
            }
            if h.retired {
                m.insert("retired".into(), Value::from(true));
            }
            Value::Object(m)
        })
        .collect();
    Ok(Value::Array(out))
}

// --- /inbox (client.ts inboxFor + the route's keep) --------------------------
//
// The inbox as the SERVER enumerates it: the candidate union (reader arms), then
// the route's keep predicate (addressed in --all, inbox_item otherwise), each
// surviving row as `jsonOf` (emit::row_to_wire). `session`(+`cwd`) builds the
// working reader; `actor` the browsing one, and session WINS when both are named.
// `mode=all` is the CLI's --all (direct address, archived included, watch/mute
// ignored); repeated `f=` are dot-param filters screening the union. 400 (Err)
// when neither id is named or a filter is malformed. READ-ONLY — no `notified`
// stamp, matching Deno's read-only enumeration.
pub fn inbox(
    store: &Store,
    session: Option<&str>,
    actor: Option<&str>,
    cwd: Option<&str>,
    mode: &str,
    filters: &[String],
) -> Result<Value, String> {
    if session.is_none() && actor.is_none() {
        return Err("session or actor required".into());
    }
    let who = if let Some(sid) = session {
        yak_kernel::reader::reader_for(store, Some(sid), cwd.unwrap_or(""), None)
    } else {
        yak_kernel::reader::reader_at(store, actor.unwrap_or(""))
    };
    let mode =
        if mode == "all" { yak_kernel::inbox::Mode::All } else { yak_kernel::inbox::Mode::Inbox };
    // The f= filters are the board grammar (parse validates + may 400); no kind
    // is named on an inbox filter, so the default-task kind parse() returns is
    // ignored — the inbox items are comments/mail, never tasks.
    let mut preds = if filters.is_empty() { vec![] } else { yak_kernel::query::parse(filters)?.1 };
    yak_kernel::query::resolve_values(store, &mut preds);
    let rows = yak_kernel::inbox::inbox(store, &who, &preds, mode);
    Ok(Value::Array(rows.iter().map(crate::emit::row_to_wire).collect()))
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
