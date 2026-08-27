// The write history, read straight off the journal tables (db.ts
// journalOf/journalBy): one entry per touching batch, changes canonicalized
// the way the TS reader does — a forward-renamed ref column (`project_eid`)
// reads as its current name.

use rusqlite::OptionalExtension;
use serde_json::Value;

use crate::store::Store;
use crate::vocab::vocab;

pub struct Entry {
    pub id: i64,
    pub ts: String,
    pub actor: Option<String>,
    pub changes: Vec<Value>,
}

// canonicalChanges: every refRename is old = `<col>_eid`, so the general
// rewrite is "a key ending _eid whose stem is a column of this comp".
fn canon(change: &mut Value) {
    let v = vocab();
    let Some(obj) = change.as_object_mut() else { return };
    let name = obj.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
    for key in ["comp", "was"] {
        let Some(Value::Object(m)) = obj.get_mut(key) else { continue };
        let renames: Vec<(String, String)> = m
            .keys()
            .filter_map(|k| {
                let stem = k.strip_suffix("_eid")?;
                v.prop_type(&name, stem).map(|_| (k.clone(), stem.into()))
            })
            .collect();
        for (old, new) in renames {
            if let Some(val) = m.remove(&old) {
                m.insert(new, val);
            }
        }
    }
}

pub fn journal_of(store: &Store, eid: &str, limit: usize) -> Vec<Entry> {
    if !store.has_table("journal_touch") {
        return vec![];
    }
    let sql = "select j.rowid, j.ts, j.actor, j.batch \
               from journal_touch t join journal j on j.rowid = t.jrow \
               where t.eid = ?1 order by t.jrow desc limit ?2";
    let Ok(mut st) = store.conn.prepare(sql) else { return vec![] };
    let rows: Vec<(i64, String, Option<String>, String)> = st
        .query_map(rusqlite::params![eid, limit as i64], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    rows.into_iter()
        .map(|(id, ts, actor, batch)| {
            let mut changes: Vec<Value> = serde_json::from_str(&batch).unwrap_or_default();
            for c in &mut changes {
                canon(c);
            }
            changes.retain(|c| c.get("eid").and_then(|e| e.as_str()) == Some(eid));
            Entry { id, ts, actor, changes }
        })
        .collect()
}

// The actor an entry prints — journal.actor, 'unknown' when null.
pub fn actor_of(e: &Entry) -> String {
    e.actor.clone().unwrap_or_else(|| "unknown".into())
}

// A batch resolved to display text (client.ts historyLine's `what`):
// comp{cols} for writes, -comp for removals, † for the entity's death.
pub fn what_of(e: &Entry) -> String {
    e.changes
        .iter()
        .map(|c| {
            let name = c.get("name").and_then(|n| n.as_str()).unwrap_or("");
            match c.get("comp") {
                None | Some(Value::Null) => {
                    if name == "entity" {
                        "†".to_string()
                    } else {
                        format!("-{name}")
                    }
                }
                Some(Value::Object(m)) => {
                    let cols: Vec<&str> =
                        m.keys().filter(|k| k.as_str() != "eid").map(|k| k.as_str()).collect();
                    format!("{name}{{{}}}", cols.join(" "))
                }
                Some(_) => format!("{name}{{}}"),
            }
        })
        .collect::<Vec<_>>()
        .join(" · ")
}

// The journal row check the resolver needs: does this eid appear at all.
pub fn seen(store: &Store, eid: &str) -> bool {
    if !store.has_table("journal_touch") {
        return false;
    }
    store
        .conn
        .query_row("select 1 from journal_touch where eid = ?1 limit 1", [eid], |r| {
            r.get::<_, i64>(0)
        })
        .optional()
        .ok()
        .flatten()
        .is_some()
}
