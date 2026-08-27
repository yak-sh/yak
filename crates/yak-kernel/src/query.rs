// The filter grammar's list/show subset: dot-params with the scalar ops
// (`=`, `!=`, `~=`, `<`, `<=`, `>`, `>=`), comma lists, `.comp!` presence,
// `=` empty for absence, `.kind=`. Bare-prop routing follows propOwners.
// Time phrases and path/reverse hops are NOT ported in the PoC — a filter
// using them is refused loudly, never half-answered.

use crate::model::{Row, Source};
use crate::vocab::{vocab, PropType};
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct Pred {
    pub comp: String,
    pub prop: String,
    pub op: String, // "", "=", "!=", "~=", "<", "<=", ">", ">="; "" = has-comp
    pub value: String,
}

// One dot token, parsed alone — either a kind screen (`.kind=x`) or a Pred.
pub enum Dot {
    Kind(String),
    P(Pred),
}

pub fn dot_token(a: &str) -> Result<Dot, String> {
    let body = &a[1..];
    if let Some(stripped) = body.strip_suffix('!') {
        if stripped.contains(['=', '<', '>', '.']) {
            return Err(format!("unsupported filter '{a}'"));
        }
        return Ok(Dot::P(Pred {
            comp: stripped.into(),
            prop: "".into(),
            op: "".into(),
            value: "".into(),
        }));
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
        let k =
            kind_word(&value).ok_or_else(|| format!("no kind '{value}'"))?;
        return Ok(Dot::Kind(k));
    }
    let (comp, prop) = route(path)?;
    // Validate/coerce the value against the leaf column's type BEFORE a row is
    // scanned, the way TS preds() runs typedValue()→parseProp: an out-of-set
    // enum, a non-numeric number/priority, a non-boolean bool is the typist's
    // news (a 400), not a filter that silently matches nothing. `~=` (contains)
    // is literal and the empty value is the absence test, so both skip — TS's
    // own guard (`type && op != '~' && value != ''`).
    let value = if op != "~=" && !value.is_empty() {
        typed_value(&comp, &prop, &value)?
    } else {
        value
    };
    Ok(Dot::P(Pred { comp, prop, op, value }))
}

// Coerce and VALIDATE a filter value against the leaf column's declared type
// (props.ts typedValue → range → atom → parseProp). Only the CLOSED scalar
// types validate here: an enum is canonicalized to its declared spelling
// (case-folded match, oneOf()); number/priority/bool are checked but left
// verbatim (resolve_values canonicalizes priority; matching reads them). eid,
// time, text and url stay lenient — refs resolve at delivery, time phrases stay
// authored, text is free — so a value of those types is returned untouched, as
// TS's atom() does (eid catches, time keeps a parseable span, text passes).
// NB: enum ALIASES are not ported here (the baked PropType carries variants,
// not aliases), so an aliased value 400s where TS would resolve it — noted, not
// in any read corpus.
fn typed_value(comp: &str, prop: &str, value: &str) -> Result<String, String> {
    let v = vocab();
    let t = if comp.is_empty() {
        v.bare_type(prop)
    } else {
        v.prop_type(comp, prop)
    };
    let Some(t) = t else { return Ok(value.into()) };
    if !matches!(
        t,
        PropType::Enum(_)
            | PropType::Number
            | PropType::Priority
            | PropType::Bool
    ) {
        return Ok(value.into());
    }
    let name = v.prop_name(comp, prop);
    value
        .split(',')
        .map(|part| typed_range(&t, &name, part))
        .collect::<Result<Vec<_>, _>>()
        .map(|parts| parts.join(","))
}

// One comma atom, itself possibly a `lo..hi` / `lo...hi` range whose two ends
// each coerce (props.ts range()). An open-ended side ('' before or after `..`)
// coerces to nothing, like the absence atom.
fn typed_range(t: &PropType, name: &str, part: &str) -> Result<String, String> {
    if let Some(at) = part.find("..") {
        let lo = &part[..at];
        let (excl, hi) = match part[at + 2..].strip_prefix('.') {
            Some(rest) => (true, rest),
            None => (false, &part[at + 2..]),
        };
        Ok(format!(
            "{}..{}{}",
            typed_atom(t, name, lo)?,
            if excl { "." } else { "" },
            typed_atom(t, name, hi)?
        ))
    } else {
        typed_atom(t, name, part)
    }
}

// One scalar atom against a closed type. The error strings are byte-identical
// to props.ts fail() (`{name} is {grammar} — got '{value}'`), so a /query 400
// diffs against the Deno server's word for word.
fn typed_atom(t: &PropType, name: &str, v: &str) -> Result<String, String> {
    if v.is_empty() {
        return Ok(v.into());
    }
    match t {
        PropType::Enum(variants) => variants
            .iter()
            .find(|x| x.eq_ignore_ascii_case(v))
            .cloned()
            .ok_or_else(|| {
                format!("{name} is one of {} — got '{v}'", variants.join(", "))
            }),
        PropType::Number => is_decimal(v).then(|| v.to_string()).ok_or_else(|| {
            format!("{name} is a finite decimal number (1, -2.5, 6e3) — got '{v}'")
        }),
        PropType::Priority => {
            let bare = v.trim().strip_prefix(['p', 'P']).unwrap_or(v.trim());
            is_decimal(bare).then(|| v.to_string()).ok_or_else(|| {
                format!(
                    "{name} is a finite number, optionally P-prefixed \
                     (P2, p02, 1.5) — got '{v}'"
                )
            })
        }
        PropType::Bool => {
            let s = v.trim().to_lowercase();
            matches!(s.as_str(), "true" | "1" | "yes" | "false" | "0" | "no")
                .then(|| v.to_string())
                .ok_or_else(|| {
                    format!(
                        "{name} is a boolean (true, false, 1, 0, yes, no) — \
                         got '{v}'"
                    )
                })
        }
        _ => Ok(v.into()),
    }
}

// props.ts DECIMAL + Number.isFinite: a signed decimal with an optional
// exponent, finite. f64 parsing accepts the same shapes; the finite check
// rejects the inf/nan words f64 also parses but DECIMAL never matches.
fn is_decimal(s: &str) -> bool {
    s.trim().parse::<f64>().map(|f| f.is_finite()).unwrap_or(false)
}

pub fn parse(args: &[String]) -> Result<(String, Vec<Pred>), String> {
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
        match dot_token(a)? {
            Dot::Kind(k) => kind = k,
            Dot::P(p) => preds.push(p),
        }
    }
    if kind.is_empty() {
        kind = "task".into();
    }
    Ok((kind, preds))
}

const SKETCH: &str = "filters are dot-params: .status=open, .priority<=1, \
.project=P-19, .title~=word, …";
const EDGE_DOOR: &str = "a dependency is an EDGE, not a prop: link one with \
'task <parent> requires <child>'";

// The names agents reach for that are EDGES (query.ts edgeish).
fn edgeish(prop: &str) -> bool {
    let p = prop.to_lowercase();
    ["block", "depend", "require", "parent", "child", "subtask"]
        .iter()
        .any(|w| p.contains(w))
}

// Spawn's legacy session aliases are one concept during the rolling window.
fn session_twin(owners: &[String]) -> bool {
    let v = vocab();
    owners.iter().any(|n| n == "session")
        && owners.iter().any(|n| v.session_facets.contains(n))
        && owners
            .iter()
            .all(|n| n == "session" || v.session_facets.contains(n))
}

// Same-named references that already read as one bare filter (query.ts
// sharedRefs).
fn shared_ref(prop: &str, owners: &[String]) -> bool {
    owners.len() > 1
        && ["actor", "canvas", "client", "scope", "target"].contains(&prop)
        && vocab().bare_type(prop).map(|t| t.is_ref()).unwrap_or(false)
}

// `.comp.prop` explicit, else the bare column routed to its owners —
// ambiguity is an error naming the candidates, never a guess (query.ts
// route()).
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
    // Session-log columns are an explicitly addressed lazy partition — bare
    // props never route there.
    let mut own: Vec<String> = v
        .owners(path)
        .into_iter()
        .filter(|n| !v.session_comps.contains(n))
        .collect();
    // Bare routing keeps the writable spelling when a stamped lifecycle
    // field shares the name (session.status vs task.status).
    let writable: Vec<String> = own
        .iter()
        .filter(|n| {
            v.comp(n).map(|c| c.iter().any(|(p, _)| p == path)).unwrap_or(false)
        })
        .cloned()
        .collect();
    if !writable.is_empty() {
        own = writable;
    }
    // Parent/child words teach the edge door — unless the word is a real
    // component (`.blocked!` filters what is stuck).
    if edgeish(path) && v.comp(path).is_none() {
        own.clear();
    }
    if own.len() == 1 {
        return Ok((own[0].clone(), path.into()));
    }
    if session_twin(&own) || shared_ref(path, &own) {
        return Ok(("".into(), path.into()));
    }
    if own.len() > 1 {
        return Err(format!(
            ".{path} is ambiguous ({}) — use .{}.{path}",
            own.join(", "),
            own[0]
        ));
    }
    // A component with no namesake column gets the presence grammar
    // (`=` absent, `~=` present).
    if v.comp(path).is_some() {
        return Ok((path.into(), "".into()));
    }
    Err(if path == "eid" {
        "address entities by id directly (T-3, E-9) — filters match \
         component props"
            .into()
    } else {
        format!(
            "unknown prop: .{path} — {}",
            if edgeish(path) { EDGE_DOOR } else { SKETCH }
        )
    })
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
// resolveRefs does — an id in a filter compares as its eid. Priority values
// normalize the way the typed param parser does (P2 -> 2). Any Source
// (sqlite store, delta-fed cache) resolves the same way.
pub fn resolve_values<S: Source + ?Sized>(src: &S, preds: &mut [Pred]) {
    let v = vocab();
    for p in preds.iter_mut() {
        if p.value.is_empty() {
            continue;
        }
        let t = if p.comp.is_empty() {
            v.bare_type(&p.prop)
        } else {
            v.prop_type(&p.comp, &p.prop)
        };
        match t {
            Some(t) if t.is_ref() => {
                if !crate::model::is_uuid(&p.value.to_lowercase()) {
                    if let Some(eid) = src.resolve_id(&p.value) {
                        p.value = eid;
                    }
                }
            }
            Some(PropType::Priority) => {
                p.value = p
                    .value
                    .split(',')
                    .map(|part| {
                        let t = part.trim();
                        let bare = t
                            .strip_prefix(['p', 'P'])
                            .filter(|r| r.parse::<f64>().is_ok());
                        bare.unwrap_or(t).to_string()
                    })
                    .collect::<Vec<_>>()
                    .join(",");
            }
            _ => {}
        }
    }
}

// One column read. `updated.at` falls back to `created.at`: an entity made
// and never touched since carries no `updated` row, and being made IS the
// last time it changed (query.ts read()).
fn scalar(
    comps: &serde_json::Map<String, Value>,
    comp: &str,
    prop: &str,
) -> Option<Value> {
    let v = comps
        .get(comp)
        .and_then(|c| c.as_object())
        .and_then(|c| c.get(prop))
        .cloned();
    if v.is_none() && comp == "updated" && prop == "at" {
        return comps.get("created").and_then(|c| c.get("at")).cloned();
    }
    v
}

// String(v) for a JSON scalar, JS-flavored (integral floats print bare).
fn s_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f.fract() == 0.0 && f.abs() < 1e15 {
                    return format!("{}", f as i64);
                }
            }
            n.to_string()
        }
        other => other.to_string(),
    }
}

fn as_num(v: &str) -> Option<f64> {
    let ok = {
        let t = v.strip_prefix('-').unwrap_or(v);
        !t.is_empty()
            && t.chars().all(|c| c.is_ascii_digit() || c == '.')
            && t.matches('.').count() <= 1
            && !t.starts_with('.')
            && !t.ends_with('.')
    };
    ok.then(|| v.parse().ok()).flatten()
}

// v vs s, numerically when both sides are numbers, else as strings (cmp()).
fn cmp(v: &str, s: &str) -> std::cmp::Ordering {
    if let (Some(a), Some(b)) = (as_num(v), as_num(s)) {
        return a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal);
    }
    v.cmp(s)
}

// The '=' forms, ported from query.ts eq(): '' is absent, 'a,b' any-of,
// 'x..y' a range ('...' excludes the end).
fn eq(v: Option<&str>, value: &str) -> bool {
    if value.is_empty() {
        return v.is_none() || v == Some("");
    }
    if let Some(at) = value.find("..") {
        let lo = &value[..at];
        let (excl, hi) = match value[at + 2..].strip_prefix('.') {
            Some(rest) => (true, rest),
            None => (false, &value[at + 2..]),
        };
        let Some(v) = v else { return false };
        return cmp(v, lo) != std::cmp::Ordering::Less
            && if excl {
                cmp(v, hi) == std::cmp::Ordering::Less
            } else {
                cmp(v, hi) != std::cmp::Ordering::Greater
            };
    }
    if value.contains(',') {
        return value.split(',').any(|part| eq(v, part));
    }
    v == Some(value)
}

// A timestamp against a phrase: the phrase names a range, the op its edge
// (query.ts inTime()).
#[cfg(feature = "native")]
fn in_time(v: &str, op: &str, s: crate::time::Span) -> bool {
    let Some(t) = crate::time::parse_stamp(v) else { return false };
    match op {
        "=" => t >= s.start && (t < s.end || t == s.start),
        "!=" => !(t >= s.start && (t < s.end || t == s.start)),
        "<" => t < s.start,
        "<=" => t < s.end || t == s.start,
        ">" => t >= s.end && t != s.start,
        _ => t >= s.start, // >=
    }
}

pub fn matches(row: &Row, preds: &[Pred]) -> bool {
    matches_at(row, preds, now_ms())
}

// The predicate test on a bare comps bag — lets a cache match BEFORE it
// clones a row out, so a query pays only for its hits.
pub fn matches_comps(
    comps: &serde_json::Map<String, Value>,
    preds: &[Pred],
) -> bool {
    matches_comps_at(comps, preds, now_ms())
}

// The wall clock — native only; wasm has no clock, so there the argless
// doors evaluate time phrases against 0 and a caller who cares passes its
// own `now` through matches_comps_at.
pub fn now_ms() -> i64 {
    #[cfg(feature = "native")]
    {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }
    #[cfg(not(feature = "native"))]
    {
        0
    }
}

pub fn matches_at(row: &Row, preds: &[Pred], now: i64) -> bool {
    matches_comps_at(&row.comps, preds, now)
}

pub fn matches_comps_at(
    comps: &serde_json::Map<String, Value>,
    preds: &[Pred],
    now: i64,
) -> bool {
    preds.iter().all(|p| {
        // A bare component name is a presence test: `!`/`~=` hold when the
        // row wears it, `=` when it does not (query.ts present()).
        if p.prop.is_empty() {
            let has = comps.contains_key(&p.comp);
            return if p.op.is_empty() || p.op == "~=" { has } else { !has };
        }
        // comp '' scans every owner: the pred holds if ANY value passes
        // (query.ts reads()).
        if p.comp.is_empty() {
            let vals: Vec<Value> = comps
                .values()
                .filter_map(|c| {
                    c.as_object().and_then(|o| o.get(&p.prop)).cloned()
                })
                .filter(|v| !v.is_null())
                .collect();
            if vals.is_empty() {
                return test(None, p, now);
            }
            return vals.into_iter().any(|v| test(Some(v), p, now));
        }
        test(scalar(comps, &p.comp, &p.prop), p, now)
    })
}

// One value against one pred — the shared leaf of matches_at.
fn test(got: Option<Value>, p: &Pred, now: i64) -> bool {
    #[cfg(not(feature = "native"))]
    let _ = now;
    {
        let gs = got.as_ref().map(s_of);
        // time-typed columns take the span road (query.ts test()) — native
        // only: phrase math needs the local timezone. Literal ISO stamps
        // still compare correctly below (lexical order IS chronological).
        #[cfg(feature = "native")]
        if p.op != "~=" {
            let v = vocab();
            let timed = if p.comp.is_empty() {
                v.bare_type(&p.prop)
            } else {
                v.prop_type(&p.comp, &p.prop)
            }
            .map(|t| t == PropType::Time)
            .unwrap_or(false);
            if timed {
                if let Some(gv) = &gs {
                    let spans: Vec<_> = p
                        .value
                        .split(',')
                        .map(|part| crate::time::span(part, now))
                        .collect();
                    if !spans.is_empty() && spans.iter().all(|s| s.is_some()) {
                        let hit = spans
                            .iter()
                            .any(|s| in_time(gv, "=", s.unwrap()));
                        if p.op == "=" {
                            return hit;
                        }
                        if p.op == "!=" {
                            return !hit;
                        }
                    }
                    if let Some(s) = crate::time::span(&p.value, now) {
                        return in_time(gv, &p.op, s);
                    }
                }
            }
        }
        match p.op.as_str() {
            "=" => eq(gs.as_deref(), &p.value),
            "!=" => !eq(gs.as_deref(), &p.value),
            "~=" => gs
                .map(|g| {
                    g.to_lowercase().contains(&p.value.to_lowercase())
                })
                .unwrap_or(false),
            op @ ("<" | "<=" | ">" | ">=") => {
                let Some(g) = gs else { return false };
                let ord = cmp(&g, &p.value);
                match op {
                    "<" => ord == std::cmp::Ordering::Less,
                    "<=" => ord != std::cmp::Ordering::Greater,
                    ">" => ord == std::cmp::Ordering::Greater,
                    _ => ord != std::cmp::Ordering::Less,
                }
            }
            _ => false,
        }
    }
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
    fn routing_refuses_ambiguity_and_teaches_doors() {
        // several owners, none preferred → the candidates, named
        let e = parse(&[".received_at>=today".into()]).unwrap_err();
        assert!(e.contains("ambiguous"), "{e}");
        assert!(e.contains("use ."), "{e}");
        // an edge word is the edge door, not a guess
        let e = parse(&[".parent=T-1".into()]).unwrap_err();
        assert!(e.contains("EDGE"), "{e}");
        // eid gets its own teaching moment
        let e = parse(&[".eid=x".into()]).unwrap_err();
        assert!(e.contains("address entities by id"), "{e}");
        // a shared ref reads every owner: comp ''
        let (_, preds) = parse(&[".target=T-1".into()]).unwrap();
        assert_eq!(preds[0].comp, "");
        assert_eq!(preds[0].prop, "target");
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

    fn task_row(comps: serde_json::Value) -> Row {
        Row {
            eid: "e".into(),
            num: Some(1),
            kind: "task".into(),
            comps: comps.as_object().cloned().unwrap_or_default(),
        }
    }

    #[test]
    fn eq_forms_range_list_absent() {
        assert!(eq(Some("3"), "1..5"));
        assert!(!eq(Some("5"), "1...5"));
        assert!(eq(Some("b"), "a,b"));
        assert!(eq(None, ""));
        assert!(!eq(Some("x"), ""));
    }

    #[test]
    fn time_phrase_matches_a_stamp() {
        let now = crate::time::parse_stamp("2026-08-26T13:00:00-04:00")
            .unwrap();
        let row = task_row(serde_json::json!({
            "updated": { "at": "2026-08-26T11:00:00-04:00" }
        }));
        let p = |op: &str, value: &str| Pred {
            comp: "updated".into(),
            prop: "at".into(),
            op: op.into(),
            value: value.into(),
        };
        assert!(matches_at(&row, &[p("=", "today")], now));
        assert!(!matches_at(&row, &[p("=", "yesterday")], now));
        assert!(matches_at(&row, &[p(">=", "3-hours-ago")], now));
        assert!(!matches_at(&row, &[p(">=", "1-hour-ago")], now));
    }
}
