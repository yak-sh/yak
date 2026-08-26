// The pure row/comp model — the shapes every kernel layer speaks, with no
// storage attached. Native sqlite (store.rs) and the delta-fed cache
// (cache.rs) both produce these; query.rs consumes them. This split is what
// lets the core compile to wasm32 (D-22530: the SPA consumes the kernel as
// wasm), so nothing here may touch rusqlite, files, or the clock.

use serde_json::{Map, Value};

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

// What query evaluation needs from whatever holds the rows: id resolution
// for reference VALUES in filters (`.project=P-19` compares as its eid).
// Deliberately minimal — a Source is not a Store.
pub trait Source {
    fn resolve_id(&self, id: &str) -> Option<String>;
}

pub fn is_uuid(s: &str) -> bool {
    let b: Vec<&str> = s.split('-').collect();
    b.len() == 5
        && [8, 4, 4, 4, 12]
            .iter()
            .zip(&b)
            .all(|(n, p)| p.len() == *n && p.chars().all(|c| c.is_ascii_hexdigit()))
}
