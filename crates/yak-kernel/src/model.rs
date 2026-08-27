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

// One FTS hit. Lives here rather than in search.rs because a hit is a shape,
// not a storage act: the sqlite FTS query and the server's /search route both
// produce these, so a renderer never learns which one answered.
#[derive(Debug, Clone)]
pub struct Hit {
    pub eid: String,
    pub num: Option<i64>,
    pub kind: String,
    pub title: String,
    // The TITLE with FTS hit-marks (highlight over doc_fts col 0), between
    // `title` and `snip` on the wire; the plain `d.title` on a filters-only or
    // addressed hit that never touched the index.
    pub title_hit: String,
    pub snip: String,
    // A comment hit OPENS its target; for everything else open == eid.
    pub open: String,
    pub open_id: Option<String>,
    pub retired: bool,
}

// What query evaluation needs from whatever holds the rows: id resolution
// for reference VALUES in filters (`.project=P-19` compares as its eid).
// Deliberately minimal — a Source is not a Store.
pub trait Source {
    fn resolve_id(&self, id: &str) -> Option<String>;
}

// The whole READ surface a renderer asks for, so `show`/`list`/`search` are
// written once against the graph and never against a storage kind. Two impls
// answer it today — the sqlite Store reading a file (store.rs) and Remote
// speaking the server's JSON wire (remote.rs) — and byte-identical output
// across the pair is the contract (T-22576).
//
// It is a SEPARATE trait from Source, not a widening of it, on purpose: the
// delta-fed GraphCache resolves ids honestly but holds no edges and no FTS,
// so making it claim this surface would mean answering "no edges" where the
// truth is "I cannot know". A cache stays a Source.
pub trait Graph: Source {
    fn row(&self, eid: &str) -> Option<Row>;
    // Every row whose kind-defining comp is `kind`, num order. Derived-kind
    // screening (a design+task lists as design) belongs to the caller.
    fn rows_of_kind(&self, kind: &str) -> Result<Vec<Row>, String>;
    // The same, NARROWED by the filters — the door a listing should use.
    // It exists because "fetch the kind, then filter" is a scan the wire
    // cannot afford: unfiltered, a board is every task's full body serialized
    // into one response. The server speaks this very grammar, so the remote
    // impl hands the predicates over and lets the query run where the rows
    // are; the file impl narrows through the index (candidates::compile) and
    // materializes only the rows that can match, then refines (T-22758).
    //
    // A listing returns Result because "no rows" and "I could not ask" are
    // different answers that look identical once flattened: a refused request
    // reported as an empty board reads as a true, quiet "(no matches)". That
    // is exactly how a malformed remote query hid itself (T-22576).
    // `reveal` lifts the quarantine screen, the way a `.quarantined` filter
    // does at the CLI and `quarantined=1` does at the route — the wire screens
    // by default, so without this a revealed listing would come back empty
    // from a server and full from a file.
    fn rows_matching(
        &self,
        kind: &str,
        preds: &[crate::query::Pred],
        reveal: bool,
    ) -> Result<Vec<Row>, String>;
    // Many eids in one pass — what a renderer resolving related entities
    // warms with (T-22589). It is a trait method rather than a Store one
    // because the saving is LARGER over the wire than over the file: one
    // request for the whole neighborhood instead of a round trip apiece.
    fn rows_of(&self, eids: &[String]) -> Vec<Row>;
    fn deps_of(&self, eid: &str) -> Vec<Dep>;
    // Comments aimed at an entity, birth order.
    fn comments_on(&self, eid: &str) -> Vec<String>;
    fn search(&self, q: &str, limit: usize) -> Result<Vec<Hit>, String>;
}

// sessionOf (types.ts): a session's rolling aliases are a PROJECTION, never a
// second source of truth — `spawn`, `worktree` and `runtime` overlay the
// session bag, canonical last. The server applies this before it serializes a
// row, so a reader of the FILE must apply it too or the same session renders
// with its agent on one door and without it on the other: provider/model/
// effort live on `spawn` for a modern row and on `session` for an old one.
//
// Both doors drop NULL columns before this runs (the file has no key, the
// wire spells it null), so here absence loses to a value. TS lets an explicit
// null CLEAR an inherited column; that one case still differs, and it needs
// nulls carried through the reader to fix.
pub fn project_session(comps: &mut Map<String, Value>) {
    if !comps.contains_key("session") {
        return;
    }
    let mut merged = match comps.get("session") {
        Some(Value::Object(m)) => m.clone(),
        _ => Map::new(),
    };
    for over in ["spawn", "worktree", "runtime"] {
        if let Some(Value::Object(m)) = comps.get(over) {
            for (k, v) in m {
                merged.insert(k.clone(), v.clone());
            }
        }
    }
    comps.insert("session".into(), Value::Object(merged));
}

pub fn is_uuid(s: &str) -> bool {
    let b: Vec<&str> = s.split('-').collect();
    b.len() == 5
        && [8, 4, 4, 4, 12]
            .iter()
            .zip(&b)
            .all(|(n, p)| p.len() == *n && p.chars().all(|c| c.is_ascii_hexdigit()))
}
