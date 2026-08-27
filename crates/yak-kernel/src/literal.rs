// Nested graph literals are request syntax, compiled to the ordinary Change
// wire before apply. Components, reference columns, and dependency words come
// only from the generated vocabulary; local keys exist only for this compile
// and never become graph data.

use crate::change::Change;
use crate::vocab::{vocab, PropType};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq)]
pub struct LiteralPlan {
    pub changes: Vec<Change>,
    // serde_json::Map preserves declaration order under the crate's
    // preserve_order feature, matching Object.fromEntries on the TS wire.
    pub aliases: Map<String, Value>,
}

#[derive(Debug, Clone)]
enum Target {
    Name(String),
    Node(usize),
}

#[derive(Debug, Clone)]
struct Dep {
    type_: String,
    target: Target,
}

#[derive(Debug, Clone)]
struct Node {
    key: Option<String>,
    id: Option<String>,
    eid: String,
    comps: Map<String, Value>,
    deps: Vec<Dep>,
    was: Map<String, Value>,
}

fn object(v: Option<&Value>, what: &str) -> Result<Map<String, Value>, String> {
    match v {
        None | Some(Value::Null) => Ok(Map::new()),
        Some(Value::Object(m)) => Ok(m.clone()),
        _ => Err(format!("literal {what} must be an object")),
    }
}

fn word(v: Option<&Value>, what: &str) -> Result<Option<String>, String> {
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            let s = s.trim().to_string();
            if s.is_empty() {
                Err(format!("a literal {what} cannot be empty"))
            } else {
                Ok(Some(s))
            }
        }
        _ => Err(format!("literal {what} must be a string")),
    }
}

fn ref_word(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(i.to_string())
            } else if let Some(u) = n.as_u64() {
                Some(u.to_string())
            } else {
                let f = n.as_f64()?;
                Some(if f == f.trunc() && f.abs() < 1e21 {
                    format!("{}", f as i64)
                } else {
                    format!("{f}")
                })
            }
        }
        _ => None,
    }
}

fn visit(
    literal: &Value,
    nodes: &mut Vec<Node>,
    keys: &mut HashMap<String, usize>,
) -> Result<usize, String> {
    let Some(obj) = literal.as_object() else {
        return Err("an entity literal must be an object".into());
    };
    if let Some(alien) =
        obj.keys().find(|k| !["key", "id", "comps", "deps", "was"].contains(&k.as_str()))
    {
        return Err(format!("unknown entity literal field: {alien}"));
    }
    let key = word(obj.get("key"), "key")?;
    if let Some(k) = &key {
        if keys.contains_key(k) {
            return Err(format!("duplicate literal key: {k}"));
        }
    }
    let id = word(obj.get("id"), "id")?;
    let comps = object(obj.get("comps"), "comps")?;
    for (name, comp) in &comps {
        if vocab().comp(name).is_none() {
            return Err(format!("unknown component: {name}"));
        }
        if !comp.is_null() && !comp.is_object() {
            return Err(format!("{name} component must be an object or null"));
        }
    }
    let was = object(obj.get("was"), "was")?;
    for (name, guard) in &was {
        if vocab().comp(name).is_none() {
            return Err(format!("unknown guarded component: {name}"));
        }
        if !comps.contains_key(name) {
            return Err(format!("was has no {name} component patch"));
        }
        let valid =
            guard.as_object().is_some_and(|m| m.values().all(|v| v.is_null() || v.is_string()));
        if !valid {
            return Err(format!("{name} was must map columns to hashes or null"));
        }
    }
    let declared_deps = object(obj.get("deps"), "deps")?;
    for name in declared_deps.keys() {
        if !vocab().edges.iter().any(|e| e == name) {
            return Err(format!("unknown dependency: {name}"));
        }
    }
    if id.is_none() && comps.is_empty() {
        return Err("a new entity literal needs at least one component".into());
    }

    // Plant the parent before its nested targets, preserving the TS compiler's
    // pre-order component and alias output.
    let at = nodes.len();
    nodes.push(Node { key: key.clone(), id, eid: String::new(), comps, deps: vec![], was });
    if let Some(k) = key {
        keys.insert(k, at);
    }
    let mut deps = vec![];
    for type_ in &vocab().edges {
        let Some(value) = declared_deps.get(type_) else { continue };
        let targets: Vec<&Value> = match value {
            Value::Array(a) => a.iter().collect(),
            other => vec![other],
        };
        for target in targets {
            if let Some(name) = ref_word(target) {
                deps.push(Dep { type_: type_.clone(), target: Target::Name(name) });
            } else if target.is_object() {
                let child = visit(target, nodes, keys)?;
                deps.push(Dep { type_: type_.clone(), target: Target::Node(child) });
            } else {
                return Err(format!("{type_} dependency must name or nest an entity"));
            }
        }
    }
    nodes[at].deps = deps;
    Ok(at)
}

fn prove(
    at: usize,
    nodes: &[Node],
    outgoing: &[Vec<usize>],
    visiting: &mut HashSet<usize>,
    rooted: &mut HashSet<usize>,
) -> Result<(), String> {
    if rooted.contains(&at) {
        return Ok(());
    }
    if !visiting.insert(at) {
        let n = &nodes[at];
        return Err(format!(
            "literal cycle at {}",
            n.key.as_deref().or(n.id.as_deref()).unwrap_or(&n.eid)
        ));
    }
    for child in &outgoing[at] {
        prove(*child, nodes, outgoing, visiting, rooted)?;
    }
    visiting.remove(&at);
    rooted.insert(at);
    Ok(())
}

// Compile a JSON literal array against a caller-owned resolver and eid mint.
// The caller controls the consistency boundary: yak-bridge invokes this while
// holding the same WriteStore lock through the subsequent apply().
pub fn normalize_literals_with(
    literals: &Value,
    mut resolve: impl FnMut(&str) -> Result<Option<String>, String>,
    mut mint: impl FnMut() -> String,
) -> Result<LiteralPlan, String> {
    let Some(input) = literals.as_array() else {
        return Err("entity literals must be an array".into());
    };
    if input.is_empty() {
        return Err("at least one entity literal is needed".into());
    }
    let mut nodes = vec![];
    let mut keys = HashMap::new();
    for literal in input {
        visit(literal, &mut nodes, &mut keys)?;
    }

    let mut resolved: HashMap<String, Option<String>> = HashMap::new();
    let mut external = |id: &str| {
        if !resolved.contains_key(id) {
            resolved.insert(id.to_string(), resolve(id)?);
        }
        Ok(resolved.get(id).cloned().flatten())
    };
    for node in &nodes {
        if let Some(key) = &node.key {
            if external(key)?.is_some() {
                return Err(format!("literal key is also an entity: {key}"));
            }
        }
    }
    let mut aliases = Map::new();
    let mut eids = HashSet::new();
    for node in &mut nodes {
        let eid = match &node.id {
            Some(id) => external(id)?.ok_or_else(|| format!("no entity: {id}"))?,
            None => mint(),
        };
        if eid.is_empty() {
            return Err("literal mint returned no eid".into());
        }
        if !eids.insert(eid.clone()) {
            return Err(format!("entity appears twice: {eid}"));
        }
        node.eid = eid.clone();
        if let Some(key) = &node.key {
            aliases.insert(key.clone(), Value::from(eid));
        }
    }

    let resolve_ref = |value: &str,
                       where_: &str,
                       external: &mut dyn FnMut(&str) -> Result<Option<String>, String>|
     -> Result<String, String> {
        let local = keys.get(value).map(|i| nodes[*i].eid.clone());
        let found = external(value)?;
        if local.is_some() && found.is_some() {
            return Err(format!("ambiguous literal reference: {value}"));
        }
        local.or(found).ok_or_else(|| format!("no entity or literal key: {value}{where_}"))
    };

    let mut deps: Vec<(usize, String, String)> = vec![];
    for (at, node) in nodes.iter().enumerate() {
        for dep in &node.deps {
            let eid = match &dep.target {
                Target::Node(i) => nodes[*i].eid.clone(),
                Target::Name(name) => resolve_ref(name, "", &mut external)?,
            };
            deps.push((at, dep.type_.clone(), eid));
        }
    }
    let by_eid: HashMap<String, usize> =
        nodes.iter().enumerate().map(|(i, n)| (n.eid.clone(), i)).collect();
    let mut outgoing = vec![vec![]; nodes.len()];
    for (parent, _, child) in &deps {
        if let Some(at) = by_eid.get(child) {
            outgoing[*parent].push(*at);
        }
    }
    let mut visiting = HashSet::new();
    let mut rooted = HashSet::new();
    for at in 0..nodes.len() {
        prove(at, &nodes, &outgoing, &mut visiting, &mut rooted)?;
    }

    let mut changes = vec![];
    for node in &nodes {
        for (comp_name, cols) in &vocab().comps {
            let Some(source) = node.comps.get(comp_name) else {
                continue;
            };
            let comp = match source {
                Value::Null => None,
                Value::Object(source) => {
                    let mut out = Map::new();
                    for (prop, value) in source {
                        let is_ref = cols
                            .iter()
                            .find(|(p, _)| p == prop)
                            .is_some_and(|(_, t)| matches!(t, PropType::Eid(_)));
                        let value = if !is_ref || value.is_null() {
                            value.clone()
                        } else {
                            let Some(reference) = ref_word(value) else {
                                return Err(format!(".{comp_name}.{prop} must name an entity"));
                            };
                            Value::from(resolve_ref(
                                &reference,
                                &format!(" (.{comp_name}.{prop})"),
                                &mut external,
                            )?)
                        };
                        out.insert(prop.clone(), value);
                    }
                    Some(out)
                }
                _ => unreachable!("visit validates component values"),
            };
            changes.push(Change {
                eid: node.eid.clone(),
                name: comp_name.clone(),
                comp,
                was: node.was.get(comp_name).and_then(Value::as_object).cloned(),
            });
        }
    }
    for (parent, type_, child) in deps {
        let mut comp = Map::new();
        comp.insert("type".into(), Value::from(type_));
        comp.insert("child".into(), Value::from(child));
        changes.push(Change::new(&nodes[parent].eid, "dependency", Some(comp)));
    }
    Ok(LiteralPlan { changes, aliases })
}

#[cfg(feature = "native")]
pub fn normalize_literals(
    conn: &rusqlite::Connection,
    literals: &Value,
) -> Result<LiteralPlan, String> {
    normalize_literals_with(
        literals,
        |id| crate::store::resolve_checked(conn, id),
        || uuid::Uuid::new_v4().to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn nested_aliases_compile_in_vocabulary_order_with_exact_guards() {
        let project = "eeeeeeee-0000-4000-8000-000000000019";
        let memory = "eeeeeeee-0000-4000-8000-000000000020";
        let minted = [
            "eeeeeeee-0000-4000-8000-000000000001",
            "eeeeeeee-0000-4000-8000-000000000002",
            "eeeeeeee-0000-4000-8000-000000000003",
        ];
        let mut at = 0;
        let plan = normalize_literals_with(
            &json!([
                {"key":"project", "id":"P-19"},
                {"key":"memory", "id":"M-20"},
                {
                    "key":"goal",
                    "comps": {
                        "doc":{"title":"Goal"},
                        "task":{"status":"open", "project":"project"}
                    },
                    "was":{"doc":{"title":"old-title-hash"}},
                    "deps":{"requires":[{
                        "key":"gate",
                        "comps": {
                            "doc":{"title":"Gate"},
                            "task":{"status":"open", "project":"project"}
                        },
                        "deps":{"reads":["memory"]}
                    }]}
                },
                {
                    "key":"recall",
                    "comps":{"recalled":{"source":"memory"}},
                    "deps":{"recalled":["memory"]}
                }
            ]),
            |id| {
                Ok(match id {
                    "P-19" => Some(project.into()),
                    "M-20" => Some(memory.into()),
                    _ => None,
                })
            },
            || {
                let eid = minted[at].to_string();
                at += 1;
                eid
            },
        )
        .unwrap();
        assert_eq!(
            plan.aliases,
            json!({
                "project":project,
                "memory":memory,
                "goal":minted[0],
                "gate":minted[1],
                "recall":minted[2]
            })
            .as_object()
            .unwrap()
            .clone()
        );
        assert_eq!(
            Value::Array(plan.changes.iter().map(Change::to_value).collect()),
            json!([
                {"eid":minted[0],"name":"doc","comp":{"title":"Goal"},
                 "was":{"title":"old-title-hash"}},
                {"eid":minted[0],"name":"task","comp":{"status":"open","project":project}},
                {"eid":minted[1],"name":"doc","comp":{"title":"Gate"}},
                {"eid":minted[1],"name":"task","comp":{"status":"open","project":project}},
                {"eid":minted[2],"name":"recalled","comp":{"source":memory}},
                {"eid":minted[0],"name":"dependency","comp":{"type":"requires","child":minted[1]}},
                {"eid":minted[1],"name":"dependency","comp":{"type":"reads","child":memory}},
                {"eid":minted[2],"name":"dependency","comp":{"type":"recalled","child":memory}}
            ])
        );
    }

    #[test]
    fn malformed_literals_and_cycles_refuse_before_a_change_exists() {
        let cases = [
            (
                json!([{"key":"same","comps":{"doc":{}}},{"key":"same","comps":{"doc":{}}}]),
                "duplicate literal key: same",
            ),
            (
                json!([{"key":"a","comps":{"doc":{}},"deps":{"reads":["missing"]}}]),
                "no entity or literal key: missing",
            ),
            (
                json!([{"key":"a","comps":{"task":{"project":"missing"}}}]),
                "no entity or literal key: missing (.task.project)",
            ),
            (json!([{"key":"a","comps":{"invented":{}}}]), "unknown component: invented"),
            (
                json!([{"key":"a","comps":{"doc":{}},"deps":{"invented":[]}}]),
                "unknown dependency: invented",
            ),
            (
                json!([
                    {"key":"a","comps":{"doc":{}},"deps":{"requires":["b"]}},
                    {"key":"b","comps":{"doc":{}},"deps":{"requires":["a"]}}
                ]),
                "literal cycle at a",
            ),
        ];
        for (input, message) in cases {
            let mut n = 0;
            let got = normalize_literals_with(
                &input,
                |_| Ok(None),
                || {
                    n += 1;
                    format!("eeeeeeee-0000-4000-8000-{n:012}")
                },
            )
            .unwrap_err();
            assert_eq!(got, message);
        }
    }

    #[test]
    fn alias_shadows_and_resolver_errors_are_preserved() {
        let taken = json!([{"key":"taken","comps":{"doc":{}}}]);
        assert_eq!(
            normalize_literals_with(
                &taken,
                |id| { Ok((id == "taken").then(|| "eeeeeeee-0000-4000-8000-000000000099".into())) },
                || "eeeeeeee-0000-4000-8000-000000000001".into(),
            )
            .unwrap_err(),
            "literal key is also an entity: taken"
        );

        let ambiguous = json!([{"id":"abcdef", "comps":{"doc":{}}}]);
        assert_eq!(
            normalize_literals_with(
                &ambiguous,
                |_| Err("abcdef is an ambiguous id — use more characters".into()),
                || unreachable!(),
            )
            .unwrap_err(),
            "abcdef is an ambiguous id — use more characters"
        );
    }

    #[test]
    fn cycles_through_existing_human_ids_are_rejected() {
        let a = "eeeeeeee-0000-4000-8000-000000000001";
        let b = "eeeeeeee-0000-4000-8000-000000000002";
        let input = json!([
            {"id":"T-1","comps":{"doc":{}},"deps":{"requires":"T-2"}},
            {"id":"T-2","comps":{"doc":{}},"deps":{"requires":"T-1"}}
        ]);
        assert_eq!(
            normalize_literals_with(
                &input,
                |id| {
                    Ok(match id {
                        "T-1" => Some(a.into()),
                        "T-2" => Some(b.into()),
                        _ => None,
                    })
                },
                || unreachable!(),
            )
            .unwrap_err(),
            "literal cycle at T-1"
        );
    }
}
