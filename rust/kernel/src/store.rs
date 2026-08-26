// The read-only store: open the live graph file, resolve human ids, read an
// entity's components the way the TS select() layer projects them — every
// {eid} reference joined back to its target's eid text, never the integer it
// is stored as. Never migrates, never takes the writer baton: a library
// client connects, reads, and leaves the schema alone (D-22530 §1).

use crate::vocab::vocab;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

pub struct Store {
    pub conn: Connection,
    tables: HashSet<String>,
}

#[derive(Debug, Clone)]
pub struct Row {
    pub eid: String,
    pub num: Option<i64>,
    pub kind: String,
    pub comps: Map<String, Value>,
}

#[derive(Debug, Clone)]
pub struct Dep {
    pub parent: String,
    pub type_: String,
    pub child: String,
}

fn q(id: &str) -> String {
    format!("\"{}\"", id)
}

impl Store {
    pub fn open(path: &str) -> rusqlite::Result<Store> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        )?;
        conn.busy_timeout(std::time::Duration::from_millis(5000))?;
        let mut tables = HashSet::new();
        {
            let mut st = conn.prepare(
                "select name from sqlite_master where type in ('table','view')",
            )?;
            let mut rows = st.query([])?;
            while let Some(r) = rows.next()? {
                tables.insert(r.get::<_, String>(0)?);
            }
        }
        Ok(Store { conn, tables })
    }

    pub fn has_table(&self, name: &str) -> bool {
        self.tables.contains(name)
    }

    // resolveId's grammar: prefixed num (prefix is display-only, num rules),
    // bare num, full uuid, short-eid prefix, alias slug.
    pub fn resolve_id(&self, id: &str) -> Option<String> {
        let num_of = |n: i64| -> Option<String> {
            self.conn
                .query_row(
                    "select eid from entity where num = ?1",
                    [n],
                    |r| r.get(0),
                )
                .optional()
                .ok()
                .flatten()
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
            if let Some(hit) = self
                .conn
                .query_row(
                    "select eid from entity where eid = ?1",
                    [&low],
                    |r| r.get::<_, String>(0),
                )
                .optional()
                .ok()
                .flatten()
            {
                return Some(hit);
            }
        }
        if low.len() >= 6 && low.len() <= 8
            && low.chars().all(|c| c.is_ascii_hexdigit())
        {
            let mut st = self
                .conn
                .prepare(
                    "select eid from entity where eid >= ?1 and eid < ?2 \
                     limit 2",
                )
                .ok()?;
            let hi = format!("{low}\u{ffff}");
            let hits: Vec<String> = st
                .query_map([&low, &hi], |r| r.get(0))
                .ok()?
                .filter_map(|x| x.ok())
                .collect();
            if hits.len() == 1 {
                return Some(hits[0].clone());
            }
        }
        if self.has_table("alias") {
            if let Some(hit) = self
                .conn
                .query_row(
                    "select e.eid from alias a join entity e \
                     on e.id = a.entity where a.slug = ?1",
                    [&low],
                    |r| r.get::<_, String>(0),
                )
                .optional()
                .ok()
                .flatten()
            {
                return Some(hit);
            }
        }
        None
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
            let present: Option<i64> = self
                .conn
                .query_row(
                    &format!(
                        "select 1 from {} t join entity e on e.id = t.entity \
                         where e.eid = ?1",
                        q(comp)
                    ),
                    [eid],
                    |r| r.get(0),
                )
                .optional()
                .ok()
                .flatten();
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
        let mut st = self.conn.prepare(&sql).ok()?;
        st.query_row([eid], |r| {
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
        .flatten()
    }

    pub fn row(&self, eid: &str) -> Option<Row> {
        // one probe answers both "does it exist" and "what num does it wear"
        let num: Option<i64> = self
            .conn
            .query_row(
                "select num from entity where eid = ?1",
                [eid],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()
            .ok()
            .flatten()
            .flatten();
        let exists: bool = self
            .conn
            .query_row(
                "select 1 from entity where eid = ?1",
                [eid],
                |r| r.get::<_, i64>(0),
            )
            .optional()
            .ok()
            .flatten()
            .is_some();
        if !exists {
            return None;
        }
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
        let mut order: Vec<(String, Option<i64>)> = vec![];
        {
            let sql = format!(
                "select e.eid, e.num from {} t join entity e \
                 on e.id = t.entity order by e.num",
                q(kind)
            );
            let Ok(mut st) = self.conn.prepare(&sql) else { return vec![] };
            let it = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)));
            if let Ok(it) = it {
                order = it.filter_map(|x| x.ok()).collect();
            }
        }
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
            let Ok(mut st) = self.conn.prepare(&sql) else { continue };
            let mut rows = match st.query([]) {
                Ok(r) => r,
                Err(_) => continue,
            };
            while let Ok(Some(r)) = rows.next() {
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
        let Ok(mut st) = self.conn.prepare(&sql) else { return vec![] };
        st.query_map([], |r| r.get(0))
            .map(|it| it.filter_map(|x| x.ok()).collect())
            .unwrap_or_default()
    }

    pub fn deps_of(&self, eid: &str) -> Vec<Dep> {
        let sql = "select pe.eid, d.type, ce.eid from dependency d \
                   join entity pe on pe.id = d.parent \
                   join entity ce on ce.id = d.child \
                   where pe.eid = ?1 or ce.eid = ?1 \
                   order by pe.eid, d.type, d.ord, ce.eid";
        let Ok(mut st) = self.conn.prepare(sql) else { return vec![] };
        st.query_map([eid], |r| {
            Ok(Dep { parent: r.get(0)?, type_: r.get(1)?, child: r.get(2)? })
        })
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default()
    }

    // Comments aimed at an entity, birth order (bornAt sort).
    pub fn comments_on(&self, eid: &str) -> Vec<String> {
        let sql = "select ce.eid from comment c \
                   join entity ce on ce.id = c.entity \
                   join entity te on te.id = c.target \
                   left join created cr on cr.entity = c.entity \
                   where te.eid = ?1 order by coalesce(cr.at, ''), ce.num";
        let Ok(mut st) = self.conn.prepare(sql) else { return vec![] };
        st.query_map([eid], |r| r.get(0))
            .map(|it| it.filter_map(|x| x.ok()).collect())
            .unwrap_or_default()
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

fn regex_num(id: &str) -> Option<i64> {
    let (pre, num) = id.split_once('-')?;
    if pre.is_empty() || !pre.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    num.parse().ok()
}

pub fn is_uuid(s: &str) -> bool {
    let b: Vec<&str> = s.split('-').collect();
    b.len() == 5
        && [8, 4, 4, 4, 12]
            .iter()
            .zip(&b)
            .all(|(n, p)| p.len() == *n && p.chars().all(|c| c.is_ascii_hexdigit()))
}
