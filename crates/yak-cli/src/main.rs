// yak — the Rust CLI (T-22532/T-22558, D-22530): the pure-read verbs
// over the live graph file, read-only, output parity with the TS CLI.
// READ-ONLY divergences, documented: `inbox` renders without stamping the
// bus `notified` marks, `inbox show` without the `opened` stamp, `context`
// without the `## pending messages` bus block — read-stamps belong to the
// write-capable doors. `inbox archive` and `context --hook` refuse.

mod digest;
mod render;

use render::{authoring_line, claimant, id_of, local_time, show_md};
use yak_kernel::profiling::{self, span};
use yak_kernel::query;
use yak_kernel::store::Rows;
use yak_kernel::{db_path, search, Store};

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
    // needs its own read-write connection (yak_kernel::WriteStore).
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
        "inbox" => inbox(&store, rest),
        "history" => history(&store, rest),
        "telemetry" => telemetry(&store, rest),
        "context" => context(&store, rest),
        // a kind's PLURAL lists it (cli.ts listing()) — `task designs`
        w if !w.is_empty() && plural_kind(w).is_some() => {
            let mut fwd = vec![plural_kind(w).unwrap()];
            fwd.extend(rest.iter().cloned());
            list(&store, &fwd)
        }
        _ => {
            eprintln!(
                "yak [--profile] \
                 <list|show|search|apply|inbox|history|telemetry|context> …"
            );
            2
        }
    }
}

// yak apply [--db path] [--fed] [--writer w] [--batch json | reads stdin]
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
    let Some(changes) = yak_kernel::change::parse_batch(&parsed) else {
        eprintln!("apply: a batch is an array of {{eid, name, comp}} changes");
        return 2;
    };
    let store = match yak_kernel::WriteStore::open(&db) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("cannot open {db} for writing: {e}");
            return 1;
        }
    };
    let opts = yak_kernel::ApplyOpts { writer: writer.as_deref(), fed };
    match yak_kernel::apply(&store, changes, &opts, &yak_kernel::default_gates()) {
        Ok(out) => {
            println!("{}", yak_kernel::change::batch_json(&out));
            0
        }
        Err(e) => {
            eprintln!("{e}");
            1
        }
    }
}

// Only the PLURAL routes to list, and never over a registered verb —
// mirrors cli.ts listing(): the singular stays a subject.
fn plural_kind(word: &str) -> Option<String> {
    let verbs = [
        "list", "show", "search", "inbox", "history", "telemetry", "context",
    ];
    if verbs.contains(&word) {
        return None;
    }
    let k = query::kind_word(word)?;
    (k != word).then_some(word.to_string())
}

fn show(store: &Store, args: &[String]) -> i32 {
    let Some(id) = args.first() else {
        eprintln!("yak show <id>");
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
    let reveal = preds.iter().any(|p| p.comp == "quarantined");
    let mut hits: Vec<yak_kernel::Row> = {
        let _p = span("query");
        store
            .rows_of_kind(&kind)
            .into_iter()
            .filter(|r| r.kind == kind)
            .filter(|r| reveal || yak_kernel::store::visible(r))
            .filter(|r| query::matches(r, &preds))
            .collect()
    };
    hits.sort_by(query::by_board);
    let _p = span("render");
    // the second column: a task's status, everything else's alias slug
    let lines: Vec<(&yak_kernel::Row, String)> = hits
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

// task inbox [filters…] [--all|--sent] · inbox show <id> — READ-ONLY:
// listing never stamps `notified`, show never stamps `opened` (the TS CLI
// stamps both; those writes belong to the write-capable doors).
fn inbox(store: &Store, args: &[String]) -> i32 {
    if args.first().map(String::as_str) == Some("show") {
        let Some(id) = args.get(1) else {
            eprintln!("yak inbox show <id>");
            return 2;
        };
        let Some(eid) = store.resolve_id(id) else {
            eprintln!("no such entity: {id}");
            return 1;
        };
        let Some(row) = store.row(&eid) else {
            eprintln!("no such entity: {id}");
            return 1;
        };
        println!("{}", show_md(store, &row));
        eprintln!("(read-only: not stamped opened — use `task inbox show`)");
        return 0;
    }
    if args.first().map(String::as_str) == Some("archive") {
        eprintln!(
            "inbox archive writes — use the TS CLI (`task inbox archive`)"
        );
        return 2;
    }
    let every = args.iter().any(|a| a == "--all");
    let sent = args.iter().any(|a| a == "--sent");
    let words: Vec<&String> =
        args.iter().filter(|a| !a.starts_with("--")).collect();
    let mut preds = vec![];
    for w in &words {
        if !w.starts_with('.') {
            eprintln!("not an inbox filter: {w}");
            return 2;
        }
        match query::dot_token(w) {
            Ok(query::Dot::P(p)) => preds.push(p),
            Ok(query::Dot::Kind(_)) => {}
            Err(e) => {
                eprintln!("{e}");
                return 2;
            }
        }
    }
    query::resolve_values(store, &mut preds);
    let v = yak_kernel::vocab();
    let sid = me();
    let who = yak_kernel::reader::reader_for(
        store,
        sid.as_deref(),
        &cwd(),
        None,
    );
    let mut items: Vec<yak_kernel::Row> = if sent {
        // outbound: mail-comp wearers that never arrived from the edge
        let now = query::now_ms();
        store
            .eids_of_kind("mail")
            .iter()
            .filter_map(|e| store.row(e))
            .filter(|r| {
                r.comps.contains_key("mail")
                    && r.comps
                        .get("mail")
                        .and_then(|m| m.get("message_id"))
                        .is_none()
                    && r.comps
                        .get("deliver")
                        .and_then(|d| d.get("to"))
                        .is_some()
                    && yak_kernel::query::matches_at(r, &preds, now)
            })
            .collect()
    } else {
        let mode = if every {
            yak_kernel::inbox::Mode::All
        } else {
            yak_kernel::inbox::Mode::Inbox
        };
        let candidates = yak_kernel::inbox::inbox_rows(store, &who, &preds, mode);
        candidates
            .into_iter()
            .filter(|r| {
                if every {
                    yak_kernel::reader::addressed(&who, r)
                } else {
                    yak_kernel::reader::inbox_item(&who, r)
                }
            })
            .collect()
    };
    // oldest→newest; a same-batch tie (identical stamp) reads in mint order
    items.sort_by(|a, b| {
        yak_kernel::inbox::born_at(a)
            .cmp(&yak_kernel::inbox::born_at(b))
            .then(a.num.unwrap_or(0).cmp(&b.num.unwrap_or(0)))
    });
    if items.is_empty() {
        eprintln!(
            "{}",
            if sent {
                "(nothing sent)"
            } else if every {
                "(nothing addressed to you)"
            } else {
                "(inbox empty)"
            }
        );
        return 0;
    }
    for r in &items {
        println!("{}", yak_kernel::inbox::line(v, r));
    }
    0
}

// task history <id> [-n N] — the entity's write history off the journal.
fn history(store: &Store, args: &[String]) -> i32 {
    let Some(id) = args.first().filter(|a| !a.starts_with('-')) else {
        eprintln!("task history <id> [-n N]");
        return 2;
    };
    let n = flag_value(args, "-n")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(50);
    let Some(eid) = store.resolve_id(id) else {
        eprintln!("no such entity: {id}");
        return 1;
    };
    let Some(row) = store.row(&eid) else {
        eprintln!("no such entity: {id}");
        return 1;
    };
    let entries = yak_kernel::journal::journal_of(store, &eid, n);
    if entries.is_empty() {
        println!("{}: no history", id_of(&row));
        return 0;
    }
    for e in &entries {
        println!(
            "#{:<6} {}  {:<24} {}",
            e.id,
            local_time(&e.ts),
            {
                let a = yak_kernel::journal::actor_of(e);
                a.chars().take(24).collect::<String>()
            },
            yak_kernel::journal::what_of(e)
        );
    }
    0
}

// task telemetry [--errors] [--since=ts] [-n N] [--stats]
fn telemetry(store: &Store, args: &[String]) -> i32 {
    let errors = args.iter().any(|a| a == "--errors");
    let since = flag_value(args, "--since");
    if args.iter().any(|a| a == "--json") {
        eprintln!("--json is not ported in yak — use the TS CLI");
        return 2;
    }
    if args.iter().any(|a| a == "--stats") {
        let rows =
            yak_kernel::telemetry::stats(store, since.as_deref(), errors);
        if rows.is_empty() {
            eprintln!("(nothing timed)");
            return 0;
        }
        let ms = |n: f64| format!("{:>9}", format!("{n}ms"));
        println!(
            "{:<4} {:<14} {:>6} {:>9} {:>9} {:>9}",
            "door", "tool", "n", "p50", "p95", "p99"
        );
        for r in rows {
            println!(
                "{:<4} {:<14} {:>6} {} {} {}",
                r.source,
                r.name,
                r.n,
                ms(r.p50),
                ms(r.p95),
                ms(r.p99)
            );
        }
        return 0;
    }
    let n = flag_value(args, "-n").and_then(|v| v.parse::<usize>().ok());
    let rows =
        yak_kernel::telemetry::recent(store, since.as_deref(), n, errors);
    if rows.is_empty() {
        eprintln!("(nothing recorded)");
        return 0;
    }
    for r in rows {
        let cohort = match r.count {
            Some(c) if c > 1 => format!(
                "  {c}× since {}",
                local_time(r.first.as_deref().unwrap_or(&r.ts))
            ),
            _ => String::new(),
        };
        println!(
            "{}  {:<4} {:<14} {} {:>6}  {:<10}  {}{cohort}",
            local_time(&r.ts),
            r.source,
            r.name,
            if r.ok { "ok " } else { "ERR" },
            r.ms.map(|m| format!("{m}ms")).unwrap_or_default(),
            r.session_id.as_deref().unwrap_or("-"),
            r.error
                .as_deref()
                .unwrap_or("")
                .chars()
                .take(80)
                .collect::<String>()
        );
    }
    0
}

// task context [P-x | S-x] — the boot digest, read-only (no reify, no bus
// block, no read-stamps). --hook and --subagent are write/agent doors and
// refuse here.
fn context(store: &Store, args: &[String]) -> i32 {
    if args.iter().any(|a| a == "--hook" || a == "--subagent") {
        eprintln!(
            "context --hook/--subagent reify sessions (writes) — \
             use the TS CLI"
        );
        return 2;
    }
    let now = query::now_ms();
    let named = args.first().filter(|a| !a.starts_with('-'));
    if let Some(id) = named {
        let Some(eid) = store.resolve_id(id) else {
            eprintln!("no such entity: {id}");
            return 1;
        };
        let Some(row) = store.row(&eid) else {
            eprintln!("no such entity: {id}");
            return 1;
        };
        if row.comps.contains_key("project") {
            println!(
                "{}",
                digest::context_digest(store, None, now, Some(&eid))
            );
            return 0;
        }
        if let Some(sc) = row.comps.get("session") {
            let sid = sc
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let fm = digest::session_meta(store, &sid);
            let out = digest::context_digest(store, Some(&sid), now, None);
            if fm.is_empty() {
                println!("{out}");
            } else {
                println!("{fm}\n{out}");
            }
            return 0;
        }
        eprintln!("{id} names neither a project nor a session");
        return 1;
    }
    match me() {
        Some(sid) if store.session_row(&sid).is_some() => {
            let fm = digest::session_meta(store, &sid);
            let out = digest::context_digest(store, Some(&sid), now, None);
            if fm.is_empty() {
                println!("{out}");
            } else {
                println!("{fm}\n{out}");
            }
        }
        _ => {
            // the preview: scoped to the repo you stand in
            let scope = yak_kernel::reader::scope_for(store, None, &cwd(), None);
            println!(
                "{}",
                digest::context_digest(store, None, now, scope.as_deref())
            );
        }
    }
    0
}

fn cwd() -> String {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

// me() — the CLI's standing identity (client.ts me()), env-resolved.
fn me() -> Option<String> {
    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    let id = env("CLAUDE_CODE_SESSION_ID")
        .or_else(|| env("TASKS_SESSION"))
        .or_else(|| env("CODEX_THREAD_ID"));
    if env("CLAUDE_CODE_CHILD_SESSION").as_deref() != Some("1") {
        return id;
    }
    let at = worktree_root();
    let own = env("TASKS_SESSION").is_some()
        && env("TASKS_SESSION") == env("CLAUDE_CODE_SESSION_ID")
        && at.is_some()
        && at == env("TASKS_TREE");
    if own { id } else { at.or(id) }
}

fn worktree_root() -> Option<String> {
    let mut d = std::env::current_dir().ok()?;
    loop {
        if d.join(".git").is_file() {
            return Some(d.to_string_lossy().to_string());
        }
        if !d.pop() {
            return None;
        }
    }
}

fn flag_value(args: &[String], name: &str) -> Option<String> {
    for (i, a) in args.iter().enumerate() {
        if let Some(v) = a.strip_prefix(&format!("{name}=")) {
            return Some(v.to_string());
        }
        if a == name {
            return args.get(i + 1).cloned();
        }
    }
    None
}

fn search_cmd(store: &Store, args: &[String]) -> i32 {
    let q = args.join(" ");
    if q.is_empty() {
        eprintln!("yak search <words...> (trailing * = prefix)");
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
            yak_kernel::vocab().id_of(&h.kind, &h.eid, h.num),
            h.kind,
            title,
            aim,
            snip,
            sunk
        );
    }
    0
}
