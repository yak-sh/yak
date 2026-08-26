// task-rs — the Rust CLI PoC (T-22532, D-22530's second rung): list, show,
// search over the live graph file, read-only, output parity with the TS CLI.

mod render;

use kernel::profiling::{self, span};
use kernel::query;
use kernel::store::Rows;
use kernel::{db_path, search, Store};
use render::{authoring_line, claimant, id_of, show_md};

fn main() {
    // One monotonic clock read, unconditional — it costs less than the argv
    // allocation on the next line, and it is what lets `startup` cover the
    // scan that decides whether to profile at all. No timer is armed.
    let t0 = std::time::Instant::now();
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    profiling::arm(&mut args, t0);
    profiling::mark("startup", t0);

    let code = run(&args);

    // After the verb's own output, and on stderr: stdout stays byte-identical
    // to an unprofiled run, which is what the parity tests read.
    if let Some(r) = profiling::report() {
        eprint!("{r}");
    }
    std::process::exit(code);
}

fn run(args: &[String]) -> i32 {
    let verb = args.first().map(String::as_str).unwrap_or("");
    let rest = &args[1.min(args.len())..];
    // The write door dispatches before the read-only Store opens: apply
    // needs its own read-write connection (kernel::WriteStore).
    if verb == "apply" {
        return apply_cmd(rest);
    }
    let path = db_path();
    let uri = format!("file:{path}?mode=ro");
    let store = match Store::open(&uri) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("cannot open {path}: {e}");
            return 1;
        }
    };
    match verb {
        "list" => list(&store, rest),
        "show" => show(&store, rest),
        "search" => search_cmd(&store, rest),
        _ => {
            eprintln!("task-rs [--profile] <list|show|search|apply> …");
            2
        }
    }
}

// task-rs apply [--db path] [--fed] [--writer w] [--batch json | reads stdin]
// One batch through the kernel write path (T-22550): prints the effective
// batch as JSON, or the refusal on stderr with exit 1 — the same all-or-
// nothing contract apply() keeps on every other door.
fn apply_cmd(args: &[String]) -> i32 {
    let mut db = db_path();
    let mut fed = false;
    let mut writer: Option<String> = None;
    let mut batch: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--db" => {
                i += 1;
                db = args.get(i).cloned().unwrap_or(db);
            }
            "--fed" => fed = true,
            "--writer" => {
                i += 1;
                writer = args.get(i).cloned();
            }
            "--batch" => {
                i += 1;
                batch = args.get(i).cloned();
            }
            other => {
                eprintln!("unknown flag {other}");
                return 2;
            }
        }
        i += 1;
    }
    let json = match batch {
        Some(j) => j,
        None => {
            let mut buf = String::new();
            use std::io::Read;
            if std::io::stdin().read_to_string(&mut buf).is_err() {
                eprintln!("apply: cannot read stdin");
                return 2;
            }
            buf
        }
    };
    let parsed: serde_json::Value = match serde_json::from_str(&json) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("apply: bad batch json — {e}");
            return 2;
        }
    };
    let Some(changes) = kernel::change::parse_batch(&parsed) else {
        eprintln!("apply: a batch is an array of {{eid, name, comp}} changes");
        return 2;
    };
    let store = match kernel::WriteStore::open(&db) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("cannot open {db} for writing: {e}");
            return 1;
        }
    };
    let opts = kernel::ApplyOpts { writer: writer.as_deref(), fed };
    match kernel::apply(&store, changes, &opts, &kernel::default_gates()) {
        Ok(out) => {
            println!("{}", kernel::change::batch_json(&out));
            0
        }
        Err(e) => {
            eprintln!("{e}");
            1
        }
    }
}

fn show(store: &Store, args: &[String]) -> i32 {
    let Some(id) = args.first() else {
        eprintln!("task-rs show <id>");
        return 2;
    };
    let eid = {
        let _p = span("resolve");
        store.resolve_id(id)
    };
    let Some(eid) = eid else {
        eprintln!("no entity {id}");
        return 1;
    };
    let row = {
        let _p = span("row");
        store.row(&eid)
    };
    let Some(row) = row else {
        eprintln!("no entity {id}");
        return 1;
    };
    let md = {
        let _p = span("render");
        show_md(store, &row)
    };
    println!("{md}");
    0
}

fn list(store: &Store, args: &[String]) -> i32 {
    let (kind, mut preds) = match query::parse(args) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{e}");
            return 2;
        }
    };
    {
        let _p = span("resolve");
        query::resolve_values(store, &mut preds);
    }
    let rows_cache = Rows::new(store);
    // `.kind=` is derived identity, not table membership: an entity wearing
    // design+task is kind design, so a task listing excludes it (kindOf).
    let mut hits: Vec<kernel::Row> = {
        let _p = span("query");
        store
            .rows_of_kind(&kind)
            .into_iter()
            .filter(|r| r.kind == kind)
            .filter(|r| query::matches(r, &preds))
            .collect()
    };
    hits.sort_by(query::by_board);
    let _p = span("render");
    // the second column: a task's status, everything else's alias slug
    let lines: Vec<(&kernel::Row, String)> = hits
        .iter()
        .map(|r| {
            let handle = if r.comps.contains_key("task") {
                r.comps
                    .get("task")
                    .and_then(|t| t.get("status"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string()
            } else {
                r.comps
                    .get("alias")
                    .and_then(|a| a.get("slug"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string()
            };
            (r, handle)
        })
        .collect();
    let wide = lines.iter().map(|(_, h)| h.len()).max().unwrap_or(0).max(5);
    for (r, handle) in &lines {
        let who = claimant(&rows_cache, r);
        let flag = who.map(|w| format!("  \u{2691} {w}")).unwrap_or_default();
        let title = r
            .comps
            .get("doc")
            .and_then(|d| d.get("title"))
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();
        let authoring = authoring_line(&rows_cache, r);
        println!(
            "{:<6} {:<w$} {}{}{}",
            id_of(r),
            handle,
            title,
            flag,
            if authoring.is_empty() {
                String::new()
            } else {
                format!(" · {authoring}")
            },
            w = wide
        );
    }
    if hits.is_empty() {
        eprintln!("(no matches)");
    }
    0
}

fn search_cmd(store: &Store, args: &[String]) -> i32 {
    let q = args.join(" ");
    if q.is_empty() {
        eprintln!("task-rs search <words...> (trailing * = prefix)");
        return 2;
    }
    let found = {
        let _p = span("search");
        search::search(store, &q, 20)
    };
    let hits = match found {
        Ok(h) => h,
        Err(e) => {
            eprintln!("{e}");
            return 2;
        }
    };
    if hits.is_empty() {
        println!("(no hits)");
        return 0;
    }
    let _p = span("render");
    for h in hits {
        let aim = if h.open != h.eid {
            format!(
                " → on {}",
                h.open_id.clone().unwrap_or_else(|| h.open.clone())
            )
        } else {
            String::new()
        };
        let snip = h.snip.replace('\u{1}', "[").replace('\u{2}', "]");
        let sunk = if h.retired { " · retired" } else { "" };
        let title = if h.title.is_empty() {
            "(untitled)".to_string()
        } else {
            h.title.clone()
        };
        println!(
            "{} {}: {}{} — {}{}",
            kernel::vocab().id_of(&h.kind, &h.eid, h.num),
            h.kind,
            title,
            aim,
            snip,
            sunk
        );
    }
    0
}
