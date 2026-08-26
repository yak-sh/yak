// The subscription query answerers (graph_query.ts evalSub/evalAgg), ported for
// the yak-bridge WS subscription frames (T-22747). A subscription's query is a
// FILTER LINE — the same dot-param grammar `/query` speaks — plus the directive
// riders that ride BESIDE the filter: a WINDOW (`.limit=`/`.after=`), an
// AGGREGATE projection (`.count!`/`.distinct=`/`.tally=`), and an `.order=`
// ranking. This module PARSES that line into its filter preds + directives and
// ANSWERS it over a read-only Store, reusing query.rs's one matcher (never a
// second evaluator): the membership set is the filter's matches, and the
// aggregate is that same set reduced.
//
// SCOPE (the rung this crate is at): the filter grammar is query.rs's list/show
// SUBSET, so a sub filter is kind-anchored (`.kind=task&…`) or component-presence
// anchored (`.canvas!`) — the candidate set the JS matcher then refines. Path
// hops, reverse hops, `.reaches`, `.fields`, `.edges` riders and the lazy entry
// partition are the grammar query.rs still refuses, so a sub naming one is
// REFUSED here rather than half-answered — the same loud boundary the /query
// door draws, and the standing follow-up (see parse_query_line's Err arms).

use crate::model::Row;
use crate::query::{self, Dot, Pred};
use crate::store::{visible, Store};
use crate::vocab::{vocab, PropType};

// A window bound (query.ts Win): how many of the newest matches to answer with,
// and where to continue below a spine num.
#[derive(Debug, Clone, Default)]
pub struct Win {
    pub limit: Option<i64>,
    pub after: Option<i64>,
}

// An aggregate projection (query.ts aggOf): the reduction and the column it
// names. `count` names no column (comp/prop empty) — it reduces the selection.
#[derive(Debug, Clone)]
pub struct Agg {
    pub op: String, // "count" | "distinct" | "tally"
    pub comp: String,
    pub prop: String,
}

// A parsed subscription query line: the filter preds, the kind it anchors on (a
// bare kind word or `.kind=`), and the directive riders.
#[derive(Debug, Clone, Default)]
pub struct Parsed {
    pub kind: Option<String>,
    pub preds: Vec<Pred>,
    pub win: Win,
    pub agg: Option<Agg>,
    pub order: Option<String>,
    // An empty query SELECTS NOTHING (query.ts NEVER): a blank sub answers the
    // empty set cheaply, never the whole graph.
    pub never: bool,
}

// The membership answer control() ships (graph_query.ts SubAnswer): the hits in
// newest-num-first order, and `window` present exactly when the members are a
// bounded PREFIX — the limit it holds and the total it is a prefix of.
pub struct SubAnswer {
    pub hits: Vec<Row>,
    pub window: Option<(i64, Option<i64>)>, // (limit, total)
}

// The default floor under a sub that names no window (graph_query.ts SUB_CAP):
// no single socket may stage the whole graph, so every row sub is bounded.
pub const SUB_CAP: i64 = 1000;

// Split a filter line on '&', minimally quote-aware: a "quoted run" glues across
// '&' the way query.ts segments() does, so a value carrying a separator stays one
// segment. Whitespace INSIDE a dot-param segment is kept (the /query grammar).
fn split_amp(line: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut quoted = false;
    for c in line.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                cur.push(c);
            }
            '&' if !quoted => {
                out.push(std::mem::take(&mut cur));
            }
            _ => cur.push(c),
        }
    }
    out.push(cur);
    out
}

// Route an aggregate/column name (`task.status`, or a bare `status`) to its
// (comp, prop). Reuses dot_token so a bare column routes by exactly the /query
// rules and an ambiguous one is refused with the same message.
fn route_col(spec: &str) -> Result<(String, String), String> {
    if let Some((comp, prop)) = spec.split_once('.') {
        if prop.contains('.') {
            return Err(format!("aggregate over a path is not ported: .{spec}"));
        }
        return Ok((comp.into(), prop.into()));
    }
    match query::dot_token(&format!(".{spec}="))? {
        Dot::P(p) if !p.prop.is_empty() => Ok((p.comp, p.prop)),
        _ => Err(format!(".{spec} does not name an aggregatable column")),
    }
}

// Parse a subscription filter LINE into its preds + directives. A directive
// rides beside the filter (window, aggregate, order); a plain token routes
// through query.rs's dot_token. Grammar this rung does not port is REFUSED.
pub fn parse_query_line(line: &str) -> Result<Parsed, String> {
    let mut out = Parsed::default();
    let trimmed = line.trim();
    if trimmed.is_empty() {
        out.never = true;
        return Ok(out);
    }
    for raw in split_amp(trimmed) {
        let seg = raw.trim();
        if seg.is_empty() {
            continue;
        }
        if !seg.starts_with('.') {
            // A bare word names the kind to list (read.rs parse); anything else
            // is a TEXT term (FTS), which this rung does not port.
            if let Some(k) = query::kind_word(seg) {
                out.kind = Some(k);
                continue;
            }
            return Err(format!(
                "bare-word (text) sub terms are not ported in this rung: '{seg}'"
            ));
        }
        // Window directives.
        if let Some(v) = seg.strip_prefix(".limit=") {
            out.win.limit = Some(
                v.parse().map_err(|_| format!(".limit takes a number: {seg}"))?,
            );
            continue;
        }
        if let Some(v) = seg.strip_prefix(".after=") {
            out.win.after = Some(
                v.parse().map_err(|_| format!(".after takes a number: {seg}"))?,
            );
            continue;
        }
        if let Some(v) = seg.strip_prefix(".order=") {
            out.order = Some(v.to_string());
            continue;
        }
        // Aggregate projections.
        if seg == ".count!" {
            out.agg = Some(Agg { op: "count".into(), comp: "".into(), prop: "".into() });
            continue;
        }
        if let Some(v) = seg.strip_prefix(".distinct=") {
            let (comp, prop) = route_col(v)?;
            out.agg = Some(Agg { op: "distinct".into(), comp, prop });
            continue;
        }
        if let Some(v) = seg.strip_prefix(".tally=") {
            let (comp, prop) = route_col(v)?;
            out.agg = Some(Agg { op: "tally".into(), comp, prop });
            continue;
        }
        // Riders this rung refuses loudly (the standing follow-up, T-22747):
        if seg.starts_with(".edges") {
            return Err("the .edges rider is not ported in this rung".into());
        }
        if seg.starts_with(".fields=") {
            return Err("the .fields projection is not ported in this rung".into());
        }
        if seg.starts_with(".reaches[") {
            return Err("the .reaches traversal is not ported in this rung".into());
        }
        // A plain filter token — dot_token refuses path/reverse hops, so those
        // reach the same loud boundary here.
        match query::dot_token(seg)? {
            Dot::Kind(k) => out.kind = Some(k),
            Dot::P(p) => out.preds.push(p),
        }
    }
    Ok(out)
}

// A sub query names the LAZY entry partition when a filter names a session-log
// component — refused this rung, so the JS matcher never sees an entry row.
fn names_lazy(p: &Parsed) -> bool {
    let v = vocab();
    p.preds
        .iter()
        .any(|pr| v.session_comps.contains(&pr.comp) && !(pr.prop.is_empty() && pr.op.is_empty()))
}

// The candidate rows a membership answer refines: the kind's rows, or a
// component-presence anchor's wearers. Both come back in num order. A query with
// no anchor this rung can bound is refused (it would be the whole graph).
fn candidates(store: &Store, p: &Parsed) -> Result<Vec<Row>, String> {
    if names_lazy(p) {
        return Err("entry-partition sub queries are not ported in this rung".into());
    }
    if let Some(k) = &p.kind {
        return Ok(store.rows_of_kind(k));
    }
    // A `.comp!` presence pred (prop empty, op present-or-empty) anchors the
    // candidate set to that component's wearers — the WS_SETS shape (`.canvas!`).
    if let Some(anchor) = p
        .preds
        .iter()
        .find(|pr| pr.prop.is_empty() && (pr.op.is_empty() || pr.op == "~="))
    {
        return Ok(store.rows_of(&presence_eids(store, &anchor.comp)));
    }
    Err("a sub query needs a kind or a component-presence anchor in this rung".into())
}

// Every eid wearing `comp`, num order — no quarantine screen (the caller screens
// membership, and an aggregate deliberately counts under LIVE only, matching
// aggregateSql).
fn presence_eids(store: &Store, comp: &str) -> Vec<String> {
    if !store.has_table(comp) {
        return vec![];
    }
    crate::store::collect(
        &store.conn,
        &format!(
            "select e.eid from \"{comp}\" t join entity e on e.id = t.entity order by e.num"
        ),
        [],
        |r| r.get(0),
    )
}

fn reveals(preds: &[Pred]) -> bool {
    preds.iter().any(|p| p.comp == "quarantined")
}

// The membership answer for a query sub (graph_query.ts evalSub): the filter's
// matches, quarantine-screened, newest-num-first, bounded to a window.
pub fn eval_sub(store: &Store, p: &Parsed, cap: i64) -> Result<SubAnswer, String> {
    if p.never {
        return Ok(SubAnswer { hits: vec![], window: None });
    }
    let mut preds = p.preds.clone();
    query::resolve_values(store, &mut preds);
    let reveal = reveals(&preds);
    let now = query::now_ms();
    let mut hits: Vec<Row> = candidates(store, p)?
        .into_iter()
        .filter(|r| reveal || visible(r))
        .filter(|r| p.kind.as_ref().map(|k| &r.kind == k).unwrap_or(true))
        .filter(|r| query::matches_comps_at(&r.comps, &preds, now))
        .collect();
    // after= continues the window below a num, before the newest cut.
    if let Some(a) = p.win.after {
        hits.retain(|r| r.num.unwrap_or(0) < a);
    }
    hits.sort_by(|a, b| b.num.unwrap_or(0).cmp(&a.num.unwrap_or(0)));
    let total = hits.len() as i64;
    let limit = p.win.limit.unwrap_or(cap);
    // Whole, and nobody asked for a window: the frame says nothing about bounds.
    let window = if total <= limit && p.win.limit.is_none() {
        None
    } else {
        Some((limit, Some(total)))
    };
    if hits.len() as i64 > limit {
        hits.truncate(limit.max(0) as usize);
    }
    Ok(SubAnswer { hits, window })
}

// The aggregate answer (graph_query.ts evalAgg): the same membership reduced to
// a value→count map. `count` reduces the selection under the empty key; `tally`
// counts each value; `distinct` names each value once (n=1). Empties (null, '')
// are dropped, and the map is VALUE-ORDERED ascending — byte-identical to
// aggregateSql's `order by value` (SQLite BINARY collation == byte order for the
// ASCII enum/text columns an aggregate names). NB: no quarantine screen, matching
// aggregateSql's LIVE-only WHERE.
pub fn eval_agg(store: &Store, p: &Parsed) -> Result<Vec<(String, i64)>, String> {
    let agg = p.agg.as_ref().ok_or("not an aggregate query")?;
    let mut preds = p.preds.clone();
    query::resolve_values(store, &mut preds);
    let now = query::now_ms();
    let hits: Vec<Row> = candidates(store, p)?
        .into_iter()
        .filter(|r| p.kind.as_ref().map(|k| &r.kind == k).unwrap_or(true))
        .filter(|r| query::matches_comps_at(&r.comps, &preds, now))
        .collect();
    if agg.op == "count" {
        return Ok(vec![(String::new(), hits.len() as i64)]);
    }
    // value → count, empties dropped, keys sorted ascending (BTreeMap).
    let mut m: std::collections::BTreeMap<String, i64> = Default::default();
    for r in &hits {
        let v = r.comps.get(&agg.comp).and_then(|c| c.get(&agg.prop));
        let key = match v {
            Some(serde_json::Value::Null) | None => continue,
            Some(serde_json::Value::String(s)) if s.is_empty() => continue,
            Some(serde_json::Value::String(s)) => s.clone(),
            Some(other) => num_str(other),
        };
        *m.entry(key).or_insert(0) += 1;
    }
    Ok(match agg.op.as_str() {
        "distinct" => m.into_keys().map(|k| (k, 1)).collect(),
        _ => m.into_iter().collect(), // tally
    })
}

// String(v) for a non-string JSON scalar, JS-flavored (integral floats bare).
fn num_str(v: &serde_json::Value) -> String {
    if let Some(f) = v.as_f64() {
        if f.fract() == 0.0 && f.abs() < 1e15 {
            return format!("{}", f as i64);
        }
    }
    v.to_string()
}

// Does a sub's filter name a MOVING time window — one the clock ages a member
// out of with nobody writing (subs.ts moving)? A time-typed leaf whose value is
// a non-fixed span (a phrase like `1-hour-ago`, not an ISO stamp).
pub fn moving(preds: &[Pred]) -> bool {
    let v = vocab();
    preds.iter().any(|p| {
        let t = if p.comp.is_empty() {
            v.bare_type(&p.prop)
        } else {
            v.prop_type(&p.comp, &p.prop)
        };
        if t != Some(PropType::Time) {
            return false;
        }
        atoms(&p.value).iter().any(|a| !fixed(a) && span_parses(a))
    })
}

// A value's atoms (subs.ts atoms): comma list, each split on a `..` range.
fn atoms(value: &str) -> Vec<String> {
    let mut out = vec![];
    for part in value.split(',') {
        if let Some(at) = part.find("..") {
            let lo = &part[..at];
            let hi = part[at + 2..].trim_start_matches('.');
            if !lo.is_empty() {
                out.push(lo.to_string());
            }
            if !hi.is_empty() {
                out.push(hi.to_string());
            }
        } else if !part.is_empty() {
            out.push(part.to_string());
        }
    }
    out
}

// A fixed calendar stamp (subs.ts fixed): `YYYY-MM-DD…`.
fn fixed(v: &str) -> bool {
    let b = v.as_bytes();
    b.len() >= 10
        && b[0..4].iter().all(|c| c.is_ascii_digit())
        && b[4] == b'-'
        && b[5..7].iter().all(|c| c.is_ascii_digit())
        && b[7] == b'-'
        && b[8..10].iter().all(|c| c.is_ascii_digit())
}

fn span_parses(v: &str) -> bool {
    crate::time::span(v, query::now_ms()).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_membership_and_kind() {
        let p = parse_query_line(".kind=task&.status=open").unwrap();
        assert_eq!(p.kind.as_deref(), Some("task"));
        assert_eq!(p.preds.len(), 1);
        assert_eq!(p.preds[0].prop, "status");
        assert!(p.agg.is_none() && p.win.limit.is_none() && !p.never);
    }

    #[test]
    fn parses_window_and_aggregate_directives() {
        let w = parse_query_line(".kind=task&.limit=3&.after=900").unwrap();
        assert_eq!(w.win.limit, Some(3));
        assert_eq!(w.win.after, Some(900));

        let c = parse_query_line(".kind=task&.status=open&.count!").unwrap();
        assert_eq!(c.agg.as_ref().unwrap().op, "count");
        assert!(c.agg.as_ref().unwrap().comp.is_empty());
        // the count directive is not left as a filter pred
        assert_eq!(c.preds.len(), 1);

        let t = parse_query_line(".kind=task&.tally=task.status").unwrap();
        let agg = t.agg.unwrap();
        assert_eq!((agg.op.as_str(), agg.comp.as_str(), agg.prop.as_str()), ("tally", "task", "status"));
    }

    #[test]
    fn empty_line_selects_nothing() {
        assert!(parse_query_line("").unwrap().never);
        assert!(parse_query_line("   ").unwrap().never);
    }

    #[test]
    fn unported_grammar_is_refused_loudly() {
        for line in [
            ".kind=task&.edges!",
            ".kind=task&.fields=task.status",
            ".comment.target.doc.title~=x",
            "some text term",
            ".reaches[requires,<=3]=T-42",
        ] {
            assert!(parse_query_line(line).is_err(), "should refuse: {line}");
        }
    }

    #[test]
    fn moving_time_detects_a_phrase_not_a_stamp() {
        // a non-fixed span is moving; an ISO stamp is not.
        let moving_line = parse_query_line(".kind=task&.updated.at>=1-hour-ago").unwrap();
        assert!(moving(&moving_line.preds));
        let fixed_line = parse_query_line(".kind=task&.updated.at>=2026-01-01").unwrap();
        assert!(!moving(&fixed_line.preds));
        // a non-time column never moves
        let plain = parse_query_line(".kind=task&.status=open").unwrap();
        assert!(!moving(&plain.preds));
    }
}
