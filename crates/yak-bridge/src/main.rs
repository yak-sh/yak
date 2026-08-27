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
use yak_kernel::{Store, WriteStore};

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
    // the same-build write rule holds and held for the native-write rungs (4+);
    // rungs 1–3 proxy EVERY batch to Deno, so nothing writes through it yet.
    #[allow(dead_code)]
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

// POST /apply — the write door (D-22804 rung 2), defaulting to PROXY-EVERYTHING.
// Every batch is classified `proxy` for now: forward the RAW, UNPARSED body to
// the Deno /apply verbatim, preserve the x-via attribution header, and relay the
// status + body unchanged. A transparent write proxy — zero behavior change and
// zero divergence risk — and the safety net that lands BEFORE any native write.
// Classification is WHOLE-BATCH only (never per-change: apply() is atomic). A
// domain leaves the proxy list only in a later rung, once its transform is
// ported AND its three-surface parity test is green (write-parity harness).
async fn apply_route(State(app): State<App>, headers: HeaderMap, body: Bytes) -> Response {
    let Some(upstream) = app.upstream.clone() else {
        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "yak-bridge: /apply has no upstream — name the Deno server with \
             --upstream or TASKS_UPSTREAM (never 5173 from a probe).",
        )
            .into_response();
    };
    // x-via is an honesty header the Deno apply resolves to an actor; carry it
    // through unchanged so a proxied write attributes exactly as a direct one.
    let via = headers
        .get("x-via")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let out = tokio::task::spawn_blocking(move || proxy_apply(&upstream, via.as_deref(), &body))
        .await
        .unwrap_or_else(|e| (502, "text/plain".into(), format!("proxy panic: {e}")));
    let (status, ctype, text) = out;
    (
        axum::http::StatusCode::from_u16(status).unwrap_or(axum::http::StatusCode::BAD_GATEWAY),
        [(axum::http::header::CONTENT_TYPE, ctype)],
        text,
    )
        .into_response()
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
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--db" => db = args.next(),
            "--port" => port = args.next().and_then(|s| s.parse().ok()),
            "--upstream" => upstream = args.next(),
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

    let uri = ro_uri(&db);
    // Fail fast if the file will not open read-only, rather than 500 per request.
    if let Err(e) = Store::open(&uri) {
        eprintln!("yak-bridge: cannot open {db} read-only: {e}");
        std::process::exit(1);
    }
    // The READ_WRITE connection (rung 1): open it now — never migrate, never
    // create — so a same-build failure or an unwritable file is a loud boot exit,
    // not a surprise on the first native write. Held for rungs 4+; unused while
    // every batch proxies.
    let write = match yak_bridge::open_write(&db) {
        Ok(w) => Arc::new(Mutex::new(w)),
        Err(e) => {
            eprintln!("yak-bridge: cannot open {db} read-write: {e}");
            std::process::exit(1);
        }
    };
    let app = App {
        db: db.clone(),
        uri,
        upstream: upstream.clone(),
        write,
    };
    eprintln!(
        "yak-bridge: write door {}",
        match &upstream {
            Some(u) => format!("proxying every batch → {u}/apply"),
            None => "DISABLED (no --upstream/TASKS_UPSTREAM); /apply will 503".into(),
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
