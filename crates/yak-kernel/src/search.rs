// FTS search, ported from db.ts search(): user words quoted into prefix
// terms (AND), bm25 blended with recency, snippets marked \x01…\x02, the
// quarantine screens, comment hits aimed at their target, retirement sinking
// hits to the tail. The PoC accepts TEXT terms only — a dot-filter mixed
// into the line is refused, not half-applied.

use crate::candidates;
pub use crate::model::Hit;
use crate::profiling;
use crate::query;
use crate::store::Store;
use crate::vocab::vocab;
use rusqlite::OptionalExtension;

// kindPreds (query.ts), in the kernel's op convention: the derived kind K is K
// PRESENT and every EARLIER kindOrder comp ABSENT (op "" is presence here, op
// "=" absence). db.ts search compiles this into the filters-only SQL so the cap
// lands AFTER the kind screen; the kernel must do the same, or a whole-table
// scan feeds a Rust kind-check the SQL cap could not bound.
fn kind_preds(kind: &str) -> Vec<query::Pred> {
    let order = &vocab().kind_order;
    let mut out = vec![query::Pred { comp: kind.into(), ..Default::default() }];
    if let Some(i) = order.iter().position(|k| k == kind) {
        for earlier in &order[..i] {
            out.push(query::Pred { comp: earlier.clone(), op: "=".into(), ..Default::default() });
        }
    }
    out
}

// A search line is board grammar (query.ts parseQuery): `&` separates SEGMENTS
// (quote-aware, `/(?:"[^"]*"|[^&])+/g`), and a segment that starts with `.` and
// carries NO interior whitespace-then-dot is ONE predicate whose value may hold
// spaces (`.title~=two words`) — so `.kind=task port` is a single `.kind=` pred
// (an invalid kind, a 400), NOT a kind filter plus a text term. Only a segment
// with an interior `\s.` (or no leading dot) is whitespace-tokenized.
fn segments(q: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut quoted = false;
    for c in q.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                cur.push(c);
            }
            '&' if !quoted => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

// `/\s\./` — a whitespace immediately followed by a dot, the tell that a segment
// carries more than one token and must be whitespace-split.
fn has_ws_dot(s: &str) -> bool {
    let cs: Vec<char> = s.chars().collect();
    (1..cs.len()).any(|i| cs[i] == '.' && cs[i - 1].is_whitespace())
}

// Whitespace tokens within a segment, double-quote aware: a quoted phrase stays
// one term (query.ts keeps "two words" a single text pred).
fn ws_tokens(q: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut quoted = false;
    for c in q.chars() {
        match c {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

// A token → a filter, a kind, or None when it is an opless dot-WORD (`.env`) —
// which query.ts's preds() returns null for, and the caller reads as text. A
// dot-token that DOES carry an operator but is invalid (`.kind=task port`, a bad
// enum) still throws, the typist's 400.
fn try_pred(s: &str) -> Result<Option<query::Dot>, String> {
    if !s.starts_with('.') || s.len() < 2 {
        return Ok(None);
    }
    // The operator set query.ts preds() recognizes; without one, a dot-word is a
    // text term, not a filter (read.rs is_text_term, the /query door's twin).
    if !s[1..].contains(['=', '!', '<', '>', '~']) {
        return Ok(None);
    }
    query::dot_token(s).map(Some)
}

pub fn search(store: &Store, q: &str, limit: usize) -> Result<Vec<Hit>, String> {
    // The search line is board grammar: bare words are TEXT terms, dot
    // tokens are the same filter preds every list door takes, screening
    // the ranked hits before the cap (db.ts search()).
    let mut words: Vec<String> = vec![];
    let mut kind_screen: Option<String> = None;
    let mut filters: Vec<query::Pred> = vec![];
    let mut take = |dot: query::Dot| match dot {
        query::Dot::Kind(k) => kind_screen = Some(k),
        query::Dot::P(p) => filters.push(p),
    };
    for seg in segments(q) {
        let seg = seg.trim();
        if seg.is_empty() {
            continue;
        }
        // The single-pred segment arm: a leading-dot segment with no interior
        // `\s.` is one predicate (its value may hold spaces), UNLESS it is an
        // opless dot-word, which falls through to be read as text.
        if seg.starts_with('.') && !has_ws_dot(seg) {
            if let Some(dot) = try_pred(seg)? {
                take(dot);
                continue;
            }
        }
        for tok in ws_tokens(seg) {
            match try_pred(&tok)? {
                Some(dot) => take(dot),
                None => words.push(tok),
            }
        }
    }
    query::resolve_values(store, &mut filters);
    let screened = kind_screen.is_some() || !filters.is_empty();
    let match_q = words
        .iter()
        .map(|w| w.trim_end_matches('*').replace('"', ""))
        .filter(|w| !w.is_empty())
        .map(|w| format!("\"{w}\"*"))
        .collect::<Vec<_>>()
        .join(" ");
    if match_q.is_empty() && !screened {
        return Ok(vec![]);
    }
    // An address is identity, not prose: one lone term that resolves as an
    // id floats its entity to the head (db.ts `addressed`).
    let addressed = (words.len() == 1 && !screened).then(|| store.resolve_id(&words[0])).flatten();
    let quarantine = "
        and not exists (select 1 from quarantined qq where qq.entity = e.id)
        and not exists (
          select 1 from comment c join quarantined q2 on q2.entity = c.target
          where c.entity = e.id
        )";
    // With filters the cap moves AFTER the screen, so hidden hits cannot
    // displace visible ones; without them the SQL cap stands as before.
    type Base = (String, String, String, String, Option<i64>);
    let base: Vec<Base> = if !match_q.is_empty() {
        let sql = format!(
            "
      select e.eid, d.title,
        highlight(doc_fts, 0, char(1), char(2)) as title_hit,
        snippet(doc_fts, 1, char(1), char(2), '…', 10) as snip,
        e.num
      from doc_fts
      join doc d on d.rowid = doc_fts.rowid
      join entity e on e.id = d.entity
      left join updated up on up.entity = e.id
      left join created cr on cr.entity = e.id
      where doc_fts match ?1 {quarantine}
      order by bm25(doc_fts, 8.0, 1.0)
        - 2.0 / (1 + julianday('now') - julianday(coalesce(up.at, cr.at)))
      {}",
            if screened { "" } else { "limit ?2" }
        );
        let t = profiling::sql(&sql);
        let mut st = store.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let map = |r: &rusqlite::Row<'_>| -> rusqlite::Result<Base> {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        };
        let it = if screened {
            st.query_map(rusqlite::params![match_q], map)
        } else {
            st.query_map(rusqlite::params![match_q, limit as i64], map)
        };
        let got: Vec<Base> = it.map_err(|e| e.to_string())?.filter_map(|x| x.ok()).collect();
        t.done(got.len());
        got
    } else {
        // Filters with no text: the newest-touch window over the docs the
        // filter selects. db.ts search compiles the filter with where() (EXACT
        // or null) and, when it compiles, screens `and e.eid in (…)` and caps
        // `limit ?` IN SQL; the kernel mirrors that so SQLite — not a Rust
        // post-scan — orders and caps, which both matches Deno's tie-order at
        // the boundary AND spares the whole-table load (M-17862). The `, e.eid`
        // tiebreak makes the recency sort a TOTAL order so the tie among rows
        // sharing one `at` (9 projects on one migration stamp) is deterministic
        // across the two SQLite builds; db.ts carries the identical tiebreak.
        // A pred that DECLINES to compile (a time phrase) drops the whole screen
        // and the cap — exactly Deno's `built ? … : ''` — so the full set is
        // read and the Rust refine below cuts it, the rare slow path both share.
        let mut screen_preds = kind_screen.as_deref().map(kind_preds).unwrap_or_default();
        screen_preds.extend(filters.iter().cloned());
        let narrowed = candidates::compile(&screen_preds);
        let (sql, params): (String, Vec<rusqlite::types::Value>) = if narrowed.exact {
            (
                format!(
                    "
      select e.eid, d.title, d.title as title_hit, '' as snip, e.num
      from doc d
      join entity e on e.id = d.entity
      left join updated up on up.entity = e.id
      left join created cr on cr.entity = e.id{joins}
      where 1 {quarantine} and {cond}
      order by coalesce(up.at, cr.at) desc, e.eid
      limit ?",
                    joins = narrowed.joins,
                    cond = narrowed.cond
                ),
                {
                    let mut p = narrowed.params;
                    p.push(rusqlite::types::Value::Integer(limit as i64));
                    p
                },
            )
        } else {
            (
                format!(
                    "
      select e.eid, d.title, d.title as title_hit, '' as snip, e.num
      from doc d
      join entity e on e.id = d.entity
      left join updated up on up.entity = e.id
      left join created cr on cr.entity = e.id
      where 1 {quarantine}
      order by coalesce(up.at, cr.at) desc, e.eid"
                ),
                vec![],
            )
        };
        let t = profiling::sql(&sql);
        let mut st = store.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let got: Vec<Base> = st
            .query_map(rusqlite::params_from_iter(params), |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|x| x.ok())
            .collect();
        t.done(got.len());
        got
    };
    // Screen ranked hits against the filters over full rows, then cap.
    let rows_cache = crate::store::Rows::new(store);
    let now = query::now_ms();
    let base: Vec<Base> = if screened {
        base.into_iter()
            .filter(|(eid, ..)| {
                let Some(row) = rows_cache.get(eid) else { return false };
                if let Some(k) = &kind_screen {
                    if row.kind != *k {
                        return false;
                    }
                }
                query::matches_at(&row, &filters, now)
            })
            .take(limit)
            .collect()
    } else {
        base
    };
    let base: Vec<Base> = match &addressed {
        Some(direct) => {
            let head = store.conn.query_row(
                "select e.eid, d.title, d.title as title_hit, '' as snip, e.num from doc d \
                 join entity e on e.id = d.entity where e.eid = ?1 \
                 and not exists \
                   (select 1 from quarantined qq where qq.entity = e.id) \
                 and not exists (select 1 from comment c \
                   join quarantined q2 on q2.entity = c.target \
                   where c.entity = e.id)",
                [direct],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            );
            match head.optional().map_err(|e| e.to_string())? {
                Some(h) => {
                    let mut out = vec![h];
                    out.extend(base.into_iter().filter(|(eid, ..)| eid != direct));
                    out.into_iter().take(limit).collect()
                }
                None => base,
            }
        }
        None => base,
    };
    // Retirement sinks a hit that belongs to an archived project — it IS an
    // archived project, or its task points at one. The whole hit set is known
    // up front, so ONE query answers it for every hit at once; it was a
    // 3-way join run per hit, second only to the FTS query in the profile.
    let retired_set: std::collections::HashSet<String> = {
        let eids: Vec<&String> = base.iter().map(|(eid, ..)| eid).collect();
        if eids.is_empty() {
            Default::default()
        } else {
            let marks = vec!["?"; eids.len()].join(",");
            let sql = format!(
                "select e.eid from entity e \
                 left join task t on t.entity = e.id \
                 where e.eid in ({marks}) and ( \
                   e.id in (select p.entity from project p \
                              join archived a on a.entity = p.entity) \
                   or t.project in (select p.entity from project p \
                                      join archived a on a.entity = p.entity))"
            );
            let tm = profiling::sql(&sql);
            let set = store
                .conn
                .prepare(&sql)
                .and_then(|mut st| {
                    st.query_map(rusqlite::params_from_iter(eids.iter()), |r| r.get::<_, String>(0))
                        .map(|it| {
                            it.filter_map(|x| x.ok()).collect::<std::collections::HashSet<_>>()
                        })
                })
                .unwrap_or_default();
            tm.done(set.len());
            set
        }
    };
    let v = vocab();
    let mut hits: Vec<Hit> = base
        .into_iter()
        .map(|(eid, title, title_hit, snip, num)| {
            let kind = v.kind_of(&|k| {
                if !store.has_table(k) {
                    return false;
                }
                let sql = format!(
                    "select 1 from \"{k}\" t join entity e \
                     on e.id = t.entity where e.eid = ?1"
                );
                let t = profiling::sql(&sql);
                let hit = store
                    .conn
                    .query_row(&sql, [&eid], |r| r.get::<_, i64>(0))
                    .optional()
                    .ok()
                    .flatten();
                t.done(hit.is_some() as usize);
                hit.is_some()
            });
            // a comment hit opens its target and wears the target's title
            let aim_sql = "select te.eid, td.title, te.num, '' from comment c \
                           join entity ce on ce.id = c.entity \
                           join entity te on te.id = c.target \
                           left join doc td on td.entity = c.target \
                           where ce.eid = ?1";
            let t = profiling::sql(aim_sql);
            let aim: Option<(String, Option<String>, Option<i64>, String)> = store
                .conn
                .query_row(aim_sql, [&eid], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get::<_, String>(3)?))
                })
                .optional()
                .ok()
                .flatten();
            t.done(aim.is_some() as usize);
            let retired = retired_set.contains(&eid);
            let (open, open_id, title) = match &aim {
                Some((teid, ttitle, tnum, _)) => {
                    let tkind = store.row(teid).map(|r| r.kind).unwrap_or_else(|| "entity".into());
                    (
                        teid.clone(),
                        Some(v.id_of(&tkind, teid, *tnum)),
                        if title.is_empty() {
                            ttitle.clone().unwrap_or_default()
                        } else {
                            title.clone()
                        },
                    )
                }
                None => (eid.clone(), None, title.clone()),
            };
            Hit { eid, num, kind, title, title_hit, snip, open, open_id, retired }
        })
        .collect();
    hits.sort_by_key(|h| h.retired);
    Ok(hits)
}
