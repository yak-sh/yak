// The delta-fed in-memory graph: the wire's {eid, name, comp} patches land
// here and queries read the result — the SPA's future data engine, and the
// wasm build's only storage. Patch semantics mirror apply()'s cast exactly:
// omitted columns untouched, a null prop clears the column, a null comp
// deletes the component, {name: "entity", comp: null} tombstones the entity
// and voids every later patch for that eid.

use crate::model::{is_eid, Row, Source};
use crate::vocab::vocab;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone)]
pub struct Change {
    pub eid: String,
    pub name: String,
    pub comp: Value, // object = patch, null = delete the component
}

impl Change {
    pub fn from_value(v: &Value) -> Option<Change> {
        let o = v.as_object()?;
        Some(Change {
            eid: o.get("eid")?.as_str()?.to_lowercase(),
            name: o.get("name")?.as_str()?.into(),
            comp: o.get("comp").cloned().unwrap_or(Value::Null),
        })
    }
}

#[derive(Default)]
pub struct GraphCache {
    rows: HashMap<String, Map<String, Value>>, // eid -> comps (spine included)
    tombs: HashSet<String>,
}

impl GraphCache {
    pub fn new() -> GraphCache {
        GraphCache::default()
    }

    pub fn ingest(&mut self, changes: &[Change]) {
        for c in changes {
            if self.tombs.contains(&c.eid) {
                continue; // dead is dead — late patches are void
            }
            if c.name == "entity" && c.comp.is_null() {
                self.rows.remove(&c.eid);
                self.tombs.insert(c.eid.clone());
                continue;
            }
            let bag = self.rows.entry(c.eid.clone()).or_insert_with(|| {
                let mut spine = Map::new();
                spine.insert("eid".into(), Value::from(c.eid.as_str()));
                let mut m = Map::new();
                m.insert("entity".into(), Value::Object(spine));
                m
            });
            if c.comp.is_null() {
                if c.name != "entity" {
                    bag.remove(&c.name);
                }
                continue;
            }
            let Some(patch) = c.comp.as_object() else { continue };
            let slot = bag.entry(c.name.clone()).or_insert_with(|| Value::Object(Map::new()));
            let Some(m) = slot.as_object_mut() else { continue };
            for (k, v) in patch {
                if v.is_null() {
                    m.remove(k);
                } else {
                    m.insert(k.clone(), v.clone());
                }
            }
        }
    }

    pub fn len(&self) -> usize {
        self.rows.len()
    }
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    fn to_row(&self, eid: &str, comps: &Map<String, Value>) -> Row {
        let v = vocab();
        let num = comps.get("entity").and_then(|e| e.get("num")).and_then(|n| n.as_i64());
        let kind = v.kind_of(&|k| comps.contains_key(k));
        Row { eid: eid.into(), num, kind, comps: comps.clone() }
    }

    pub fn row(&self, eid: &str) -> Option<Row> {
        self.rows.get(eid).map(|c| self.to_row(eid, c))
    }

    // Every row wearing the kind's defining comp, num order — the cache's
    // answer to store::rows_of_kind.
    pub fn rows_of_kind(&self, kind: &str) -> Vec<Row> {
        self.query_kind(kind, &[])
    }

    // Match on the raw bags, clone only the hits — a query pays for its
    // answer, not for the cache.
    pub fn query_kind(&self, kind: &str, preds: &[crate::query::Pred]) -> Vec<Row> {
        let mut out: Vec<Row> = self
            .rows
            .iter()
            .filter(|(_, c)| c.contains_key(kind) && crate::query::matches_comps(c, preds))
            .map(|(eid, c)| self.to_row(eid, c))
            .collect();
        out.sort_by_key(|r| r.num.unwrap_or(i64::MAX));
        out
    }
}

impl Source for GraphCache {
    // The cache resolves what it holds: full uuids and prefixed/bare nums.
    // Short-eid prefixes and alias slugs stay native-only.
    fn resolve_id(&self, id: &str) -> Option<String> {
        let low = id.to_lowercase();
        if is_eid(&low) {
            return self.rows.contains_key(&low).then_some(low);
        }
        let num: i64 = match id.split_once('-') {
            Some((pre, n)) if !pre.is_empty() && pre.chars().all(|c| c.is_ascii_alphabetic()) => {
                n.parse().ok()?
            }
            _ => id.parse().ok()?,
        };
        self.rows
            .iter()
            .find(|(_, c)| {
                c.get("entity").and_then(|e| e.get("num")).and_then(|n| n.as_i64()) == Some(num)
            })
            .map(|(eid, _)| eid.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ch(eid: &str, name: &str, comp: Value) -> Change {
        Change { eid: eid.into(), name: name.into(), comp }
    }

    const A: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

    #[test]
    fn patches_compose() {
        let mut g = GraphCache::new();
        g.ingest(&[
            ch(A, "entity", json!({"num": 7})),
            ch(A, "doc", json!({"title": "hi"})),
            ch(A, "task", json!({"status": "open", "priority": 2})),
        ]);
        let r = g.row(A).unwrap();
        assert_eq!(r.num, Some(7));
        assert_eq!(r.kind, "task");
        // omitted columns untouched, null clears
        g.ingest(&[ch(A, "task", json!({"status": "wip", "priority": null}))]);
        let t = g.row(A).unwrap().comps["task"].clone();
        assert_eq!(t["status"], "wip");
        assert!(t.get("priority").is_none());
    }

    #[test]
    fn comp_and_entity_deletes() {
        let mut g = GraphCache::new();
        g.ingest(&[ch(A, "doc", json!({"title": "x"})), ch(A, "task", json!({"status": "open"}))]);
        g.ingest(&[ch(A, "task", Value::Null)]);
        assert!(!g.row(A).unwrap().comps.contains_key("task"));
        g.ingest(&[ch(A, "entity", Value::Null)]);
        assert!(g.row(A).is_none());
        // tombstoned: late patches are void
        g.ingest(&[ch(A, "doc", json!({"title": "ghost"}))]);
        assert!(g.row(A).is_none());
    }

    #[test]
    fn resolves_ids_it_holds() {
        let mut g = GraphCache::new();
        g.ingest(&[ch(A, "entity", json!({"num": 19})), ch(A, "project", json!({}))]);
        assert_eq!(g.resolve_id("P-19").as_deref(), Some(A));
        assert_eq!(g.resolve_id("19").as_deref(), Some(A));
        assert_eq!(g.resolve_id(A).as_deref(), Some(A));
        assert!(g.resolve_id("P-20").is_none());
    }
}
