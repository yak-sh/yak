// yak-bridge links the system libsqlite3 by default so parity exercises the
// host SQLite. With rusqlite's `bundled` feature off, `-lsqlite3` has to resolve
// against a shared library on the box.
//
// The box has no pkg-config and no unversioned `libsqlite3.so` on the default
// linker path (only versioned `.so.0`), so libsqlite3-sys cannot find it on its
// own. This probe points the linker at the first directory holding an
// unversioned `libsqlite3.so` (or `.dylib`): `SQLITE3_LIB_DIR` if the operator
// set it, then the usual homebrew / system locations. It is additive — it adds
// a search path, it never overrides one — so a box that already resolves
// `-lsqlite3` is unaffected.

use std::path::Path;

fn main() {
    // libsqlite3-sys already honours these; re-export so an explicit setting
    // still wins and the build re-runs when they change.
    println!("cargo:rerun-if-env-changed=SQLITE3_LIB_DIR");
    if std::env::var_os("SQLITE3_LIB_DIR").is_some() {
        return; // the operator (or a parent build) has said where it is.
    }
    let mut dirs: Vec<String> = vec![];
    if let Some(p) = std::env::var_os("HOMEBREW_PREFIX") {
        dirs.push(format!("{}/lib", p.to_string_lossy()));
    }
    dirs.extend(
        [
            "/home/linuxbrew/.linuxbrew/lib",
            "/opt/homebrew/lib",
            "/usr/local/lib",
            "/usr/lib/x86_64-linux-gnu",
            "/usr/lib",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    for dir in dirs {
        let d = Path::new(&dir);
        if d.join("libsqlite3.so").exists() || d.join("libsqlite3.dylib").exists() {
            println!("cargo:rustc-link-search=native={dir}");
            return;
        }
    }
    // Found nothing to add. Say so once — the link step will fail with the real
    // `-lsqlite3` error, and this line points at why.
    println!(
        "cargo:warning=yak-bridge: no unversioned libsqlite3.so found; set \
         SQLITE3_LIB_DIR to the directory holding the SYSTEM libsqlite3 the \
         Deno server links (M-22673)."
    );
}
