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
