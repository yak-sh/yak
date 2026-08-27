// The read surface answered over the wire: the same Graph the sqlite Store
// implements, served by the running graph server's EXISTING JSON routes
// (/query, /search) — no new endpoint, no framing of our own. This is what
// lets task-rs work on a box with no graph file (T-22576, D-22530).
//
// Every route here is one the TS client already speaks, so the two clients
// cannot drift:
//
//   GET /query?<dot-params>        rows, comps nested, refs projected to eids
//   GET /query?id=<id[,id…]>       resolve/fetch by human id, uuid or slug
//   GET /query?id=<eid>&deps=1     the row plus the edges touching it
//   GET /query?.comment.target=…   the comments aimed at an entity
//   GET /search?q=…&limit=N        FTS hits, \x01…\x02 marks intact
//
// Parity note — the wire spells an absent column `null`, while the file
// simply has no key (store.rs skips a NULL). `comps()` drops nulls on the way
// in, so `.assignee=` (the absence test) means the same thing through both
// doors; without that, a null would compare as the string "null" and a filter
// would answer differently depending on where it read.

use crate::model::{Dep, Graph, Hit, Row, Source};
use crate::vocab::vocab;
use serde_json::{Map, Value};

pub struct Remote {
    host: String,
    agent: ureq::Agent,
}

// /query takes its filters as WHOLE segments: the route splits the query
// string on '&' and decodeURIComponent's each piece before parsing it
// (server.ts). So a filter is encoded entire — operators included — rather
// than value-only. `.priority<=1` sent with a bare '<' is not a legal URI and
// a strict client refuses to send it at all; curl's tolerance is what made
// that look like it worked. Everything comes back through one decode, so
// encoding the whole segment is both safe and exact.
fn seg(s: &str) -> String {
    enc(s)
}

// Percent-encode a VALUE for a normal query parameter (/search reads its `q`
// through searchParams, not the segment path above). The reserved set is
// deliberately wide — a filter may carry anything a human typed.
fn enc(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

impl Remote {
    // `host` is the TS client's spelling: host:port, no scheme (client.ts
    // host()). Kept verbatim so TASKS_HOST means one thing fleet-wide.
    pub fn new(host: &str) -> Remote {
        Remote { host: host.to_string(), agent: ureq::agent() }
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    fn get(&self, path: &str) -> Result<Value, String> {
        let url = format!("http://{}{}", self.host, path);
        let mut res = self.agent.get(&url).call().map_err(|e| format!("{}: {e}", self.host))?;
        // A 4xx carries the typist's news (a bad filter) as plain text; the
        // status is already folded into the error by ureq, so only the body
        // needs lifting here. Parsed with serde_json rather than ureq's own
        // json feature — one json implementation in this crate, not two.
        let body = res.body_mut().read_to_string().map_err(|e| format!("{}: {e}", self.host))?;
        serde_json::from_str(&body)
            .map_err(|e| format!("{}: bad json — {e} — {}", self.host, body.trim()))
    }

    // GET /query?<params> → rows. `params` is a ready query string.
    fn query(&self, params: &str) -> Result<Vec<Row>, String> {
        let v = self.get(&format!("/query?{params}"))?;
        let Some(arr) = v.as_array() else {
            return Err("query: expected a json array".into());
        };
        Ok(arr.iter().filter_map(row_of).collect())
    }
}

// One wire object → a Row, shaped exactly as the file's reader shapes it:
// nulls dropped, `kind`/`deps` lifted out of the comp bag, and kind DERIVED
// from the comps this binary knows rather than trusted from the wire — so a
// server carrying a comp we have never heard of names the row the same way a
// local read would.
fn row_of(v: &Value) -> Option<Row> {
    let obj = v.as_object()?;
    let mut comps = comps(obj);
    // Idempotent here — the route already merged — but applied anyway so the
    // two doors run one projection, not two conventions.
    crate::model::project_session(&mut comps);
    let spine = comps.get("entity")?.as_object()?;
    let eid = spine.get("eid")?.as_str()?.to_string();
    let num = spine.get("num").and_then(|n| n.as_i64());
    let kind = vocab().kind_of(&|k| comps.contains_key(k));
    Some(Row { eid, num, kind, comps })
}

// The comp bag: every key but the route's own decorations, with null columns
// dropped so absence means the same through both doors.
fn comps(obj: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    for (k, val) in obj {
        if k == "kind" || k == "deps" {
            continue;
        }
        let Some(bag) = val.as_object() else { continue };
        let mut m = Map::new();
        for (col, cv) in bag {
            if !cv.is_null() {
                m.insert(col.clone(), cv.clone());
            }
        }
        out.insert(k.clone(), Value::Object(m));
    }
    out
}

impl Source for Remote {
    // The server owns the id grammar (prefixed num, bare num, uuid, short
    // prefix, alias slug) — asking it is how the remote reader inherits every
    // spelling without porting the table.
    fn resolve_id(&self, id: &str) -> Option<String> {
        let rows = self.query(&seg(&format!("id={id}"))).ok()?;
        rows.into_iter().next().map(|r| r.eid)
    }
}

impl Graph for Remote {
    fn row(&self, eid: &str) -> Option<Row> {
        self.query(&seg(&format!("id={eid}"))).ok()?.into_iter().next()
    }

    // `id=` takes a comma list, so a whole neighborhood costs one request.
    // Chunked at 50 the way client.ts batches it — a URL is not unbounded,
    // and the route pages nothing here.
    fn rows_of(&self, eids: &[String]) -> Vec<Row> {
        let mut out = vec![];
        for chunk in eids.chunks(50) {
            let ask = seg(&format!("id={}", chunk.join(",")));
            match self.query(&ask) {
                Ok(rows) => out.extend(rows),
                // warm() is a speed pass, never correctness: a chunk that
                // fails simply stays uncached and resolves through row().
                Err(_) => continue,
            }
        }
        out
    }

    fn rows_of_kind(&self, kind: &str) -> Result<Vec<Row>, String> {
        self.query(&seg(&format!(".kind={kind}")))
    }

    // The filters ride ALONG, so the query runs where the rows are and the
    // response carries the hits instead of the board. The predicates are
    // spelled back in the grammar they were parsed from — always the explicit
    // `.comp.prop` form, since bare-column routing is the parser's own choice
    // and re-routing it at the far end could land on a different owner.
    //
    // The local test runs too, over what comes back. Belt and braces on
    // purpose: the server narrows, and `matches` confirms in the SAME code
    // the file door uses, so any grammar the two spell differently shows up
    // as a missing row in the parity diff rather than a quiet difference in
    // what a filter means.
    fn rows_matching(
        &self,
        kind: &str,
        preds: &[crate::query::Pred],
        reveal: bool,
    ) -> Result<Vec<Row>, String> {
        let mut parts = vec![format!(".kind={kind}")];
        for p in preds {
            parts.push(if p.op.is_empty() {
                format!(".{}!", p.comp)
            } else {
                format!(".{}.{}{}{}", p.comp, p.prop, p.op, p.value)
            });
        }
        // The route screens quarantined rows unless asked; the file hands
        // them over and lets the caller screen. Asking here is what makes a
        // revealed listing read the same through both doors.
        if reveal {
            parts.push("quarantined=1".into());
        }
        let qs = parts.iter().map(|s| seg(s)).collect::<Vec<_>>().join("&");
        Ok(self.query(&qs)?.into_iter().filter(|r| crate::query::matches(r, preds)).collect())
    }

    // deps=1 rides the row back; the route already orders the edges the way
    // the file does (db.ts depsOf: parent, type, ord, child), so the wire
    // order is KEPT — re-sorting here would drop `ord`, which no client can
    // see and which orders a parent's children.
    fn deps_of(&self, eid: &str) -> Vec<Dep> {
        let url = format!("/query?{}&{}", seg(&format!("id={eid}")), seg("deps=1"));
        let Ok(v) = self.get(&url) else {
            return vec![];
        };
        let Some(hit) = v.as_array().and_then(|a| a.first()) else {
            return vec![];
        };
        let Some(deps) = hit.get("deps").and_then(|d| d.as_array()) else {
            return vec![];
        };
        deps.iter()
            .filter_map(|d| {
                Some(Dep {
                    parent: d.get("parent")?.as_str()?.to_string(),
                    type_: d.get("type")?.as_str()?.to_string(),
                    child: d.get("child")?.as_str()?.to_string(),
                })
            })
            .collect()
    }

    // The file sorts these in sql (created.at, then num); the wire does not
    // promise an order, so the same sort is applied here rather than assumed.
    fn comments_on(&self, eid: &str) -> Vec<String> {
        let Ok(rows) = self.query(&seg(&format!(".comment.target={eid}"))) else {
            return vec![];
        };
        let mut born: Vec<(String, i64, String)> = rows
            .into_iter()
            .map(|r| {
                let at = r
                    .comps
                    .get("created")
                    .and_then(|c| c.get("at"))
                    .and_then(|a| a.as_str())
                    .unwrap_or("")
                    .to_string();
                (at, r.num.unwrap_or(0), r.eid)
            })
            .collect();
        born.sort();
        born.into_iter().map(|(_, _, eid)| eid).collect()
    }

    // /search answers the same shape search.rs builds. `retired` rides as an
    // optional flag (the route omits it when false) and the route has already
    // sunk retired hits to the tail, so the order stands as sent.
    fn search(&self, q: &str, limit: usize) -> Result<Vec<Hit>, String> {
        let v = self.get(&format!("/search?q={}&limit={limit}", enc(q)))?;
        let arr = v.as_array().ok_or("search: expected a json array")?;
        Ok(arr
            .iter()
            .filter_map(|h| {
                let eid = h.get("eid")?.as_str()?.to_string();
                let open = h.get("open").and_then(|o| o.as_str()).unwrap_or(&eid).to_string();
                Some(Hit {
                    num: h.get("num").and_then(|n| n.as_i64()),
                    kind: h.get("kind").and_then(|k| k.as_str()).unwrap_or("entity").to_string(),
                    title: h.get("title").and_then(|t| t.as_str()).unwrap_or("").to_string(),
                    title_hit: h
                        .get("title_hit")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string(),
                    snip: h.get("snip").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                    open_id: h.get("open_id").and_then(|o| o.as_str()).map(String::from),
                    retired: h.get("retired").and_then(|r| r.as_bool()).unwrap_or(false),
                    open,
                    eid,
                })
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_null_column_reads_as_absent() {
        // The file has no key for a NULL column; the wire spells it null. A
        // remote row must agree with the file, or `.assignee=` diverges.
        let v: Value = serde_json::from_str(
            r#"{"kind":"task","entity":{"eid":"e","num":3},
                "task":{"status":"open","assignee":null}}"#,
        )
        .unwrap();
        let r = row_of(&v).unwrap();
        let t = r.comps.get("task").unwrap().as_object().unwrap();
        assert!(t.contains_key("status"));
        assert!(!t.contains_key("assignee"));
        assert_eq!(r.num, Some(3));
    }

    #[test]
    fn kind_is_derived_not_trusted() {
        // design+task derives to design (kindOrder), whatever the wire says.
        let v: Value = serde_json::from_str(
            r#"{"kind":"task","entity":{"eid":"e"},
                "task":{"status":"open"},"design":{}}"#,
        )
        .unwrap();
        assert_eq!(row_of(&v).unwrap().kind, "design");
    }

    #[test]
    fn values_are_encoded() {
        assert_eq!(enc("a b&c=d"), "a%20b%26c%3Dd");
        assert_eq!(enc("P-19"), "P-19");
    }

    #[test]
    fn a_filter_segment_encodes_its_operator() {
        // '<' is not legal in a URI, so a bare one is never sent — the whole
        // segment is encoded and the route decodes it back before parsing.
        // This is the bug that read as "(no matches)" over the wire.
        let s = seg(".task.priority<=1");
        assert!(!s.contains('<'));
        assert_eq!(s, ".task.priority%3C%3D1");
        // …and a value carrying the separator still survives the round trip.
        assert!(!seg(".doc.title~=a&b").contains('&'));
    }
}
