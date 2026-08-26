// The kernel crate (D-22530 §1): the graph's pure core — vocabulary, the
// row/comp model, the filter subset, the delta-fed cache — plus, behind the
// `native` feature, the read-only sqlite store and FTS over the live file.
// The core compiles to wasm32 (kernel-wasm), so nothing outside `native`
// may touch rusqlite, files, or the clock. No writes, no migration, no
// baton — a library client connects and reads.

pub mod cache;
pub mod model;
pub mod query;
#[cfg(feature = "native")]
pub mod search;
#[cfg(feature = "native")]
pub mod store;
pub mod vocab;
mod vocab_gen;

pub use model::{Dep, Row, Source};
#[cfg(feature = "native")]
pub use store::{Rows, Store};
pub use vocab::{vocab, PropType, Vocab};

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
