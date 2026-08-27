// The kernel crate (D-22530 §1): the graph's pure core — vocabulary, the
// row/comp model, the wire Change, the filter subset, the delta-fed cache —
// plus, behind the `native` feature, everything that touches the file: the
// read-only sqlite store, FTS, and since T-22550 the WRITE path — apply()
// with its gate registry, the journal, and the catchup feed. The core
// compiles to wasm32 (yak-wasm), so nothing outside `native` may touch
// rusqlite, files, or the clock. A library client does not migrate: it
// connects, reads, writes through apply, and leaves the schema alone.

pub mod cache;
#[cfg(feature = "native")]
pub mod candidates;
pub mod change;
#[cfg(feature = "native")]
pub mod feed;
#[cfg(feature = "native")]
pub mod inbox;
#[cfg(feature = "native")]
pub mod journal;
pub mod literal;
pub mod model;
#[cfg(feature = "native")]
pub mod profiling;
pub mod query;
#[cfg(feature = "native")]
pub mod reader;
pub mod rooted;
#[cfg(feature = "native")]
pub mod schema;
#[cfg(feature = "native")]
mod schema_gen;
#[cfg(feature = "native")]
pub mod search;
#[cfg(feature = "native")]
pub mod store;
#[cfg(feature = "native")]
pub mod subquery;
#[cfg(feature = "native")]
pub mod telemetry;
#[cfg(feature = "native")]
pub mod time;
pub mod vocab;
mod vocab_gen;
#[cfg(feature = "native")]
pub mod write;

pub use change::Change;
#[cfg(feature = "native")]
pub use feed::{cursor_of, data_version, journal_since, row_changes, Feed, JournalRow};
pub use literal::{normalize_literals_with, LiteralPlan};
pub use model::{Dep, Graph, Hit, Row, Source};
#[cfg(feature = "remote")]
pub mod remote;
#[cfg(feature = "native")]
pub use change::parse_batch;
#[cfg(feature = "native")]
pub use literal::normalize_literals;
#[cfg(feature = "remote")]
pub use remote::Remote;
#[cfg(feature = "native")]
pub use schema::{apply_schema, mint_epoch, SchemaOp};
#[cfg(feature = "native")]
pub use store::{Rows, Store};
pub use vocab::{vocab, PropType, Vocab};
pub use write::{
    apply, default_gates, native_safe, ApplyError, ApplyOpts, Gate, WriteStore, NATIVE_COMPS,
};

// The live graph the way every client resolves it: DB_PATH wins, else the
// home pairing.
#[cfg(feature = "native")]
pub fn db_path() -> String {
    if let Ok(p) = std::env::var("DB_PATH") {
        if !p.is_empty() {
            return p;
        }
    }
    live_db()
}

#[cfg(feature = "native")]
pub fn live_db() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    format!("{home}/.tasks/tasks.db")
}

// True when `target` names the SAME file as `live` — directly, by symlink, or
// by a relative/`.`/`..` path that resolves to it. The comparison is pure over
// its two inputs (no env), so the guard tests without an environment.
//
// The live file exists in production, so a target that will not canonicalize
// is not it (`:memory:`, a scratch copy under a temp dir that was removed);
// fall back to a plain string match only for the case the live file itself is
// absent (a fresh box, the fast tier).
#[cfg(feature = "native")]
pub fn same_graph_file(target: &str, live: &str) -> bool {
    match (std::fs::canonicalize(target), std::fs::canonicalize(live)) {
        (Ok(a), Ok(b)) => a == b,
        _ => target == live,
    }
}

// The default the whole fleet means by "the server" (client.ts host()).
pub const DEFAULT_HOST: &str = "127.0.0.1:5173";

// Where a reader should read. The TS CLI decided this first (localread.ts
// armPath) and the rule is its own, not a new one — a process names its
// endpoint by what it set:
//
//   DB_PATH=<file>   an explicit FILE; probe discipline pairs it with a probe
//                    server, so reading it is exactly right
//   TASKS_HOST only  names a SERVER whose file this process cannot know, so
//                    every read stays on the wire
//   neither          the live pairing — the home graph beside the default host
//   ':memory:'       a private empty db is not the server's graph: wire-only
//   TASKS_LOCAL=0    the arm off outright
#[derive(Debug, Clone, PartialEq)]
pub enum Endpoint {
    File(String),
    Wire(String),
}

// Pure over its inputs, so the decision table tests without an environment.
pub fn endpoint_of(
    db_path: Option<&str>,
    host: Option<&str>,
    disabled: bool,
    live: &str,
) -> Endpoint {
    let wire = || Endpoint::Wire(host.unwrap_or(DEFAULT_HOST).to_string());
    if disabled || db_path == Some(":memory:") {
        return wire();
    }
    match db_path {
        Some(p) if !p.is_empty() => Endpoint::File(p.to_string()),
        _ if host.is_some() => wire(),
        _ => Endpoint::File(live.to_string()),
    }
}

#[cfg(feature = "native")]
pub fn endpoint() -> Endpoint {
    let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    endpoint_of(
        var("DB_PATH").as_deref(),
        var("TASKS_HOST").as_deref(),
        std::env::var("TASKS_LOCAL").ok().as_deref() == Some("0"),
        &live_db(),
    )
}

// The reader this process should use, and the word for where it read. A FILE
// that will not open read-only (missing, or a WAL needing write access) is
// not an error: the wire remains, exactly as armLocal() leaves the TS CLI
// wire-only rather than failing. The local error is only worth reporting when
// the wire cannot answer either.
#[cfg(all(feature = "native", feature = "remote"))]
pub fn open_graph() -> Result<(Box<dyn Graph>, String), String> {
    match endpoint() {
        Endpoint::File(path) => {
            let uri = format!("file:{path}?mode=ro");
            match Store::open(&uri) {
                Ok(s) => Ok((Box::new(s), path)),
                Err(e) => {
                    let host = std::env::var("TASKS_HOST")
                        .ok()
                        .filter(|v| !v.is_empty())
                        .unwrap_or_else(|| DEFAULT_HOST.to_string());
                    let probe = Remote::new(&host);
                    // Prove the fallback answers before claiming it: a dead
                    // server must report the LOCAL truth, not a connection
                    // refusal about a host nobody named.
                    match probe.search("", 1) {
                        Ok(_) => Ok((Box::new(probe), host)),
                        Err(_) => Err(format!("cannot open {path}: {e}")),
                    }
                }
            }
        }
        Endpoint::Wire(host) => {
            let r = Remote::new(&host);
            Ok((Box::new(r), host))
        }
    }
}

#[cfg(test)]
mod endpoint_tests {
    use super::*;

    #[test]
    fn the_decision_table_matches_armpath() {
        let live = "/home/x/.tasks/tasks.db";
        let f = |p, h, d| endpoint_of(p, h, d, live);
        // neither set: the live pairing
        assert_eq!(f(None, None, false), Endpoint::File(live.into()));
        // an explicit file wins, host or no host
        assert_eq!(f(Some("/tmp/a.db"), None, false), Endpoint::File("/tmp/a.db".into()));
        assert_eq!(f(Some("/tmp/a.db"), Some("h:1"), false), Endpoint::File("/tmp/a.db".into()));
        // a host alone names a server whose file we cannot know
        assert_eq!(f(None, Some("h:1"), false), Endpoint::Wire("h:1".into()));
        // ':memory:' is not the server's graph
        assert_eq!(f(Some(":memory:"), None, false), Endpoint::Wire(DEFAULT_HOST.into()));
        // TASKS_LOCAL=0 turns the arm off outright, whatever DB_PATH says
        assert_eq!(f(Some("/tmp/a.db"), None, true), Endpoint::Wire(DEFAULT_HOST.into()));
        // …and it lands on the named host when one is set
        assert_eq!(f(Some("/tmp/a.db"), Some("h:1"), true), Endpoint::Wire("h:1".into()));
    }
}

// The same-file predicate used by owner-data service guards.
#[cfg(all(test, feature = "native"))]
mod live_guard_tests {
    use super::same_graph_file;
    use std::io::Write;

    #[test]
    fn same_file_by_any_path_is_the_live_file() {
        let dir = std::env::temp_dir().join(format!("liveguard-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".tasks")).unwrap();
        let live = dir.join(".tasks/tasks.db");
        std::fs::File::create(&live).unwrap().write_all(b"x").unwrap();
        let live = live.to_str().unwrap();

        // the exact path, and a `.`/`..` detour that resolves to it
        assert!(same_graph_file(live, live));
        let detour = dir.join(".tasks/../.tasks/tasks.db");
        assert!(same_graph_file(detour.to_str().unwrap(), live));

        // a symlink pointing at the live file
        let link = dir.join("link.db");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(live, &link).unwrap();
            assert!(same_graph_file(link.to_str().unwrap(), live));
        }

        // a sibling copy is NOT the live file, nor is :memory:
        let copy = dir.join(".tasks/copy.db");
        std::fs::File::create(&copy).unwrap().write_all(b"x").unwrap();
        assert!(!same_graph_file(copy.to_str().unwrap(), live));
        assert!(!same_graph_file(":memory:", live));

        std::fs::remove_dir_all(&dir).ok();
    }
}
