// FTS search, ported from db.ts search(): user words quoted into prefix
// terms (AND), bm25 blended with recency, snippets marked \x01…\x02, the
// quarantine screens, comment hits aimed at their target, retirement sinking
// hits to the tail. The PoC accepts TEXT terms only — a dot-filter mixed
// into the line is refused, not half-applied.

pub use crate::model::Hit;
use crate::profiling;
use crate::query;
use crate::store::Store;
use crate::vocab::vocab;
use rusqlite::OptionalExtension;

// The search line's tokens, double-quote aware: a quoted phrase stays one
// term (query.ts keeps "two words" a single text pred).
fn tokens(q: &str) -> Vec<String> {
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

pub fn search(store: &Store, q: &str, limit: usize) -> Result<Vec<Hit>, String> {
    // The search line is board grammar: bare words are TEXT terms, dot
    // tokens are the same filter preds every list door takes, screening
    // the ranked hits before the cap (db.ts search()).
    let mut words: Vec<String> = vec![];
    let mut kind_screen: Option<String> = None;
    let mut filters: Vec<query::Pred> = vec![];
    for tok in tokens(q) {
        if tok.starts_with('.') && tok.len() > 1 {
            match query::dot_token(&tok)? {
                query::Dot::Kind(k) => kind_screen = Some(k),
                query::Dot::P(p) => filters.push(p),
            }
        } else {
            words.push(tok);
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
    let base: Vec<(String, String, String, Option<i64>)> = if !match_q.is_empty() {
        let sql = format!(
            "
      select e.eid, d.title,
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
        let map =
            |r: &rusqlite::Row<'_>| -> rusqlite::Result<(String, String, String, Option<i64>)> {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            };
        let it = if screened {
            st.query_map(rusqlite::params![match_q], map)
        } else {
            st.query_map(rusqlite::params![match_q, limit as i64], map)
        };
        let got: Vec<(String, String, String, Option<i64>)> =
            it.map_err(|e| e.to_string())?.filter_map(|x| x.ok()).collect();
        t.done(got.len());
        got
    } else {
        // filters with no text: every visible doc, newest touch first
        let sql = format!(
            "
      select e.eid, d.title, d.title as snip, e.num
      from doc d
      join entity e on e.id = d.entity
      left join updated up on up.entity = e.id
      left join created cr on cr.entity = e.id
      where 1 {quarantine}
      order by coalesce(up.at, cr.at) desc"
        );
        let t = profiling::sql(&sql);
        let mut st = store.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let got: Vec<(String, String, String, Option<i64>)> = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|x| x.ok())
            .collect();
        t.done(got.len());
        got
    };
    // Screen ranked hits against the filters over full rows, then cap.
    let rows_cache = crate::store::Rows::new(store);
    let now = query::now_ms();
    let base: Vec<(String, String, String, Option<i64>)> = if screened {
        base.into_iter()
            .filter(|(eid, _, _, _)| {
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
    let base: Vec<(String, String, String, Option<i64>)> = match &addressed {
        Some(direct) => {
            let head = store.conn.query_row(
                "select e.eid, d.title, '', e.num from doc d \
                 join entity e on e.id = d.entity where e.eid = ?1 \
                 and not exists \
                   (select 1 from quarantined qq where qq.entity = e.id) \
                 and not exists (select 1 from comment c \
                   join quarantined q2 on q2.entity = c.target \
                   where c.entity = e.id)",
                [direct],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            );
            match head.optional().map_err(|e| e.to_string())? {
                Some(h) => {
                    let mut out = vec![h];
                    out.extend(base.into_iter().filter(|(eid, _, _, _)| eid != direct));
                    out.into_iter().take(limit).collect()
                }
                None => base,
            }
        }
        None => base,
    };
    let v = vocab();
    let mut hits: Vec<Hit> = base
        .into_iter()
        .map(|(eid, title, snip, num)| {
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
            let sunk_sql = "select 1 from project p \
                            join archived a on a.entity = p.entity \
                            left join task t on t.entity = \
                              (select id from entity where eid = ?1) \
                            where p.entity in \
                              ((select id from entity where eid = ?1), \
                               t.project)";
            let t = profiling::sql(sunk_sql);
            let retired: bool = store
                .conn
                .query_row(sunk_sql, [&eid], |r| r.get::<_, i64>(0))
                .optional()
                .ok()
                .flatten()
                .is_some();
            t.done(retired as usize);
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
            Hit { eid, num, kind, title, snip, open, open_id, retired }
        })
        .collect();
    hits.sort_by_key(|h| h.retired);
    Ok(hits)
}
