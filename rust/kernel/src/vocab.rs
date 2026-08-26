// The vocabulary, read from the contract the TOML manifests compose. The
// embedded artifact is src/vocab/fixture.json — the codegen's own assembled
// output (T-22531), so Rust and TS read one source. Embedded at COMPILE time:
// a stale binary carries a stale vocabulary, the same trade every compiled
// client makes; the kernel's vocab-table diff (D-22530 §2) is the eventual
// guard.

use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

const FIXTURE: &str = include_str!("../../../src/vocab/fixture.json");

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
    fn parse(v: &Value) -> PropType {
        match v {
            Value::String(s) => match s.as_str() {
                "body" => PropType::Body,
                "number" => PropType::Number,
                "priority" => PropType::Priority,
                "bool" => PropType::Bool,
                "time" => PropType::Time,
                "url" => PropType::Url,
                "query" => PropType::Query,
                _ => PropType::Text,
            },
            Value::Object(o) => {
                if let Some(e) = o.get("enum") {
                    PropType::Enum(
                        e.as_array().unwrap_or(&vec![])
                            .iter()
                            .filter_map(|x| x.as_str().map(String::from))
                            .collect(),
                    )
                } else if let Some(t) = o.get("eid") {
                    PropType::Eid(t.as_str().unwrap_or("entity").into())
                } else if let Some(t) = o.get("text") {
                    PropType::Well(t.as_str().unwrap_or("").into())
                } else {
                    PropType::Text
                }
            }
            _ => PropType::Text,
        }
    }
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
}

fn cols(v: &Value) -> Vec<(String, PropType)> {
    v.as_object()
        .map(|o| {
            o.iter()
                .map(|(k, t)| (k.clone(), PropType::parse(t)))
                .collect()
        })
        .unwrap_or_default()
}

fn strings(v: &Value) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(v.as_str().unwrap_or("[]"))
        .unwrap_or_default()
}

pub fn vocab() -> &'static Vocab {
    static V: OnceLock<Vocab> = OnceLock::new();
    V.get_or_init(|| {
        let root: Map<String, Value> =
            serde_json::from_str(FIXTURE).expect("fixture.json parses");
        let obj = |k: &str| -> Map<String, Value> {
            serde_json::from_str(root[k].as_str().unwrap_or("{}"))
                .unwrap_or_default()
        };
        let comps = obj("comps")
            .iter()
            .map(|(k, v)| (k.clone(), cols(v)))
            .collect();
        let stamped = obj("stamped")
            .iter()
            .map(|(k, v)| (k.clone(), cols(v)))
            .collect();
        let prefix = obj("prefix")
            .iter()
            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.into())))
            .collect();
        Vocab {
            comps,
            stamped,
            kind_order: strings(&root["kindOrder"]),
            prefix,
            statuses: strings(&root["statuses"]),
        }
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
}
