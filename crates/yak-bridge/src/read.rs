// The /query door as a pure function over a read-only Store — the same answer
// server.ts:1031 builds, so a recorded corpus diffs byte-for-byte. The route's
// grammar, restated exactly:
//
//   - the query string is split on '&' and each SEGMENT decodeURIComponent'd
//     WHOLE (operators included) before parsing — remote.rs seg() is the mirror
//     of this on the client.
//   - `deps=1` rides each hit's incident edges; `quarantined=1` lifts the
//     default quarantine screen; `after=`/`limit=` page the answer.
//   - `id=<id[,id,…]>` FETCHES by address (num, uuid, short-eid, slug) and any
//     remaining filter only screens; everything else runs the filter pipeline.
//   - order: the whole answer in num order, or — under an explicit `limit` —
//     the NEWEST `limit` by num, returned in num order (evalGraph `cut`).
//
// CLOSED at this rung (T-22759): the aggregate projections
// (`.count!`/`.distinct=`/`.tally=`) reuse the kernel's one `eval_agg`
// (subquery.rs), `backlinks=1` builds the reverse-reference layer over
// `Store::refs_of` + the incident edges, and the grammar/enum validation edges
// now match TS `parseQuery` (an out-of-enum value 400s; an unknown-column dot
// token with no operator is a TEXT term, not a 400).
//
// STILL DEFERRED (documented divergences): FTS hot/text RANKING, the lazy entry
// partition, and the path-hop / time grammar `query::parse` refuses. A bare
// text term reaches this door as `Query.text` and — since the bridge does not
// port FTS — answers the EMPTY set (200), which is byte-parity with the Deno
// server for a term that matches nothing (a term that WOULD match is the
// standing text divergence). The harness screens ranked text out and tests only
// the no-match form.

use crate::emit::hit_with_layers;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use yak_kernel::store::visible;
use yak_kernel::subquery::{self, parse_query_line};
use yak_kernel::vocab::vocab;
use yak_kernel::{query, Graph, Row, Store};

pub struct Query {
    pub deps: bool,
    pub reveal: bool,
    pub after: Option<i64>,
    pub limit: Option<i64>,
    pub ids: Vec<String>,
    pub filters: Vec<String>, // the remaining filter segments, as parse() args
    pub backlinks: bool,      // backlinks=1 — the reverse-reference layer
    pub aggregate: bool,      // a `.count!`/`.distinct=`/`.tally=` projection
    pub text: bool,           // a bare TEXT term rode the filter line (see note)
}

// Percent-decode one query segment the way decodeURIComponent does: %XX bytes,
// UTF-8 reassembled; a stray or malformed '%' passes through literally (the
// browser's lenient behaviour). '+' is NOT a space here — the route decodes
// segments, it does not form-decode them.
pub fn decode(seg: &str) -> String {
    let b = seg.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = |c: u8| -> Option<u8> {
                match c {
                    b'0'..=b'9' => Some(c - b'0'),
                    b'a'..=b'f' => Some(c - b'a' + 10),
                    b'A'..=b'F' => Some(c - b'A' + 10),
                    _ => None,
                }
            };
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h << 4 | l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// Split a raw query string (no leading '?') into decoded segments, dropping
// empties — server.ts's `url.search.slice(1).split('&').filter(Boolean)`.
pub fn parse_query(raw: &str) -> Query {
    let segs: Vec<String> = raw.split('&').filter(|s| !s.is_empty()).map(decode).collect();
    let mut q = Query {
        deps: false,
        reveal: false,
        after: None,
        limit: None,
        ids: vec![],
        filters: vec![],
        backlinks: false,
        aggregate: false,
        text: false,
    };
    for s in segs {
        if s == "deps=1" {
            q.deps = true;
        } else if s == "backlinks=1" {
            q.backlinks = true;
        } else if s == "quarantined=1" {
            q.reveal = true;
        } else if let Some(v) = s.strip_prefix("after=") {
            q.after = v.parse().ok();
        } else if let Some(v) = s.strip_prefix("limit=") {
            q.limit = v.parse().ok();
        } else if let Some(v) = s.strip_prefix("id=") {
            q.ids.extend(v.split(',').filter(|x| !x.is_empty()).map(String::from));
        } else if is_text_term(&s) {
            // A `.`-token with no operator is, in TS parseQuery, a TEXT term
            // (its preds() returns null), not a filter. It never reaches
            // `query::parse` — that would 400 — and instead flags the query
            // as carrying unranked text: the bridge answers the empty set.
            q.text = true;
        } else {
            // An aggregate PROJECTION answers a value, not rows. Exactly the
            // three spellings, so a `.canvas!` presence filter (also `!`-tailed)
            // is never mistaken for one.
            if s == ".count!" || s.starts_with(".distinct=") || s.starts_with(".tally=") {
                q.aggregate = true;
            }
            q.filters.push(s);
        }
    }
    q
}

// TS parseQuery routes a `.`-token to preds(): a token carrying one of the
// operators (`!= ~= <= >= < > = !`) is a filter (parse/validate, may 400);
// one with NONE is an opless dot-word whose preds() returns null — a TEXT
// term. Mirror that decision by the presence of an operator-introducing char
// after the leading dot. (A bare word is likewise text in TS, but the kernel's
// `parse()` reads it as a KIND, so only dot-tokens are screened here.)
fn is_text_term(seg: &str) -> bool {
    seg.starts_with('.') && seg.len() > 1 && !seg[1..].contains(['=', '!', '<', '>', '~'])
}

// The derived-kind screen as PREDS. `.kind=K` means kindOf(comps) == K — K
// present AND every EARLIER kindOrder comp absent (TS `kindPreds`). The kind's
// own base table already guarantees K present, so the screen is just the
// earlier-comps-absent half, one absence pred each. Expressing it as preds (not
// a post-hoc JS filter) is what lets the windowed path screen the derived kind
// IN SQL, before its LIMIT: otherwise a row an earlier kind reclaims (a `board`
// comp worn by a project) could fill the newest-N page and then be screened,
// under-filling it. Absence is op "=" with an empty value here — the kernel's
// presence/absence convention, which `candidates::compile` and `query::matches`
// both read the same way (op "" is PRESENCE there, not absence).
fn kind_screen(kind: &str) -> Vec<query::Pred> {
    let order = &vocab().kind_order;
    let Some(i) = order.iter().position(|k| k == kind) else {
        return vec![];
    };
    order[..i]
        .iter()
        .map(|c| query::Pred {
            comp: c.clone(),
            prop: String::new(),
            op: "=".into(),
            value: String::new(),
            ..Default::default()
        })
        .collect()
}

// evalGraph's `cut`: `after` keeps rows below that num; an explicit `limit`
// keeps the NEWEST `limit` by num and returns them in num order. Input is
// already num-ascending (rows_of_kind order), so the no-limit path is identity.
fn cut(mut rows: Vec<Row>, after: Option<i64>, limit: Option<i64>) -> Vec<Row> {
    if let Some(a) = after {
        rows.retain(|r| r.num.unwrap_or(0) < a);
    }
    if let Some(l) = limit {
        let l = l.max(0) as usize;
        if rows.len() > l {
            rows.sort_by_key(|a| std::cmp::Reverse(a.num.unwrap_or(0)));
            rows.truncate(l);
            rows.sort_by_key(|a| a.num.unwrap_or(0));
        }
    }
    rows
}

// Attach the optional layers to each hit when asked: `deps` are the hit's own
// incident edges (one keyed read per hit, screened the way the route's deps
// layer screens them); `backlinks` are who points AT the hit (built once for
// the whole set below). Both are keyed off the hit, so a one-entity question
// costs one entity.
fn layers(store: &Store, rows: Vec<Row>, deps: bool, backs: bool, reveal: bool) -> Value {
    let back = if backs { backlinks_of(store, &rows, reveal) } else { Default::default() };
    Value::Array(
        rows.iter()
            .map(|r| {
                let d = deps.then(|| crate::deps::deps_of(store, &r.eid));
                let b = backs.then(|| back.get(&r.eid).cloned().unwrap_or_default());
                hit_with_layers(r, d, b)
            })
            .collect(),
    )
}

// Is an entity quarantined? The source screen the backlinks layer applies —
// `refsOf(...).filter(!eager(from).quarantined)` in the route.
fn quarantined(store: &Store, eid: &str) -> bool {
    if !store.has_table("quarantined") {
        return false;
    }
    store
        .conn
        .query_row(
            "select 1 from quarantined t join entity e on e.id = t.entity \
             where e.eid = ?1 limit 1",
            [eid],
            |r| r.get::<_, i64>(0),
        )
        .is_ok()
}

// The `backlinks=1` layer for a hit set: who points AT each hit, and how. The
// references are two streams concatenated exactly as the route builds them
// (db.ts): first `refsOf` — every typed {eid} column pointing at a hit, source
// screened for quarantine — then the incident dep EDGES whose CHILD is a hit
// (`from = parent`, `via = the edge type`), which `deps_of` already screens and
// which carry the synthetic persona `reads` edges too. Each reference is
// rendered `{ from: <id>, via, title }`, the source's human id and doc title
// read once from a bulk `rows_of`, grouped per target.
fn backlinks_of(store: &Store, hits: &[Row], reveal: bool) -> HashMap<String, Vec<Value>> {
    let eids: Vec<String> = hits.iter().map(|r| r.eid.clone()).collect();
    let mut refs: Vec<(String, String, String)> = store
        .refs_of(&eids)
        .into_iter()
        .filter(|(from, _, _)| reveal || !quarantined(store, from))
        .collect();
    // A dep edge is a reference like any other; its verb IS the `via`. Keep the
    // ones whose child is a hit, so the edge lands as a backlink ON the child.
    for r in hits {
        for d in crate::deps::deps_of(store, &r.eid) {
            if d.child == r.eid {
                refs.push((d.parent.clone(), d.type_.clone(), d.child.clone()));
            }
        }
    }
    // Resolve each distinct source once — its human id and doc title ride along
    // because a backlink is READ, not chased.
    let froms: Vec<String> =
        refs.iter().map(|(f, _, _)| f.clone()).collect::<HashSet<_>>().into_iter().collect();
    let named: HashMap<String, Row> =
        store.rows_of(&froms).into_iter().map(|r| (r.eid.clone(), r)).collect();
    let mut back: HashMap<String, Vec<Value>> = HashMap::new();
    for (from, via, to) in &refs {
        let Some(r) = named.get(from) else { continue };
        let title = r
            .comps
            .get("doc")
            .and_then(|d| d.get("title"))
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();
        let mut o = Map::new();
        o.insert("from".into(), Value::from(vocab().id_of(&r.kind, &r.eid, r.num)));
        o.insert("via".into(), Value::from(via.as_str()));
        o.insert("title".into(), Value::from(title));
        back.entry(to.clone()).or_default().push(Value::Object(o));
    }
    back
}

// The aggregate answer (server.ts): a `.count!` is one number under `count`; a
// `.distinct=` is the sorted keys; a `.tally=` is the value→count map, keys
// sorted. Reuses the kernel's ONE `eval_agg` (subquery.rs) — never a second
// evaluator — over the same filter LINE the route joins (`segs.join('&')`).
fn aggregate(store: &Store, filters: &[String]) -> Result<Value, String> {
    let parsed = parse_query_line(&filters.join("&"))?;
    let op = parsed.agg.as_ref().ok_or("not an aggregate query")?.op.clone();
    let counts = subquery::eval_agg(store, &parsed)?;
    let mut out = Map::new();
    match op.as_str() {
        "count" => {
            let n = counts.first().map(|(_, n)| *n).unwrap_or(0);
            out.insert("count".into(), Value::from(n));
        }
        "distinct" => {
            out.insert(
                "distinct".into(),
                Value::Array(counts.iter().map(|(k, _)| Value::from(k.as_str())).collect()),
            );
        }
        _ => {
            // tally: keys already ascending (BTreeMap), preserve_order keeps it.
            let mut t = Map::new();
            for (k, n) in &counts {
                t.insert(k.clone(), Value::from(*n));
            }
            out.insert("tally".into(), Value::Object(t));
        }
    }
    Ok(Value::Object(out))
}

// The answer, or an Err whose String is the 400 body (a malformed filter is the
// typist's news, exactly as the route treats it).
pub fn answer(store: &Store, raw: &str) -> Result<Value, String> {
    let q = parse_query(raw);

    // An aggregate PROJECTION answers a value, not a row set — rows, layers and
    // id= addressing don't apply (server.ts checks it first). It reuses the
    // kernel's eval_agg over the filter line.
    if q.aggregate {
        return aggregate(store, &q.filters);
    }

    // id= FETCHES by address; a remaining filter only screens.
    if !q.ids.is_empty() {
        let mut preds = if q.filters.is_empty() {
            vec![]
        } else {
            let (_, p) = query::parse(&q.filters)?;
            p
        };
        query::resolve_values(store, &mut preds);
        let mut rows: Vec<Row> = q
            .ids
            .iter()
            .filter_map(|id| store.resolve_id(id))
            .filter_map(|eid| store.row(&eid)) // store.row screens quarantine + tombstone
            .filter(|r| q.reveal || visible(r))
            .filter(|r| query::matches(r, &preds))
            .collect();
        rows.sort_by_key(|a| a.num.unwrap_or(0));
        // Distinct by eid: id= may name the same entity twice, and the route's
        // Set dedups before eager().
        rows.dedup_by(|a, b| a.eid == b.eid);
        if q.text {
            return Ok(Value::Array(vec![]));
        }
        return Ok(layers(store, rows, q.deps, q.backlinks, q.reveal));
    }

    // The filter pipeline. parse() names the kind (default task) and the preds
    // — and validates every value, so an out-of-enum filter 400s here even when
    // a text term rides alongside (TS parses each segment before answering).
    let (kind, mut preds) = query::parse(&q.filters)?;
    // A bare TEXT term the bridge cannot FTS-rank → the empty set (200), after
    // the filters above have had their chance to 400 (see module note).
    if q.text {
        return Ok(Value::Array(vec![]));
    }
    query::resolve_values(store, &mut preds);
    // rows_of_kind is candidate membership — every wearer of the kind's comp.
    // But `.kind=K` in the route means DERIVED kind == K (kindOf), so an entity
    // wearing a board comp whose derived kind is `project` (P-19) is NOT a board
    // to the route. Screen on derived kind exactly when the caller NAMED a kind
    // (`.kind=…` or a bare kind word); a defaulted kind never adds that screen,
    // so `.status=open` alone spans every kind that wears the column, as it does
    // on the route.
    let named_kind =
        q.filters.iter().any(|f| f.starts_with(".kind=") || f == ".kind" || !f.starts_with('.'));
    // The pure-limit HOT PATH: an explicit `limit` lets the kernel push the
    // newest-N window into SQL (`rows_window`), materializing at most `limit`
    // rows instead of bulk-loading the whole kind and cutting in Rust — flat
    // 0.14ms where the bulk read grows with kind size (T-22758). The window
    // already screens quarantine and applies the after/limit cut in the
    // statement; folding the derived-kind screen in as absence preds screens it
    // there too, so the SQL LIMIT rides a fully-screened order. Byte-identical
    // to the bulk-cut path below — parity.rs holds the line.
    if let Some(limit) = q.limit {
        if named_kind {
            preds.extend(kind_screen(&kind));
        }
        let rows = store.rows_window(&kind, &preds, q.after, Some(limit), q.reveal);
        return Ok(layers(store, rows, q.deps, q.backlinks, q.reveal));
    }
    let rows = store.rows_matching(&kind, &preds, q.reveal)?;
    // rows_of_kind does not screen quarantine (a listing screens one level up);
    // the route's default screen is a `.quarantined=` absent pred, so apply it
    // here unless revealed.
    let rows: Vec<Row> = rows
        .into_iter()
        .filter(|r| q.reveal || visible(r))
        .filter(|r| !named_kind || r.kind == kind)
        .collect();
    let rows = cut(rows, q.after, q.limit);
    Ok(layers(store, rows, q.deps, q.backlinks, q.reveal))
}
