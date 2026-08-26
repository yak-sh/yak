// The kernel crate (D-22530 §1, PoC slice): read-only store over the live
// graph file, the vocabulary from the composed manifest contract, the
// filter subset, and FTS search. No writes, no migration, no baton — a
// library client connects and reads.

pub mod query;
pub mod search;
pub mod store;
pub mod vocab;

pub use store::{Dep, Row, Rows, Store};
pub use vocab::{vocab, PropType, Vocab};

// The live graph the way every client resolves it: DB_PATH wins, else the
// home pairing.
pub fn db_path() -> String {
    if let Ok(p) = std::env::var("DB_PATH") {
        if !p.is_empty() {
            return p;
        }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    format!("{home}/.tasks/tasks.db")
}
