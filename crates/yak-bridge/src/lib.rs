// yak-bridge: the read wire (/query, /journal, WS join/catchup/live) served
// over yak-kernel's read-only Store + journal Feed, byte-parity with the Deno
// server (D-22692 rung 1). The library exposes the pure answerers so the parity
// harness can drive them directly; `main.rs` wraps them in axum + tokio.

pub mod deps;
pub mod emit;
pub mod journalr;
pub mod live;
pub mod read;
pub mod snap;
pub mod subserve;

// Would opening `db` land on the live graph while this binary carries a bundled
// SQLite? That is the cross-build co-reader the same-build rule forbids
// (M-22673, generalized from the T-22622 write-door refusal). A system-linked
// bridge (the default, built `-p yak-bridge`) reads the live file safely; this
// fires for a build that linked bundled SQLite — whether via yak-bridge's own
// `bundled` feature or Cargo feature unification with a bundled workspace
// sibling, both of which `yak_kernel::is_bundled()` reflects.
pub fn refuses_live(db: &str) -> bool {
    yak_kernel::is_bundled() && yak_kernel::same_graph_file(db, &yak_kernel::live_db())
}

// The bridge's READ_WRITE connection (D-22804 rung 1): a native write lands
// through this in rung 4+; today it opens at boot only to prove the same-build
// WRITE rule holds and to fail loudly if the file cannot be opened read-write.
// `refuses_live` gates it exactly as it gates the read open — a bundled build
// must NEVER co-write the live WAL across builds (M-22673, T-22622) — and
// `WriteStore::open` itself encodes never-create/never-migrate, so a library
// writer leaves the schema and the baton alone.
pub fn open_write(db: &str) -> Result<yak_kernel::WriteStore, String> {
    if refuses_live(db) {
        return Err(format!(
            "refusing read-write on the live graph {db} — bundled SQLite cannot \
             co-write the live WAL across builds (M-22673). Point --db at a COPY."
        ));
    }
    yak_kernel::WriteStore::open(db).map_err(|e| e.to_string())
}
