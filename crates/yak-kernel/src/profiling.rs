// Built-in profiling: scoped phase timers plus a timing for every SQL
// execution, gathered into one per-process report. The report goes to
// STDERR after the verb has written its own output, so stdout stays
// byte-identical — that is what the parity tests read, and they must never
// see a profile.
//
// Free when off. `span()` and `sql()` read one relaxed atomic and hand back
// an unarmed handle: no clock read, no allocation, and Drop returns
// immediately. Nothing is armed until `enable()`, so the cost of carrying
// the instrumentation through a cold path is a predictable-branch load.
//
// Native only: the pure core compiles to wasm32, where `Instant::now()`
// panics, so the whole facility sits behind the `native` feature.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

static ON: AtomicBool = AtomicBool::new(false);

// How many statements the report names before folding the tail. A `show`
// touches every component table, so the full list is ~100 rows — enough to
// scroll the phases off the screen, which is the half you read first.
const TOP: usize = 25;

pub fn on() -> bool {
    ON.load(Ordering::Relaxed)
}

// A phase, recorded at OPEN so the log reads in execution order; `dur` is
// filled in when the span drops. `depth` is the nesting at open time.
struct Phase {
    name: String,
    depth: usize,
    dur: Duration,
}

// One statement, folded across its executions — a probe run once per hit in
// a loop is the thing a profile most needs to show, and 60 identical lines
// would hide it rather than name it.
struct Stmt {
    sql: String,
    n: usize,
    dur: Duration,
    rows: usize,
}

#[derive(Default)]
struct Log {
    origin: Option<Instant>,
    phases: Vec<Phase>,
    depth: usize,
    stmts: Vec<Stmt>,
}

fn log() -> &'static Mutex<Log> {
    static L: OnceLock<Mutex<Log>> = OnceLock::new();
    L.get_or_init(Default::default)
}

// Arm the facility. `origin` is the instant the total is measured against —
// the caller's first instruction, so the report's wall covers everything
// including the arming itself.
pub fn enable(origin: Instant) {
    {
        let mut l = log().lock().unwrap();
        l.origin = Some(origin);
        l.phases.clear();
        l.stmts.clear();
        l.depth = 0;
    }
    ON.store(true, Ordering::Relaxed);
}

pub fn disable() {
    ON.store(false, Ordering::Relaxed);
}

// The two doors a binary offers: `--profile` anywhere in argv — stripped in
// place, so verb parsing never sees it — or the env var set to anything but
// empty/0. The kernel is the general core, so the flag is YAK_PROFILE;
// TASKS_PROFILE is accepted as the tasks-era alias.
pub fn arm(args: &mut Vec<String>, origin: Instant) -> bool {
    let flagged = args.iter().any(|a| a == "--profile");
    args.retain(|a| a != "--profile");
    let set = |k: &str| std::env::var(k).map(|v| !v.is_empty() && v != "0").unwrap_or(false);
    if flagged || set("YAK_PROFILE") || set("TASKS_PROFILE") {
        enable(origin);
    }
    on()
}

// A phase whose start predates the facility — the argv scan that armed it.
pub fn mark(name: &str, from: Instant) {
    if !on() {
        return;
    }
    let dur = from.elapsed();
    let mut l = log().lock().unwrap();
    let depth = l.depth;
    l.phases.push(Phase { name: name.into(), depth, dur });
}

pub struct Span(Option<(usize, Instant)>);

// Open a phase; it closes when the returned handle drops, so a span is
// scoped by the block that holds it.
pub fn span(name: &str) -> Span {
    if !on() {
        return Span(None);
    }
    let at = {
        let mut l = log().lock().unwrap();
        let at = l.phases.len();
        let depth = l.depth;
        l.phases.push(Phase { name: name.into(), depth, dur: Duration::ZERO });
        l.depth += 1;
        at
    };
    Span(Some((at, Instant::now())))
}

impl Drop for Span {
    fn drop(&mut self) {
        let Some((at, t0)) = self.0 else { return };
        let dur = t0.elapsed();
        let mut l = log().lock().unwrap();
        l.phases[at].dur = dur;
        l.depth = l.depth.saturating_sub(1);
    }
}

pub struct Sql(Option<(String, Instant, usize)>);

// Time one SQL execution. The statement is squashed to a single line at
// record time — the display truncates, the fold does not, so two statements
// that differ past the cutoff stay two rows.
pub fn sql(stmt: &str) -> Sql {
    if !on() {
        return Sql(None);
    }
    Sql(Some((squash(stmt), Instant::now(), 0)))
}

impl Sql {
    // What the execution produced. The record lands on drop either way, so a
    // forgotten `done` costs its row count, never the timing.
    pub fn done(mut self, rows: usize) {
        if let Some(t) = self.0.as_mut() {
            t.2 = rows;
        }
    }
}

impl Drop for Sql {
    fn drop(&mut self) {
        let Some((sql, t0, rows)) = self.0.take() else { return };
        let dur = t0.elapsed();
        let mut l = log().lock().unwrap();
        match l.stmts.iter_mut().find(|s| s.sql == sql) {
            Some(s) => {
                s.n += 1;
                s.dur += dur;
                s.rows += rows;
            }
            None => l.stmts.push(Stmt { sql, n: 1, dur, rows }),
        }
    }
}

// The whole report, or None when the facility is off — so a caller writes
// `if let Some(r) = report()` and prints nothing on the cold path.
pub fn report() -> Option<String> {
    if !on() {
        return None;
    }
    let l = log().lock().unwrap();
    let wall = l.origin.map(|o| o.elapsed()).unwrap_or_default();
    let top: Duration = l.phases.iter().filter(|p| p.depth == 0).map(|p| p.dur).sum();

    let mut phases: Vec<Vec<String>> = l
        .phases
        .iter()
        .map(|p| vec![format!("{}{}", "  ".repeat(p.depth), p.name), ms(p.dur)])
        .collect();
    // What the spans never claimed: process teardown, and anything on the
    // path nobody has wrapped yet — the honest half of a phase breakdown.
    phases.push(vec!["unaccounted".into(), ms(wall.saturating_sub(top))]);
    phases.push(vec!["total".into(), ms(wall)]);

    let mut order: Vec<&Stmt> = l.stmts.iter().collect();
    order.sort_by(|a, b| b.dur.cmp(&a.dur));
    let row = |s: &Stmt| vec![clip(&s.sql, 58), s.n.to_string(), ms(s.dur), s.rows.to_string()];
    let mut stmts: Vec<Vec<String>> = order.iter().take(TOP).map(|s| row(s)).collect();
    // The tail is folded, never dropped: the totals stay complete, and a
    // report that scrolls off the screen names nothing.
    if order.len() > TOP {
        let tail = &order[TOP..];
        stmts.push(vec![
            format!("… {} more statements", tail.len()),
            tail.iter().map(|s| s.n).sum::<usize>().to_string(),
            ms(tail.iter().map(|s| s.dur).sum()),
            tail.iter().map(|s| s.rows).sum::<usize>().to_string(),
        ]);
    }
    let n: usize = l.stmts.iter().map(|s| s.n).sum();
    let dur: Duration = l.stmts.iter().map(|s| s.dur).sum();
    let rows: usize = l.stmts.iter().map(|s| s.rows).sum();
    stmts.push(vec!["total".into(), n.to_string(), ms(dur), rows.to_string()]);

    let mut out = String::from("\n── profile ──\n");
    out.push_str(&table(&["phase", "ms"], &phases, &[false, true]));
    if !l.stmts.is_empty() {
        out.push('\n');
        out.push_str(&table(&["sql", "n", "ms", "rows"], &stmts, &[false, true, true, true]));
    }
    Some(out)
}

// ms with µs precision — the unit a CLI phase is actually measured in.
fn ms(d: Duration) -> String {
    format!("{:.3}", d.as_secs_f64() * 1000.0)
}

fn squash(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clip(s: &str, w: usize) -> String {
    if s.chars().count() <= w {
        return s.into();
    }
    let mut out: String = s.chars().take(w.saturating_sub(1)).collect();
    out.push('…');
    out
}

// Columns sized to their widest cell; `right` says which ones are numbers.
fn table(head: &[&str], rows: &[Vec<String>], right: &[bool]) -> String {
    let wide: Vec<usize> = head
        .iter()
        .enumerate()
        .map(|(i, h)| {
            rows.iter()
                .filter_map(|r| r.get(i))
                .map(|c| c.chars().count())
                .chain([h.chars().count()])
                .max()
                .unwrap_or(0)
        })
        .collect();
    let line = |cells: &[String]| -> String {
        let mut s = String::new();
        for (i, w) in wide.iter().enumerate() {
            let c = cells.get(i).map(String::as_str).unwrap_or("");
            let pad = w.saturating_sub(c.chars().count());
            if right.get(i).copied().unwrap_or(false) {
                s.push_str(&" ".repeat(pad));
                s.push_str(c);
            } else {
                s.push_str(c);
                if i + 1 < wide.len() {
                    s.push_str(&" ".repeat(pad));
                }
            }
            if i + 1 < wide.len() {
                s.push_str("  ");
            }
        }
        s.trim_end().to_string()
    };
    let head: Vec<String> = head.iter().map(|h| h.to_string()).collect();
    let mut out = line(&head);
    out.push('\n');
    for r in rows {
        out.push_str(&line(r));
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // The log is per-process on purpose, so the tests take turns on it.
    fn turn() -> std::sync::MutexGuard<'static, ()> {
        static T: OnceLock<Mutex<()>> = OnceLock::new();
        T.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn off_is_silent() {
        let _t = turn();
        disable();
        {
            let _s = span("never");
            sql("select 1 from nowhere").done(3);
        }
        assert!(report().is_none());
        // and nothing was banked: arming next reports only what came after
        enable(Instant::now());
        let r = report().unwrap();
        assert!(!r.contains("never"), "{r}");
        assert!(!r.contains("nowhere"), "{r}");
        disable();
    }

    #[test]
    fn report_renders_phases_and_sql() {
        let _t = turn();
        enable(Instant::now());
        {
            let _outer = span("db.open");
            let _inner = span("vocab.init");
            sql("select  a,\n b from   entity where eid = ?1").done(2);
            sql("select a, b from entity where eid = ?1").done(5);
        }
        mark("render", Instant::now());
        let r = report().unwrap();
        disable();

        assert!(r.contains("── profile ──"), "{r}");
        assert!(r.contains("phase"), "{r}");
        // execution order, and the nested span is indented under its parent
        let open = r.find("db.open").unwrap();
        let init = r.find("  vocab.init").unwrap();
        assert!(open < init, "{r}");
        assert!(init < r.find("render").unwrap(), "{r}");
        assert!(r.contains("unaccounted"), "{r}");
        // ms with µs precision
        assert!(
            r.lines().any(|l| l.starts_with("total")
                && l.split_whitespace().nth(1).unwrap().split('.').nth(1).unwrap().len() == 3),
            "{r}"
        );
        // the two spellings squash to one statement, folded n=2 rows=7
        let sql_line = r
            .lines()
            .find(|l| l.contains("select a, b from entity"))
            .unwrap_or_else(|| panic!("{r}"));
        let cols: Vec<&str> = sql_line.split_whitespace().collect();
        assert_eq!(cols[cols.len() - 3], "2", "{sql_line}");
        assert_eq!(cols[cols.len() - 1], "7", "{sql_line}");
    }

    #[test]
    fn the_flag_is_stripped_before_verb_parsing() {
        let _t = turn();
        let mut args: Vec<String> =
            ["--profile", "show", "T-1"].iter().map(|s| s.to_string()).collect();
        assert!(arm(&mut args, Instant::now()));
        assert_eq!(args, ["show", "T-1"]);
        disable();

        let mut plain: Vec<String> = ["show", "T-1"].iter().map(|s| s.to_string()).collect();
        assert!(!arm(&mut plain, Instant::now()));
        assert_eq!(plain, ["show", "T-1"]);
    }

    #[test]
    fn long_statements_are_clipped_not_folded() {
        let _t = turn();
        enable(Instant::now());
        let a = format!("select {} from a", "x".repeat(80));
        let b = format!("select {} from b", "x".repeat(80));
        sql(&a).done(1);
        sql(&b).done(1);
        let r = report().unwrap();
        disable();
        assert_eq!(r.matches('…').count(), 2, "{r}");
        assert!(r.lines().any(|l| l.trim_start().starts_with("sql")), "{r}");
    }
}
