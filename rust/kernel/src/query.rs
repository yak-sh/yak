// The filter grammar's list/show subset: dot-params with the scalar ops
// (`=`, `!=`, `~=`, `<`, `<=`, `>`, `>=`), comma lists, `.comp!` presence,
// `=` empty for absence, `.kind=`. Bare-prop routing follows propOwners.
// Time phrases and path/reverse hops are NOT ported in the PoC — a filter
// using them is refused loudly, never half-answered.

use crate::store::{Row, Store};
use crate::vocab::{vocab, PropType};
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct Pred {
    pub comp: String,
    pub prop: String,
    pub op: String, // "", "=", "!=", "~=", "<", "<=", ">", ">="; "" = has-comp
    pub value: String,
}

pub fn parse(args: &[String]) -> Result<(String, Vec<Pred>), String> {
    let v = vocab();
    let mut kind = String::new();
    let mut preds = vec![];
    for a in args {
        if !a.starts_with('.') {
            // a bare word names the kind to list
            if let Some(k) = kind_word(a) {
                kind = k;
                continue;
            }
            return Err(format!(
                "'{a}' is not a filter; a bare word may name a KIND, \
                 as in task list projects"
            ));
        }
        let body = &a[1..];
        if let Some(stripped) = body.strip_suffix('!') {
            if stripped.contains(['=', '<', '>', '.']) {
                return Err(format!("unsupported filter '{a}'"));
            }
            preds.push(Pred {
                comp: stripped.into(),
                prop: "".into(),
                op: "".into(),
                value: "".into(),
            });
            continue;
        }
        let ops = ["!=", "~=", "<=", ">=", "=", "<", ">"];
        let Some((op, at)) = ops
            .iter()
            .filter_map(|op| body.find(op).map(|i| (op.to_string(), i)))
            .min_by_key(|(_, i)| *i)
        else {
            return Err(format!("unsupported filter '{a}'"));
        };
        let path = &body[..at];
        let value = body[at + op.len()..].to_string();
        if path == "kind" {
            kind = kind_word(&value)
                .ok_or_else(|| format!("no kind '{value}'"))?;
            continue;
        }
        let (comp, prop) = route(path)?;
        preds.push(Pred { comp, prop, op, value });
    }
    if kind.is_empty() {
        kind = "task".into();
    }
    let _ = v;
    Ok((kind, preds))
}

// `.comp.prop` explicit, else the bare column routed to its owners.
fn route(path: &str) -> Result<(String, String), String> {
    if path == "kind" {
        return Ok(("".into(), "kind".into()));
    }
    let v = vocab();
    if let Some((comp, prop)) = path.split_once('.') {
        if prop.contains('.') {
            return Err(format!(
                "path filters ('.{path}') are not ported in the Rust PoC"
            ));
        }
        return Ok((comp.into(), prop.into()));
    }
    let owners = v.owners(path);
    if owners.is_empty() {
        return Err(format!("no column '{path}' in the vocabulary"));
    }
    Ok((owners[0].clone(), path.into()))
}

pub fn kind_word(word: &str) -> Option<String> {
    let v = vocab();
    v.kind_order
        .iter()
        .find(|k| {
            *k == word || plural(k) == word || format!("{k}s") == word
        })
        .cloned()
}

fn plural(kind: &str) -> String {
    if kind == "person" {
        return "people".into();
    }
    if let Some(stem) = kind.strip_suffix('y') {
        return format!("{stem}ies");
    }
    if kind.ends_with('s') || kind.ends_with('x') || kind.ends_with("ch")
        || kind.ends_with("sh")
    {
        return format!("{kind}es");
    }
    format!("{kind}s")
}

// Resolve reference VALUES (`.project=P-19`) before matching, like
// resolveRefs does — an id in a filter compares as its eid.
pub fn resolve_values(store: &Store, preds: &mut [Pred]) {
    let v = vocab();
    for p in preds.iter_mut() {
        if p.value.is_empty() {
            continue;
        }
        let is_ref = v
            .prop_type(&p.comp, &p.prop)
            .map(|t| t.is_ref())
            .unwrap_or(false);
        if is_ref && !crate::store::is_uuid(&p.value.to_lowercase()) {
            if let Some(eid) = store.resolve_id(&p.value) {
                p.value = eid;
            }
        }
    }
}

fn scalar(row: &Row, comp: &str, prop: &str) -> Option<Value> {
    row.comps.get(comp)?.as_object()?.get(prop).cloned()
}

pub fn matches(row: &Row, preds: &[Pred]) -> bool {
    preds.iter().all(|p| {
        if p.op.is_empty() {
            return row.comps.contains_key(&p.comp);
        }
        let got = scalar(row, &p.comp, &p.prop);
        let want_list: Vec<&str> = p.value.split(',').collect();
        let hit = |want: &str| -> bool {
            let Some(g) = &got else {
                return want.is_empty(); // `=` empty matches absent
            };
            let gs = match g {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            match p.op.as_str() {
                "=" => eq(&gs, want),
                "!=" => !eq(&gs, want),
                "~=" => gs.to_lowercase().contains(&want.to_lowercase()),
                "<" | "<=" | ">" | ">=" => cmp(&gs, want, &p.op),
                _ => false,
            }
        };
        match p.op.as_str() {
            "!=" => want_list.iter().all(|w| hit(w)),
            _ => want_list.iter().any(|w| hit(w)),
        }
    })
}

fn eq(got: &str, want: &str) -> bool {
    if let (Ok(a), Ok(b)) = (got.parse::<f64>(), num_of(want)) {
        return a == b;
    }
    got == want
}

fn cmp(got: &str, want: &str, op: &str) -> bool {
    let ord = if let (Ok(a), Ok(b)) = (got.parse::<f64>(), num_of(want)) {
        a.partial_cmp(&b)
    } else {
        Some(got.cmp(want).into())
    };
    let Some(ord) = ord else { return false };
    match op {
        "<" => ord == std::cmp::Ordering::Less,
        "<=" => ord != std::cmp::Ordering::Greater,
        ">" => ord == std::cmp::Ordering::Greater,
        ">=" => ord != std::cmp::Ordering::Less,
        _ => false,
    }
}

// P-prefixed numbers compare as numbers (`.priority<=1`, `P1`).
fn num_of(s: &str) -> Result<f64, std::num::ParseFloatError> {
    s.trim().trim_start_matches(['p', 'P']).parse::<f64>()
}

// The board sort: status column order, then priority, then num.
pub fn by_board(a: &Row, b: &Row) -> std::cmp::Ordering {
    let v = vocab();
    let slot = |r: &Row| {
        let s = r
            .comps
            .get("task")
            .and_then(|t| t.get("status"))
            .and_then(|s| s.as_str())
            .unwrap_or("");
        v.statuses.iter().position(|x| x == s).map(|i| i as i64).unwrap_or(-1)
    };
    let pri = |r: &Row| {
        r.comps
            .get("task")
            .and_then(|t| t.get("priority"))
            .and_then(|p| p.as_f64())
            .unwrap_or(0.0)
    };
    slot(a)
        .cmp(&slot(b))
        .then(pri(a).partial_cmp(&pri(b)).unwrap_or(std::cmp::Ordering::Equal))
        .then(a.num.unwrap_or(0).cmp(&b.num.unwrap_or(0)))
}

// PropType is referenced here only through is_ref; silence the lint if the
// import thins later.
#[allow(unused)]
fn _t(_: PropType) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_kind_and_preds() {
        let (kind, preds) = parse(&[
            ".project=P-19".into(),
            ".status=open,wip".into(),
            ".priority<=1".into(),
        ])
        .unwrap();
        assert_eq!(kind, "task");
        assert_eq!(preds.len(), 3);
        assert_eq!(preds[0].comp, "task");
        assert_eq!(preds[1].prop, "status");
        assert_eq!(preds[2].op, "<=");
    }

    #[test]
    fn bare_word_names_the_kind() {
        let (kind, _) = parse(&["projects".into()]).unwrap();
        assert_eq!(kind, "project");
        assert!(parse(&["nonsense".into()]).is_err());
    }

    #[test]
    fn kind_filter_rides_dotted() {
        let (kind, preds) = parse(&[".kind=memory".into()]).unwrap();
        assert_eq!(kind, "memory");
        assert!(preds.is_empty());
    }

    #[test]
    fn unported_grammar_refuses() {
        assert!(parse(&[".comment.target.doc.title~=j".into()]).is_err());
    }

    #[test]
    fn priority_compares_p_prefixed() {
        assert!(num_of("P2").unwrap() == 2.0);
        assert!(cmp("1", "P2", "<"));
    }
}
