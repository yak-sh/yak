// yak-bridge — the READ wire over yak-kernel, on a probe port beside the live
// Deno server (D-22692 rung 1). axum + tokio at the edge; the kernel stays
// synchronous, so every HTTP read runs in `spawn_blocking` on its own read-only
// Store, and every WS socket is served by a DEDICATED THREAD owning its own
// Store + journal cursor, bridged to the async socket by a channel pair. One
// client's expensive query can never stall another's — the per-connection
// isolation D-22388 bought, realized as threads.
//
// READ ONLY: no /apply here. Writes still POST the Deno server; a write frame on
// a socket is ignored. But the WS SUBSCRIPTION machinery IS served now (T-22747,
// subserve.rs): a `{sub, q}` frame registers a query and streams its members —
// membership, windowed, aggregate and route subs — with live add/update/
// remove/dead deltas byte-identical to the Deno server. The join/catchup/live
// handshake stays complete, so a raw `{since:0,live:1,ws:1}` probe still gets
// its reset+snapshot and every later commit as a live frame until it subscribes.
// (The `.edges` rider, the lazy `entries:` partition, path/reverse-hop sub
// filters and `.fields` projection are the standing follow-up — refused loudly,
// never half-served.)

use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use std::collections::HashMap;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use yak_bridge::subserve::Subserve;
use yak_bridge::{journalr, read, snap};
use yak_kernel::{
    apply, default_gates, native_safe, parse_batch, ApplyOpts, Change, Store, WriteStore,
};

#[derive(Clone)]
struct App {
    db: String,   // the raw db path (for /graph + worker opens)
    uri: String,  // the read-only open URI
    // The Deno /apply upstream every write is proxied to (D-22804 rung 2). None
    // until one is named (--upstream/TASKS_UPSTREAM) — /apply then refuses rather
    // than guessing a server, since a wrong guess (5173) would proxy probe writes
    // at the live graph.
    upstream: Option<String>,
    // The bridge's READ_WRITE connection (D-22804 rung 1). Opened at boot to prove
    // the same-build write rule holds; a native-safe batch (rung 4) COMMITS
    // through it, a transform-bearing one still proxies to Deno.
    write: Arc<Mutex<WriteStore>>,
}

fn ro_uri(db: &str) -> String {
    format!("file:{db}?mode=ro")
}

// A read handler's Store — opened per request, in the blocking pool. Read-only
// opens are cheap and give each request the per-connection isolation the design
// asks for; a pool is a later optimization, never a correctness need.
fn open(uri: &str) -> Result<Store, String> {
    Store::open(uri).map_err(|e| e.to_string())
}

async fn query_route(
    State(app): State<App>,
    axum::extract::RawQuery(raw): axum::extract::RawQuery,
) -> Response {
    let uri = app.uri.clone();
    let raw = raw.unwrap_or_default();
    let out = tokio::task::spawn_blocking(move || {
        let store = open(&uri)?;
        read::answer(&store, &raw)
    })
    .await
    .unwrap_or_else(|e| Err(format!("panic: {e}")));
    match out {
        Ok(v) => json_response(&v),
        // A malformed filter is the typist's news, not a server error — 400
        // with the message as the body, exactly as the route treats it.
        Err(msg) => (axum::http::StatusCode::BAD_REQUEST, msg).into_response(),
    }
}

async fn journal_route(
    State(app): State<App>,
    Query(p): Query<HashMap<String, String>>,
) -> Response {
    let uri = app.uri.clone();
    let via = p.get("via").cloned();
    let eid = p.get("eid").cloned();
    let limit = p
        .get("limit")
        .and_then(|s| s.parse::<i64>().ok())
        .filter(|n| *n != 0)
        .unwrap_or(50);
    let out = tokio::task::spawn_blocking(move || {
        let store = open(&uri)?;
        Ok::<_, String>(journalr::answer(&store, via.as_deref(), eid.as_deref(), limit))
    })
    .await
    .unwrap_or_else(|e| Err(format!("panic: {e}")));
    match out {
        Ok(v) => json_response(&v),
        Err(msg) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, msg).into_response(),
    }
}

// /graph: who serves this port and which file — the health/peer probe the TS
// server answers (bind.ts Serving). Lets a supervisor or a check see the bridge.
async fn graph_route(State(app): State<App>) -> Response {
    let uri = app.uri.clone();
    let db = app.db.clone();
    let out = tokio::task::spawn_blocking(move || {
        let epoch = open(&uri).map(|s| snap::epoch_of(&s)).unwrap_or_default();
        serde_json::json!({ "db": db, "epoch": epoch, "pid": std::process::id() })
    })
    .await
    .unwrap_or(serde_json::json!({ "db": app.db, "epoch": "", "pid": 0 }));
    json_response(&out)
}

// POST /apply — the write door (D-22804). A native-safe batch (rung 4) COMMITS
// through the bridge's own WriteStore; everything else PROXIES to the Deno
// /apply verbatim. The route classifies WHOLE-BATCH (apply() is atomic) via the
// kernel's `native_safe` — the single source of truth for the divergence
// surface, biased hard to over-proxy — so a transform-bearing comp, a claim, an
// entity delete, a malformed body, or an empty batch all fall through to proxy.
// x-via (the honesty header the Deno apply resolves to an actor) rides both
// paths, so a bridge write attributes exactly as a direct one.
async fn apply_route(State(app): State<App>, headers: HeaderMap, body: Bytes) -> Response {
    let via = headers
        .get("x-via")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let write = app.write.clone();
    let upstream = app.upstream.clone();
    let out = tokio::task::spawn_blocking(move || {
        route_apply(&write, upstream.as_deref(), via.as_deref(), &body)
    })
    .await
    .unwrap_or_else(|e| (502, "text/plain".into(), format!("apply panic: {e}"), "native"));
    let (status, ctype, text, route) = out;
    (
        axum::http::StatusCode::from_u16(status).unwrap_or(axum::http::StatusCode::BAD_GATEWAY),
        [
            (axum::http::header::CONTENT_TYPE, ctype),
            // Which door this batch took — `native` (kernel WriteStore) or
            // `proxy` (relayed to Deno). Deno never sends it, so it is out of the
            // wire-parity surfaces; the harness reads it off the bridge's own
            // response to PROVE the routing decision, and it is a plain
            // observability aid otherwise.
            (axum::http::HeaderName::from_static("x-yak-apply"), route.to_string()),
        ],
        text,
    )
        .into_response()
}

// Classify one batch and route it: a native-safe plain-graph batch COMMITS
// natively; anything else proxies. Parsing is part of the classification — a
// body that is not a clean Change array is NOT native (Deno owns malformed-input
// errors, so it proxies). No upstream + a proxy batch is the only 503; a native
// batch commits regardless of upstream, since the WriteStore is always open. The
// trailing tag is the door taken, for the response's `x-yak-apply` header.
fn route_apply(
    write: &Mutex<WriteStore>,
    upstream: Option<&str>,
    via: Option<&str>,
    body: &[u8],
) -> (u16, String, String, &'static str) {
    let batch = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .as_ref()
        .and_then(parse_batch)
        .filter(|b| native_safe(b));
    match batch {
        Some(changes) => {
            let (s, c, t) = native_apply(write, via, changes);
            (s, c, t, "native")
        }
        None => match upstream {
            Some(u) => {
                let (s, c, t) = proxy_apply(u, via, body);
                (s, c, t, "proxy")
            }
            None => (
                503,
                "text/plain".into(),
                "yak-bridge: /apply has no upstream for this batch — a \
                 transform-bearing or delete batch must reach the Deno server; \
                 name it with --upstream or TASKS_UPSTREAM (never 5173 from a \
                 probe)."
                    .into(),
                "proxy",
            ),
        },
    }
}

// Commit a native-safe batch through the bridge's WriteStore and shape the
// answer like the Deno door: `{ok:true,changes:[…]}` on success, or the refusal
// MESSAGE as a 400 body (byte-identical to Deno's — apply() is the same port).
// `fed:true` journals the trace so effectsd fires the batch's effects exactly as
// it does a Deno-committed row (at-most-once off the same journal); the bridge
// itself fires none.
fn native_apply(write: &Mutex<WriteStore>, via: Option<&str>, changes: Vec<Change>) -> (u16, String, String) {
    // A poisoned lock means a prior apply PANICKED; SQLite already rolled that
    // transaction back, so the WriteStore is sound — recover the guard rather
    // than wedging the write door forever.
    let store = write.lock().unwrap_or_else(|p| p.into_inner());
    let opts = ApplyOpts { writer: via, fed: true };
    match apply(&store, changes, &opts, &default_gates()) {
        Ok(out) => {
            let changes: Vec<serde_json::Value> = out.iter().map(Change::to_value).collect();
            let body = serde_json::json!({ "ok": true, "changes": changes });
            (200, "application/json".into(), body.to_string())
        }
        Err(e) => (400, "text/plain".into(), e.to_string()),
    }
}

// Forward one write batch to the Deno /apply and read back (status, content-type,
// body) verbatim. `http_status_as_error(false)` is load-bearing: a rejected batch
// is a 400 whose BODY is the message a client must see (the `was`-stale merge
// text, the claim-bounce reason), so the proxy relays it like any other answer
// rather than swallowing it into a status-code error.
fn proxy_apply(upstream: &str, via: Option<&str>, body: &[u8]) -> (u16, String, String) {
    let url = format!("{}/apply", upstream.trim_end_matches('/'));
    let agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .build()
        .new_agent();
    let mut req = agent.post(&url).header("content-type", "application/json");
    if let Some(v) = via {
        req = req.header("x-via", v);
    }
    match req.send(body) {
        Ok(mut r) => {
            let status = r.status().as_u16();
            let ctype = r
                .headers()
                .get("content-type")
                .and_then(|h| h.to_str().ok())
                .unwrap_or("application/json")
                .to_string();
            let text = r.body_mut().read_to_string().unwrap_or_default();
            (status, ctype, text)
        }
        Err(e) => (
            502,
            "text/plain".into(),
            format!("yak-bridge: proxy to {url} failed: {e}"),
        ),
    }
}

fn json_response(v: &serde_json::Value) -> Response {
    (
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        serde_json::to_string(v).unwrap_or_else(|_| "null".into()),
    )
        .into_response()
}

async fn ws_route(State(app): State<App>, up: WebSocketUpgrade) -> Response {
    let uri = app.uri.clone();
    up.on_upgrade(move |socket| serve_socket(socket, uri))
}

enum ToWorker {
    Frame(String),
}

// The async half of one socket: pump worker frames out, control frames in.
async fn serve_socket(mut socket: WebSocket, uri: String) {
    let (to_tx, to_rx) = std::sync::mpsc::channel::<ToWorker>();
    let (from_tx, mut from_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let worker = std::thread::spawn(move || worker_loop(uri, to_rx, from_tx));
    loop {
        tokio::select! {
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Text(t))) => {
                    if to_tx.send(ToWorker::Frame(t.to_string())).is_err() { break }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => {} // ping/pong/binary — not part of the read wire
            },
            out = from_rx.recv() => match out {
                Some(s) => {
                    if socket.send(Message::Text(s.into())).await.is_err() { break }
                }
                None => break, // worker exited (e.g. its connection died)
            }
        }
    }
    drop(to_tx); // signals the worker to stop
    let _ = worker.join();
}

// The worker THREAD: its own read-only Store + a Subserve that owns this
// socket's subscription registry, join state, and journal cursor. Blocks on the
// control channel with a short timeout; each frame is routed through the
// Subserve, and between frames it polls the journal for foreign commits
// (data_version gate) — folding each into the subscriptions and, while
// unfiltered, the plain live stream — and ticks the moving-time windows. This is
// the wake mechanism D-22388 leaves pluggable: a poll here; a wal-watch or a DO
// alarm elsewhere.
fn worker_loop(uri: String, rx: Receiver<ToWorker>, tx: tokio::sync::mpsc::UnboundedSender<String>) {
    let store = match Store::open(&uri) {
        Ok(s) => s,
        Err(e) => {
            // Serving would be silence; tell the async half so it closes the
            // socket and the client reconnects (the delegator's dead-worker rule).
            let _ = tx.send(serde_json::json!({ "dead": e.to_string() }).to_string());
            return;
        }
    };
    let mut sub = Subserve::new(&store);
    loop {
        match rx.recv_timeout(Duration::from_millis(150)) {
            Ok(ToWorker::Frame(t)) => sub.frame(&store, &t, &tx),
            // The clock moved without a write — age the moving-time windows.
            Err(RecvTimeoutError::Timeout) => sub.tick(&store, &tx),
            Err(RecvTimeoutError::Disconnected) => return,
        }
        sub.poll(&store, &tx);
    }
}

#[tokio::main]
async fn main() {
    let mut db: Option<String> = std::env::var("DB_PATH").ok().filter(|s| !s.is_empty());
    let mut port: Option<u16> = std::env::var("PORT").ok().and_then(|s| s.parse().ok());
    let mut upstream: Option<String> =
        std::env::var("TASKS_UPSTREAM").ok().filter(|s| !s.is_empty());
    let mut migrate = false;
    let mut join = false;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--db" => db = args.next(),
            "--port" => port = args.next().and_then(|s| s.parse().ok()),
            "--upstream" => upstream = args.next(),
            // Swap-boot as a SUCCESSOR (D-22804 §8): wait for the predecessor to
            // release the writer baton, migrate as the now-sole writer, THEN
            // serve — the live Deno→Rust handoff. Owner-gated on the live graph;
            // refused here (mechanism only). Mirrors Deno's becomeWriter join path.
            "--join" => join = true,
            // Deliberately CREATE or additively migrate the graph, then exit
            // (D-22804 §8): the schema-authority capability the kernel now owns.
            // A one-shot on purpose — the LIVE swap boot (a successor holding the
            // writer baton, migrating, then serving) is the owner-gated rung-8
            // step, filed as its own follow-on; this refuses the live graph.
            "--migrate" => migrate = true,
            other if db.is_none() && !other.starts_with("--") => db = Some(other.to_string()),
            _ => {}
        }
    }
    let db = db.unwrap_or_else(|| {
        eprintln!("yak-bridge: no db path (DB_PATH, --db, or a positional arg)");
        std::process::exit(2);
    });
    if migrate {
        // Never the live graph: bundled builds cannot co-write the live WAL
        // across builds (M-22673), and the baton-guarded live swap is rung 8.
        if yak_bridge::refuses_live(&db) || yak_kernel::writes_live_graph(&db) {
            eprintln!(
                "yak-bridge --migrate: refusing the live graph {db} — live \
                 schema migration is the owner-gated rung-8 swap, under the \
                 writer baton. Point --db at a fresh/probe path."
            );
            std::process::exit(2);
        }
        match yak_kernel::WriteStore::create_or_migrate(&db) {
            Ok(_) => {
                eprintln!("yak-bridge: created/migrated {db} (schema authority, D-22804 §8)");
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("yak-bridge --migrate: cannot create/migrate {db}: {e}");
                std::process::exit(1);
            }
        }
    }
    let port = port.unwrap_or_else(|| {
        eprintln!("yak-bridge: no port (PORT or --port); pick a PROBE port, never 5173");
        std::process::exit(2);
    });
    // Probe discipline: 5173 is the live server's port (bind.ts). The bridge is
    // a co-process on its OWN port, never the live one.
    if port == 5173 {
        eprintln!("yak-bridge: refusing port 5173 — that is the live server's port");
        std::process::exit(2);
    }
    // The same-build boot assertion (M-22673): a bundled build must never open
    // the live pairing — not read-only (shared wal-index, cross-build) and, now
    // that the bridge holds a WRITE connection (D-22804 rung 1), least of all
    // read-write, where two SQLite builds co-writing one WAL corrupt the graph
    // (T-22622). The one predicate gates BOTH opens below: it runs first, so a
    // bundled build never reaches the RW open on the live file. The default
    // system-linked build reads AND writes the live file safely.
    if yak_bridge::refuses_live(&db) {
        eprintln!(
            "yak-bridge: refusing the live graph {db} — this binary was built \
             with `bundled` SQLite and would share the live WAL wal-index with \
             a different build (M-22673), read OR write. Rebuild without \
             --features bundled, or point --db at a COPY."
        );
        std::process::exit(2);
    }

    // The writer baton, held for this process's whole life when we are the swap
    // SUCCESSOR (--join, D-22804 §8). Parked in a binding that lives to the end
    // of main so its fd is never dropped out from under the serving loop —
    // dropping it releases the writer role while still serving (baton.ts's
    // module-binding trick, in Rust). None in shadow mode: a co-writing bridge
    // serializes with the live Deno server through SQLite's own writer lock +
    // begin-immediate, NOT the migration baton (D-22804), so it never takes it.
    let _writer_baton: Option<yak_kernel::Baton>;

    let write = if join {
        // Swap-boot successor: hold the writer baton, migrate as the now-sole
        // writer, THEN serve — the ORDER that closes the two-writer window
        // (T-20223), mirroring Deno becomeWriter → migrate. Owner-gated on the
        // live graph: this pass REFUSES it (mechanism only, like --migrate); the
        // real flip is rung 8. writes_live_graph gates EVERY build here, because
        // migrating the live schema IS the swap, not a build-safety question.
        if yak_bridge::refuses_live(&db) || yak_kernel::writes_live_graph(&db) {
            eprintln!(
                "yak-bridge --join: refusing the live graph {db} — the \
                 baton-guarded live swap boot (migrate as sole writer, then \
                 serve) is the owner-gated rung-8 step. Point --db at a \
                 fresh/probe COPY."
            );
            std::process::exit(2);
        }
        eprintln!(
            "yak-bridge --join: waiting for the writer baton on {db}{} \
             (the predecessor releases it on exit)…",
            yak_kernel::WRITER_LOCK
        );
        // wait:true — poll until the predecessor's exit frees the baton, or the
        // deadline names one that would not let go. Defaults mirror baton.ts.
        _writer_baton = match yak_kernel::take_baton(
            &db,
            &yak_kernel::TakeOpts { wait: true, ..Default::default() },
        ) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("yak-bridge --join: {e}");
                std::process::exit(1);
            }
        };
        eprintln!(
            "yak-bridge --join: holding the writer baton — migrating as sole \
             writer (create_or_migrate), then serving."
        );
        // Migrate/create UNDER the baton (no other writer can be mid-batch), and
        // reuse the returned RW connection as the serving write store.
        match yak_kernel::WriteStore::create_or_migrate(&db) {
            Ok(w) => Arc::new(Mutex::new(w)),
            Err(e) => {
                eprintln!("yak-bridge --join: cannot create/migrate {db}: {e}");
                std::process::exit(1);
            }
        }
    } else {
        _writer_baton = None;
        // The READ_WRITE connection (rung 1): open it now — never migrate, never
        // create — so a same-build failure or an unwritable file is a loud boot
        // exit, not a surprise on the first native write. Held for rungs 4+;
        // unused while every batch proxies.
        match yak_bridge::open_write(&db) {
            Ok(w) => Arc::new(Mutex::new(w)),
            Err(e) => {
                eprintln!("yak-bridge: cannot open {db} read-write: {e}");
                std::process::exit(1);
            }
        }
    };

    let uri = ro_uri(&db);
    // Fail fast if the file will not open read-only, rather than 500 per request.
    // (After a --join migrate the file now exists, so the RO open succeeds.)
    if let Err(e) = Store::open(&uri) {
        eprintln!("yak-bridge: cannot open {db} read-only: {e}");
        std::process::exit(1);
    }
    let app = App {
        db: db.clone(),
        uri,
        upstream: upstream.clone(),
        write,
    };
    eprintln!(
        "yak-bridge: write door — native-safe batches commit through the kernel; {}",
        match &upstream {
            Some(u) => format!("everything else proxies → {u}/apply"),
            None =>
                "no upstream (--upstream/TASKS_UPSTREAM), so transform-bearing/delete batches 503"
                    .into(),
        }
    );
    let router = Router::new()
        .route("/query", get(query_route))
        .route("/journal", get(journal_route))
        .route("/graph", get(graph_route))
        .route("/apply", post(apply_route))
        .route("/ws", get(ws_route))
        .with_state(app);

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap_or_else(|e| {
        eprintln!("yak-bridge: cannot bind {addr}: {e}");
        std::process::exit(1);
    });
    eprintln!("yak-bridge: read wire on http://{addr}/  (db {db})");
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .unwrap();
}
