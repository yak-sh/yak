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

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use std::collections::HashMap;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;
use yak_bridge::subserve::Subserve;
use yak_bridge::{journalr, read, snap};
use yak_kernel::Store;

#[derive(Clone)]
struct App {
    db: String,     // the raw db path (for /graph + worker opens)
    uri: String,    // the read-only open URI
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
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--db" => db = args.next(),
            "--port" => port = args.next().and_then(|s| s.parse().ok()),
            other if db.is_none() && !other.starts_with("--") => db = Some(other.to_string()),
            _ => {}
        }
    }
    let db = db.unwrap_or_else(|| {
        eprintln!("yak-bridge: no db path (DB_PATH, --db, or a positional arg)");
        std::process::exit(2);
    });
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
    // the live pairing, even read-only (shared wal-index, cross-build). The
    // default system-linked build reads the live file safely.
    if yak_bridge::refuses_live(&db) {
        eprintln!(
            "yak-bridge: refusing the live graph {db} — this binary was built \
             with `bundled` SQLite and would share the live WAL wal-index with \
             a different build (M-22673). Rebuild without --features bundled, \
             or point --db at a COPY."
        );
        std::process::exit(2);
    }

    let uri = ro_uri(&db);
    // Fail fast if the file will not open read-only, rather than 500 per request.
    if let Err(e) = Store::open(&uri) {
        eprintln!("yak-bridge: cannot open {db} read-only: {e}");
        std::process::exit(1);
    }
    let app = App { db: db.clone(), uri };
    let router = Router::new()
        .route("/query", get(query_route))
        .route("/journal", get(journal_route))
        .route("/graph", get(graph_route))
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
