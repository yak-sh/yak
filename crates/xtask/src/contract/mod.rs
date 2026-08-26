// The vocabulary contract — the SOURCE OF TRUTH (D-22530 §6). Each plugin is a
// module of annotated Rust: a `#[derive(Comp)]` struct per component, a
// `venum!` per closed set, and the kernel/sessions singletons (edges, renames,
// the session capability lists) as plain inventory submits. The xtask iterates
// the inventory these produce and emits the per-plugin data manifest.
//
// This is plugin zero and its peers living in one build-only crate for now;
// D-22530 §8 migrates each module into its own plugin crate later, unchanged
// in form. The prose that used to sit beside each TOML declaration lives here,
// on the type it describes.

// The contract structs are declarations, not runtime values — the derive reads
// them at compile time and nothing constructs them.
#![allow(dead_code)]

// One closed set: (plugin, name, rank, [values]). Ranks are the global
// emission order the manifests share; the value list is the closed set.
macro_rules! venum {
    ($plugin:literal, $name:literal, $rank:literal, [$($v:literal),* $(,)?]) => {
        ::inventory::submit! {
            ::yak_vocab::EnumDef { plugin: $plugin, name: $name, rank: $rank, values: &[$($v),*] }
        }
    };
}

mod canvas;
mod capture;
mod comms;
mod identity;
mod kernel;
mod mail;
mod roles;
mod sessions;
mod work;
