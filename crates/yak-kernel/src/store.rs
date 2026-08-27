// The read-only store: open the live graph file, resolve human ids, read an
// entity's components the way the TS select() layer projects them — every
// {eid} reference joined back to its target's eid text, never the integer it
// is stored as. Never migrates, never takes the writer baton: a library
// client connects, reads, and leaves the schema alone (D-22530 §1).

use crate::vocab::vocab;
pub use crate::model::{is_uuid, Dep, Row};
use crate::model::{Graph, Hit, Source};
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

    // Quarantined entities are SCREENED from reads — the graph's own
    // convention, applied by the /query route, by client.ts rows(), and by
    // FTS (search.rs carries the same `not exists` in its sql). A file reader
    // that skipped it would list rows the server refuses to serve, which is
    // exactly how the two doors first disagreed (T-22576). The wire lifts the
    // screen with quarantined=1; no reader here asks yet, so there is no
    // reveal flag to thread — add one on the day something needs it.
    //
    // Returns a `and not exists (…)` fragment for entity alias `a`, or empty
    // on a graph too old to have the table.
    fn unscreened(&self, alias: &str) -> String {
        if !self.has_table("quarantined") {
            return String::new();
        }
        format!(
            " and not exists (select 1 from quarantined __q \
             where __q.entity = {alias}.id)"
        )
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
        self.row_opt(eid, false)
    }

    // Like row(), but WITHOUT the default quarantine screen: a quarantined
    // entity comes back WITH its `quarantined` comp, and the caller decides.
    // This is what a subscription's per-eid maintain needs — a live member that
    // becomes quarantined mid-session must emit a REMOVE (drop), not a death
    // (entity-null), so it reads the row unscreened and screens with the same
    // `listed()`/reveal logic TS eager()+maintain apply (subserve.ts: eager()
    // is unscreened, maintain's step() drops a member that stops matching).
    pub fn row_revealed(&self, eid: &str) -> Option<Row> {
        self.row_opt(eid, true)
    }

    fn row_opt(&self, eid: &str, reveal: bool) -> Option<Row> {
        // one probe answers all three: does it exist, is it screened, and
        // what num does it wear — a quarantined entity reads as absent unless
        // `reveal` lifts the screen (the maintain reader above).
        let screen =
            if reveal { String::new() } else { self.unscreened("e") };
        let num: Option<Option<i64>> = one(
            &self.conn,
            &format!("select e.num from entity e where e.eid = ?1{screen}"),
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
        crate::model::project_session(&mut comps);
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
        // No screen here on purpose: a LISTING screens one level up, where
        // `visible()` can be lifted by a `.quarantined` filter (T-22558). The
        // per-entity doors have no such reveal, so they screen in sql.
        let sql = format!(
            "select e.eid, e.num from {} t join entity e \
             on e.id = t.entity order by e.num",
            q(kind)
        );
        let order: Vec<(String, Option<i64>)> =
            collect(&self.conn, &sql, [], |r| Ok((r.get(0)?, r.get(1)?)));
        // the kind's own table IS the membership — sqlite reads it as a
        // subquery, so the set never has to be carried through the string
        self.fill(&format!("select entity from {}", q(kind)), order)
    }

    // The indexed candidate path (T-22758): a listing narrows to the rows an
    // index says CAN match before it materializes any, instead of bulk-loading
    // the whole kind and filtering in Rust. `candidates::compile` turns the
    // filters into a WHERE that selects a SUPERSET (a pred it cannot express
    // exactly is dropped, which only widens a conjunction); `fill` materializes
    // just that set; and the caller's `matches` refines it to the exact answer —
    // so this returns byte-identically what `rows_of_kind().filter(matches)`
    // did, having touched a fraction of the rows. On the live graph a filtered
    // task board fell from ~180ms (all 4.4k tasks) to single-digit ms.
    //
    // No quarantine screen, the same as rows_of_kind: a listing screens one
    // level up, where a `.quarantined` filter can lift it.
    //
    // Named apart from the `Graph::rows_matching` trait door on purpose: a
    // concrete `&Store` would let an inherent method of the same name SHADOW the
    // trait one, silently changing what every direct caller (read.rs) resolves
    // to. `rows_matching` (trait) is the public door; this is its file body.
    pub fn rows_narrowed(&self, kind: &str, preds: &[crate::query::Pred]) -> Vec<Row> {
        if !self.has_table(kind) {
            return vec![];
        }
        let n = crate::candidates::compile(preds);
        // Nothing compiled — the candidate set IS the whole kind, so read it the
        // cheap way (a membership subquery, no id list to carry) exactly as
        // rows_of_kind does, then refine.
        if !n.narrowed {
            return self
                .rows_of_kind(kind)
                .into_iter()
                .filter(|r| crate::query::matches(r, preds))
                .collect();
        }
        let (ids, order) = self.candidate_ids(kind, &n, None, None, false);
        if ids.is_empty() {
            return vec![];
        }
        self.fill(&ids.join(","), order)
            .into_iter()
            .filter(|r| crate::query::matches(r, preds))
            .collect()
    }

    // The evalFast-equivalent (sql.ts windowed()): a filtered/LIMITED large-kind
    // read answered newest-num-first from the index, materializing at most
    // `limit` rows — the door that closes the pure-limit case (`.kind=task&
    // limit=1`), which narrowing alone cannot, because the window has to reach
    // the SQL before rows are built. A LIMIT may ride the statement ONLY when the
    // filter compiled EXACTLY: a predicate the matcher answers runs AFTER the
    // limit and would under-fill the page (sql.ts's rule), so an inexact filter
    // falls back to narrow → refine → cut-in-Rust, correct but unwindowed at the
    // SQL. `reveal` lifts the quarantine screen the window otherwise applies IN
    // the WHERE — the screen must ride the compiled statement, or a screened row
    // in the newest N under-fills the page.
    //
    // Rows come back num-ASCENDING (the wire order); the window's "newest" is an
    // ordering the SQL uses to pick the page, not the shape it returns.
    pub fn rows_window(
        &self,
        kind: &str,
        preds: &[crate::query::Pred],
        after: Option<i64>,
        limit: Option<i64>,
        reveal: bool,
    ) -> Vec<Row> {
        if !self.has_table(kind) {
            return vec![];
        }
        let n = crate::candidates::compile(preds);
        let screen = !reveal;
        // The exact path: push after/limit into the statement and materialize
        // only the page. Safe only when every pred compiled — else the matcher's
        // leftover work happens after the cut.
        if n.exact {
            let (ids, mut order) =
                self.candidate_ids(kind, &n, after, limit, screen);
            if ids.is_empty() {
                return vec![];
            }
            let mut rows = self.fill(&ids.join(","), std::mem::take(&mut order));
            rows.sort_by(|a, b| a.num.unwrap_or(0).cmp(&b.num.unwrap_or(0)));
            return rows;
        }
        // The inexact fallback: narrow by the compilable subset, refine with the
        // full matcher, screen, then cut the newest `limit` in Rust.
        let mut rows: Vec<Row> = if n.narrowed {
            let (ids, order) = self.candidate_ids(kind, &n, None, None, false);
            if ids.is_empty() {
                vec![]
            } else {
                self.fill(&ids.join(","), order)
            }
        } else {
            self.rows_of_kind(kind)
        };
        rows.retain(|r| crate::query::matches(r, preds));
        if screen {
            rows.retain(crate::store::visible);
        }
        if let Some(a) = after {
            rows.retain(|r| r.num.unwrap_or(0) < a);
        }
        if let Some(l) = limit {
            let l = l.max(0) as usize;
            if rows.len() > l {
                rows.sort_by(|a, b| b.num.unwrap_or(0).cmp(&a.num.unwrap_or(0)));
                rows.truncate(l);
                rows.sort_by(|a, b| a.num.unwrap_or(0).cmp(&b.num.unwrap_or(0)));
            }
        }
        rows
    }

    // Run a compiled candidate filter over a kind's membership and return the
    // matching entity ids (for an inlined `fill` set) beside their (eid, num) in
    // read order. `after`/`limit` bound the newest-num page; `screen` adds the
    // quarantine screen in SQL (a windowed read must screen before it cuts).
    fn candidate_ids(
        &self,
        kind: &str,
        n: &crate::candidates::Narrowed,
        after: Option<i64>,
        limit: Option<i64>,
        screen: bool,
    ) -> (Vec<String>, Vec<(String, Option<i64>)>) {
        let screen_sql = if screen { self.unscreened("e") } else { String::new() };
        let mut after_sql = String::new();
        if let Some(a) = after {
            // a is an i64 read off the spine — no user text, safe to inline.
            after_sql = format!(" and e.num < {a}");
        }
        let order_dir = if limit.is_some() { "desc" } else { "asc" };
        let limit_sql = match limit {
            Some(l) => format!(" limit {}", l.max(0)),
            None => String::new(),
        };
        let sql = format!(
            "select e.id, e.eid, e.num from {} t join entity e \
             on e.id = t.entity{} where {}{}{} order by e.num {}{}",
            q(kind),
            n.joins,
            n.cond,
            screen_sql,
            after_sql,
            order_dir,
            limit_sql,
        );
        let got: Vec<(i64, String, Option<i64>)> = collect(
            &self.conn,
            &sql,
            rusqlite::params_from_iter(n.params.iter()),
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        );
        let mut ids = Vec::with_capacity(got.len());
        let mut order = Vec::with_capacity(got.len());
        for (id, eid, num) in got {
            ids.push(id.to_string());
            order.push((eid, num));
        }
        (ids, order)
    }

    // The same bulk read for an arbitrary SET of eids — what a renderer
    // resolving many related entities needs (T-22589). Rows come back for
    // whichever eids the graph has, num order; the rest are simply absent,
    // the way row() answers None.
    pub fn rows_of(&self, eids: &[String]) -> Vec<Row> {
        if eids.is_empty() {
            return vec![];
        }
        // Membership is named by entity.id, not eid: every comp table is keyed
        // on the integer, so an id list lets each per-comp query seek instead
        // of scanning a table as long as the graph. Chunked because the eids
        // are bound, and sqlite caps how many parameters one statement takes.
        let mut order: Vec<(String, Option<i64>)> = vec![];
        let mut ids: Vec<i64> = vec![];
        for batch in eids.chunks(500) {
            let holes: Vec<String> =
                (1..=batch.len()).map(|i| format!("?{i}")).collect();
            let sql = format!(
                "select e.id, e.eid, e.num from entity e where e.eid in ({}) \
                 order by e.num",
                holes.join(",")
            );
            let got: Vec<(i64, String, Option<i64>)> = collect(
                &self.conn,
                &sql,
                rusqlite::params_from_iter(batch.iter()),
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            );
            for (id, eid, num) in got {
                ids.push(id);
                order.push((eid, num));
            }
        }
        if ids.is_empty() {
            return vec![];
        }
        // integers straight from entity.id — nothing a caller spelled
        let list: Vec<String> = ids.iter().map(|i| i.to_string()).collect();
        self.fill(&list.join(","), order)
    }

    // The bulk read both rows_of_kind and rows_of are made of: one query per
    // component table over a membership `t.entity in (<set>)`, filling a bag
    // per entity. `set` is SQL — a subquery for a kind, an id list for a set.
    // Column projection matches comp_row() exactly, so a row assembled here
    // and a row probed there are the same row.
    fn fill(&self, set: &str, order: Vec<(String, Option<i64>)>) -> Vec<Row> {
        let v = vocab();
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
                 where t.entity in ({})",
                sel.join(", "),
                q(comp),
                joins,
                set
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
                let mut comps = bags.remove(&eid)?;
                crate::model::project_session(&mut comps);
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

    // Entities whose `comp.prop` REFERENCE points at one of `targets` —
    // the reverse lookup the inbox arms ride (comment.target=…). Ref
    // columns store integer ids, so the probe joins through entity twice.
    pub fn eids_where_ref(
        &self,
        comp: &str,
        prop: &str,
        targets: &[String],
    ) -> Vec<String> {
        if targets.is_empty() || !self.has_table(comp) {
            return vec![];
        }
        let marks = vec!["?"; targets.len()].join(",");
        let sql = format!(
            "select e.eid from {} t join entity e on e.id = t.entity \
             join entity tt on tt.id = t.{} \
             where tt.eid in ({marks}) order by e.num",
            q(comp),
            q(prop)
        );
        let Ok(mut st) = self.conn.prepare(&sql) else { return vec![] };
        st.query_map(rusqlite::params_from_iter(targets), |r| r.get(0))
            .map(|it| it.filter_map(|x| x.ok()).collect())
            .unwrap_or_default()
    }

    // Entities whose `comp.prop` TEXT column equals one of `values`.
    pub fn eids_where_text(
        &self,
        comp: &str,
        prop: &str,
        values: &[String],
    ) -> Vec<String> {
        if values.is_empty() || !self.has_table(comp) {
            return vec![];
        }
        let marks = vec!["?"; values.len()].join(",");
        let sql = format!(
            "select e.eid from {} t join entity e on e.id = t.entity \
             where t.{} in ({marks}) order by e.num",
            q(comp),
            q(prop)
        );
        let Ok(mut st) = self.conn.prepare(&sql) else { return vec![] };
        st.query_map(rusqlite::params_from_iter(values), |r| r.get(0))
            .map(|it| it.filter_map(|x| x.ok()).collect())
            .unwrap_or_default()
    }

    // The session ENTITY carrying this session-id string, if reified.
    pub fn session_row(&self, sid: &str) -> Option<Row> {
        if !self.has_table("session") {
            return None;
        }
        let eid: Option<String> = self
            .conn
            .query_row(
                "select e.eid from session s join entity e \
                 on e.id = s.entity where s.id = ?1",
                [sid],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        eid.and_then(|e| self.row(&e))
    }

    // Both endpoints of every edge touching an eid. The filter must name the
    // edge table's OWN columns: `pe.eid = ?1 or ce.eid = ?1` spans two joined
    // copies of `entity`, so no single index answers it and sqlite falls back
    // to SCANNING all of entity, seeking dependency once per row — 110ms of a
    // 155ms `show`. Resolving the eid to its integer id in a scalar subquery
    // (evaluated once, not correlated) turns the disjunction into two preds
    // over one table, which sqlite answers as a MULTI-INDEX OR: the parent
    // half seeks the primary key, the child half seeks dependency_child.
    // The disjunction stays a top-level AND-term under the screens, so that
    // plan survives them.
    //
    // Both endpoints are screened, the way the route's deps=1 layer screens
    // them (localread.ts localDeps filters on either end).
    pub fn deps_of(&self, eid: &str) -> Vec<Dep> {
        let sql = format!(
            "select pe.eid, d.type, ce.eid from dependency d \
             join entity pe on pe.id = d.parent \
             join entity ce on ce.id = d.child \
             where (d.parent = (select id from entity where eid = ?1) \
                 or d.child  = (select id from entity where eid = ?1)){}{} \
             order by pe.eid, d.type, d.ord, ce.eid",
            self.unscreened("pe"),
            self.unscreened("ce")
        );
        collect(&self.conn, &sql, [eid], |r| {
            Ok(Dep { parent: r.get(0)?, type_: r.get(1)?, child: r.get(2)? })
        })
    }

    // Who points AT these entities through a typed {eid} reference column — the
    // reverse-reference layer db.ts refsOf() builds for `backlinks=1`. One keyed
    // statement per ref column in the readable vocabulary (comps + stamped), the
    // SAME order Object.entries(readable) walks — cmps declaration order, each
    // component's columns in readable order — so the concatenated result is the
    // route's. The targets are staged in a temp `hit` table (writable even on a
    // read-only main db), exactly as stage() does, so the query planner reads
    // the same plan — and thus the same unordered row order — the Deno server's
    // node:sqlite reads over the SAME system libsqlite3. Each tuple is
    // (from_eid, `comp.col`, to_eid); the caller screens quarantine on the
    // source, the way the route filters `!eager(from).quarantined`.
    pub fn refs_of(&self, eids: &[String]) -> Vec<(String, String, String)> {
        if eids.is_empty() {
            return vec![];
        }
        if self
            .conn
            .execute_batch(
                "create temp table if not exists hit (eid text primary key); \
                 delete from hit;",
            )
            .is_err()
        {
            return vec![];
        }
        {
            let Ok(mut put) =
                self.conn.prepare("insert or ignore into hit (eid) values (?1)")
            else {
                return vec![];
            };
            for e in eids {
                let _ = put.execute([e]);
            }
        }
        let v = vocab();
        let mut out = vec![];
        for (name, _) in &v.comps {
            if !self.has_table(name) {
                continue;
            }
            for (col, t) in v.readable(name) {
                if !t.is_ref() {
                    continue;
                }
                let sql = format!(
                    "select o.eid, r.eid from {} t \
                     join entity o on o.id = t.entity \
                     join entity r on r.id = t.{} \
                     where r.eid in (select eid from hit)",
                    q(name),
                    q(&col)
                );
                let via = format!("{name}.{col}");
                for (from, to) in
                    collect(&self.conn, &sql, [], |r| Ok((r.get(0)?, r.get(1)?)))
                {
                    out.push((from, via.clone(), to));
                }
            }
        }
        out
    }

    // Comments aimed at an entity, birth order (bornAt sort).
    pub fn comments_on(&self, eid: &str) -> Vec<String> {
        let sql = format!(
            "select ce.eid from comment c \
             join entity ce on ce.id = c.entity \
             join entity te on te.id = c.target \
             left join created cr on cr.entity = c.entity \
             where te.eid = ?1{} order by coalesce(cr.at, ''), ce.num",
            self.unscreened("ce")
        );
        collect(&self.conn, &sql, [eid], |r| r.get(0))
    }
}

// A row cache for renderers that resolve many eids (said(), authoring).
// Holds a Graph, not a Store, so one renderer serves the file and the wire —
// and over the wire the memo is what keeps a page to a handful of requests.
pub struct Rows<'a> {
    pub graph: &'a dyn Graph,
    cache: std::cell::RefCell<HashMap<String, Option<Row>>>,
}

impl<'a> Rows<'a> {
    pub fn new(graph: &'a dyn Graph) -> Rows<'a> {
        Rows { graph, cache: Default::default() }
    }
    pub fn get(&self, eid: &str) -> Option<Row> {
        if let Some(hit) = self.cache.borrow().get(eid) {
            return hit.clone();
        }
        let got = self.graph.row(eid);
        self.cache.borrow_mut().insert(eid.into(), got.clone());
        got
    }

    // Load many eids in one bulk pass instead of a probe apiece (T-22589).
    // Correctness never rides on this: an eid warm() misses still resolves
    // through get(), so a renderer that forgets to name one loses speed, not
    // accuracy — which is what makes the gather safe to keep approximate.
    pub fn warm(&self, eids: &[String]) {
        let want: Vec<String> = {
            let seen = self.cache.borrow();
            let mut asked: HashSet<&str> = HashSet::new();
            eids.iter()
                .filter(|e| !e.is_empty() && !seen.contains_key(*e))
                .filter(|e| asked.insert(e.as_str()))
                .cloned()
                .collect()
        };
        if want.is_empty() {
            return;
        }
        let got = self.graph.rows_of(&want);
        let mut cache = self.cache.borrow_mut();
        for r in got {
            cache.insert(r.eid.clone(), Some(r));
        }
        // an eid the graph does not have caches as a miss, the way get() does
        for e in want {
            cache.entry(e).or_insert(None);
        }
    }
}

// query.rs resolves filter values through any Source; the sqlite store's
// resolution is resolve_id itself.
impl Source for Store {
    fn resolve_id(&self, id: &str) -> Option<String> {
        Store::resolve_id(self, id)
    }
}

// The file's answer to the read surface — the inherent methods, which the
// remote impl mirrors over HTTP.
impl Graph for Store {
    fn row(&self, eid: &str) -> Option<Row> {
        Store::row(self, eid)
    }
    fn rows_of_kind(&self, kind: &str) -> Result<Vec<Row>, String> {
        Ok(Store::rows_of_kind(self, kind))
    }
    fn rows_of(&self, eids: &[String]) -> Vec<Row> {
        Store::rows_of(self, eids)
    }
    // The file narrows through the index and refines the superset (T-22758);
    // the caller's `visible()` screen is what reveal lifts one level up, so
    // nothing to do with reveal here.
    fn rows_matching(
        &self,
        kind: &str,
        preds: &[crate::query::Pred],
        _reveal: bool,
    ) -> Result<Vec<Row>, String> {
        Ok(Store::rows_narrowed(self, kind, preds))
    }
    fn deps_of(&self, eid: &str) -> Vec<Dep> {
        Store::deps_of(self, eid)
    }
    fn comments_on(&self, eid: &str) -> Vec<String> {
        Store::comments_on(self, eid)
    }
    fn search(&self, q: &str, limit: usize) -> Result<Vec<Hit>, String> {
        crate::search::search(self, q, limit)
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

// The query doors screen quarantined content by default (db.ts unshifts a
// `.quarantined=` absent pred); every reader that assembles its own row set
// applies the same screen unless a filter reveals.
pub fn visible(r: &Row) -> bool {
    !r.comps.contains_key("quarantined")
}
