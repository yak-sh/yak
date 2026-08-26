// The vocabulary, generated from the contract the TOML manifests compose
// (src/vocab/*.toml → vocab_gen.rs, T-22547). Native Rust data baked at
// COMPILE time — no runtime parse; a stale binary carries a stale
// vocabulary, the same trade every compiled client makes. The kernel's
// vocab-table diff (D-22530 §2) is the eventual guard.

use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq)]
pub enum PropType {
    Text,
    Body,
    Number,
    Priority,
    Bool,
    Time,
    Url,
    Query,
    Enum(Vec<String>),
    Eid(String),
    Well(String),
}

impl PropType {
    pub fn is_ref(&self) -> bool {
        matches!(self, PropType::Eid(_))
    }
}

// Insertion order is load-bearing everywhere (frontmatter walks comps in
// declaration order), so columns ride Vec<(name, type)>, not a HashMap.
pub struct Vocab {
    pub comps: Vec<(String, Vec<(String, PropType)>)>,
    pub stamped: HashMap<String, Vec<(String, PropType)>>,
    pub kind_order: Vec<String>,
    pub prefix: HashMap<String, String>,
    pub statuses: Vec<String>,
    // Old spellings that still resolve — the compatibility promise in data.
    pub renames: Vec<(String, String)>,
    // Every {eid} reference's declared death word, in comps declaration
    // order: (comp, column, word). The write path's cascade worklists derive
    // from these — the declarations ARE the reaper's list, TS deaths().
    pub deaths: Vec<(String, String, String)>,
    // The valid dependency words.
    pub edges: Vec<String>,
    // The session-log lazy partition's comps — bare props never route here.
    pub session_comps: Vec<String>,
    // Session facets (the spawn twin window) — share bare filters with
    // session.
    pub session_facets: Vec<String>,
}

pub fn vocab() -> &'static Vocab {
    static V: OnceLock<Vocab> = OnceLock::new();
    V.get_or_init(|| {
        // the one place the baked contract is built — a phase worth naming,
        // and the only span in the pure core (profiling is native-only)
        #[cfg(feature = "native")]
        let _s = crate::profiling::span("vocab.init");
        crate::vocab_gen::baked()
    })
}

impl Vocab {
    pub fn comp(&self, name: &str) -> Option<&Vec<(String, PropType)>> {
        self.comps.iter().find(|(n, _)| n == name).map(|(_, c)| c)
    }
    // comps + stamped for one component — the readable union, insertion order.
    pub fn readable(&self, name: &str) -> Vec<(String, PropType)> {
        let mut out = self.comp(name).cloned().unwrap_or_default();
        if let Some(s) = self.stamped.get(name) {
            for (k, t) in s {
                if !out.iter().any(|(n, _)| n == k) {
                    out.push((k.clone(), t.clone()));
                }
            }
        }
        out
    }
    pub fn prop_type(&self, comp: &str, prop: &str) -> Option<PropType> {
        self.readable(comp).into_iter().find(|(n, _)| n == prop).map(|(_, t)| t)
    }
    // comp '' searches the vocabulary: the first owner's declaration
    // (props.ts bareType).
    pub fn bare_type(&self, prop: &str) -> Option<PropType> {
        self.owners(prop)
            .into_iter()
            .find_map(|c| self.prop_type(&c, prop))
    }
    // propOwners: every component (wire or stamped) declaring the column.
    pub fn owners(&self, prop: &str) -> Vec<String> {
        let mut names: Vec<String> =
            self.comps.iter().map(|(n, _)| n.clone()).collect();
        for k in self.stamped.keys() {
            if !names.iter().any(|n| n == k) {
                names.push(k.clone());
            }
        }
        names
            .into_iter()
            .filter(|c| self.readable(c).iter().any(|(n, _)| n == prop))
            .collect()
    }
    // The qualified display name: bare while unique, comp.prop once shared.
    pub fn prop_name(&self, comp: &str, prop: &str) -> String {
        if self.owners(prop).len() > 1 {
            format!("{comp}.{prop}")
        } else {
            prop.into()
        }
    }
    // The reaper's worklist for one death word, (comp, column) pairs in
    // declaration order — TS deaths().
    pub fn deaths_of(&self, word: &str) -> Vec<(String, String)> {
        self.deaths
            .iter()
            .filter(|(_, _, w)| w == word)
            .map(|(c, col, _)| (c.clone(), col.clone()))
            .collect()
    }
    // types.ts propRenames: the renames table minus the renderer's `view:`
    // namespace — what admitted()'s rewrite applies.
    pub fn prop_renames(&self) -> HashMap<String, String> {
        self.renames
            .iter()
            .filter(|(k, _)| !k.starts_with("view:"))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }
    pub fn kind_of(&self, has: &dyn Fn(&str) -> bool) -> String {
        self.kind_order
            .iter()
            .find(|k| has(k))
            .cloned()
            .unwrap_or_else(|| "entity".into())
    }
    pub fn id_of(&self, kind: &str, eid: &str, num: Option<i64>) -> String {
        match num {
            Some(n) => {
                let p = self.prefix.get(kind).cloned().unwrap_or_else(|| {
                    kind.chars().next().unwrap_or('E').to_uppercase().to_string()
                });
                format!("{p}-{n}")
            }
            None => eid.chars().take(8).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocabulary_loads_from_the_contract() {
        let v = vocab();
        assert!(v.comp("task").is_some());
        assert_eq!(v.statuses, ["open", "wip", "done", "cancelled"]);
        assert_eq!(v.prefix["task"], "T");
        assert!(v.kind_order.iter().position(|k| k == "design").unwrap()
            < v.kind_order.iter().position(|k| k == "task").unwrap());
    }

    #[test]
    fn refs_and_ids() {
        let v = vocab();
        assert!(v.prop_type("task", "project").unwrap().is_ref());
        assert_eq!(v.id_of("task", "x", Some(3)), "T-3");
        assert_eq!(v.id_of("entity", "abcdef1234", None), "abcdef12");
    }

    #[test]
    fn renames_ride_the_contract() {
        let v = vocab();
        assert!(v
            .renames
            .iter()
            .any(|(from, to)| from == "view:Show" && to == "Full"));
    }
}
