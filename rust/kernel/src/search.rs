// FTS search, ported from db.ts search(): user words quoted into prefix
// terms (AND), bm25 blended with recency, snippets marked \x01…\x02, the
// quarantine screens, comment hits aimed at their target, retirement sinking
// hits to the tail. The PoC accepts TEXT terms only — a dot-filter mixed
// into the line is refused, not half-applied.

use crate::store::Store;
use crate::vocab::vocab;
use rusqlite::OptionalExtension;

#[derive(Debug, Clone)]
pub struct Hit {
    pub eid: String,
    pub num: Option<i64>,
    pub kind: String,
    pub title: String,
    pub snip: String,
    pub open: String,
    pub open_id: Option<String>,
    pub retired: bool,
}

pub fn search(store: &Store, q: &str, limit: usize) -> Result<Vec<Hit>, String> {
    if q.split_whitespace().any(|w| w.starts_with('.')) {
        return Err(
            "dot-filters in search are not ported in the Rust PoC — \
             text terms only"
                .into(),
        );
    }
    let match_q = q
        .split_whitespace()
        .map(|w| w.trim_end_matches('*').replace('"', ""))
        .filter(|w| !w.is_empty())
        .map(|w| format!("\"{w}\"*"))
        .collect::<Vec<_>>()
        .join(" ");
    if match_q.is_empty() {
        return Ok(vec![]);
    }
    let sql = "
      select e.eid, d.title,
        snippet(doc_fts, 1, char(1), char(2), '…', 10) as snip,
        e.num
      from doc_fts
      join doc d on d.rowid = doc_fts.rowid
      join entity e on e.id = d.entity
      left join updated up on up.entity = e.id
      left join created cr on cr.entity = e.id
      where doc_fts match ?1
        and not exists (select 1 from quarantined qq where qq.entity = e.id)
        and not exists (
          select 1 from comment c join quarantined q2 on q2.entity = c.target
          where c.entity = e.id
        )
      order by bm25(doc_fts, 8.0, 1.0)
        - 2.0 / (1 + julianday('now') - julianday(coalesce(up.at, cr.at)))
      limit ?2";
    let mut st = store.conn.prepare(sql).map_err(|e| e.to_string())?;
    let base: Vec<(String, String, String, Option<i64>)> = st
        .query_map(rusqlite::params![match_q, limit as i64], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect();
    let v = vocab();
    let mut hits: Vec<Hit> = base
        .into_iter()
        .map(|(eid, title, snip, num)| {
            let kind = v.kind_of(&|k| {
                store.has_table(k)
                    && store
                        .conn
                        .query_row(
                            &format!(
                                "select 1 from \"{k}\" t join entity e \
                                 on e.id = t.entity where e.eid = ?1"
                            ),
                            [&eid],
                            |r| r.get::<_, i64>(0),
                        )
                        .optional()
                        .ok()
                        .flatten()
                        .is_some()
            });
            // a comment hit opens its target and wears the target's title
            let aim: Option<(String, Option<String>, Option<i64>, String)> =
                store
                    .conn
                    .query_row(
                        "select te.eid, td.title, te.num, '' from comment c \
                         join entity ce on ce.id = c.entity \
                         join entity te on te.id = c.target \
                         left join doc td on td.entity = c.target \
                         where ce.eid = ?1",
                        [&eid],
                        |r| {
                            Ok((
                                r.get(0)?,
                                r.get(1)?,
                                r.get(2)?,
                                r.get::<_, String>(3)?,
                            ))
                        },
                    )
                    .optional()
                    .ok()
                    .flatten();
            let retired: bool = store
                .conn
                .query_row(
                    "select 1 from project p \
                     join archived a on a.entity = p.entity \
                     left join task t on t.entity = \
                       (select id from entity where eid = ?1) \
                     where p.entity in \
                       ((select id from entity where eid = ?1), t.project)",
                    [&eid],
                    |r| r.get::<_, i64>(0),
                )
                .optional()
                .ok()
                .flatten()
                .is_some();
            let (open, open_id, title) = match &aim {
                Some((teid, ttitle, tnum, _)) => {
                    let tkind = store
                        .row(teid)
                        .map(|r| r.kind)
                        .unwrap_or_else(|| "entity".into());
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
