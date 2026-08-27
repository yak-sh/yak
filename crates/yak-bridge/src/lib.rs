// yak-bridge: the read wire (/query, /journal, WS join/catchup/live) served
// over yak-kernel's read-only Store + journal Feed, byte-parity with the Deno
// server (D-22692 rung 1). The library exposes the pure answerers so the parity
// harness can drive them directly; `main.rs` wraps them in axum + tokio.

pub mod appread;
pub mod deps;
pub mod emit;
pub mod front;
pub mod journalr;
pub mod live;
pub mod read;
pub mod snap;
pub mod subserve;

// The owner graph has one serving process. The bridge remains available for
// disposable parity copies, never as a co-serving production process.
pub fn refuses_live(db: &str) -> bool {
    yak_kernel::same_graph_file(db, &yak_kernel::live_db())
}

// The bridge's READ_WRITE connection (D-22804 rung 1): a native write lands
// through this in rung 4+ on disposable graphs. WriteStore::open itself encodes
// never-create/never-migrate.
pub fn open_write(db: &str) -> Result<yak_kernel::WriteStore, String> {
    if refuses_live(db) {
        return Err(format!(
            "refusing the owner graph {db}: production runs one serving process \
             per database. Point --db at a disposable copy."
        ));
    }
    yak_kernel::WriteStore::open(db).map_err(|e| e.to_string())
}
