// The kernel crate (D-22530 §1): the graph's pure core — vocabulary, the
// row/comp model, the wire Change, the filter subset, the delta-fed cache —
// plus, behind the `native` feature, everything that touches the file: the
// read-only sqlite store, FTS, and since T-22550 the WRITE path — apply()
// with its gate registry, the journal, and the catchup feed. The core
// compiles to wasm32 (kernel-wasm), so nothing outside `native` may touch
// rusqlite, files, or the clock. Still no migration and no baton — a
// library client connects, reads, writes through apply, and leaves the
// schema alone.

pub mod cache;
pub mod change;
#[cfg(feature = "native")]
pub mod feed;
pub mod model;
pub mod query;
#[cfg(feature = "native")]
pub mod search;
#[cfg(feature = "native")]
pub mod store;
pub mod vocab;
mod vocab_gen;
#[cfg(feature = "native")]
pub mod write;

pub use change::Change;
#[cfg(feature = "native")]
pub use feed::{cursor_of, data_version, journal_since, row_changes, Feed, JournalRow};
pub use model::{Dep, Row, Source};
#[cfg(feature = "native")]
pub use store::{Rows, Store};
pub use vocab::{vocab, PropType, Vocab};
#[cfg(feature = "native")]
pub use write::{apply, default_gates, ApplyError, ApplyOpts, Gate, WriteStore};

// The live graph the way every client resolves it: DB_PATH wins, else the
// home pairing.
#[cfg(feature = "native")]
pub fn db_path() -> String {
    if let Ok(p) = std::env::var("DB_PATH") {
        if !p.is_empty() {
            return p;
        }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    format!("{home}/.tasks/tasks.db")
}
