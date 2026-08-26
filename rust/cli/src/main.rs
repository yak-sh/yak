// task-rs — the Rust CLI PoC (T-22532, D-22530's second rung): list, show,
// search over the live graph file, read-only, output parity with the TS CLI.

mod render;

use kernel::query;
use kernel::store::Rows;
use kernel::{db_path, search, Store};
use render::{authoring_line, claimant, id_of, show_md};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let verb = args.first().map(String::as_str).unwrap_or("");
    let rest = &args[1.min(args.len())..];
    let path = db_path();
    let uri = format!("file:{path}?mode=ro");
    let store = match Store::open(&uri) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("cannot open {path}: {e}");
            std::process::exit(1);
        }
    };
    let code = match verb {
        "list" => list(&store, rest),
        "show" => show(&store, rest),
        "search" => search_cmd(&store, rest),
        _ => {
            eprintln!("task-rs <list|show|search> …");
            2
        }
    };
    std::process::exit(code);
}

fn show(store: &Store, args: &[String]) -> i32 {
    let Some(id) = args.first() else {
        eprintln!("task-rs show <id>");
        return 2;
    };
    let Some(eid) = store.resolve_id(id) else {
        eprintln!("no entity {id}");
        return 1;
    };
    let Some(row) = store.row(&eid) else {
        eprintln!("no entity {id}");
        return 1;
    };
    println!("{}", show_md(store, &row));
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
    query::resolve_values(store, &mut preds);
    let rows_cache = Rows::new(store);
    // `.kind=` is derived identity, not table membership: an entity wearing
    // design+task is kind design, so a task listing excludes it (kindOf).
    let mut hits: Vec<kernel::Row> = store
        .rows_of_kind(&kind)
        .into_iter()
        .filter(|r| r.kind == kind)
        .filter(|r| query::matches(r, &preds))
        .collect();
    hits.sort_by(query::by_board);
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
    let hits = match search::search(store, &q, 20) {
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
