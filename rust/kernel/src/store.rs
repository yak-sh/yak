// The read-only store: open the live graph file, resolve human ids, read an
// entity's components the way the TS select() layer projects them — every
// {eid} reference joined back to its target's eid text, never the integer it
// is stored as. Never migrates, never takes the writer baton: a library
// client connects, reads, and leaves the schema alone (D-22530 §1).

use crate::vocab::vocab;
pub use crate::model::{is_uuid, Dep, Row};
use crate::model::Source;
use crate::profiling;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

pub struct Store {
    pub conn: Connection,
    tables: HashSet<String>,
}

fn q(id: &str) -> String {
    format!("\"{}\"", id)
}

// The two shapes every read in this file takes, each counted as one timed
// execution. Instrumenting the store means instrumenting these two doors
// rather than each call site — and the free functions serve the write path's
// own connection too.

// query_row + optional: at most one row, and a hit counts as one.
pub fn one<T>(
    conn: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
    row: impl FnOnce(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> Option<T> {
    let t = profiling::sql(sql);
    let got = conn.query_row(sql, params, row).optional().ok().flatten();
    t.done(got.is_some() as usize);
    got
}

// prepare + collect: every row the statement produced.
pub fn collect<T>(
    conn: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
    row: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> Vec<T> {
    let t = profiling::sql(sql);
    let Ok(mut st) = conn.prepare(sql) else { return vec![] };
    let out: Vec<T> = st
        .query_map(params, row)
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    t.done(out.len());
    out
}

impl Store {
    pub fn open(path: &str) -> rusqlite::Result<Store> {
        let _p = profiling::span("db.open");
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        )?;
        conn.busy_timeout(std::time::Duration::from_millis(5000))?;
        let mut tables = HashSet::new();
        {
            let sql =
                "select name from sqlite_master where type in ('table','view')";
            let t = profiling::sql(sql);
            let mut st = conn.prepare(sql)?;
            let mut rows = st.query([])?;
            while let Some(r) = rows.next()? {
                tables.insert(r.get::<_, String>(0)?);
            }
            t.done(tables.len());
        }
        Ok(Store { conn, tables })
    }

    pub fn has_table(&self, name: &str) -> bool {
        self.tables.contains(name)
    }

    // resolveId's grammar: prefixed num (prefix is display-only, num rules),
    // bare num, full uuid, short-eid prefix, alias slug.
    pub fn resolve_id(&self, id: &str) -> Option<String> {
        resolve(&self.conn, id)
    }

    // One component row for one entity, refs projected to eids (select()).
    pub fn comp_row(&self, comp: &str, eid: &str) -> Option<Map<String, Value>> {
        if !self.has_table(comp) {
            return None;
        }
        let v = vocab();
        let cols = v.readable(comp);
        if cols.is_empty() {
            // membership-only comp (no wire columns): presence is the value
            let sql = format!(
                "select 1 from {} t join entity e on e.id = t.entity \
                 where e.eid = ?1",
                q(comp)
            );
            let present: Option<i64> =
                one(&self.conn, &sql, [eid], |r| r.get(0));
            return present.map(|_| Map::new());
        }
        let mut joins = String::new();
        let mut sel: Vec<String> = vec![];
        for (i, (name, t)) in cols.iter().enumerate() {
            if t.is_ref() {
                let a = format!("__r{i}");
                joins.push_str(&format!(
                    " left join entity {a} on {a}.id = t.{}",
                    q(name)
                ));
                sel.push(format!("{a}.eid"));
            } else {
                sel.push(format!("t.{}", q(name)));
            }
        }
        let sql = format!(
            "select {} from {} t join entity __o on __o.id = t.entity{} \
             where __o.eid = ?1",
            sel.join(", "),
            q(comp),
            joins
        );
        let t = profiling::sql(&sql);
        let mut st = self.conn.prepare(&sql).ok()?;
        let got = st
            .query_row([eid], |r| {
                let mut m = Map::new();
                for (i, (name, _)) in cols.iter().enumerate() {
                    let v: Value = match r.get_ref(i)? {
                        rusqlite::types::ValueRef::Null => continue,
                        rusqlite::types::ValueRef::Integer(n) => Value::from(n),
                        rusqlite::types::ValueRef::Real(f) => Value::from(f),
                        rusqlite::types::ValueRef::Text(s) => {
                            Value::from(String::from_utf8_lossy(s).to_string())
                        }
                        rusqlite::types::ValueRef::Blob(_) => continue,
                    };
                    m.insert(name.clone(), v);
                }
                Ok(m)
            })
            .optional()
            .ok()
            .flatten();
        t.done(got.is_some() as usize);
        got
    }

    pub fn row(&self, eid: &str) -> Option<Row> {
        // one probe answers both "does it exist" and "what num does it wear"
        let num: Option<Option<i64>> = one(
            &self.conn,
            "select num from entity where eid = ?1",
            [eid],
            |r| r.get::<_, Option<i64>>(0),
        );
        let Some(num) = num else { return None };
        let v = vocab();
        let mut comps = Map::new();
        // entity comp first, the way the wire projects the spine
        let mut spine = Map::new();
        spine.insert("eid".into(), Value::from(eid));
        if let Some(n) = num {
            spine.insert("num".into(), Value::from(n));
        }
        comps.insert("entity".into(), Value::Object(spine));
        for (name, _) in &v.comps {
            if name == "entity" {
                continue;
            }
            if let Some(m) = self.comp_row(name, eid) {
                comps.insert(name.clone(), Value::Object(m));
            }
        }
        let kind = v.kind_of(&|k| comps.contains_key(k));
        Some(Row { eid: eid.into(), num, kind, comps })
    }

    // Every row of a kind, comps loaded in bulk — one query per component
    // table over the kind's membership, never per-row (a hot path never
    // scans row-at-a-time, M-17862). Rows come back in num order.
    pub fn rows_of_kind(&self, kind: &str) -> Vec<Row> {
        if !self.has_table(kind) {
            return vec![];
        }
        let v = vocab();
        let sql = format!(
            "select e.eid, e.num from {} t join entity e \
             on e.id = t.entity order by e.num",
            q(kind)
        );
        let order: Vec<(String, Option<i64>)> =
            collect(&self.conn, &sql, [], |r| Ok((r.get(0)?, r.get(1)?)));
        let mut bags: HashMap<String, Map<String, Value>> = HashMap::new();
        for (eid, num) in &order {
            let mut spine = Map::new();
            spine.insert("eid".into(), Value::from(eid.as_str()));
            if let Some(n) = num {
                spine.insert("num".into(), Value::from(*n));
            }
            let mut m = Map::new();
            m.insert("entity".into(), Value::Object(spine));
            bags.insert(eid.clone(), m);
        }
        for (comp, _) in &v.comps {
            if comp == "entity" || !self.has_table(comp) {
                continue;
            }
            let cols = v.readable(comp);
            let mut joins = String::new();
            let mut sel: Vec<String> = vec!["__o.eid".into()];
            for (i, (name, t)) in cols.iter().enumerate() {
                if t.is_ref() {
                    let a = format!("__r{i}");
                    joins.push_str(&format!(
                        " left join entity {a} on {a}.id = t.{}",
                        q(name)
                    ));
                    sel.push(format!("{a}.eid"));
                } else {
                    sel.push(format!("t.{}", q(name)));
                }
            }
            let sql = format!(
                "select {} from {} t join entity __o on __o.id = t.entity{} \
                 where t.entity in (select entity from {})",
                sel.join(", "),
                q(comp),
                joins,
                q(kind)
            );
            let t = profiling::sql(&sql);
            let mut got = 0usize;
            let Ok(mut st) = self.conn.prepare(&sql) else { continue };
            let mut rows = match st.query([]) {
                Ok(r) => r,
                Err(_) => continue,
            };
            while let Ok(Some(r)) = rows.next() {
                got += 1;
                let Ok(eid) = r.get::<_, String>(0) else { continue };
                let mut m = Map::new();
                for (i, (name, _)) in cols.iter().enumerate() {
                    let v: Value = match r.get_ref(i + 1) {
                        Ok(rusqlite::types::ValueRef::Integer(n)) => {
                            Value::from(n)
                        }
                        Ok(rusqlite::types::ValueRef::Real(f)) => {
                            Value::from(f)
                        }
                        Ok(rusqlite::types::ValueRef::Text(s)) => Value::from(
                            String::from_utf8_lossy(s).to_string(),
                        ),
                        _ => continue,
                    };
                    m.insert(name.clone(), v);
                }
                if let Some(bag) = bags.get_mut(&eid) {
                    bag.insert(comp.clone(), Value::Object(m));
                }
            }
            t.done(got);
        }
        order
            .into_iter()
            .filter_map(|(eid, num)| {
                let comps = bags.remove(&eid)?;
                let kind = v.kind_of(&|k| comps.contains_key(k));
                Some(Row { eid, num, kind, comps })
            })
            .collect()
    }

    // Every eid wearing the kind's defining comp, num order.
    pub fn eids_of_kind(&self, kind: &str) -> Vec<String> {
        if !self.has_table(kind) {
            return vec![];
        }
        let sql = format!(
            "select e.eid from {} t join entity e on e.id = t.entity \
             order by e.num",
            q(kind)
        );
        collect(&self.conn, &sql, [], |r| r.get(0))
    }

    // Both endpoints of every edge touching an eid. The filter must name the
    // edge table's OWN columns: `pe.eid = ?1 or ce.eid = ?1` spans two joined
    // copies of `entity`, so no single index answers it and sqlite falls back
    // to SCANNING all of entity, seeking dependency once per row — 110ms of a
    // 155ms `show`. Resolving the eid to its integer id in a scalar subquery
    // (evaluated once, not correlated) turns the disjunction into two preds
    // over one table, which sqlite answers as a MULTI-INDEX OR: the parent
    // half seeks the primary key, the child half seeks dependency_child.
    pub fn deps_of(&self, eid: &str) -> Vec<Dep> {
        let sql = "select pe.eid, d.type, ce.eid from dependency d \
                   join entity pe on pe.id = d.parent \
                   join entity ce on ce.id = d.child \
                   where d.parent = (select id from entity where eid = ?1) \
                      or d.child  = (select id from entity where eid = ?1) \
                   order by pe.eid, d.type, d.ord, ce.eid";
        collect(&self.conn, sql, [eid], |r| {
            Ok(Dep { parent: r.get(0)?, type_: r.get(1)?, child: r.get(2)? })
        })
    }

    // Comments aimed at an entity, birth order (bornAt sort).
    pub fn comments_on(&self, eid: &str) -> Vec<String> {
        let sql = "select ce.eid from comment c \
                   join entity ce on ce.id = c.entity \
                   join entity te on te.id = c.target \
                   left join created cr on cr.entity = c.entity \
                   where te.eid = ?1 order by coalesce(cr.at, ''), ce.num";
        collect(&self.conn, sql, [eid], |r| r.get(0))
    }
}

// A row cache for renderers that resolve many eids (said(), authoring).
pub struct Rows<'a> {
    pub store: &'a Store,
    cache: std::cell::RefCell<HashMap<String, Option<Row>>>,
}

impl<'a> Rows<'a> {
    pub fn new(store: &'a Store) -> Rows<'a> {
        Rows { store, cache: Default::default() }
    }
    pub fn get(&self, eid: &str) -> Option<Row> {
        if let Some(hit) = self.cache.borrow().get(eid) {
            return hit.clone();
        }
        let got = self.store.row(eid);
        self.cache.borrow_mut().insert(eid.into(), got.clone());
        got
    }
}

// query.rs resolves filter values through any Source; the sqlite store's
// resolution is resolve_id itself.
impl Source for Store {
    fn resolve_id(&self, id: &str) -> Option<String> {
        Store::resolve_id(self, id)
    }
}

// The id grammar as a free function, so the write path resolves against its
// own connection with the same rules the read Store uses.
pub fn resolve(conn: &Connection, id: &str) -> Option<String> {
    let num_of = |n: i64| -> Option<String> {
        one(conn, "select eid from entity where num = ?1", [n], |r| r.get(0))
    };
    if let Some(c) = regex_num(id) {
        return num_of(c);
    }
    if let Ok(n) = id.parse::<i64>() {
        if let Some(hit) = num_of(n) {
            return Some(hit);
        }
    }
    let low = id.to_lowercase();
    if is_uuid(&low) {
        if let Some(hit) = one(
            conn,
            "select eid from entity where eid = ?1",
            [&low],
            |r| r.get::<_, String>(0),
        ) {
            return Some(hit);
        }
    }
    if low.len() >= 6 && low.len() <= 8
        && low.chars().all(|c| c.is_ascii_hexdigit())
    {
        let hi = format!("{low}\u{ffff}");
        let hits: Vec<String> = collect(
            conn,
            "select eid from entity where eid >= ?1 and eid < ?2 limit 2",
            [&low, &hi],
            |r| r.get(0),
        );
        if hits.len() == 1 {
            return Some(hits[0].clone());
        }
    }
    let has_alias = one(
        conn,
        "select 1 from sqlite_master where type = 'table' and name = 'alias'",
        [],
        |r| r.get::<_, i64>(0),
    )
    .is_some();
    if has_alias {
        if let Some(hit) = one(
            conn,
            "select e.eid from alias a join entity e \
             on e.id = a.entity where a.slug = ?1",
            [&low],
            |r| r.get::<_, String>(0),
        ) {
            return Some(hit);
        }
    }
    None
}

fn regex_num(id: &str) -> Option<i64> {
    let (pre, num) = id.split_once('-')?;
    if pre.is_empty() || !pre.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    num.parse().ok()
}
