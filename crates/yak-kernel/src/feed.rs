// The catchup read side (src/catchup.ts, src/db.ts journalSince/rowChanges):
// a consumer holds a rowid cursor into the journal and is handed each row
// past it in rowid order — its own commits and every other process's
// uniformly, because the journal is the record of what committed. This is
// what lets a Rust process CONSUME beside the TS server, the mirror of
// write.rs letting it produce.

use crate::change::{parse_batch, Change};
use rusqlite::Connection;
use serde_json::{Map, Value};

#[derive(Debug, Clone)]
pub struct Trace {
    pub created: Vec<String>,
    pub removed: Vec<(String, Vec<String>)>,
}

#[derive(Debug, Clone)]
pub struct JournalRow {
    pub rowid: i64,
    pub ts: String,
    pub actor: Option<String>,
    pub via: Option<String>,
    pub batch: Vec<Change>,
    pub trace: Option<Trace>,
}

pub fn cursor_of(conn: &Connection) -> i64 {
    conn.query_row("select coalesce(max(rowid), 0) from journal", [], |r| r.get(0)).unwrap_or(0)
}

// PRAGMA data_version: bumped when ANOTHER connection commits, never by our
// own — the foreign-write detector (catchup.ts).
pub fn data_version(conn: &Connection) -> i64 {
    conn.query_row("pragma data_version", [], |r| r.get(0)).unwrap_or(0)
}

pub fn journal_since(conn: &Connection, since: i64) -> Vec<JournalRow> {
    let Ok(mut st) = conn.prepare_cached(
        "select rowid, ts, actor, via, batch, trace from journal \
         where rowid > ?1 order by rowid",
    ) else {
        return vec![];
    };
    let rows = st.query_map([since], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, Option<String>>(5)?,
        ))
    });
    let Ok(rows) = rows else { return vec![] };
    rows.flatten()
        .filter_map(|(rowid, ts, actor, via, batch, trace)| {
            let parsed: Value = serde_json::from_str(&batch).ok()?;
            let batch = parse_batch(&parsed)?;
            let trace = trace.and_then(|t| {
                let v: Value = serde_json::from_str(&t).ok()?;
                let created = v
                    .get("created")?
                    .as_array()?
                    .iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect();
                let removed = v
                    .get("removed")?
                    .as_array()?
                    .iter()
                    .filter_map(|pair| {
                        let a = pair.as_array()?;
                        let eid = a.first()?.as_str()?.to_string();
                        let names = a
                            .get(1)?
                            .as_array()?
                            .iter()
                            .filter_map(|n| n.as_str().map(String::from))
                            .collect();
                        Some((eid, names))
                    })
                    .collect();
                Some(Trace { created, removed })
            });
            Some(JournalRow { rowid, ts, actor, via, batch, trace })
        })
        .collect()
}

// One row replayed as the changes its commit meant: the batch plus the
// provenance envelope the journal deliberately left out (db.ts rowChanges).
pub fn row_changes(r: &JournalRow) -> Vec<Change> {
    let mut changes = r.batch.clone();
    let mut born: Vec<String> = vec![];
    let mut dead: Vec<String> = vec![];
    let mut touched: Vec<String> = vec![];
    let mut said_created: Vec<String> = vec![];
    let mut said_updated: Vec<String> = vec![];
    let push = |list: &mut Vec<String>, eid: &str| {
        if !list.iter().any(|e| e == eid) {
            list.push(eid.to_string());
        }
    };
    for c in &r.batch {
        if c.name == "entity" {
            push(if c.comp.is_some() { &mut born } else { &mut dead }, &c.eid);
        } else if c.name == "dependency" {
            push(&mut touched, &c.eid);
            if let Some(m) = &c.comp {
                if let Some(child) = m.get("child").and_then(|v| v.as_str()) {
                    push(&mut touched, child);
                }
            }
        } else {
            push(&mut touched, &c.eid);
            if c.name == "created" {
                push(&mut said_created, &c.eid);
            }
            if c.name == "updated" {
                push(&mut said_updated, &c.eid);
            }
        }
    }
    let envelope = |eid: &str, said: bool| {
        let mut m = Map::new();
        m.insert("eid".into(), Value::from(eid));
        m.insert("at".into(), Value::from(r.ts.as_str()));
        if !said {
            m.insert("by".into(), r.actor.as_deref().map(Value::from).unwrap_or(Value::Null));
        }
        m.insert("via".into(), r.via.as_deref().map(Value::from).unwrap_or(Value::Null));
        m
    };
    for eid in &born {
        changes.push(Change::new(eid, "created", Some(envelope(eid, said_created.contains(eid)))));
    }
    for eid in &touched {
        if born.contains(eid) || dead.contains(eid) {
            continue;
        }
        changes.push(Change::new(eid, "updated", Some(envelope(eid, said_updated.contains(eid)))));
    }
    changes
}

// The drain loop (catchup.ts settle, single-threaded shape): hand every row
// past the cursor to on_row exactly once, re-checking after each pass so a
// row committed mid-drain is picked up rather than skipped.
pub struct Feed {
    pub cursor: i64,
}

impl Feed {
    pub fn from_tip(conn: &Connection) -> Feed {
        Feed { cursor: cursor_of(conn) }
    }
    pub fn settle(&mut self, conn: &Connection, on_row: &mut dyn FnMut(&JournalRow)) {
        loop {
            let rows = journal_since(conn, self.cursor);
            if rows.is_empty() {
                return;
            }
            for r in rows {
                self.cursor = r.rowid;
                on_row(&r);
            }
        }
    }
}
