// The deps=1 layer's edge set for one hit — the incident dependency-table edges
// PLUS the synthetic persona `reads` edges the route appends (db.ts incident →
// `[...deps, ...homeReads(homes(…), deps)]`). A project's specialist personas
// ride a derived `reads` edge from the project (their home) to themselves; that
// edge lives in no table, so a reader off the dependency table alone misses it
// (the two "reads" edges the first parity run surfaced).
//
// `store.deps_of` already returns the incident edges quarantine-screened and in
// the route's order (parent.eid, type, ord, child.eid); homeReads is appended
// after, exactly as the route concatenates it.

use yak_kernel::{Dep, Store};

fn quarantined(store: &Store, eid: &str) -> bool {
    if !store.has_table("quarantined") {
        return false;
    }
    store
        .conn
        .query_row(
            "select 1 from quarantined q join entity e on e.id = q.entity \
             where e.eid = ?1 limit 1",
            [eid],
            |r| r.get::<_, i64>(0),
        )
        .ok()
        .is_some()
}

// homes(): the (persona, home) pairs whose persona OR home is `eid`, in persona
// table order — homeReads' whole input, scoped to this hit.
fn homes_touching(store: &Store, eid: &str) -> Vec<(String, Option<String>)> {
    if !store.has_table("persona") {
        return vec![];
    }
    let sql = "select o.eid, h.eid from persona t \
               join entity o on o.id = t.entity \
               left join entity h on h.id = t.home \
               where o.eid = ?1 or h.eid = ?1";
    let Ok(mut st) = store.conn.prepare(sql) else { return vec![] };
    st.query_map([eid], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default()
}

// The deps=1 layer for one hit: incident edges then the synthetic persona
// `reads` edges (homeReads), each screened for quarantine and deduped against a
// contains/reads edge that already exists.
pub fn deps_of(store: &Store, eid: &str) -> Vec<Dep> {
    let sql = store.deps_of(eid);
    let mut out = sql.clone();
    for (persona, home) in homes_touching(store, eid) {
        let Some(home) = home else { continue };
        let dup = sql.iter().any(|d| {
            d.parent == home && d.child == persona && (d.type_ == "contains" || d.type_ == "reads")
        });
        if dup || quarantined(store, &home) || quarantined(store, &persona) {
            continue;
        }
        out.push(Dep { parent: home, type_: "reads".into(), child: persona });
    }
    out
}

// The `.edges!` rider's incident set for a MEMBER set (db.ts eagerDeps =
// incident(eids, eagerOnly=true)): the incident edges screened to the eager
// graph (store.incident_eager) then the synthetic persona `reads` edges
// (homeReads) over the set's homes, deduped against a contains/reads edge that
// already exists. NO quarantine screen — incident()+homeReads carry none (unlike
// the deps=1 route's localDeps), so the rider delivers every incident triple,
// quarantined endpoints included. Byte-for-byte incident(eids, eagerOnly=true).
pub fn eager_deps(store: &Store, eids: &[String]) -> Vec<Dep> {
    let incident = store.incident_eager(eids);
    let mut out = incident.clone();
    for (persona, home) in store.homes_for(eids) {
        let Some(home) = home else { continue };
        let dup = incident.iter().any(|d| {
            d.parent == home && d.child == persona && (d.type_ == "contains" || d.type_ == "reads")
        });
        if dup {
            continue;
        }
        out.push(Dep { parent: home, type_: "reads".into(), child: persona });
    }
    out
}
