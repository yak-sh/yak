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
    round1(v)
}

// round(x, 1) as SQLite's own round() does it: round the TRUE stored value to
// one decimal, ties AWAY from zero. NOT `(x*10).round()/10` — the ×10 corrupts
// the boundary, floating 107.44999999999999 (just under .45, so → 107.4) up to
// exactly 1074.5, a fabricated tie that rounds away to 107.5. SQLite formats the
// double to its EXACT decimal and rounds that; we mirror it with a high-precision
// format (which spells the true value, not the shortest round-trip — the shortest
// form prints 9.95 for a stored 9.9499…, and SQLite rounds that DOWN to 9.9),
// then decide on the hundredths digit: `>= 5` rounds the tenths up, so a genuine
// tie (2615.25 → 2615.3) rounds away while a value just under the midpoint
// (9.9499… → 9.9, 107.4499… → 107.4) rounds down. Forty places is far more than
// any f64 in the ms range needs to sit off a two-decimal midpoint.
fn round1(v: f64) -> f64 {
    if !v.is_finite() {
        return v;
    }
    let neg = v.is_sign_negative();
    let s = format!("{:.40}", v.abs());
    let (int_part, frac) = s.split_once('.').unwrap_or((s.as_str(), ""));
    let mut digits: Vec<u8> = int_part.bytes().map(|b| b - b'0').collect();
    let d1 = frac.as_bytes().first().map(|b| b - b'0').unwrap_or(0);
    // The hundredths digit decides: the remainder past the tenths is >= 0.5
    // exactly when it is >= 5, and a tie (a lone trailing 5) rounds away — up.
    let d2 = frac.as_bytes().get(1).map(|b| b - b'0').unwrap_or(0);
    let round_up = d2 >= 5;
    let mut tenths = d1;
    if round_up {
        tenths += 1;
        if tenths == 10 {
            tenths = 0;
            // carry through the integer digits
            let mut i = digits.len();
            loop {
                if i == 0 {
                    digits.insert(0, 1);
                    break;
                }
                i -= 1;
                if digits[i] == 9 {
                    digits[i] = 0;
                } else {
                    digits[i] += 1;
                    break;
                }
            }
        }
    }
    let int_str: String = digits.iter().map(|d| (d + b'0') as char).collect();
    let out: f64 = format!("{int_str}.{tenths}").parse().unwrap_or(v.abs());
    if neg {
        -out
    } else {
        out
    }
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
    out.sort_by_key(|a| std::cmp::Reverse(a.n));
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
        // percentile_cont here interpolates to 3.8499999999999996 (just under
        // 3.85) — SQLite's round(x,1) yields 3.8, NOT 3.9. The old `(v*10).round`
        // path returned 3.9 because 3.8499999999999996 * 10.0 floats up to
        // exactly 38.5, a fabricated tie; round1 rounds the true value like the
        // SQL, so this now matches what `select round(percentile_cont(ms,0.95),1)`
        // returns on [1,2,3,4].
        assert_eq!(pct(&v, 0.95), 3.8);
    }

    #[test]
    fn round1_matches_sqlite_round_at_boundaries() {
        // Each value verified against `select round(x,1)` in SQLite. Ties away
        // from zero, decided on the TRUE value (never a ×10 product), so a stored
        // 9.9499… (shortest form "9.95") rounds DOWN to 9.9, as the SQL does.
        assert_eq!(round1(2615.25), 2615.3); // exact tie → away (up)
        assert_eq!(round1(107.44999999999999), 107.4); // just under .45 → down
        assert_eq!(round1(3.8499999999999996), 3.8); // just under .85 → down
        assert_eq!(round1(9.95), 9.9); // stored just under .95 → down
        assert_eq!(round1(0.35), 0.3); // stored just under .35 → down
        assert_eq!(round1(1.05), 1.1); // stored just over .05 → up
        assert_eq!(round1(164.0), 164.0); // integer-valued
        assert_eq!(round1(539.5), 539.5); // one decimal already
        assert_eq!(round1(9.99), 10.0); // carry through the integer part
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
