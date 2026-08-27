// The deps=1 layer's edge set for one hit — the incident dependency-table edges
// PLUS the synthetic persona `reads` edges the route appends (db.ts incident →
// `[...deps, ...homeReads(homes(…), deps)]`). A project's specialist personas
// ride a derived `reads` edge from the project (their home) to themselves; that
// edge lives in no table, so a reader off the dependency table alone misses it
// (the two "reads" edges the first parity run surfaced).
//
// homeReads now lives in the kernel (Store::deps_of appends it — T-22640), so
// both doors derive one edge set: the file (yak-cli show_md) and this wire
// server share the same synthesis, and the deps=1 layer is just that call.

use yak_kernel::{Dep, Store};

// The deps=1 layer for one hit: incident edges plus the synthetic persona
// `reads` edges (homeReads), quarantine-screened and deduped — all inside
// Store::deps_of, so the wire and the file door can never disagree.
pub fn deps_of(store: &Store, eid: &str) -> Vec<Dep> {
    store.deps_of(eid)
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
