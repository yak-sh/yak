// The wire's one sentence: a Change is a PATCH — {eid, name, comp} with
// omitted columns untouched, `comp: null` deleting the component and
// `{name: "entity", comp: null}` deleting the entity. `was` rides BESIDE
// comp (never inside it): the per-column precondition hashes apply() guards
// on. Serialization preserves the TS key order (eid, name, comp, was) so a
// Rust-journaled batch reads identically to a TS-journaled one.

use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct Change {
    pub eid: String,
    pub name: String,
    // None = delete (comp: null on the wire). A component write is Some(map).
    pub comp: Option<Map<String, Value>>,
    pub was: Option<Map<String, Value>>,
}

impl Change {
    pub fn new(eid: &str, name: &str, comp: Option<Map<String, Value>>) -> Change {
        Change { eid: eid.into(), name: name.into(), comp, was: None }
    }

    pub fn from_value(v: &Value) -> Option<Change> {
        let o = v.as_object()?;
        let eid = o.get("eid")?.as_str()?.to_string();
        let name = o.get("name")?.as_str()?.to_string();
        let comp = match o.get("comp") {
            None | Some(Value::Null) => None,
            Some(Value::Object(m)) => Some(m.clone()),
            _ => return None,
        };
        let was = match o.get("was") {
            None | Some(Value::Null) => None,
            Some(Value::Object(m)) => Some(m.clone()),
            _ => return None,
        };
        Some(Change { eid, name, comp, was })
    }

    pub fn to_value(&self) -> Value {
        let mut o = Map::new();
        o.insert("eid".into(), Value::from(self.eid.as_str()));
        o.insert("name".into(), Value::from(self.name.as_str()));
        o.insert(
            "comp".into(),
            match &self.comp {
                Some(m) => Value::Object(m.clone()),
                None => Value::Null,
            },
        );
        if let Some(w) = &self.was {
            o.insert("was".into(), Value::Object(w.clone()));
        }
        Value::Object(o)
    }
}

pub fn parse_batch(v: &Value) -> Option<Vec<Change>> {
    v.as_array()?.iter().map(Change::from_value).collect()
}

pub fn batch_json(changes: &[Change]) -> String {
    Value::Array(changes.iter().map(Change::to_value).collect()).to_string()
}
