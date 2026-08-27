// Time phrases, ported from src/time.ts span(): a phrase names a RANGE in
// epoch milliseconds and the filter op picks its edge. Day boundaries are
// LOCAL, like every evaluator in the TS system (browser and server both use
// the machine's zone), so `today` here equals `today` there on the same box.

use chrono::{Datelike, Local, NaiveDate, TimeZone, Timelike};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Span {
    pub start: i64,
    pub end: i64,
}

const UNIT_MS: &[(&str, i64)] = &[
    ("second", 1_000),
    ("minute", 60_000),
    ("hour", 3_600_000),
    ("day", 86_400_000),
    ("week", 604_800_000),
];

fn unit_ms(u: &str) -> Option<i64> {
    UNIT_MS.iter().find(|(n, _)| *n == u).map(|(_, ms)| *ms)
}

fn unit(w: &str) -> Option<String> {
    let short = match w {
        "s" | "sec" | "secs" => Some("second"),
        "m" | "min" | "mins" => Some("minute"),
        "h" | "hr" | "hrs" => Some("hour"),
        "d" => Some("day"),
        "w" => Some("week"),
        "mo" => Some("month"),
        "y" => Some("year"),
        _ => None,
    };
    if let Some(s) = short {
        return Some(s.into());
    }
    let stem = w.strip_suffix('s').unwrap_or(w);
    matches!(stem, "second" | "minute" | "hour" | "day" | "week" | "month" | "year")
        .then(|| stem.to_string())
}

// Local calendar date at a day offset -> epoch ms of local midnight.
// Out-of-range dates (month rollover) ride chrono's checked arithmetic.
fn local_midnight(y: i32, mo: u32, d: i64) -> Option<i64> {
    // normalize an offset day count through a base date
    let base = NaiveDate::from_ymd_opt(y, mo, 1)?;
    let date = base.checked_add_signed(chrono::Duration::days(d - 1))?;
    let dt = date.and_hms_opt(0, 0, 0)?;
    Local.from_local_datetime(&dt).earliest().map(|t| t.timestamp_millis())
}

fn local_at(y: i32, mo: u32, d: i64, h: u32, mi: u32, s: u32) -> Option<i64> {
    let base = NaiveDate::from_ymd_opt(y, mo, 1)?;
    let date = base.checked_add_signed(chrono::Duration::days(d - 1))?;
    let dt = date.and_hms_opt(h, mi, s)?;
    Local.from_local_datetime(&dt).earliest().map(|t| t.timestamp_millis())
}

struct Clock {
    h: u32,
    m: u32,
    exact: bool,
}

fn clock(s: &str) -> Option<Clock> {
    if s == "noon" {
        return Some(Clock { h: 12, m: 0, exact: true });
    }
    if s == "midnight" {
        return Some(Clock { h: 0, m: 0, exact: true });
    }
    let ampm =
        s.strip_suffix("am").map(|r| (r, 0)).or_else(|| s.strip_suffix("pm").map(|r| (r, 12)));
    if let Some((rest, add)) = ampm {
        let (hh, mm, exact) = match rest.split_once(':') {
            Some((h, m)) => (h.parse().ok()?, Some(m), true),
            None => (rest.parse::<u32>().ok()?, None, false),
        };
        let m = match mm {
            Some(m) if m.len() == 2 => m.parse().ok()?,
            Some(_) => return None,
            None => 0,
        };
        if hh > 12 {
            return None;
        }
        return Some(Clock { h: hh % 12 + add, m, exact });
    }
    let (h, m) = s.split_once(':')?;
    if m.len() != 2 {
        return None;
    }
    let h: u32 = h.parse().ok()?;
    let m: u32 = m.parse().ok()?;
    (h < 24 && m < 60).then_some(Clock { h, m, exact: true })
}

// span() — the phrase grammar. Returns None for a non-phrase, so a caller
// falls back to plain string compare exactly like the TS evaluator.
pub fn span(s: &str, now: i64) -> Option<Span> {
    let raw = s.trim().to_lowercase();
    if let Some(sp) = iso_span(&raw, s) {
        return Some(sp);
    }
    let t = raw.replace(['-', '_'], " ").split_whitespace().collect::<Vec<_>>().join(" ");
    let d = Local.timestamp_millis_opt(now).earliest()?;
    let (y, mo, dd) = (d.year(), d.month(), d.day() as i64);
    let days = |a: i64, b: i64| -> Option<Span> {
        Some(Span { start: local_midnight(y, mo, dd + a)?, end: local_midnight(y, mo, dd + b)? })
    };
    // month/year shifts keep the wall-clock fields, like the TS Date math
    let shift = |n: i64, u: &str| -> Option<i64> {
        if u == "month" {
            let total = (y as i64) * 12 + (mo as i64 - 1) + n;
            let (yy, mm) = (total.div_euclid(12) as i32, total.rem_euclid(12) as u32 + 1);
            local_at(yy, mm, dd, d.hour(), d.minute(), d.second())
        } else {
            local_at(y + n as i32, mo, dd, d.hour(), d.minute(), d.second())
        }
    };
    match t.as_str() {
        "now" => return Some(Span { start: now, end: now }),
        "today" => return days(0, 1),
        "yesterday" => return days(-1, 0),
        "tomorrow" => return days(1, 2),
        _ => {}
    }
    let ws: Vec<&str> = t.split(' ').collect();
    if ws.len() == 2 && matches!(ws[0], "this" | "last" | "next") {
        let at: i64 = match ws[0] {
            "this" => 0,
            "last" => -1,
            _ => 1,
        };
        match ws[1] {
            "day" => return days(at, at + 1),
            "week" => {
                // weeks start Monday
                let dow = d.weekday().num_days_from_monday() as i64;
                let mon = dd - dow + at * 7;
                return Some(Span {
                    start: local_midnight(y, mo, mon)?,
                    end: local_midnight(y, mo, mon + 7)?,
                });
            }
            "month" => {
                let ms = |k: i64| {
                    let total = (y as i64) * 12 + (mo as i64 - 1) + k;
                    local_midnight(total.div_euclid(12) as i32, total.rem_euclid(12) as u32 + 1, 1)
                };
                return Some(Span { start: ms(at)?, end: ms(at + 1)? });
            }
            "year" => {
                return Some(Span {
                    start: local_midnight(y + at as i32, 1, 1)?,
                    end: local_midnight(y + at as i32 + 1, 1, 1)?,
                });
            }
            "minute" | "hour" => {
                let w = unit_ms(ws[1])?;
                let start = now.div_euclid(w) * w + at * w;
                return Some(Span { start, end: start + w });
            }
            _ => {}
        }
    }
    // "N unit ago"
    if ws.len() == 3 && ws[2] == "ago" {
        if let (Ok(n), Some(u)) = (ws[0].parse::<i64>(), unit(ws[1])) {
            let start = match unit_ms(&u) {
                Some(ms) => Some(now - n * ms),
                None => shift(-n, &u),
            }?;
            return Some(Span { start, end: now });
        }
    }
    // "in N unit" / "after N unit" — also glued forms like "in 60m"
    if ws.len() >= 2 && matches!(ws[0], "in" | "after") {
        let (ns, us) = if ws.len() == 3 {
            (ws[1].to_string(), ws[2].to_string())
        } else {
            let rest = ws[1];
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            (digits.clone(), rest[digits.len()..].to_string())
        };
        if let (Ok(n), Some(u)) = (ns.parse::<i64>(), unit(&us)) {
            let end = match unit_ms(&u) {
                Some(ms) => Some(now + n * ms),
                None => shift(n, &u),
            }?;
            return Some(Span { start: now, end });
        }
    }
    // A clock is today unless a day word rides along.
    let off = |w: &str| match w {
        "yesterday" => Some(-1i64),
        "today" => Some(0),
        "tomorrow" => Some(1),
        _ => None,
    };
    let (day, rest): (Option<i64>, Vec<&str>) = if let Some(o) = off(ws[0]) {
        (Some(o), ws[1..].to_vec())
    } else if let Some(o) = ws.last().and_then(|w| off(w)) {
        (Some(o), ws[..ws.len() - 1].to_vec())
    } else {
        (None, ws.clone())
    };
    if let Some(c) = clock(&rest.join("")) {
        let start = local_at(y, mo, dd + day.unwrap_or(0), c.h, c.m, 0)?;
        return Some(Span { start, end: start + if c.exact { 60_000 } else { 3_600_000 } });
    }
    None
}

// ISO date / datetime — a date is its local day; a zoned stamp is itself;
// an unzoned stamp is local. Minute stamps span a minute, second stamps 1s.
fn iso_span(raw: &str, original: &str) -> Option<Span> {
    let b = raw.as_bytes();
    if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let y: i32 = raw.get(0..4)?.parse().ok()?;
    let mo: u32 = raw.get(5..7)?.parse().ok()?;
    let dd: i64 = raw.get(8..10)?.parse().ok()?;
    if !raw.get(0..10)?.chars().enumerate().all(|(i, c)| {
        if i == 4 || i == 7 {
            c == '-'
        } else {
            c.is_ascii_digit()
        }
    }) {
        return None;
    }
    if raw.len() == 10 {
        return Some(Span {
            start: local_midnight(y, mo, dd)?,
            end: local_midnight(y, mo, dd + 1)?,
        });
    }
    let sep = b[10];
    if sep != b't' && sep != b' ' {
        return None;
    }
    let rest = raw.get(11..)?;
    let hh: u32 = rest.get(0..2)?.parse().ok()?;
    if rest.as_bytes().get(2) != Some(&b':') {
        return None;
    }
    let mi: u32 = rest.get(3..5)?.parse().ok()?;
    let tail = rest.get(5..)?;
    let (ss, has_ss, zone_part) = if tail.starts_with(':') {
        let s: u32 = tail.get(1..3)?.parse().ok()?;
        (s, true, tail.get(3..)?)
    } else {
        (0, false, tail)
    };
    let zone = zone_part.trim_start_matches(|c: char| c == '.' || c.is_ascii_digit());
    let zoned = zone == "z" || zone.starts_with('+') || zone.starts_with('-');
    if !zone.is_empty() && !zoned {
        return None;
    }
    let start = if zoned {
        chrono::DateTime::parse_from_rfc3339(original.trim())
            .ok()
            .map(|t| t.timestamp_millis())
            .or_else(|| {
                // tolerate the compact zone form (+hhmm)
                chrono::DateTime::parse_from_str(original.trim(), "%Y-%m-%dT%H:%M:%S%z")
                    .ok()
                    .map(|t| t.timestamp_millis())
            })?
    } else {
        local_at(y, mo, dd, hh, mi, ss)?
    };
    Some(Span { start, end: start + if has_ss { 1000 } else { 60_000 } })
}

// Parse an ISO-8601 stamp (as stored on rows) to epoch ms — Date.parse's
// role in inTime(). None mirrors NaN.
pub fn parse_stamp(v: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(v).ok().map(|t| t.timestamp_millis()).or_else(|| {
        let t = v.trim();
        let naive = chrono::NaiveDateTime::parse_from_str(t, "%Y-%m-%dT%H:%M:%S")
            .or_else(|_| chrono::NaiveDateTime::parse_from_str(t, "%Y-%m-%dT%H:%M:%S%.f"))
            .ok()?;
        Local.from_local_datetime(&naive).earliest().map(|x| x.timestamp_millis())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> i64 {
        parse_stamp(s).unwrap()
    }

    #[test]
    fn today_is_midnight_to_midnight() {
        let now = at("2026-08-26T13:00:00-04:00");
        let sp = span("today", now).unwrap();
        assert_eq!(sp.end - sp.start, 86_400_000);
        assert!(sp.start <= now && now < sp.end);
    }

    #[test]
    fn glued_hour_ago() {
        let now = 1_000_000_000_000;
        let sp = span("1-hour-ago", now).unwrap();
        assert_eq!(sp, Span { start: now - 3_600_000, end: now });
        assert_eq!(span("7 days ago", now).unwrap().start, now - 7 * 86_400_000);
    }

    #[test]
    fn iso_date_names_its_local_day() {
        let sp = span("2026-01-05", 0).unwrap();
        assert_eq!(sp.end - sp.start, 86_400_000);
    }

    #[test]
    fn non_phrases_stay_none() {
        assert!(span("open", 0).is_none());
        assert!(span("P-19", 0).is_none());
        assert!(span("", 0).is_none());
    }

    #[test]
    fn this_week_starts_monday() {
        let now = at("2026-08-26T13:00:00-04:00"); // a Wednesday
        let sp = span("this-week", now).unwrap();
        assert_eq!(sp.end - sp.start, 7 * 86_400_000);
        let mon = span("2026-08-24", now).unwrap();
        assert_eq!(sp.start, mon.start);
    }

    #[test]
    fn clock_time_spans_its_hour() {
        let now = at("2026-08-26T13:00:00-04:00");
        let nine = span("9am", now).unwrap();
        assert_eq!(nine.end - nine.start, 3_600_000);
        let exact = span("9:30pm", now).unwrap();
        assert_eq!(exact.end - exact.start, 60_000);
    }
}
