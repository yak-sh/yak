// The vocabulary codegen driver (D-22530 §6). The annotated-Rust contract
// (the `contract` module) is the SOURCE OF TRUTH; this binary assembles the
// inventory of contributions and writes the per-plugin data manifest —
// src/vocab/manifests/<plugin>.json — the former TOML shape, now generated
// interchange. gen.ts reads those manifests and emits types.ts, fixture.json,
// and vocab_gen.rs exactly as before, so the vocabulary VALUES are unchanged
// while their source moves to Rust.
//
//   cargo run -p xtask -- vocab           regenerate the manifests
//   cargo run -p xtask -- vocab --check    exit 1 if committed manifests are
//                                          stale against the Rust contract
//
// The manifests must not drift silently: `xtask_test.rs` runs the same check
// under `cargo test`, so a contract edit that forgets the regenerate fails the
// gate keyed off the Rust source.

mod contract;

use std::path::PathBuf;

// The manifests directory, resolved from this crate's location so the tool
// works from any cwd: crates/xtask → repo root → src/vocab/manifests.
pub fn manifests_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../src/vocab/manifests")
        .canonicalize()
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../src/vocab/manifests")
        })
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str);
    match cmd {
        Some("vocab") => {
            let check = args.iter().any(|a| a == "--check");
            if check {
                if let Err(stale) = check_manifests() {
                    eprintln!("{stale}");
                    std::process::exit(1);
                }
                println!("vocab: manifests match the Rust contract");
            } else {
                write_manifests();
            }
        }
        _ => {
            eprintln!("usage: xtask vocab [--check]");
            std::process::exit(2);
        }
    }
}

fn write_manifests() {
    let dir = manifests_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let mut n = 0;
    for (name, body) in yak_vocab::manifest_files() {
        std::fs::write(dir.join(format!("{name}.json")), body).unwrap();
        n += 1;
    }
    println!("vocab: wrote {n} manifests to {}", dir.display());
}

// Ok if every committed manifest matches the freshly-assembled contract,
// Err(description) naming the first drift otherwise. Shared by --check and the
// test so the gate and the CLI cannot disagree.
pub fn check_manifests() -> Result<(), String> {
    let dir = manifests_dir();
    for (name, body) in yak_vocab::manifest_files() {
        let path = dir.join(format!("{name}.json"));
        let cur = std::fs::read_to_string(&path).unwrap_or_default();
        if cur != body {
            return Err(format!(
                "src/vocab/manifests/{name}.json is stale against the Rust contract \
                 — run `cargo run -p xtask -- vocab`",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // The staleness gate keyed off the Rust source of truth (T-22607): edit a
    // contract type and forget to regenerate, and this fails under the same
    // `cargo test` the pre-land gate already runs. The types.ts half of the
    // chain is `deno task codegen --check`.
    #[test]
    fn manifests_match_the_rust_contract() {
        if let Err(stale) = check_manifests() {
            panic!("{stale}");
        }
    }

    // Every contract comp names a plugin and the assembly is non-empty — a
    // smoke test that the inventory actually linked in.
    #[test]
    fn contract_assembles() {
        let ms = yak_vocab::manifests();
        assert!(ms.iter().any(|(p, _)| p == "kernel"));
        assert!(ms.iter().any(|(p, _)| p == "sessions"));
        assert_eq!(ms.len(), 9, "expected nine plugins");
    }
}
