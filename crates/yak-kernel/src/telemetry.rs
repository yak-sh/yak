// The tool_call log, read directly (telemetry.ts recent()/stats()): newest
// first, repeated errors collapsed into counted cohorts, and the latency
// percentiles computed here with percentile_cont's linear interpolation so
// the numbers match the SQL the TS server runs.

use crate::store::Store;

#[derive(Debug, Clone)]
pub struct Log {
    pub ts: String,
    pub source: String,
    pub name: String,
    pub session_id: Option<String>,
    pub ok: bool,
    pub ms: Option<f64>,
    pub error: Option<String>,
    pub detail: Option<String>,
    pub count: Option<i64>,
    pub first: Option<String>,
}

pub struct Stat {
    pub source: String,
    pub name: String,
    pub n: i64,
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
}

fn err_class(error: &str) -> String {
    let head = error.lines().next().unwrap_or("");
    // the first token ending in Error/Exception, with [\w.$] characters
    let mut best: Option<(usize, usize)> = None;
    for marker in ["Error", "Exception"] {
        let mut from = 0;
        while let Some(i) = head[from..].find(marker) {
            let at = from + i;
            let end = at + marker.len();
            // word boundary after
            let after_ok = head[end..]
                .chars()
                .next()
                .map(|c| !(c.is_alphanumeric() || c == '_'))
                .unwrap_or(true);
            if after_ok {
                // extend left over [\w.$]
                let start = head[..at]
                    .rfind(|c: char| !(c.is_alphanumeric() || c == '_' || c == '.' || c == '$'))
                    .map(|i| i + 1)
                    .unwrap_or(0);
                if best.map(|(s, _)| start < s).unwrap_or(true) {
                    best = Some((start, end));
                }
            }
            from = end;
        }
    }
    best.map(|(s, e)| head[s..e].to_string()).unwrap_or_default()
}

fn frames(detail: Option<&str>) -> String {
    detail
        .unwrap_or("")
        .lines()
        .filter(|l| {
            l.split_whitespace().any(|w| w == "at")
                || l.contains(" at ")
                || l.starts_with("at ")
                || l.contains('@')
        })
        .take(5)
        .map(|l| strip_line_cols(l).trim().to_string())
        .collect::<Vec<_>>()
        .join("|")
}

// remove :NN:NN position suffixes anywhere in the line
fn strip_line_cols(l: &str) -> String {
    let mut out = String::new();
    let b = l.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b':' {
            let mut j = i + 1;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            if j > i + 1 && j < b.len() && b[j] == b':' {
                let mut k = j + 1;
                while k < b.len() && b[k].is_ascii_digit() {
                    k += 1;
                }
                if k > j + 1 {
                    i = k;
                    continue;
                }
            }
        }
        out.push(b[i] as char);
        i += 1;
    }
    out
}

fn fingerprint(r: &Log) -> String {
    let cls = err_class(r.error.as_deref().unwrap_or(""));
    let fr = frames(r.detail.as_deref());
    let body = if !cls.is_empty() || !fr.is_empty() {
        format!("{cls}\n{fr}")
    } else {
        r.error.as_deref().unwrap_or("").lines().next().unwrap_or("").to_string()
    };
    format!("{}\n{}\n{}", r.source, r.name, body)
}

fn cohort(rows: Vec<Log>) -> Vec<Log> {
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut out: Vec<Log> = vec![];
    for r in rows {
        if r.ok {
            out.push(r);
            continue;
        }
        let key = fingerprint(&r);
        match seen.get(&key) {
            Some(&ix) => {
                let hit = &mut out[ix];
                hit.count = Some(hit.count.unwrap_or(1) + 1);
                hit.first = Some(r.ts.clone());
            }
            None => {
                let mut rep = r;
                rep.count = Some(1);
                rep.first = Some(rep.ts.clone());
                seen.insert(key, out.len());
                out.push(rep);
            }
        }
    }
    for r in &mut out {
        if r.count == Some(1) {
            r.count = None;
            r.first = None;
        }
    }
    out
}

pub fn recent(
    store: &Store,
    since: Option<&str>,
    limit: Option<usize>,
    only_errors: bool,
) -> Vec<Log> {
    if !store.has_table("tool_call") {
        return vec![];
    }
    let n = limit.unwrap_or(50).clamp(1, 500);
    let mut wh: Vec<&str> = vec![];
    let mut args: Vec<String> = vec![];
    if let Some(s) = since {
        wh.push("ts >= ?");
        args.push(s.into());
    }
    if only_errors {
        wh.push("ok = 0");
    }
    let sql = format!(
        "select ts, source, name, session_id, ok, ms, error, detail \
         from tool_call {} order by ts desc, rowid desc limit 500",
        if wh.is_empty() { String::new() } else { format!("where {}", wh.join(" and ")) }
    );
    let Ok(mut st) = store.conn.prepare(&sql) else { return vec![] };
    let rows: Vec<Log> = st
        .query_map(rusqlite::params_from_iter(&args), |r| {
            Ok(Log {
                ts: r.get(0)?,
                source: r.get(1)?,
                name: r.get(2)?,
                session_id: r.get(3)?,
                ok: r.get::<_, i64>(4)? != 0,
                ms: r.get(5)?,
                error: r.get(6)?,
                detail: r.get(7)?,
                count: None,
                first: None,
            })
        })
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    cohort(rows).into_iter().take(n).collect()
}

// percentile_cont's linear interpolation, one decimal, over ms-timed calls.
fn pct(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let rank = p * (sorted.len() - 1) as f64;
    let lo = rank.floor() as usize;
    let hi = rank.ceil() as usize;
    let v = if lo == hi {
        sorted[lo]
    } else {
        sorted[lo] + (rank - lo as f64) * (sorted[hi] - sorted[lo])
    };
    (v * 10.0).round() / 10.0
}

pub fn stats(store: &Store, since: Option<&str>, only_errors: bool) -> Vec<Stat> {
    if !store.has_table("tool_call") {
        return vec![];
    }
    let mut wh: Vec<&str> = vec!["ms is not null"];
    let mut args: Vec<String> = vec![];
    if let Some(s) = since {
        wh.push("ts >= ?");
        args.push(s.into());
    }
    if only_errors {
        wh.push("ok = 0");
    }
    let sql = format!("select source, name, ms from tool_call where {}", wh.join(" and "));
    let Ok(mut st) = store.conn.prepare(&sql) else { return vec![] };
    let rows: Vec<(String, String, f64)> = st
        .query_map(rusqlite::params_from_iter(&args), |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    let mut groups: Vec<(String, String, Vec<f64>)> = vec![];
    for (source, name, ms) in rows {
        match groups.iter_mut().find(|(s, n, _)| *s == source && *n == name) {
            Some((_, _, v)) => v.push(ms),
            None => groups.push((source, name, vec![ms])),
        }
    }
    let mut out: Vec<Stat> = groups
        .into_iter()
        .map(|(source, name, mut v)| {
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            Stat {
                source,
                name,
                n: v.len() as i64,
                p50: pct(&v, 0.5),
                p95: pct(&v, 0.95),
                p99: pct(&v, 0.99),
            }
        })
        .collect();
    // SQLite emits GROUP BY in group-key order, then sorts by n desc with
    // ties keeping that order — a stable sort over key-ordered groups.
    out.sort_by(|a, b| (&a.source, &a.name).cmp(&(&b.source, &b.name)));
    out.sort_by(|a, b| b.n.cmp(&a.n));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn err_class_finds_the_error_token() {
        assert_eq!(err_class("TypeError: boom"), "TypeError");
        assert_eq!(err_class("weird failure"), "");
        assert_eq!(err_class("x Some.Error: y"), "Some.Error");
    }

    #[test]
    fn percentile_interpolates_like_sql() {
        let v = [1.0, 2.0, 3.0, 4.0];
        assert_eq!(pct(&v, 0.5), 2.5);
        assert_eq!(pct(&v, 0.95), 3.9);
    }

    #[test]
    fn cohorts_collapse_repeated_errors() {
        let mk = |ts: &str, ok: bool, err: &str| Log {
            ts: ts.into(),
            source: "mcp".into(),
            name: "t".into(),
            session_id: None,
            ok,
            ms: None,
            error: (!err.is_empty()).then(|| err.into()),
            detail: None,
            count: None,
            first: None,
        };
        let out = cohort(vec![
            mk("3", false, "TypeError: boom"),
            mk("2", true, ""),
            mk("1", false, "TypeError: boom"),
        ]);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].count, Some(2));
        assert_eq!(out[0].first.as_deref(), Some("1"));
    }
}
