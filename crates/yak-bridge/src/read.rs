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
// DEFERRED to a later rung (documented divergences, filed as follow-up): the
// aggregate projections (`.count!`/`.distinct`/`.tally`), `backlinks=1`, hot/
// text ranking, the lazy entry partition, and the path-hop / time grammar the
// kernel's `query::parse` refuses. A query using one of those is answered by
// the core pipeline (or a 400 from `parse`), NOT by emulating the Deno path —
// so the harness screens them out and rung 2 closes them.

use crate::emit::hit_with_layers;
use serde_json::Value;
use yak_kernel::store::visible;
use yak_kernel::{query, Graph, Row, Store};

pub struct Query {
    pub deps: bool,
    pub reveal: bool,
    pub after: Option<i64>,
    pub limit: Option<i64>,
    pub ids: Vec<String>,
    pub filters: Vec<String>, // the remaining filter segments, as parse() args
    pub backlinks: bool,      // parsed, but deferred — see module note
    pub aggregate: bool,      // a `.count!`/`.distinct`/`.tally` line — deferred
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
    let segs: Vec<String> =
        raw.split('&').filter(|s| !s.is_empty()).map(decode).collect();
    let mut q = Query {
        deps: false,
        reveal: false,
        after: None,
        limit: None,
        ids: vec![],
        filters: vec![],
        backlinks: false,
        aggregate: false,
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
        } else {
            // An aggregate projection answers a value, not rows — flag it so the
            // door can 400/defer rather than mislead with a row set.
            if s.ends_with("!") || s.contains(".distinct=") || s.contains(".tally=")
            {
                q.aggregate = true;
            }
            q.filters.push(s);
        }
    }
    q
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
            rows.sort_by(|a, b| b.num.unwrap_or(0).cmp(&a.num.unwrap_or(0)));
            rows.truncate(l);
            rows.sort_by(|a, b| a.num.unwrap_or(0).cmp(&b.num.unwrap_or(0)));
        }
    }
    rows
}

// Attach the deps layer to each hit when asked — one keyed read per hit, both
// endpoints screened the way the route's deps layer screens them.
fn layers(store: &Store, rows: Vec<Row>, deps: bool) -> Value {
    Value::Array(
        rows.iter()
            .map(|r| {
                let d = deps.then(|| crate::deps::deps_of(store, &r.eid));
                hit_with_layers(r, d)
            })
            .collect(),
    )
}

// The answer, or an Err whose String is the 400 body (a malformed filter is the
// typist's news, exactly as the route treats it).
pub fn answer(store: &Store, raw: &str) -> Result<Value, String> {
    let q = parse_query(raw);

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
        rows.sort_by(|a, b| a.num.unwrap_or(0).cmp(&b.num.unwrap_or(0)));
        // Distinct by eid: id= may name the same entity twice, and the route's
        // Set dedups before eager().
        rows.dedup_by(|a, b| a.eid == b.eid);
        return Ok(layers(store, rows, q.deps));
    }

    // The filter pipeline. parse() names the kind (default task) and the preds.
    let (kind, mut preds) = query::parse(&q.filters)?;
    query::resolve_values(store, &mut preds);
    let rows = store.rows_matching(&kind, &preds, q.reveal)?;
    // rows_of_kind is candidate membership — every wearer of the kind's comp.
    // But `.kind=K` in the route means DERIVED kind == K (kindOf), so an entity
    // wearing a board comp whose derived kind is `project` (P-19) is NOT a board
    // to the route. Screen on derived kind exactly when the caller NAMED a kind
    // (`.kind=…` or a bare kind word); a defaulted kind never adds that screen,
    // so `.status=open` alone spans every kind that wears the column, as it does
    // on the route.
    let named_kind = q.filters.iter().any(|f| {
        f.starts_with(".kind=") || f == ".kind" || !f.starts_with('.')
    });
    // rows_of_kind does not screen quarantine (a listing screens one level up);
    // the route's default screen is a `.quarantined=` absent pred, so apply it
    // here unless revealed.
    let rows: Vec<Row> = rows
        .into_iter()
        .filter(|r| q.reveal || visible(r))
        .filter(|r| !named_kind || r.kind == kind)
        .collect();
    let rows = cut(rows, q.after, q.limit);
    Ok(layers(store, rows, q.deps))
}
