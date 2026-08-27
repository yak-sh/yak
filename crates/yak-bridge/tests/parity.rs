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
//   2. boot a probe Deno server on the copy, EFFECTS OFF and EMBED OFF:
//        TASKS_EFFECTS=daemon TASKS_EMBED=0 PORT=5271 DB_PATH=/tmp/probe.db \
//          deno run -A --unstable-net --unstable-worker-options src/server.ts
//      TASKS_EMBED=0 is load-bearing for the WS tests alongside effects-off: the
//      embed sweep WRITES embedding columns on a timer, advancing the probe's
//      journal minutes into a run and drifting the TS WS `cursor` ahead of the
//      read-only bridge — the same T-22790 cursor artifact require_quiescent
//      guards, surfacing only once the sweep first fires (T-22756).
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

// The eid behind a human id (T-22548 → its uuid), read off the /query id= door.
fn eid_of_id(base: &str, id: &str) -> Option<String> {
    let (_, body) = get(base, &format!("/query?id={id}"));
    serde_json::from_str::<Value>(&body)
        .ok()?
        .as_array()?
        .first()?
        .get("entity")?
        .get("eid")?
        .as_str()
        .map(String::from)
}

#[test]
fn query_parity() {
    if write_mode() {
        eprintln!("query_parity: skipped (write mode — read parity wants one shared copy)");
        return;
    }
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
    if write_mode() {
        eprintln!("journal_parity: skipped (write mode — read parity wants one shared copy)");
        return;
    }
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
    if write_mode() {
        eprintln!("ws_join_and_live_parity: skipped (write mode — read parity wants one shared copy)");
        return;
    }
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
    if write_mode() {
        eprintln!("ws_sub_parity: skipped (write mode — read parity wants one shared copy)");
        return;
    }
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
        // FIELDS projection (T-22756): each member rides only its projected
        // columns + spine, and the frame STATES the projection. A `~` column is
        // volatile (delivered, wake:false); `.fields=eid` is the eids-only form.
        ("f-pin", ".pin!&.fields=pin.x,pin.z~"),
        ("f-eids", ".card!&.fields=eid"),
        // REACHES traversal (T-22756): the tasks that reach T-22548 through at
        // most 3 `requires` edges — a bounded closure the matcher tests with a
        // Set lookup, resolved once per pass from the recursive CTE.
        ("r-reach", ".kind=task&.reaches[requires,<=3]=T-22548"),
        ("r-reach1", ".kind=task&.reaches[requires,<=1]=T-22548"),
        // EDGES rider (T-22756): the dep triples incident to the member set ride
        // beside the rows (`.edges!`), and `.edges.peers=` projects the far
        // endpoint's named columns — a bare rider and a peer-projecting one, over
        // a small kind whose members carry incident edges (boards, projects).
        ("e-board", ".kind=board&.edges!"),
        ("e-project", ".kind=project&.edges!"),
        ("e-peers", ".kind=board&.edges.peers=title"),
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

    // --- FIELDS projection MAINTAIN parity (T-22756) -------------------------
    // On its own socket pair, a marker task sub projected to `task.status`: an
    // ADD carries the projected column + spine (the doc, not projected, never
    // rides); a patch to the PROJECTED column ships a projected update; a patch
    // to a NON-projected column (priority) projects to nothing and both stay
    // silent; a delete forwards entity-null.
    let mut ts_fm = joined_ws(&ts);
    let mut br_fm = joined_ws(&br);
    let fmark = format!("zqfmark{}", &uuid_v4()[..8]);
    same_sub(&mut ts_fm, &mut br_fm, "fm", &format!(".kind=task&.title~={fmark}&.fields=task.status"));
    let feid = uuid_v4();
    apply(
        &ts,
        &format!(
            "[{{\"eid\":\"{feid}\",\"name\":\"doc\",\"comp\":{{\"title\":\"{fmark} f\"}}}},\
              {{\"eid\":\"{feid}\",\"name\":\"task\",\"comp\":{{\"status\":\"open\",\"priority\":0}}}}]"
        ),
    );
    same_sub_delta(&mut ts_fm, &mut br_fm, "fm", "create (projected add)");
    apply(&ts, &format!("[{{\"eid\":\"{feid}\",\"name\":\"task\",\"comp\":{{\"status\":\"wip\"}}}}]"));
    same_sub_delta(&mut ts_fm, &mut br_fm, "fm", "patch task.status (projected update)");
    apply(&ts, &format!("[{{\"eid\":\"{feid}\",\"name\":\"task\",\"comp\":{{\"priority\":2}}}}]"));
    same_sub_delta(&mut ts_fm, &mut br_fm, "fm", "patch task.priority (unprojected: both silent)");
    apply(&ts, &format!("[{{\"eid\":\"{feid}\",\"name\":\"entity\",\"comp\":null}}]"));
    same_sub_delta(&mut ts_fm, &mut br_fm, "fm", "delete (dead)");

    // --- REACHES traversal MAINTAIN parity (T-22756) -------------------------
    // A `.reaches[requires,<=3]=T-22548` sub: creating a task does not reach the
    // target (both silent); LINKING a `requires` edge to the target makes it
    // reach (ADD); UNLINKING drops it (REMOVE). The closure is rebuilt per batch,
    // so an edge landing moves membership even though the batch mentions only the
    // edge's own parent.
    if let Some(target) = eid_of_id(&ts, "T-22548") {
        let mut ts_rm = joined_ws(&ts);
        let mut br_rm = joined_ws(&br);
        same_sub(&mut ts_rm, &mut br_rm, "rm", ".kind=task&.reaches[requires,<=3]=T-22548");
        let reid = uuid_v4();
        apply(
            &ts,
            &format!(
                "[{{\"eid\":\"{reid}\",\"name\":\"doc\",\"comp\":{{\"title\":\"zqreach probe\"}}}},\
                  {{\"eid\":\"{reid}\",\"name\":\"task\",\"comp\":{{\"status\":\"open\"}}}}]"
            ),
        );
        same_sub_delta(&mut ts_rm, &mut br_rm, "rm", "create task (no edge: both silent)");
        apply(
            &ts,
            &format!(
                "[{{\"eid\":\"{reid}\",\"name\":\"dependency\",\"comp\":{{\"type\":\"requires\",\"child\":\"{target}\"}}}}]"
            ),
        );
        same_sub_delta(&mut ts_rm, &mut br_rm, "rm", "link requires (reach add)");
        apply(
            &ts,
            &format!(
                "[{{\"eid\":\"{reid}\",\"name\":\"dependency\",\"comp\":{{\"type\":\"requires\",\"child\":\"{target}\",\"gone\":true}}}}]"
            ),
        );
        same_sub_delta(&mut ts_rm, &mut br_rm, "rm", "unlink (reach remove)");
        apply(&ts, &format!("[{{\"eid\":\"{reid}\",\"name\":\"entity\",\"comp\":null}}]"));
        same_sub_delta(&mut ts_rm, &mut br_rm, "rm", "delete (both silent)");
    }

    // --- EDGES rider MAINTAIN parity (T-22756) -------------------------------
    // A `.kind=task&.title~=<marker>&.edges.peers=title` sub: a new marker task
    // ADDs (rider silent, no edges yet); LINKING it `requires` a live task adds
    // the incident edge and projects the far endpoint's title (a held peer);
    // UNLINKING withdraws the edge and unpeers; deleting the member forwards
    // entity-null. Composes membership, the incident set, and the peer projection.
    if let Some(peer) = an_id(&ts, "task") {
        let mut ts_em = joined_ws(&ts);
        let mut br_em = joined_ws(&br);
        let emark = format!("zqemark{}", &uuid_v4()[..8]);
        same_sub(&mut ts_em, &mut br_em, "em", &format!(".kind=task&.title~={emark}&.edges.peers=title"));
        let aid = uuid_v4();
        apply(
            &ts,
            &format!(
                "[{{\"eid\":\"{aid}\",\"name\":\"doc\",\"comp\":{{\"title\":\"{emark} a\"}}}},\
                  {{\"eid\":\"{aid}\",\"name\":\"task\",\"comp\":{{\"status\":\"open\"}}}}]"
            ),
        );
        same_sub_delta(&mut ts_em, &mut br_em, "em", "create member (add, rider silent)");
        let peer_eid = eid_of_id(&ts, &peer).expect("peer eid");
        apply(
            &ts,
            &format!(
                "[{{\"eid\":\"{aid}\",\"name\":\"dependency\",\"comp\":{{\"type\":\"requires\",\"child\":\"{peer_eid}\"}}}}]"
            ),
        );
        same_sub_delta(&mut ts_em, &mut br_em, "em", "link requires (edge + peer projection)");
        apply(
            &ts,
            &format!(
                "[{{\"eid\":\"{aid}\",\"name\":\"dependency\",\"comp\":{{\"type\":\"requires\",\"child\":\"{peer_eid}\",\"gone\":true}}}}]"
            ),
        );
        same_sub_delta(&mut ts_em, &mut br_em, "em", "unlink (unedge + unpeer)");
        apply(&ts, &format!("[{{\"eid\":\"{aid}\",\"name\":\"entity\",\"comp\":null}}]"));
        same_sub_delta(&mut ts_em, &mut br_em, "em", "delete member (dead)");
    }

    eprintln!("\nWS subscription parity OK");
}

// --- WRITE parity: two fresh copies, three surfaces (D-22804 rung 3) ----------
//
// Writes MUTATE, so a write batch cannot be fired at two servers over ONE shared
// copy — the first would move the graph the second reads. The write harness runs
// over TWO fresh copies, each seeded from the SAME `VACUUM INTO` snapshot:
//
//   copy-A: a Deno server               → TS_URL  (fire the batch DIRECT here)
//   copy-B: a Deno server + the bridge   → BRIDGE_URL (fire it at the bridge,
//           which PROXIES to copy-B's Deno; boot the bridge --upstream that Deno).
//
// The batch reaches each copy through a DIFFERENT door — direct vs proxied — and
// the harness diffs THREE surfaces the copies then present, canonicalized for the
// two things that can never byte-match between independent writers: wall-clock
// stamps (created/updated/claimed_at …) → `<ts>`, and server-minted uuids (a
// conflict row's eid) → `<u0>`,`<u1>`,… in first-seen order. Everything else —
// client eids (identical inputs), nums (lockstep minting), enum/text — rides
// through untouched, so a real divergence still shows.
//
//   (a) the echoed /apply answer: status + `{ok,changes}` (or the rejection text)
//   (b) the journal row(s) the batch produced: batch + trace since a baseline
//       (`select via,batch,trace from journal where rowid>baseline`)
//   (c) the resulting DB state: every touched entity read back off the read wire
//       (refs already projected to ids, server-owned reads included)
//
// A native-safe batch now COMMITS through the bridge's own WriteStore on copy-B
// (D-22804 rung 4): the create/update and the doc/task/comment rejections take
// the `native` door, while a claim, an entity delete, or a transform-bearing
// comp (a setting) still PROXIES to copy-B's Deno. Each case asserts the door
// the bridge took (its `x-yak-apply` header) AND that the result is byte-
// identical to direct-to-Deno on copy-A — so a native write that diverged from
// the port, OR a mis-routed batch, surfaces here. The predicate is the kernel's
// `native_safe` (write.rs `NATIVE_COMPS`), the single divergence-surface source.
//
// Env (all four; the tests skip unless every one is set), same effects-OFF probe
// setup the read harness documents above (TASKS_EFFECTS=daemon, no effectsd — so
// nothing but the batch itself advances either journal):
//   TS_URL / BRIDGE_URL  — copy-A's Deno / copy-B's bridge
//   TS_DB  / BRIDGE_DB    — copy-A's / copy-B's FILE path (opened read-only here
//                           for the journal dump only)
//
// WRITE MODE is "TS_DB or BRIDGE_DB set". The read-parity tests above compare one
// SHARED copy through two doors and demand it stay quiescent, which a concurrent
// writer breaks — so they skip in write mode, and this test skips outside it. The
// operator runs the two modes as two separate `cargo test` invocations.

fn ts_db() -> Option<String> {
    std::env::var("TS_DB").ok().filter(|s| !s.is_empty())
}
fn br_db() -> Option<String> {
    std::env::var("BRIDGE_DB").ok().filter(|s| !s.is_empty())
}
fn write_mode() -> bool {
    ts_db().is_some() || br_db().is_some()
}

// POST /apply, returning (status, raw body, route) for a SUCCESS or a REJECTION
// alike — `http_status_as_error(false)` keeps a 400's message body in hand
// instead of folding it into a status-code error (exactly what the bridge proxy
// relies on). `route` is the bridge's `x-yak-apply` header (native | proxy),
// None from the Deno server which never sends it.
fn post_apply(base: &str, batch: &str) -> (u16, String, Option<String>) {
    let url = format!("{base}/apply");
    let agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .build()
        .new_agent();
    match agent.post(&url).header("content-type", "application/json").send(batch) {
        Ok(mut r) => {
            let status = r.status().as_u16();
            let route = r
                .headers()
                .get("x-yak-apply")
                .and_then(|h| h.to_str().ok())
                .map(String::from);
            (status, r.body_mut().read_to_string().unwrap_or_default(), route)
        }
        Err(e) => panic!("POST {url} failed: {e}"),
    }
}

// Fire a setup/cleanup batch at BOTH copies, keeping them in lockstep (identical
// batch sequence ⇒ identical num minting) — the result is not asserted.
fn both_apply(ts: &str, br: &str, batch: &str) {
    post_apply(ts, batch);
    post_apply(br, batch);
}

fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, &c)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}

fn is_iso_ts(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 20
        && b.len() <= 30
        && b[4] == b'-'
        && b[7] == b'-'
        && (b[10] == b'T' || b[10] == b' ')
        && b[13] == b':'
        && b[16] == b':'
        && b[..4].iter().all(u8::is_ascii_digit)
}

// One scalar string, canonicalized (a uuid → its stable placeholder, a stamp →
// `<ts>`, anything else verbatim).
fn canon_scalar(s: &str, seen: &mut Vec<String>) -> String {
    if is_uuid(s) {
        let i = seen.iter().position(|u| u == s).unwrap_or_else(|| {
            seen.push(s.to_string());
            seen.len() - 1
        });
        format!("<u{i}>")
    } else if is_iso_ts(s) {
        "<ts>".to_string()
    } else {
        s.to_string()
    }
}

fn canon_value(v: &Value, seen: &mut Vec<String>) -> Value {
    match v {
        Value::String(s) => Value::from(canon_scalar(s, seen)),
        Value::Array(a) => Value::Array(a.iter().map(|x| canon_value(x, seen)).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, x)| (k.clone(), canon_value(x, seen))).collect())
        }
        other => other.clone(),
    }
}

// A wire text (a response body, a journal batch/trace) canonicalized. JSON is
// walked; a plain rejection MESSAGE is compared raw — its embedded ids (a task's
// num, a ghost eid echoed verbatim from the input) are deterministic across the
// two identical copies.
fn canon_text(text: &str) -> String {
    match serde_json::from_str::<Value>(text) {
        Ok(v) => {
            let mut seen = vec![];
            serde_json::to_string(&canon_value(&v, &mut seen)).unwrap()
        }
        Err(_) => text.to_string(),
    }
}

// Open a copy read-only (its file, not `?mode=ro` on the server) for the journal
// dump. A read-only cross-build reader of a WAL the Deno server writes is exactly
// what the bridge itself is — safe; only co-WRITING across builds corrupts.
fn ro_conn(db_path: &str) -> rusqlite::Connection {
    rusqlite::Connection::open_with_flags(
        format!("file:{db_path}?mode=ro"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .unwrap_or_else(|e| panic!("open {db_path} read-only: {e}"))
}

fn journal_tip(db_path: &str) -> i64 {
    ro_conn(db_path)
        .query_row("select coalesce(max(rowid),0) from journal", [], |r| r.get(0))
        .unwrap_or(0)
}

// A bounced claim's conflict entity is minted AFTER the batch rolls back, by a
// direct write that does NOT journal — so it is invisible to the journal-derived
// affected set. Baseline the conflict table and read back the eids minted since,
// so surface (c) still checks the audit row.
fn conflict_tip(db_path: &str) -> i64 {
    ro_conn(db_path)
        .query_row("select coalesce(max(entity),0) from conflict", [], |r| r.get(0))
        .unwrap_or(0)
}

fn new_conflicts(db_path: &str, base: i64) -> Vec<String> {
    let conn = ro_conn(db_path);
    let mut st = conn
        .prepare("select e.eid from conflict c join entity e on e.id = c.entity where c.entity > ?1")
        .unwrap();
    st.query_map([base], |r| r.get::<_, String>(0))
        .unwrap()
        .flatten()
        .collect()
}

// The (via, batch, trace) rows a batch committed, canonicalized and joined — one
// string per surface (b) so a Vec compare pinpoints a differing row.
fn journal_since(db_path: &str, base: i64) -> Vec<String> {
    let conn = ro_conn(db_path);
    let mut st = conn
        .prepare(
            "select coalesce(via,''), batch, coalesce(trace,'') \
             from journal where rowid > ?1 order by rowid",
        )
        .unwrap();
    let rows = st
        .query_map([base], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })
        .unwrap();
    rows.filter_map(|x| x.ok())
        .map(|(via, batch, trace)| {
            let mut seen = vec![];
            format!(
                "via={} | batch={} | trace={}",
                canon_scalar(&via, &mut seen),
                canon_text(&batch),
                canon_text(&trace),
            )
        })
        .collect()
}

// Every eid a committed batch touched — the union across the journal rows since
// baseline. Captures the batch's own eids, cascade casualties, AND a bounce's
// minted conflict eid, so surface (c) reads back exactly what moved.
fn affected(db_path: &str, base: i64) -> Vec<String> {
    let conn = ro_conn(db_path);
    let mut st = conn
        .prepare("select batch from journal where rowid > ?1 order by rowid")
        .unwrap();
    let batches: Vec<String> = st
        .query_map([base], |r| r.get::<_, String>(0))
        .unwrap()
        .filter_map(|x| x.ok())
        .collect();
    let mut set = std::collections::BTreeSet::new();
    for b in batches {
        if let Ok(v) = serde_json::from_str::<Value>(&b) {
            collect_eids(&v, &mut set);
        }
    }
    set.into_iter().collect()
}

fn collect_eids(v: &Value, out: &mut std::collections::BTreeSet<String>) {
    match v {
        Value::Object(o) => {
            if let Some(Value::String(e)) = o.get("eid") {
                out.insert(e.clone());
            }
            for (_, x) in o {
                collect_eids(x, out);
            }
        }
        Value::Array(a) => {
            for x in a {
                collect_eids(x, out);
            }
        }
        _ => {}
    }
}

// Surface (c): the resulting DB state — a normalized comp-row dump straight off
// the copy file. Every component table (keyed on the `entity` int PK) is dumped
// for the touched eids, each ref column projected back to its eid (int→eid via
// the entity table), then canonicalized. Read from the FILE, not the read wire:
// a tombstoned entity simply has no comp rows on either copy (clean parity),
// whereas the read wire renders a tombstone stub on the bridge but nothing on
// Deno — a read-wire difference this surface must not inherit. Ref-ness is read
// from the schema's foreign keys (pragma foreign_key_list), so it needs no
// vocabulary and catches server-owned refs (conflict.target, claim.session) too.
fn state_of(db_path: &str, eids: &[String]) -> String {
    let conn = ro_conn(db_path);
    let mut id2eid: std::collections::HashMap<i64, String> = Default::default();
    let mut eid2id: std::collections::HashMap<String, i64> = Default::default();
    {
        let mut st = conn.prepare("select id, eid from entity").unwrap();
        let rows = st
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .unwrap();
        for (id, eid) in rows.flatten() {
            id2eid.insert(id, eid.clone());
            eid2id.insert(eid, id);
        }
    }
    let ids: Vec<i64> = eids.iter().filter_map(|e| eid2id.get(e).copied()).collect();
    let mut out: Vec<String> = vec![];
    for comp in comp_tables(&conn) {
        let refs = ref_cols(&conn, &comp);
        let sql = format!("select * from \"{comp}\" where entity = ?1");
        let mut st = match conn.prepare(&sql) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let colnames: Vec<String> = st.column_names().iter().map(|s| s.to_string()).collect();
        for &id in &ids {
            let mut rows = st.query([id]).unwrap();
            while let Some(row) = rows.next().unwrap() {
                let mut seen = vec![];
                let mut m = serde_json::Map::new();
                for (i, col) in colnames.iter().enumerate() {
                    let raw = cell(row, i);
                    let projected = if col == "entity" || refs.contains(col) {
                        match &raw {
                            Value::Number(n) => n
                                .as_i64()
                                .and_then(|i| id2eid.get(&i))
                                .map(|e| Value::from(e.clone()))
                                .unwrap_or(Value::Null),
                            other => other.clone(),
                        }
                    } else {
                        raw
                    };
                    m.insert(col.clone(), canon_value(&projected, &mut seen));
                }
                out.push(format!("{comp} {}", serde_json::to_string(&Value::Object(m)).unwrap()));
            }
        }
    }
    out.sort();
    out.join("\n")
}

// One column cell → a JSON value (blobs summarized by length; none ride the
// tables this harness dumps).
fn cell(row: &rusqlite::Row, i: usize) -> Value {
    match row.get_ref(i) {
        Ok(rusqlite::types::ValueRef::Null) | Err(_) => Value::Null,
        Ok(rusqlite::types::ValueRef::Integer(n)) => Value::from(n),
        Ok(rusqlite::types::ValueRef::Real(f)) => Value::from(f),
        Ok(rusqlite::types::ValueRef::Text(t)) => {
            Value::from(String::from_utf8_lossy(t).to_string())
        }
        Ok(rusqlite::types::ValueRef::Blob(b)) => Value::from(format!("<blob:{}>", b.len())),
    }
}

// Every component table — one with an `entity` int-PK column (edges/journal/
// tombstone/entity have none, so they fall out; edge deltas ride surface (b)).
fn comp_tables(conn: &rusqlite::Connection) -> Vec<String> {
    let mut st = conn
        .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")
        .unwrap();
    let names: Vec<String> = st
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .flatten()
        .collect();
    names
        .into_iter()
        .filter(|t| {
            let mut ti = conn.prepare(&format!("pragma table_info(\"{t}\")")).unwrap();
            let cols: Vec<String> = ti
                .query_map([], |r| r.get::<_, String>(1))
                .unwrap()
                .flatten()
                .collect();
            cols.iter().any(|c| c == "entity")
        })
        .collect()
}

// The columns of `table` that reference the entity table — its refs, read from
// the schema so it needs no vocabulary.
fn ref_cols(conn: &rusqlite::Connection, table: &str) -> std::collections::HashSet<String> {
    let mut st = conn
        .prepare(&format!("pragma foreign_key_list(\"{table}\")"))
        .unwrap();
    st.query_map([], |r| Ok((r.get::<_, String>(2)?, r.get::<_, String>(3)?)))
        .unwrap()
        .flatten()
        .filter(|(reftable, _)| reftable == "entity")
        .map(|(_, from)| from)
        .collect()
}

// Fire ONE batch at copy-A's Deno (direct) and copy-B's bridge, assert the
// bridge took the EXPECTED door (native | proxy), and assert all three surfaces
// match between the two copies regardless of door. Returns the affected-eid
// count for the log line. `route` is the proof the divergence predicate routed
// this batch as intended — a native-committed batch and a proxied one must BOTH
// land byte-identically to direct-to-Deno, and each must have taken its door.
fn assert_write(case: &str, ts: &str, br: &str, ts_db: &str, br_db: &str, batch: &str, route: &str) {
    let base_a = journal_tip(ts_db);
    let base_b = journal_tip(br_db);
    let cbase_a = conflict_tip(ts_db);
    let cbase_b = conflict_tip(br_db);
    let (sa, ba, _) = post_apply(ts, batch);
    let (sb, bb, taken) = post_apply(br, batch);
    // The routing proof: the bridge stamped the door it took, and it must be the
    // one the predicate is meant to choose for this batch's comps.
    assert_eq!(
        taken.as_deref(),
        Some(route),
        "[{case}] bridge took the wrong door — expected {route}, got {taken:?}"
    );
    // (a) the echoed answer — status first, then the body.
    assert_eq!(sa, sb, "[{case}] status differs (ts={sa} bridge={sb})\n ts={ba}\n br={bb}");
    assert_eq!(
        canon_text(&ba),
        canon_text(&bb),
        "[{case}] echoed answer differs\n ts={ba}\n br={bb}"
    );
    // (b) the journal row(s).
    let ja = journal_since(ts_db, base_a);
    let jb = journal_since(br_db, base_b);
    assert_eq!(ja, jb, "[{case}] journal rows differ\n ts={ja:#?}\n br={jb:#?}");
    // (c) the resulting DB state of everything the commit touched — the journal's
    // eids PLUS any conflict row minted off-journal by a bounce.
    let mut ea = affected(ts_db, base_a);
    ea.extend(new_conflicts(ts_db, cbase_a));
    let mut eb = affected(br_db, base_b);
    eb.extend(new_conflicts(br_db, cbase_b));
    let state_a = state_of(ts_db, &ea);
    let state_b = state_of(br_db, &eb);
    assert_eq!(
        state_a, state_b,
        "[{case}] resulting DB state differs\n ts={state_a}\n br={state_b}"
    );
    eprintln!("ok  write-parity [{case}]  status={sa}  journal={}  entities={}", ja.len(), ea.len());
}

// Up to two existing session eids from the snapshot (real sessions, so a claim
// on one carries a stable label and no ghost-ref). Fewer than two ⇒ the
// claim-bounce case is skipped.
fn a_session_pair(ts: &str) -> Vec<String> {
    let (_, body) = get(ts, "/query?.kind=session&limit=2");
    serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|row| row.get("entity")?.get("eid")?.as_str().map(String::from))
        .collect()
}

#[test]
fn write_parity() {
    if !write_mode() {
        eprintln!("write_parity: skipped (set TS_URL, BRIDGE_URL, TS_DB, BRIDGE_DB)");
        return;
    }
    let (ts, br) = both().expect("write mode needs TS_URL and BRIDGE_URL");
    let ts_db = ts_db().expect("TS_DB");
    let br_db = br_db().expect("BRIDGE_DB");
    let uid = &uuid_v4()[..8]; // marker so probe writes are recognizable
    let g = |t: &str, b: &str, c: &str| both_apply(t, b, c);

    // --- ROUTING: a plain create lands identically through the bridge as direct.
    let e1 = uuid_v4();
    assert_write(
        "routing/create",
        &ts,
        &br,
        &ts_db,
        &br_db,
        &format!(
            "[{{\"eid\":\"{e1}\",\"name\":\"doc\",\"comp\":{{\"title\":\"zqw{uid} route\"}}}},\
              {{\"eid\":\"{e1}\",\"name\":\"task\",\"comp\":{{\"status\":\"open\",\"priority\":0}}}}]"
        ),
        "native",
    );
    // an UPDATE to the same entity (provenance flips created→updated).
    assert_write(
        "routing/update",
        &ts,
        &br,
        &ts_db,
        &br_db,
        &format!("[{{\"eid\":\"{e1}\",\"name\":\"doc\",\"comp\":{{\"title\":\"zqw{uid} route 2\"}}}}]"),
        "native",
    );

    // --- REJECTION: `was` stale (message + hash) -----------------------------
    let e2 = uuid_v4();
    g(&ts, &br, &format!("[{{\"eid\":\"{e2}\",\"name\":\"doc\",\"comp\":{{\"title\":\"v1\"}}}}]"));
    // land v2 with the correct guard so the row is now v2, then guard v3 with the
    // STALE v1 hash — refused on both, byte-identical Stale message.
    let sha_v1 = yak_kernel::write::sha(&serde_json::json!("v1"));
    // land v2 guarded by the CORRECT v1 hash (guard passes, row becomes v2)…
    g(
        &ts,
        &br,
        &format!(
            "[{{\"eid\":\"{e2}\",\"name\":\"doc\",\"comp\":{{\"title\":\"v2\"}},\"was\":{{\"title\":\"{sha_v1}\"}}}}]"
        ),
    );
    // …then guard v3 with that SAME v1 hash, now STALE (stored is v2) → refused:
    assert_write(
        "reject/was-stale",
        &ts,
        &br,
        &ts_db,
        &br_db,
        &format!(
            "[{{\"eid\":\"{e2}\",\"name\":\"doc\",\"comp\":{{\"title\":\"v3\"}},\"was\":{{\"title\":\"{sha_v1}\"}}}}]"
        ),
        "native",
    );

    // --- REJECTION: unknown column ------------------------------------------
    let e3 = uuid_v4();
    assert_write(
        "reject/unknown-column",
        &ts,
        &br,
        &ts_db,
        &br_db,
        &format!("[{{\"eid\":\"{e3}\",\"name\":\"task\",\"comp\":{{\"statuss\":\"done\"}}}}]"),
        "native",
    );

    // --- REJECTION: ghost reference -----------------------------------------
    let e4 = uuid_v4();
    let ghost = uuid_v4();
    assert_write(
        "reject/ghost-ref",
        &ts,
        &br,
        &ts_db,
        &br_db,
        &format!("[{{\"eid\":\"{e4}\",\"name\":\"comment\",\"comp\":{{\"target\":\"{ghost}\"}}}}]"),
        "native",
    );

    // --- REJECTION: claim bounce + minted conflict row ----------------------
    let sessions = a_session_pair(&ts);
    if sessions.len() >= 2 {
        let (sa, sb) = (&sessions[0], &sessions[1]);
        let tclaim = uuid_v4();
        g(
            &ts,
            &br,
            &format!(
                "[{{\"eid\":\"{tclaim}\",\"name\":\"doc\",\"comp\":{{\"title\":\"zqw{uid} claim\"}}}},\
                  {{\"eid\":\"{tclaim}\",\"name\":\"task\",\"comp\":{{\"status\":\"open\"}}}}]"
            ),
        );
        // first session claims it (lands wip + worked edge)
        g(&ts, &br, &format!("[{{\"eid\":\"{tclaim}\",\"name\":\"claim\",\"comp\":{{\"session\":\"{sa}\"}}}}]"));
        // second session's claim BOUNCES — refused batch, but a conflict entity is
        // committed AFTER the rollback (its own journal row, its own minted eid).
        assert_write(
            "reject/claim-bounce",
            &ts,
            &br,
            &ts_db,
            &br_db,
            &format!("[{{\"eid\":\"{tclaim}\",\"name\":\"claim\",\"comp\":{{\"session\":\"{sb}\"}}}}]"),
            "proxy",
        );
        // release + delete the probe task (keeps both copies in lockstep).
        g(&ts, &br, &format!("[{{\"eid\":\"{tclaim}\",\"name\":\"entity\",\"comp\":null}}]"));
    } else {
        eprintln!("write-parity [reject/claim-bounce]: skipped (need 2 sessions in the snapshot)");
    }

    // --- DELETE CASCADE: synthesized entity-nulls + detach echoes ------------
    let p = uuid_v4();
    let t = uuid_v4();
    let c = uuid_v4();
    g(
        &ts,
        &br,
        &format!(
            "[{{\"eid\":\"{p}\",\"name\":\"doc\",\"comp\":{{\"title\":\"zqw{uid} proj\"}}}},\
              {{\"eid\":\"{p}\",\"name\":\"project\",\"comp\":{{}}}}]"
        ),
    );
    g(
        &ts,
        &br,
        &format!(
            "[{{\"eid\":\"{t}\",\"name\":\"doc\",\"comp\":{{\"title\":\"zqw{uid} t\"}}}},\
              {{\"eid\":\"{t}\",\"name\":\"task\",\"comp\":{{\"status\":\"open\",\"project\":\"{p}\"}}}},\
              {{\"eid\":\"{c}\",\"name\":\"doc\",\"comp\":{{\"title\":\"zqw{uid} note\"}}}},\
              {{\"eid\":\"{c}\",\"name\":\"comment\",\"comp\":{{\"target\":\"{t}\"}}}}]"
        ),
    );
    // deleting the task cascades the comment ABOUT it (synthesized entity-null in
    // the echo) and — if a session was claimable — releases the claim.
    if !sessions.is_empty() {
        g(&ts, &br, &format!("[{{\"eid\":\"{t}\",\"name\":\"claim\",\"comp\":{{\"session\":\"{}\"}}}}]", sessions[0]));
    }
    assert_write(
        "cascade/delete-task",
        &ts,
        &br,
        &ts_db,
        &br_db,
        &format!("[{{\"eid\":\"{t}\",\"name\":\"entity\",\"comp\":null}}]"),
        "proxy",
    );
    // a surviving task pointing at the project, then delete the project → its
    // `project` pointer is DETACHED (a null-column echo), the project tombstoned.
    let t2 = uuid_v4();
    g(
        &ts,
        &br,
        &format!(
            "[{{\"eid\":\"{t2}\",\"name\":\"doc\",\"comp\":{{\"title\":\"zqw{uid} t2\"}}}},\
              {{\"eid\":\"{t2}\",\"name\":\"task\",\"comp\":{{\"status\":\"open\",\"project\":\"{p}\"}}}}]"
        ),
    );
    assert_write(
        "cascade/delete-project-detaches",
        &ts,
        &br,
        &ts_db,
        &br_db,
        &format!("[{{\"eid\":\"{p}\",\"name\":\"entity\",\"comp\":null}}]"),
        "proxy",
    );
    // --- ROUTING: a TRANSFORM-BEARING comp proxies -------------------------------
    // A `setting` write fires guardSettings in db.ts apply() — a transform the
    // rust kernel does not port (rung 6). The predicate must PROXY it, not commit
    // it natively (which would skip validation). An unknown catalog key is refused
    // by guardSettings identically on both copies, so the batch mutates nothing
    // and proves the proxy door: same rejection, `x-yak-apply: proxy`.
    let e5 = uuid_v4();
    assert_write(
        "routing/setting-proxies",
        &ts,
        &br,
        &ts_db,
        &br_db,
        &format!(
            "[{{\"eid\":\"{e5}\",\"name\":\"setting\",\"comp\":{{\"key\":\"zqw{uid}_no_such_key\",\"value\":\"x\"}}}}]"
        ),
        "proxy",
    );

    // clean up the surviving probe entities on BOTH copies.
    g(&ts, &br, &format!("[{{\"eid\":\"{t2}\",\"name\":\"entity\",\"comp\":null}}]"));
    g(&ts, &br, &format!("[{{\"eid\":\"{e1}\",\"name\":\"entity\",\"comp\":null}}]"));
    g(&ts, &br, &format!("[{{\"eid\":\"{e2}\",\"name\":\"entity\",\"comp\":null}}]"));

    eprintln!(
        "\nwrite parity OK (native-safe batches commit through the bridge; \
         transform/claim/delete batches proxy — both land identically to direct)"
    );
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
