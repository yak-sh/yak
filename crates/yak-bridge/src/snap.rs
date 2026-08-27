// The working-set snapshot a cold or stale WS client is reset to
// (graph_query.ts workingSet, M-21143): NOT the whole graph, but the DEFINING
// chrome sets a joining client subscribes to on mount — canvases, pins, cards,
// projects and the per-client UI state. Same `Snapshot` shape the route's
// reset frame carries: `{changes, deps:[], cursor, epoch, vocabHash,
// capabilities}`, its changes each `{eid, name, comp}` in vocabulary order,
// entities in WS-set-then-num order (the union's insertion order).
//
// Three envelope fields the kernel does not source:
//   - `cursor` / `epoch`: read straight from the db (max journal rowid, and
//     server_meta.epoch) — byte-exact with the Deno server on the same file.
//   - `capabilities`: the types.ts constant, restated here (a build constant of
//     this code version).
//   - `vocabHash`: the Deno server hashes its own vocabulary manifest JSON
//     (db.ts vocabHashOf = sha1({writable,stamped})[..16]). That manifest is a
//     TS object shape this crate cannot reproduce byte-for-byte, so the value
//     here is DERIVED from the kernel's baked vocab and is a DOCUMENTED
//     DIVERGENCE until the hash is generated from a source both share (filed as
//     a rung-2 follow-up). A mismatch only makes a client that carried the TS
//     hash re-snapshot on reconnect — harmless; it never corrupts a cache.

use crate::emit::entity_changes;
use serde_json::{Map, Value};
use yak_kernel::feed::cursor_of;
use yak_kernel::vocab::vocab;
use yak_kernel::Store;

// The defining sets, in the order workingSet unions them (graph_query.ts
// WS_SETS). `.session!` is deliberately absent — sessions are the unbounded
// kind and stream when a view that needs them mounts.
pub const WS_SETS: &[&str] = &[
    "canvas", "pin", "card", "project", "favorite", "cursor", "camera", "fold", "shelf", "client",
];

// The server's advertised capabilities (types.ts `capabilities`).
pub const CAPABILITIES: &[&str] = &["spawn", "session-facets"];

// Entities wearing `comp`, quarantine-screened (the route's default screen),
// num order — `.<comp>!` as evalGraph answers it.
fn presence_eids(store: &Store, comp: &str) -> Vec<String> {
    if !store.has_table(comp) {
        return vec![];
    }
    let screen = if store.has_table("quarantined") {
        " and not exists (select 1 from quarantined q where q.entity = e.id)"
    } else {
        ""
    };
    let sql = format!(
        "select e.eid from \"{comp}\" t join entity e on e.id = t.entity \
         where 1=1{screen} order by e.num"
    );
    let Ok(mut st) = store.conn.prepare(&sql) else { return vec![] };
    st.query_map([], |r| r.get::<_, String>(0))
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default()
}

pub fn epoch_of(store: &Store) -> String {
    if !store.has_table("server_meta") {
        return String::new();
    }
    store
        .conn
        .query_row("select v from server_meta where k = 'epoch'", [], |r| r.get::<_, String>(0))
        .unwrap_or_default()
}

// A stable hash of the kernel's baked vocabulary — the bridge's own vocab
// fingerprint. See the module note: NOT expected to equal the Deno server's
// vocabHash yet. Public because the WS reset frame carries this fingerprint
// and returning sockets use it to decide whether their cursor is reusable.
pub fn vocab_hash() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let v = vocab();
    let mut h = DefaultHasher::new();
    for (name, cols) in &v.comps {
        name.hash(&mut h);
        for (c, _) in cols {
            c.hash(&mut h);
        }
    }
    let mut stamped: Vec<&String> = v.stamped.keys().collect();
    stamped.sort();
    for k in stamped {
        k.hash(&mut h);
    }
    format!("{:016x}", h.finish())
}

// The whole reset frame: `{reset:true, snapshot:{…}}`.
pub fn reset_frame(store: &Store) -> Value {
    let mut ids: Vec<String> = vec![];
    let mut seen = std::collections::HashSet::new();
    for comp in WS_SETS {
        for eid in presence_eids(store, comp) {
            if seen.insert(eid.clone()) {
                ids.push(eid);
            }
        }
    }
    let mut changes: Vec<Value> = vec![];
    for eid in &ids {
        if let Some(row) = store.row(eid) {
            changes.extend(entity_changes(&row));
        }
    }
    let mut snap = Map::new();
    snap.insert("changes".into(), Value::Array(changes));
    snap.insert("deps".into(), Value::Array(vec![]));
    snap.insert("cursor".into(), Value::from(cursor_of(&store.conn)));
    snap.insert("epoch".into(), Value::from(epoch_of(store)));
    snap.insert("vocabHash".into(), Value::from(vocab_hash()));
    snap.insert(
        "capabilities".into(),
        Value::Array(CAPABILITIES.iter().map(|c| Value::from(*c)).collect()),
    );
    let mut frame = Map::new();
    frame.insert("reset".into(), Value::Bool(true));
    frame.insert("snapshot".into(), Value::Object(snap));
    Value::Object(frame)
}
