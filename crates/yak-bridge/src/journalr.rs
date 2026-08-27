// The /journal door (server.ts:1468): a batch history keyed either by an entity
// (`?eid=`, journalOf — newest first, changes filtered to that eid) or by the
// instrument that wrote it (`?via=`, journalBy — the whole batch). Each entry is
// `{id, ts, actor, via, changes}`; a change is canonicalized so a forward-
// renamed ref column reads under its current name (db.ts canonicalChanges).
//
// Implemented here rather than through kernel `journal::journal_of` because the
// route emits `via` (the kernel Entry omits it) and offers the `?via=` cut the
// kernel has no reader for. The canonicalization matches the kernel's own and
// the TS reader's: a `<col>_eid` key whose stem is a column of the change's
// component is rewritten to the stem, IN PLACE (position preserved, as
// `record()` does — never moved to the end).

use serde_json::{Map, Value};
use yak_kernel::vocab::vocab;
use yak_kernel::Store;

// One journal row as read from SQLite: (rowid, ts, actor, via, batch json).
type JournalRow = (i64, String, Option<String>, Option<String>, String);

// canonicalChanges' `record`, order-preserving: rewrite each `<col>_eid` key
// whose stem is a readable column of `name` to the stem, keeping the original
// key position and value.
fn canon(name: &str, comp: &Map<String, Value>) -> Map<String, Value> {
    let v = vocab();
    let mut out = Map::new();
    for (k, val) in comp {
        // Every refRename is `<col>_eid → <col>` (db.ts refRenames). A regular
        // comp's ref column is a readable prop, so prop_type confirms it; the
        // `dependency` EDGE is not in v.comps, so its two ref columns
        // (parent_eid, child_eid) are named explicitly — the same two rows the
        // TS list carries for it.
        let key = k
            .strip_suffix("_eid")
            .filter(|stem| {
                v.prop_type(name, stem).is_some()
                    || (name == "dependency" && (*stem == "parent" || *stem == "child"))
            })
            .map(|stem| stem.to_string())
            .unwrap_or_else(|| k.clone());
        out.insert(key, val.clone());
    }
    out
}

fn canon_change(change: &mut Value) {
    let Some(obj) = change.as_object_mut() else { return };
    let name = obj.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
    if let Some(Value::Object(m)) = obj.get("comp") {
        let fixed = canon(&name, m);
        obj.insert("comp".into(), Value::Object(fixed));
    }
    if let Some(Value::Object(m)) = obj.get("was") {
        let fixed = canon(&name, m);
        obj.insert("was".into(), Value::Object(fixed));
    }
}

fn entry(
    id: i64,
    ts: String,
    actor: Option<String>,
    via: Option<String>,
    changes: Vec<Value>,
) -> Value {
    let mut m = Map::new();
    m.insert("id".into(), Value::from(id));
    m.insert("ts".into(), Value::from(ts));
    m.insert("actor".into(), actor.map(Value::from).unwrap_or(Value::Null));
    m.insert("via".into(), via.map(Value::from).unwrap_or(Value::Null));
    m.insert("changes".into(), Value::Array(changes));
    Value::Object(m)
}

// journalOf: the batches touching one entity, newest first, each batch's
// changes canonicalized and screened to that entity's own eid.
pub fn of_eid(store: &Store, eid: &str, limit: i64) -> Vec<Value> {
    if !store.has_table("journal_touch") {
        return vec![];
    }
    let sql = "select j.rowid, j.ts, j.actor, j.via, j.batch \
               from journal_touch t join journal j on j.rowid = t.jrow \
               where t.eid = ?1 order by t.jrow desc limit ?2";
    let Ok(mut st) = store.conn.prepare(sql) else { return vec![] };
    let rows: Vec<JournalRow> = st
        .query_map(rusqlite::params![eid, limit], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    rows.into_iter()
        .map(|(id, ts, actor, via, batch)| {
            let mut changes: Vec<Value> = serde_json::from_str(&batch).unwrap_or_default();
            for c in &mut changes {
                canon_change(c);
            }
            changes.retain(|c| c.get("eid").and_then(|e| e.as_str()) == Some(eid));
            entry(id, ts, actor, via, changes)
        })
        .collect()
}

// journalBy: every batch an instrument wrote, whole (no per-eid screen),
// newest first.
pub fn by_via(store: &Store, via: &str, limit: i64) -> Vec<Value> {
    if !store.has_table("journal") {
        return vec![];
    }
    let sql = "select rowid, ts, actor, via, batch from journal \
               where via = ?1 order by rowid desc limit ?2";
    let Ok(mut st) = store.conn.prepare(sql) else { return vec![] };
    let rows: Vec<JournalRow> = st
        .query_map(rusqlite::params![via, limit], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    rows.into_iter()
        .map(|(id, ts, actor, via, batch)| {
            let mut changes: Vec<Value> = serde_json::from_str(&batch).unwrap_or_default();
            for c in &mut changes {
                canon_change(c);
            }
            entry(id, ts, actor, via, changes)
        })
        .collect()
}

// The route: `?via=` wins over `?eid=`; `limit` defaults to 50.
pub fn answer(store: &Store, via: Option<&str>, eid: Option<&str>, limit: i64) -> Value {
    Value::Array(match via {
        Some(v) => by_via(store, v, limit),
        None => of_eid(store, eid.unwrap_or(""), limit),
    })
}
