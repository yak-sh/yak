// The wire-contract test: fire the SAME requests at the Deno server and at
// yak-bridge — both pointed at the SAME copy of the graph — and diff the
// responses byte-for-byte. A difference is a bug in the bridge or a discovered
// wire ambiguity; either way it fails here, and this corpus is the standing
// contract.
//
// Env-gated so `cargo test` is green with no servers up (the pure-logic tests
// below always run). To run the parity harness:
//
//   1. copy the live graph read-only:
//        sqlite3 'file:$HOME/.tasks/tasks.db?mode=ro' "VACUUM INTO '/tmp/probe.db'"
//   2. boot a probe Deno server on the copy, EFFECTS OFF:
//        TASKS_EFFECTS=daemon PORT=5271 DB_PATH=/tmp/probe.db \
//          deno run -A --unstable-net --unstable-worker-options src/server.ts
//   3. boot the bridge on the SAME copy, a different port:
//        yak-bridge --db /tmp/probe.db --port 5272
//   4. run:  TS_URL=http://127.0.0.1:5271 BRIDGE_URL=http://127.0.0.1:5272 \
//              cargo test -p yak-bridge --test parity -- --nocapture
//
// EFFECTS OFF is load-bearing for the WS tests, and it is why step 2 sets
// TASKS_EFFECTS=daemon and step 2 alone runs — do NOT also boot the effects
// daemon (effectsd.ts). TASKS_EFFECTS=daemon splits the DOING half out of the
// serving process; with no effectsd claiming that half, NO `where:'do'` effect
// fires, so nothing WRITES to the copy and the journal stays quiescent. That
// quiescence is the WS cursor comparison's precondition: every WS frame's
// `cursor` is the journal's `max(rowid)` sampled at the instant that server
// answered, and the TS and bridge samples are apples-to-apples only over a
// journal no one is advancing. Boot effectsd (or run the server with inline
// effects) and its effect writes advance the copy's journal UNDER the read-only
// bridge — the TS side's cursor drifts ahead and the WS tests fail on an
// off-by-one `cursor` that is a TEST-ISOLATION artifact, not a bridge bug (the
// bridge computes the identical max(rowid) the Deno server does; T-22790).
// `require_quiescent()` below asserts this precondition before the WS
// comparisons, so a writing probe fails loudly with the cause instead.
//
// Documented intentional divergence (D-22692 rung 1): the WS reset snapshot's
// `vocabHash` is the Deno server's own manifest hash, which the bridge cannot
// reproduce byte-for-byte until the hash is Rust-sourced (a rung-2 follow-up).
// The harness asserts the whole snapshot EXCEPT that one field, and the live
// frames (which carry no vocabHash) byte-exact.

use serde_json::Value;
use std::net::TcpStream;
use std::time::{Duration, Instant};

fn ts() -> Option<String> {
    std::env::var("TS_URL").ok().filter(|s| !s.is_empty())
}
fn br() -> Option<String> {
    std::env::var("BRIDGE_URL").ok().filter(|s| !s.is_empty())
}
fn both() -> Option<(String, String)> {
    Some((ts()?, br()?))
}

// A browser percent-encodes the URI-unsafe chars before it sends a URL; ureq's
// http layer likewise REFUSES a raw `<`/`>` in the request target. Encode just
// those two (the corpus's `<=`/`>=` filters) so the wire carries what a real
// client sends — both servers decodeURIComponent each segment back, so the
// answer is unchanged; this only lets the request leave the harness.
fn wire(path: &str) -> String {
    path.replace('<', "%3C").replace('>', "%3E")
}

// GET, returning (status, raw body). ureq folds a 4xx into an Err whose body is
// the message — lift it so a 400 diffs like any other answer.
fn get(base: &str, path: &str) -> (u16, String) {
    let url = format!("{base}{}", wire(path));
    match ureq::get(&url).call() {
        Ok(mut r) => {
            let s = r.status().as_u16();
            (s, r.body_mut().read_to_string().unwrap_or_default())
        }
        Err(ureq::Error::StatusCode(code)) => (code, String::new()),
        Err(e) => panic!("GET {url} failed: {e}"),
    }
}

fn timed(base: &str, path: &str) -> (u16, String, Duration) {
    let t = Instant::now();
    let (s, b) = get(base, path);
    (s, b, t.elapsed())
}

// Assert both servers answer a path identically, and report the latency of each.
fn same(ts: &str, br: &str, path: &str) -> (Duration, Duration) {
    let (ts_s, ts_b, ts_t) = timed(ts, path);
    let (br_s, br_b, br_t) = timed(br, path);
    assert_eq!(ts_s, br_s, "status differs for {path}");
    if ts_b != br_b {
        let cut = ts_b.chars().zip(br_b.chars()).position(|(a, b)| a != b).unwrap_or(0);
        let from = cut.saturating_sub(60);
        panic!(
            "BODY DIFFERS for {path} at byte {cut}\n  ts:     …{}\n  bridge: …{}",
            &ts_b[from..(cut + 80).min(ts_b.len())],
            &br_b[from..(cut + 80).min(br_b.len())],
        );
    }
    (ts_t, br_t)
}

// A short human id (T-3, P-19, …) for a kind, discovered from the TS server so
// the corpus needs no hardcoded ids.
fn an_id(ts: &str, kind: &str) -> Option<String> {
    let (_, body) = get(ts, &format!("/query?.kind={kind}&limit=1"));
    let v: Value = serde_json::from_str(&body).ok()?;
    let row = v.as_array()?.first()?;
    let num = row.get("entity")?.get("num")?.as_i64()?;
    // prefix from kind
    let p = match kind {
        "task" => "T",
        "project" => "P",
        "design" => "D",
        "memory" => "M",
        "board" => "B",
        "session" => "S",
        _ => return row.get("entity")?.get("eid")?.as_str().map(String::from),
    };
    Some(format!("{p}-{num}"))
}

fn an_eid(ts: &str, kind: &str) -> Option<String> {
    let (_, body) = get(ts, &format!("/query?.kind={kind}&limit=1"));
    let v: Value = serde_json::from_str(&body).ok()?;
    v.as_array()?
        .first()?
        .get("entity")?
        .get("eid")?
        .as_str()
        .map(String::from)
}

#[test]
fn query_parity() {
    let Some((ts, br)) = both() else {
        eprintln!("query_parity: skipped (set TS_URL and BRIDGE_URL)");
        return;
    };
    let mut corpus: Vec<String> = vec![
        "/query?.kind=project".into(),
        "/query?.kind=project&deps=1".into(),
        "/query?.kind=board".into(),
        "/query?.kind=task&limit=1".into(),
        "/query?.kind=task&limit=5".into(),
        "/query?.kind=task&limit=200".into(),
        "/query?.kind=task&.status=open&limit=10".into(),
        "/query?.kind=task&.status=wip".into(),
        "/query?.kind=task&.priority=0&limit=20".into(),
        "/query?.kind=memory&limit=8".into(),
        "/query?.kind=design&limit=5".into(),
        "/query?.kind=session&limit=3".into(),
        "/query?.kind=session&limit=3&deps=1".into(),
        // a VALID filter that matches nothing — the empty array, both ways
        "/query?.kind=task&.title~=zqzq_no_such_title_xyz".into(),
        // The indexed candidate path (T-22758) narrows these through SQL where the
        // old bulk read filtered in Rust; each exercises a different compiler arm,
        // and every one must stay byte-identical to TS's evalFast answer.
        "/query?.kind=task&.status=open,wip&limit=50".into(), // enum list
        "/query?.kind=task&.priority<=1&limit=30".into(),      // numeric compare
        "/query?.kind=task&.priority=0,2&limit=40".into(),     // numeric list
        "/query?.kind=task&.status!=done&limit=100".into(),    // negation + NULL
        "/query?.kind=task&.status=open&.priority=0&limit=15".into(), // AND, one join
        "/query?.kind=task&.title~=port&limit=20".into(),      // contains (instr)
        "/query?.kind=task&.assignee=&limit=20".into(),        // absence
        "/query?.kind=task&.doc!&limit=20".into(),             // component presence
        // The WINDOWED pure-limit route (T-22777): an explicit `limit` pushes
        // the newest-N window into SQL (rows_window) instead of bulk-loading and
        // cutting in Rust. Each must stay byte-identical to the bulk-cut answer.
        //   - a kind whose comp OVERLAPS an earlier kind (a `board` comp worn by
        //     a project) proves the derived-kind screen rides the SQL BEFORE the
        //     LIMIT — a screened row must not fill and then vacate the page.
        "/query?.kind=board&limit=1".into(),
        "/query?.kind=board&limit=3".into(),
        "/query?.kind=project&limit=2".into(),
        //   - a filter that compiles EXACTLY + limit: the window's exact path
        //     (LIMIT in the statement).
        "/query?.kind=task&.status=open&limit=1".into(),
        "/query?.kind=task&.priority<=1&limit=1".into(),
        //   - a filter that DECLINES to compile (a time phrase) + limit: the
        //     window's inexact fallback (narrow → refine → screen → cut in Rust).
        "/query?.kind=task&.updated.at>=today&limit=5".into(),
        //   - a reference filter + limit, on a kind other than task.
        "/query?.kind=memory&.scope=P-19&limit=3".into(),
        // AGGREGATE projections (T-22759): the value, not a row set. `.count!`
        // is one number; `.tally=` the value→count map (keys ascending);
        // `.distinct=` the sorted keys. The bridge reuses the kernel's one
        // eval_agg (subquery.rs) — never a second evaluator.
        "/query?.kind=task&.status=open&.count!".into(),
        "/query?.kind=task&.tally=task.status".into(),
        "/query?.kind=task&.distinct=task.status".into(),
        "/query?.kind=memory&.tally=memory.scope".into(),
        // GRAMMAR / VALIDATION edges (T-22759), reconciled to TS parseQuery in
        // BOTH directions:
        //   - an out-of-enum value 400s, the message byte-identical to props.ts
        //     ("task.status is one of open, wip, done, cancelled — got 'x'").
        "/query?.status=nonesuch".into(),
        "/query?.kind=task&.status=open,nonesuch".into(),
        "/query?.priority=notanum".into(),
        //   - an opless dot-word is a TEXT term, not a filter: 200 [] where the
        //     term matches nothing (the kernel used to 400 "unsupported
        //     filter"). A no-match token, so it is byte-parity here — a term
        //     that WOULD FTS-match is the standing text divergence, screened
        //     out. `.zzz.zzz` itself now matches this task family's own bodies,
        //     so the corpus uses a token no doc carries.
        "/query?.zqx7kk3vqnomatch".into(),
        "/query?.kind=task&.zqx7kk3vqnomatch.nope".into(),
    ];
    // id= addressing, deps=1, backlinks=1, and after= paging, seeded from live
    // ids.
    for kind in ["project", "task", "design", "memory"] {
        if let Some(id) = an_id(&ts, kind) {
            corpus.push(format!("/query?id={id}"));
            corpus.push(format!("/query?id={id}&deps=1"));
            // backlinks=1 (T-22759): who points AT the hit — the reverse-ref
            // layer over every {eid} column plus the incident edges.
            corpus.push(format!("/query?id={id}&backlinks=1"));
            corpus.push(format!("/query?id={id}&deps=1&backlinks=1"));
        }
    }
    // backlinks over a whole (small) kind listing exercises the multi-hit
    // grouping and ordering, not just one target.
    corpus.push("/query?.kind=board&backlinks=1".into());
    if let (Some(a), Some(b)) = (an_id(&ts, "project"), an_id(&ts, "task")) {
        corpus.push(format!("/query?id={a},{b}"));
    }
    // after= continues a num window
    corpus.push("/query?.kind=task&limit=5&after=22000".into());

    let mut ts_tot = Duration::ZERO;
    let mut br_tot = Duration::ZERO;
    for path in &corpus {
        let (t, b) = same(&ts, &br, path);
        ts_tot += t;
        br_tot += b;
        eprintln!("ok  {path}   ts={t:?} bridge={b:?}");
    }
    eprintln!(
        "\n/query corpus: {} requests — ts total {ts_tot:?}, bridge total {br_tot:?}",
        corpus.len()
    );
}

#[test]
fn journal_parity() {
    let Some((ts, br)) = both() else {
        eprintln!("journal_parity: skipped (set TS_URL and BRIDGE_URL)");
        return;
    };
    let mut corpus: Vec<String> = vec![];
    for kind in ["task", "project", "memory", "design"] {
        if let Some(eid) = an_eid(&ts, kind) {
            corpus.push(format!("/journal?eid={eid}"));
            corpus.push(format!("/journal?eid={eid}&limit=5"));
        }
    }
    // by-instrument: find a `via` from a recent journal entry.
    if let Some(eid) = an_eid(&ts, "task") {
        let (_, body) = get(&ts, &format!("/journal?eid={eid}&limit=1"));
        if let Ok(v) = serde_json::from_str::<Value>(&body) {
            if let Some(via) = v.as_array().and_then(|a| a.first()).and_then(|e| e.get("via")).and_then(|x| x.as_str()) {
                corpus.push(format!("/journal?via={via}&limit=20"));
            }
        }
    }
    assert!(!corpus.is_empty(), "journal_parity found no eids to test");
    for path in &corpus {
        let (t, b) = same(&ts, &br, path);
        eprintln!("ok  {path}   ts={t:?} bridge={b:?}");
    }
}

// --- WS parity ---------------------------------------------------------------

// A minimal blocking WS client: HTTP upgrade, then read/write unmasked-agnostic
// text frames. Enough to send one join and read a handful of frames; tungstenite
// handles the framing and masking.
struct Ws {
    inner: tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>,
}
impl Ws {
    fn open(base: &str) -> Ws {
        let url = format!("{}/ws", base.replace("http", "ws"));
        let (mut sock, _res) = tungstenite::connect(&url).expect("ws connect");
        // non-blocking reads with our own deadline
        if let tungstenite::stream::MaybeTlsStream::Plain(s) = sock.get_mut() {
            s.set_read_timeout(Some(Duration::from_millis(200))).ok();
        }
        Ws { inner: sock }
    }
    fn send(&mut self, txt: &str) {
        self.inner.send(tungstenite::Message::Text(txt.into())).expect("ws send");
    }
    // Read the next non-ping text frame, or None within `deadline`.
    fn next_text(&mut self, deadline: Duration) -> Option<String> {
        let t = Instant::now();
        while t.elapsed() < deadline {
            match self.inner.read() {
                Ok(tungstenite::Message::Text(s)) => {
                    let s = s.to_string();
                    if s == "ping" || s == "{\"ping\":1}" {
                        continue;
                    }
                    return Some(s);
                }
                Ok(_) => continue,
                Err(tungstenite::Error::Io(e))
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    continue
                }
                Err(_) => return None,
            }
        }
        None
    }
}

fn strip_vocab_hash(mut v: Value) -> Value {
    if let Some(s) = v.get_mut("snapshot").and_then(|s| s.as_object_mut()) {
        s.insert("vocabHash".into(), Value::from("<normalized>"));
    }
    v
}

// The probe TS journal's current tip (`max(rowid)`), read off a throwaway
// join's reset `cursor` — the same value every WS frame stamps. -1 if the
// server never answers (its death, not a tip).
fn tip(base: &str) -> i64 {
    let mut ws = Ws::open(base);
    ws.send(JOIN);
    let Some(reset) = ws.next_text(Duration::from_secs(5)) else { return -1 };
    serde_json::from_str::<Value>(&reset)
        .ok()
        .and_then(|v| v["snapshot"]["cursor"].as_i64())
        .unwrap_or(-1)
}

// The WS cursor comparison's PRECONDITION: the shared copy's journal must be
// quiescent, or the TS and bridge cursor samples (each `max(rowid)` at its own
// instant) are not apples-to-apples. Prove it holds — sample the TS tip twice
// with a gap and require it to hold still — before any cross-server cursor
// comparison runs. A moving tip means the probe TS server is WRITING to the
// copy (effectsd booted, or inline effects), which drifts its cursor ahead of
// the read-only bridge; fail loudly naming that cause, rather than surfacing it
// downstream as a cryptic off-by-one `cursor` diff (T-22790). This is a
// test-isolation artifact — the bridge computes the identical max(rowid) the
// Deno server does — so the fix is the probe setup, not the wire.
fn require_quiescent(ts: &str) {
    for _ in 0..40 {
        let a = tip(ts);
        std::thread::sleep(Duration::from_millis(150));
        let b = tip(ts);
        if a >= 0 && a == b {
            return;
        }
    }
    panic!(
        "probe TS journal at {ts} keeps advancing — the probe server is WRITING \
         to the shared copy, so its WS `cursor` drifts ahead of the read-only \
         bridge and the byte-parity comparison is not apples-to-apples. Run the \
         probe TS server with effects OFF (TASKS_EFFECTS=daemon and do NOT boot \
         effectsd) so the journal is quiescent. This is a test-isolation \
         artifact, not a bridge cursor bug (the bridge computes the identical \
         max(rowid) the Deno server does; T-22790)."
    );
}

#[test]
fn ws_join_and_live_parity() {
    let Some((ts, br)) = both() else {
        eprintln!("ws_join_and_live_parity: skipped (set TS_URL and BRIDGE_URL)");
        return;
    };
    // The cursor comparisons below are apples-to-apples only over a quiescent
    // journal — prove the probe copy is not being written before we start.
    require_quiescent(&ts);

    // --- the JOIN handshake: a cold {since:0} resets both to the working set.
    let join = "{\"since\":0,\"live\":1,\"ws\":1}";
    let mut ts_ws = Ws::open(&ts);
    let mut br_ws = Ws::open(&br);
    ts_ws.send(join);
    br_ws.send(join);
    let ts_reset: Value =
        serde_json::from_str(&ts_ws.next_text(Duration::from_secs(5)).expect("ts reset")).unwrap();
    let br_reset: Value =
        serde_json::from_str(&br_ws.next_text(Duration::from_secs(5)).expect("bridge reset")).unwrap();

    // vocabHash is the one documented divergence — normalize it out, assert the
    // rest byte-for-byte (changes, deps, cursor, epoch, capabilities).
    let ts_n = strip_vocab_hash(ts_reset.clone());
    let br_n = strip_vocab_hash(br_reset.clone());
    assert_eq!(
        serde_json::to_string(&ts_n).unwrap(),
        serde_json::to_string(&br_n).unwrap(),
        "WS reset snapshot differs (beyond vocabHash)"
    );
    let ts_vh = ts_reset["snapshot"]["vocabHash"].as_str().unwrap_or("");
    let br_vh = br_reset["snapshot"]["vocabHash"].as_str().unwrap_or("");
    eprintln!("WS reset: snapshot byte-parity OK (vocabHash ts={ts_vh} bridge={br_vh} — documented divergence)");

    // --- a foreign write via Deno /apply, observed live on BOTH streams.
    let eid = format!("{}", uuid_v4());
    let create = format!(
        "[{{\"eid\":\"{eid}\",\"name\":\"doc\",\"comp\":{{\"title\":\"parity-live-probe\"}}}}]"
    );
    apply(&ts, &create);

    let ts_live = collect_live(&mut ts_ws, &eid, Duration::from_secs(5));
    let br_live = collect_live(&mut br_ws, &eid, Duration::from_secs(5));
    let ts_live = ts_live.expect("ts live frame for the probe write");
    let br_live = br_live.expect("bridge live frame for the probe write");
    assert_eq!(
        serde_json::to_string(&ts_live).unwrap(),
        serde_json::to_string(&br_live).unwrap(),
        "WS live frame differs for the foreign write"
    );
    eprintln!("WS live: frame byte-parity OK for the foreign write");

    // clean up the probe entity (delete it), and observe the delete live too.
    let del = format!("[{{\"eid\":\"{eid}\",\"name\":\"entity\",\"comp\":null}}]");
    apply(&ts, &del);
    let ts_del = collect_live(&mut ts_ws, &eid, Duration::from_secs(5));
    let br_del = collect_live(&mut br_ws, &eid, Duration::from_secs(5));
    if let (Some(a), Some(b)) = (ts_del, br_del) {
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap(),
            "WS live delete frame differs"
        );
        eprintln!("WS live: delete frame byte-parity OK");
    }
}

// Read live frames until one mentions `eid`, returning that frame (envelope or
// bare array), or None on timeout.
fn collect_live(ws: &mut Ws, eid: &str, deadline: Duration) -> Option<Value> {
    let t = Instant::now();
    while t.elapsed() < deadline {
        let Some(s) = ws.next_text(Duration::from_millis(500)) else { continue };
        if !s.contains(eid) {
            continue;
        }
        return serde_json::from_str(&s).ok();
    }
    None
}

fn apply(base: &str, batch: &str) {
    let url = format!("{base}/apply");
    ureq::post(&url)
        .header("content-type", "application/json")
        .send(batch)
        .expect("apply");
}

// A v4 uuid without pulling a dep into the dev-deps.
fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let a = (n & 0xffff_ffff) as u32;
    let b = ((n >> 32) & 0xffff) as u16;
    let c = 0x4000 | (((n >> 48) & 0x0fff) as u16);
    let d = 0x8000 | ((n >> 60) & 0x3fff) as u16;
    let e = (n >> 20) & 0xffff_ffff_ffff;
    format!("{a:08x}-{b:04x}-{c:04x}-{d:04x}-{e:012x}")
}

// --- WS subscription parity --------------------------------------------------

// The cold JOIN a client sends before subscribing (working-set reset + live).
const JOIN: &str = "{\"since\":0,\"live\":1,\"ws\":1}";

// Open a socket, run the JOIN handshake, and drain the reset frame — the state a
// client is in when it starts subscribing.
fn joined_ws(base: &str) -> Ws {
    let mut ws = Ws::open(base);
    ws.send(JOIN);
    ws.next_text(Duration::from_secs(5)).expect("reset frame");
    ws
}

// Read frames until one is a subscription frame for `name` (its `sub` field), or
// None on timeout — skips the reset, live frames, and other subs' frames.
fn next_sub(ws: &mut Ws, name: &str, deadline: Duration) -> Option<Value> {
    let t = Instant::now();
    while t.elapsed() < deadline {
        let Some(s) = ws.next_text(Duration::from_millis(500)) else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&s) else { continue };
        if v.get("sub").and_then(|x| x.as_str()) == Some(name) {
            return Some(v);
        }
    }
    None
}

// Subscribe on both sockets and assert the initial reply is byte-identical.
fn same_sub(ts_ws: &mut Ws, br_ws: &mut Ws, name: &str, q: &str) {
    let frame = format!(
        "{{\"sub\":\"{name}\",\"q\":\"{}\"}}",
        q.replace('\\', "\\\\").replace('"', "\\\"")
    );
    ts_ws.send(&frame);
    br_ws.send(&frame);
    let ts = next_sub(ts_ws, name, Duration::from_secs(5)).expect("ts sub reply");
    let br = next_sub(br_ws, name, Duration::from_secs(5)).expect("bridge sub reply");
    assert_eq!(
        serde_json::to_string(&ts).unwrap(),
        serde_json::to_string(&br).unwrap(),
        "SUB reply differs for {name} (q={q})"
    );
    eprintln!("ok  sub {name}  (q={q})");
}

// After a foreign write, assert both sockets emit a byte-identical delta for the
// named sub (or that BOTH stay silent, when the write moves nothing).
fn same_sub_delta(ts_ws: &mut Ws, br_ws: &mut Ws, name: &str, what: &str) {
    let ts = next_sub(ts_ws, name, Duration::from_secs(5));
    let br = next_sub(br_ws, name, Duration::from_secs(5));
    match (ts, br) {
        (Some(a), Some(b)) => {
            assert_eq!(
                serde_json::to_string(&a).unwrap(),
                serde_json::to_string(&b).unwrap(),
                "SUB delta differs for {name} after {what}"
            );
            eprintln!("ok  sub-delta {name}  ({what})");
        }
        (None, None) => eprintln!("ok  sub-delta {name}  ({what}: both silent)"),
        (a, b) => panic!(
            "SUB delta presence differs for {name} after {what}: ts={} bridge={}",
            a.is_some(),
            b.is_some()
        ),
    }
}

#[test]
fn ws_sub_parity() {
    let Some((ts, br)) = both() else {
        eprintln!("ws_sub_parity: skipped (set TS_URL and BRIDGE_URL)");
        return;
    };
    // Sub replies and deltas each stamp a `cursor` sampled at answer time; the
    // TS and bridge samples match only over a journal no one is advancing.
    require_quiescent(&ts);

    // --- initial-answer parity across the ported sub kinds -------------------
    // Membership (kind-anchored subset grammar), windowed (`.limit=`), aggregate
    // (`.count!`/`.tally=`/`.distinct=`), and a route sub (one entity whole).
    let mut ts_ws = joined_ws(&ts);
    let mut br_ws = joined_ws(&br);

    let cases: &[(&str, &str)] = &[
        ("m-project", ".kind=project"),
        ("m-board", ".kind=board"),
        ("m-wip", ".kind=task&.status=wip"),
        ("w-mem5", ".kind=memory&.limit=5"),
        ("w-task3", ".kind=task&.limit=3"),
        ("a-count", ".kind=task&.status=open&.count!"),
        ("a-tally", ".kind=task&.tally=task.status"),
        ("a-distinct", ".kind=task&.distinct=task.status"),
    ];
    for (name, q) in cases {
        same_sub(&mut ts_ws, &mut br_ws, name, q);
    }

    // A route sub streams ONE entity whole (bodies included), seeded from a live
    // task id.
    if let Some(eid) = an_eid(&ts, "task") {
        same_sub(&mut ts_ws, &mut br_ws, &format!("route:{eid}"), "");
    }

    // --- live maintain parity: add / update / dead / remove ------------------
    // A FRESH socket pair carrying ONLY the marker sub, so each write fires
    // exactly one delta and next_sub never has to discard a sibling sub's frame
    // while hunting for this one. (The other sockets' subs still fire on the same
    // writes — into buffers this test does not read.)
    let mut ts_ws = joined_ws(&ts);
    let mut br_ws = joined_ws(&br);
    // A membership sub whose set is EMPTY (a marker no live task carries), so the
    // deltas a fresh write drives are deterministic and small.
    let marker = format!("zqmark{}", &uuid_v4()[..8]);
    let name = "m-marker";
    let q = format!(".kind=task&.title~={marker}");
    same_sub(&mut ts_ws, &mut br_ws, name, &q);

    // create a task carrying the marker → an ADD on both.
    let eid = uuid_v4();
    apply(
        &ts,
        &format!(
            "[{{\"eid\":\"{eid}\",\"name\":\"doc\",\"comp\":{{\"title\":\"{marker} one\"}}}},\
              {{\"eid\":\"{eid}\",\"name\":\"task\",\"comp\":{{\"status\":\"open\"}}}}]"
        ),
    );
    same_sub_delta(&mut ts_ws, &mut br_ws, name, "create (add)");

    // patch the title, still carrying the marker → an UPDATE (the batch's own
    // doc change, plus the updated envelope) on both.
    apply(
        &ts,
        &format!(
            "[{{\"eid\":\"{eid}\",\"name\":\"doc\",\"comp\":{{\"title\":\"{marker} two\"}}}}]"
        ),
    );
    same_sub_delta(&mut ts_ws, &mut br_ws, name, "retitle (update)");

    // delete the task → a DEAD (entity-null) on both.
    apply(&ts, &format!("[{{\"eid\":\"{eid}\",\"name\":\"entity\",\"comp\":null}}]"));
    same_sub_delta(&mut ts_ws, &mut br_ws, name, "delete (dead)");

    // A REMOVE (a standing member that stops matching): create carrying the
    // marker (add), then retitle WITHOUT it (drop).
    let eid2 = uuid_v4();
    apply(
        &ts,
        &format!(
            "[{{\"eid\":\"{eid2}\",\"name\":\"doc\",\"comp\":{{\"title\":\"{marker} keep\"}}}},\
              {{\"eid\":\"{eid2}\",\"name\":\"task\",\"comp\":{{\"status\":\"open\"}}}}]"
        ),
    );
    same_sub_delta(&mut ts_ws, &mut br_ws, name, "create#2 (add)");
    apply(
        &ts,
        &format!("[{{\"eid\":\"{eid2}\",\"name\":\"doc\",\"comp\":{{\"title\":\"gone now\"}}}}]"),
    );
    same_sub_delta(&mut ts_ws, &mut br_ws, name, "retitle-away (remove)");
    // clean up the probe entity.
    apply(&ts, &format!("[{{\"eid\":\"{eid2}\",\"name\":\"entity\",\"comp\":null}}]"));
    same_sub_delta(&mut ts_ws, &mut br_ws, name, "delete#2 (dead)");

    // --- window + aggregate MAINTAIN parity ----------------------------------
    // Each on its OWN socket pair so a single task write fires exactly one delta:
    // a windowed sub RE-ANSWERS (a new top-num task enters the newest-3, pushing
    // one out); a `.count!` aggregate ships the value→count DIFF.
    let mut ts_wm = joined_ws(&ts);
    let mut br_wm = joined_ws(&br);
    same_sub(&mut ts_wm, &mut br_wm, "wm", ".kind=task&.limit=3");
    let mut ts_cm = joined_ws(&ts);
    let mut br_cm = joined_ws(&br);
    same_sub(&mut ts_cm, &mut br_cm, "cm", ".kind=task&.status=open&.count!");

    let eid3 = uuid_v4();
    apply(
        &ts,
        &format!(
            "[{{\"eid\":\"{eid3}\",\"name\":\"doc\",\"comp\":{{\"title\":\"{marker} win\"}}}},\
              {{\"eid\":\"{eid3}\",\"name\":\"task\",\"comp\":{{\"status\":\"open\"}}}}]"
        ),
    );
    same_sub_delta(&mut ts_wm, &mut br_wm, "wm", "create (window re-answer)");
    same_sub_delta(&mut ts_cm, &mut br_cm, "cm", "create (count +1)");
    apply(&ts, &format!("[{{\"eid\":\"{eid3}\",\"name\":\"entity\",\"comp\":null}}]"));
    same_sub_delta(&mut ts_wm, &mut br_wm, "wm", "delete (window re-answer)");
    same_sub_delta(&mut ts_cm, &mut br_cm, "cm", "delete (count -1)");

    eprintln!("\nWS subscription parity OK");
}

// --- pure logic tests (always run, no servers) -------------------------------

#[test]
fn decode_matches_decodeuricomponent() {
    assert_eq!(yak_bridge::read::decode(".task.priority%3C%3D1"), ".task.priority<=1");
    assert_eq!(yak_bridge::read::decode("a%20b%26c"), "a b&c");
    assert_eq!(yak_bridge::read::decode("P-19"), "P-19");
    // a stray percent passes through literally
    assert_eq!(yak_bridge::read::decode("100%"), "100%");
}

#[test]
fn parse_query_splits_flags_and_ids() {
    let q = yak_bridge::read::parse_query(".kind=task&deps=1&id=T-3,T-4&limit=5&after=100");
    assert!(q.deps);
    assert_eq!(q.limit, Some(5));
    assert_eq!(q.after, Some(100));
    assert_eq!(q.ids, vec!["T-3".to_string(), "T-4".to_string()]);
    assert_eq!(q.filters, vec![".kind=task".to_string()]);
}
