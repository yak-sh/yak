// The catchup delta and the live stream — the two halves the WS serving side
// pushes after a join. Both are the JOURNAL replayed as changes:
//
//   - catchup (warm join): every batch since the client's cursor, concatenated
//     in apply order, root-projected (db.ts delta). Frame `{catchup, cursor}`.
//   - live: one freshly-committed batch, root-projected, in the envelope the
//     socket negotiated (wire.ts liveFrame) — `{live, cursor}` for a client
//     that sent `live:1`, a bare `Change[]` for an old one.
//
// A change is built by the kernel's `feed::row_changes` (the mirror of db.ts
// rowChanges: the batch plus the created/updated provenance envelopes the
// journal leaves out) and serialized by `Change::to_value` — the same key
// order the TS journal uses. `root_changes` then drops the lazy entry
// partition, exactly as the root stream does (db.ts rootChanges): a client on
// the root canvas never hears an entry row; those ride an `entries:` sub.

use serde_json::Value;
use yak_kernel::change::Change;
use yak_kernel::feed::{cursor_of, journal_since, row_changes, JournalRow};
use yak_kernel::Store;

// rootChanges: hide every change whose entity is an entry-partition row — the
// eids named by an `entry` component in THIS batch, plus any eid that already
// wears an `entry` row in the graph. The rest pass in order.
pub fn root_changes(store: &Store, changes: Vec<Change>) -> Vec<Change> {
    let has_entry = store.has_table("entry");
    let mut hidden = std::collections::HashSet::new();
    for c in &changes {
        if c.name == "entry" && c.comp.is_some() {
            hidden.insert(c.eid.clone());
        }
    }
    if has_entry {
        let mut candidates: Vec<String> =
            changes.iter().map(|c| c.eid.clone()).collect();
        candidates.sort();
        candidates.dedup();
        for eid in candidates {
            if hidden.contains(&eid) {
                continue;
            }
            let is_entry: Option<i64> = store
                .conn
                .query_row(
                    "select 1 from entry t join entity e on e.id = t.entity \
                     where e.eid = ?1 limit 1",
                    [&eid],
                    |r| r.get(0),
                )
                .ok();
            if is_entry.is_some() {
                hidden.insert(eid);
            }
        }
    }
    changes.into_iter().filter(|c| !hidden.contains(&c.eid)).collect()
}

// delta(db, since): the replay window and the cursor it advanced to.
pub fn delta(store: &Store, since: i64) -> (Vec<Change>, i64) {
    let mut changes: Vec<Change> = vec![];
    let mut cursor = since;
    for r in journal_since(&store.conn, since) {
        cursor = r.rowid;
        changes.extend(row_changes(&r));
    }
    (root_changes(store, changes), cursor)
}

// The catchup frame for a warm client.
pub fn catchup_frame(store: &Store, since: i64) -> Value {
    let (changes, cursor) = delta(store, since);
    serde_json::json!({
        "catchup": changes.iter().map(|c| c.to_value()).collect::<Vec<_>>(),
        "cursor": cursor,
    })
}

// One committed row cast to the live stream: its changes, root-projected. The
// caller pairs this with the negotiated envelope. Returns None when the row is
// wholly entry-partition (nothing for the root stream to hear).
pub fn live_changes(store: &Store, r: &JournalRow) -> Vec<Change> {
    root_changes(store, row_changes(r))
}

// wire.ts liveFrame: envelope → `{live, cursor}`, else the bare array.
pub fn live_frame(changes: &[Change], cursor: i64, envelope: bool) -> Value {
    let arr: Vec<Value> = changes.iter().map(|c| c.to_value()).collect();
    if envelope {
        serde_json::json!({ "live": arr, "cursor": cursor })
    } else {
        Value::Array(arr)
    }
}

pub fn tip(store: &Store) -> i64 {
    cursor_of(&store.conn)
}
