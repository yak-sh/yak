// One socket's serving half — the subscription registry, the live stream, and
// the catch-up/reset handshake (src/subserve.ts, ported for the WS wire,
// T-22747). A worker thread owns one Subserve over its read-only Store; the
// async half pumps the frames this side produces. Everything it reads is a
// db-parameterized kernel call, so a read-only connection serves as well as the
// writer's.
//
// The frames it emits are byte-identical to the Deno server's:
//   - the JOIN handshake: {since} → a working-set reset (cold/stale) or a
//     journal catchup delta (warm), then the live stream opens.
//   - a SUBSCRIPTION: {sub, q} registers a query and replies with its current
//     matches as one `replace` batch (or an aggregate's value→count map); the
//     first non-shadow sub turns the plain live stream OFF (this socket's cache
//     is now the subscriptions' to own). {unsub} forgets one.
//   - the LIVE fold: each committed journal row is re-tested against every
//     subscription and the transition streamed — an add ships full comps, an
//     update the batch's own patches, a departure a drop, a death an
//     entity-null; a windowed or aggregate sub RE-ANSWERS from the index and
//     ships the diff. A moving-time sub re-tests its members on each tick.
//
// SCOPE (this rung): the membership/window/aggregate/route subscription kinds
// over query.rs's list/show grammar subset. The `.edges` rider, the lazy
// `entries:` partition, path/reverse-hop sub filters and `.fields` projection
// are refused loudly by parse_query_line (the standing follow-up), never
// half-served.

use crate::emit::entity_changes;
use crate::{live, snap};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use tokio::sync::mpsc::UnboundedSender;
use yak_kernel::change::Change;
use yak_kernel::feed::{cursor_of, data_version, journal_since, row_changes};
use yak_kernel::query::{self, Pred};
use yak_kernel::subquery::{eval_agg, eval_sub, moving, parse_query_line, Parsed, SUB_CAP};
use yak_kernel::vocab::{vocab, PropType};
use yak_kernel::Store;

type Send = UnboundedSender<String>;

// One live subscription: its parsed query, the eids currently in its set, and
// the standing state each committed batch speaks a diff from.
struct Sub {
    name: String,
    parsed: Parsed,
    preds: Vec<Pred>, // resolved filter preds — the per-eid maintain re-test
    members: HashSet<String>,
    bodies: bool,           // a route/entries/card sub ships doc bodies
    only: Option<String>,   // a route sub's fixed id
    has_window: bool,       // members are a bounded prefix — RE-ANSWER, not per-eid
    win_total: Option<i64>, // the total the window is a prefix of, restated on change
    agg: Option<Vec<(String, i64)>>, // an aggregate's standing value→count answer
    moving: bool,
}

pub struct Subserve {
    subs: Vec<Sub>,
    joined: bool,
    filtered: bool, // a non-shadow sub owns the cache — the plain live stream is off
    envelope: bool,
    cursor: i64,
    last_ver: i64,
}

impl Subserve {
    pub fn new(store: &Store) -> Subserve {
        Subserve {
            subs: vec![],
            joined: false,
            filtered: false,
            envelope: false,
            cursor: 0,
            last_ver: data_version(&store.conn),
        }
    }

    // One control-object frame ({since} join vs {sub}/{unsub}); a write batch
    // (a top-level array, or an object with neither key) is ignored — writes
    // still POST the Deno /apply door in this read rung.
    pub fn frame(&mut self, store: &Store, raw: &str, tx: &Send) {
        let Ok(f) = serde_json::from_str::<Value>(raw) else { return };
        let Some(obj) = f.as_object() else { return };
        if obj.contains_key("since") {
            self.join(store, obj, tx);
        } else if obj.contains_key("sub") || obj.contains_key("unsub") {
            self.control(store, obj, tx);
        }
        // A join/sub just moved our cursor and delivered a set; don't let the
        // next poll re-emit what we already sent.
        self.last_ver = data_version(&store.conn);
    }

    // The join handshake: reset a cold/stale client to the working set, else
    // replay the journal catchup delta, then open the live stream.
    fn join(&mut self, store: &Store, obj: &Map<String, Value>, tx: &Send) {
        let since = obj.get("since").and_then(|v| v.as_i64());
        let epoch_held = obj.get("epoch").and_then(|v| v.as_str());
        let vocab_held = obj.get("vocab").and_then(|v| v.as_str());
        self.envelope = obj.get("live").and_then(|v| v.as_i64()) == Some(1);
        let frame = if since.is_none()
            || cursor_stale(store, epoch_held, vocab_held, since.unwrap())
        {
            self.cursor = cursor_of(&store.conn);
            snap::reset_frame(store).to_string()
        } else {
            let f = live::catchup_frame(store, since.unwrap());
            self.cursor = f.get("cursor").and_then(|c| c.as_i64()).unwrap_or(self.cursor);
            f.to_string()
        };
        let _ = tx.send(frame);
        self.joined = true;
    }

    // A subscribe/unsubscribe. `{sub, q}` registers a query and replies with its
    // current answer as one `replace` batch; `{unsub}` forgets one.
    fn control(&mut self, store: &Store, obj: &Map<String, Value>, tx: &Send) {
        if let Some(name) = obj.get("unsub").and_then(|v| v.as_str()) {
            self.subs.retain(|s| s.name != name);
            return;
        }
        let Some(name) = obj.get("sub").and_then(|v| v.as_str()) else { return };
        let shadow = obj.get("shadow").and_then(|v| v.as_bool()).unwrap_or(false);
        let line = obj.get("q").and_then(|v| v.as_str()).unwrap_or("");
        // A non-shadow sub takes ownership of this socket's cache: the plain live
        // stream must stop (subserve.ts filtered).
        if !shadow {
            self.filtered = true;
        }
        match self.register(store, name, line, shadow) {
            Ok(frame) => {
                let _ = tx.send(frame.to_string());
            }
            // A bad query is the client's news, not a server error (subserve.ts
            // `catch`): warn and send nothing rather than break the socket.
            Err(e) => eprintln!("yak-bridge sub: bad query {name:?} — {e}"),
        }
    }

    fn register(
        &mut self,
        store: &Store,
        name: &str,
        line: &str,
        shadow: bool,
    ) -> Result<Value, String> {
        let cursor = cursor_of(&store.conn);
        let bodies = bodied(name);
        // A route sub names ONE entity in its own name — no query to eval; its
        // hit is that entity's current comps (empty if not minted, so a later
        // create ADDs it).
        if let Some(eid) = name.strip_prefix("route:") {
            let mut members = HashSet::new();
            let mut changes: Vec<Value> = vec![];
            if let Some(row) = store.row(eid) {
                members.insert(eid.to_string());
                changes = carry(true, entity_changes(&row));
            }
            self.subs.push(Sub {
                name: name.into(),
                parsed: Parsed::default(),
                preds: vec![],
                members,
                bodies: true,
                only: Some(eid.to_string()),
                has_window: false,
                win_total: None,
                agg: None,
                moving: false,
            });
            return Ok(reply_frame(name, changes, vec![], cursor, shadow, None));
        }
        if name.starts_with("entries:") {
            return Err("the entries: partition sub is not ported in this rung".into());
        }
        // A query sub. Parse the line, resolve its reference values once, and
        // answer it — an aggregate as a value→count map, a membership as rows.
        let parsed = parse_query_line(line)?;
        let mut preds = parsed.preds.clone();
        query::resolve_values(store, &mut preds);
        let moving_time = moving(&preds);
        if parsed.agg.is_some() {
            let counts = eval_agg(store, &parsed)?;
            let frame = agg_frame(name, &counts, cursor, shadow);
            self.subs.push(Sub {
                name: name.into(),
                parsed,
                preds,
                members: HashSet::new(),
                bodies,
                only: None,
                has_window: false,
                win_total: None,
                agg: Some(counts),
                moving: moving_time,
            });
            return Ok(frame);
        }
        let answer = eval_sub(store, &parsed, SUB_CAP)?;
        let members: HashSet<String> =
            answer.hits.iter().map(|r| r.eid.clone()).collect();
        let mut changes: Vec<Value> = vec![];
        for r in &answer.hits {
            changes.extend(carry(bodies, entity_changes(r)));
        }
        let win_total = answer.window.as_ref().and_then(|(_, t)| *t);
        self.subs.push(Sub {
            name: name.into(),
            parsed,
            preds,
            members,
            bodies,
            only: None,
            has_window: answer.window.is_some(),
            win_total,
            agg: None,
            moving: moving_time,
        });
        Ok(reply_frame(name, changes, vec![], cursor, shadow, answer.window))
    }

    // Poll the journal for foreign commits and fold each committed row into
    // every subscription (and, while unfiltered, the plain live stream). Called
    // between control frames; the data_version gate keeps it free when idle.
    pub fn poll(&mut self, store: &Store, tx: &Send) {
        if !self.joined {
            return;
        }
        let ver = data_version(&store.conn);
        if ver == self.last_ver {
            return;
        }
        self.last_ver = ver;
        for r in journal_since(&store.conn, self.cursor) {
            self.cursor = r.rowid;
            let changes = row_changes(&r);
            // The plain live stream (only while no sub owns the cache).
            if !self.filtered {
                let rooted = live::live_changes(store, &r);
                if !rooted.is_empty() {
                    let _ = tx.send(live::live_frame(&rooted, r.rowid, self.envelope).to_string());
                }
            }
            self.maintain(store, &changes, r.rowid, tx);
        }
    }

    // Fold one committed batch into every subscription (subserve.ts maintain).
    fn maintain(&mut self, store: &Store, batch: &[Change], cur: i64, tx: &Send) {
        if self.subs.is_empty() {
            return;
        }
        let gone: HashSet<String> = batch
            .iter()
            .filter(|c| c.name == "entity" && c.comp.is_none())
            .map(|c| c.eid.clone())
            .collect();
        let mut touched: Vec<String> = vec![];
        for c in batch {
            if !touched.contains(&c.eid) {
                touched.push(c.eid.clone());
            }
        }
        // The batch's own changes grouped per eid — the payload of an UPDATE.
        let mut patch: HashMap<String, Vec<Value>> = HashMap::new();
        for c in batch {
            patch.entry(c.eid.clone()).or_default().push(c.to_value());
        }
        // A per-pass eager read memo (one keyed read per touched eid).
        let mut reads: HashMap<String, Option<yak_kernel::Row>> = HashMap::new();
        let now = query::now_ms();

        for sub in &mut self.subs {
            if let Some(counts) = &sub.agg {
                // Re-answer the aggregate and ship the DIFF (n=0 drops a key).
                let Ok(next) = eval_agg(store, &sub.parsed) else { continue };
                let mut delta: Vec<(String, i64)> = vec![];
                let prev: HashMap<&String, i64> = counts.iter().map(|(k, n)| (k, *n)).collect();
                let next_map: HashMap<&String, i64> = next.iter().map(|(k, n)| (k, *n)).collect();
                for (v, n) in &next {
                    if prev.get(v) != Some(n) {
                        delta.push((v.clone(), *n));
                    }
                }
                for (v, _) in counts.iter() {
                    if !next_map.contains_key(v) {
                        delta.push((v.clone(), 0));
                    }
                }
                sub.agg = Some(next);
                if !delta.is_empty() {
                    let _ = tx.send(agg_delta(&sub.name, &delta, cur).to_string());
                }
                continue;
            }
            if sub.has_window {
                // An exact window RE-ANSWERS: the rows that cross its edge are
                // precisely the ones no batch mentions.
                let Ok(answer) = eval_sub(store, &sub.parsed, SUB_CAP) else { continue };
                let next: HashSet<String> =
                    answer.hits.iter().map(|r| r.eid.clone()).collect();
                let mut changes: Vec<Value> = vec![];
                for r in &answer.hits {
                    if !sub.members.contains(&r.eid) {
                        changes.extend(carry(sub.bodies, entity_changes(r)));
                    } else if let Some(p) = patch.get(&r.eid) {
                        changes.extend(carry(sub.bodies, p.clone()));
                    }
                }
                let mut drop: Vec<String> = vec![];
                for eid in &sub.members {
                    if next.contains(eid) {
                        continue;
                    }
                    if gone.contains(eid) {
                        changes.push(entity_null(eid));
                    } else {
                        drop.push(eid.clone());
                    }
                }
                sub.members = next;
                let (limit, total) = answer
                    .window
                    .unwrap_or((sub.parsed.win.limit.unwrap_or(SUB_CAP), Some(answer.hits.len() as i64)));
                let moved = total != sub.win_total;
                sub.win_total = total;
                if !changes.is_empty() || !drop.is_empty() || moved {
                    let _ = tx.send(
                        window_delta(&sub.name, changes, drop, cur, (limit, total)).to_string(),
                    );
                }
                continue;
            }
            // A plain membership sub: re-test each touched eid.
            let reveal = sub.preds.iter().any(|p| p.comp == "quarantined");
            let mut changes: Vec<Value> = vec![];
            let mut drop: Vec<String> = vec![];
            for eid in &touched {
                // store.row already screens a quarantined/tombstoned entity to
                // None; `gone` is the batch's own entity-null.
                let row = if gone.contains(eid) {
                    None
                } else {
                    reads
                        .entry(eid.clone())
                        .or_insert_with(|| store.row(eid))
                        .clone()
                };
                let alive = row.is_some();
                let is_quar =
                    row.as_ref().map(|r| r.comps.contains_key("quarantined")).unwrap_or(false);
                let hit = match &row {
                    None => false,
                    Some(r) => match &sub.only {
                        Some(id) => id == eid,
                        None => {
                            (reveal || !is_quar)
                                && query::matches_comps_at(&r.comps, &sub.preds, now)
                        }
                    },
                };
                let was = sub.members.contains(eid);
                if !alive {
                    if was {
                        sub.members.remove(eid);
                        changes.push(entity_null(eid));
                    }
                } else if hit {
                    if was {
                        changes.extend(carry(sub.bodies, patch.get(eid).cloned().unwrap_or_default()));
                    } else {
                        sub.members.insert(eid.clone());
                        changes.extend(carry(sub.bodies, entity_changes(row.as_ref().unwrap())));
                    }
                } else if was {
                    sub.members.remove(eid);
                    drop.push(eid.clone());
                }
            }
            if !changes.is_empty() || !drop.is_empty() {
                let _ = tx.send(delta_frame(&sub.name, changes, drop, cur).to_string());
            }
        }
    }

    // The clock's own tick: a moving-time window ages a member out with nobody
    // writing, so re-test each moving sub's members against `now` and drop the
    // ones that have fallen out (subserve.ts aged).
    pub fn tick(&mut self, store: &Store, tx: &Send) {
        if !self.joined || !self.subs.iter().any(|s| s.moving) {
            return;
        }
        let cur = cursor_of(&store.conn);
        let now = query::now_ms();
        let mut reads: HashMap<String, Option<yak_kernel::Row>> = HashMap::new();
        for sub in &mut self.subs {
            if !sub.moving {
                continue;
            }
            let reveal = sub.preds.iter().any(|p| p.comp == "quarantined");
            let mut changes: Vec<Value> = vec![];
            let mut drop: Vec<String> = vec![];
            for eid in sub.members.clone() {
                let row = reads
                    .entry(eid.clone())
                    .or_insert_with(|| store.row(&eid))
                    .clone();
                let alive = row.is_some();
                let is_quar =
                    row.as_ref().map(|r| r.comps.contains_key("quarantined")).unwrap_or(false);
                let matches = match &row {
                    None => false,
                    Some(r) => {
                        (reveal || !is_quar)
                            && query::matches_comps_at(&r.comps, &sub.preds, now)
                    }
                };
                if !alive {
                    sub.members.remove(&eid);
                    changes.push(entity_null(&eid));
                } else if !matches {
                    sub.members.remove(&eid);
                    drop.push(eid);
                }
            }
            if !changes.is_empty() || !drop.is_empty() {
                let _ = tx.send(delta_frame(&sub.name, changes, drop, cur).to_string());
            }
        }
    }
}

// --- payload shaping ---------------------------------------------------------

// carry (subserve.ts): a row payload passes through the body deferral (unless
// the sub is bodied) and always drops any edge change — edges ride the .edges
// rider, never a row payload.
fn carry(bodies: bool, changes: Vec<Value>) -> Vec<Value> {
    unedged(if bodies { changes } else { bodyless(changes) })
}

// bodyless (subs.ts): a row's declared BODY columns are left behind (deferred
// until a card opens), the same Changes a full payload would have shipped minus
// the body class. A change emptied by the cut says nothing and is dropped.
fn bodyless(changes: Vec<Value>) -> Vec<Value> {
    let mut out = vec![];
    for mut c in changes {
        let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let has_comp = matches!(c.get("comp"), Some(Value::Object(_)));
        if has_comp {
            let cut = body_cols(&name);
            if let Some(Value::Object(obj)) = c.get_mut("comp") {
                if cut.iter().any(|p| obj.contains_key(p)) {
                    for p in &cut {
                        obj.remove(p);
                    }
                    if obj.is_empty() {
                        continue;
                    }
                }
            }
        }
        out.push(c);
    }
    out
}

// unedged (subs.ts): a `dependency` change never rides a row payload.
fn unedged(changes: Vec<Value>) -> Vec<Value> {
    changes
        .into_iter()
        .filter(|c| c.get("name").and_then(|v| v.as_str()) != Some("dependency"))
        .collect()
}

// A component's BODY-typed columns (props.ts bodyCols) — the readable union, so
// a stamped body column (none today) would defer too.
fn body_cols(name: &str) -> Vec<String> {
    vocab()
        .readable(name)
        .into_iter()
        .filter(|(_, t)| *t == PropType::Body)
        .map(|(n, _)| n)
        .collect()
}

fn entity_null(eid: &str) -> Value {
    let mut m = Map::new();
    m.insert("eid".into(), Value::from(eid));
    m.insert("name".into(), Value::from("entity"));
    m.insert("comp".into(), Value::Null);
    Value::Object(m)
}

// --- frame envelopes ---------------------------------------------------------

// A sub's initial reply (subserve.ts control): the key order matches the TS
// JSON.stringify — sub, changes, drop, replace, cursor, shadow, [window].
fn reply_frame(
    name: &str,
    changes: Vec<Value>,
    drop: Vec<String>,
    cursor: i64,
    shadow: bool,
    window: Option<(i64, Option<i64>)>,
) -> Value {
    let mut m = Map::new();
    m.insert("sub".into(), Value::from(name));
    m.insert("changes".into(), Value::Array(changes));
    m.insert("drop".into(), Value::Array(drop.into_iter().map(Value::from).collect()));
    m.insert("replace".into(), Value::Bool(true));
    m.insert("cursor".into(), Value::from(cursor));
    m.insert("shadow".into(), Value::Bool(shadow));
    if let Some(w) = window {
        m.insert("window".into(), window_value(w));
    }
    Value::Object(m)
}

// A maintain delta (subserve.ts): sub, changes, drop, cursor, shadow. Shadow is
// always false in this rung (no shadow subs), stated for byte-parity.
fn delta_frame(name: &str, changes: Vec<Value>, drop: Vec<String>, cur: i64) -> Value {
    let mut m = Map::new();
    m.insert("sub".into(), Value::from(name));
    m.insert("changes".into(), Value::Array(changes));
    m.insert("drop".into(), Value::Array(drop.into_iter().map(Value::from).collect()));
    m.insert("cursor".into(), Value::from(cur));
    m.insert("shadow".into(), Value::Bool(false));
    Value::Object(m)
}

// A windowed sub's delta restates its bound: sub, changes, drop, cursor,
// shadow, window.
fn window_delta(
    name: &str,
    changes: Vec<Value>,
    drop: Vec<String>,
    cur: i64,
    window: (i64, Option<i64>),
) -> Value {
    let mut m = Map::new();
    m.insert("sub".into(), Value::from(name));
    m.insert("changes".into(), Value::Array(changes));
    m.insert("drop".into(), Value::Array(drop.into_iter().map(Value::from).collect()));
    m.insert("cursor".into(), Value::from(cur));
    m.insert("shadow".into(), Value::Bool(false));
    m.insert("window".into(), window_value(window));
    Value::Object(m)
}

// An aggregate sub's initial reply: sub, agg, replace, cursor, shadow.
fn agg_frame(name: &str, counts: &[(String, i64)], cursor: i64, shadow: bool) -> Value {
    let mut m = Map::new();
    m.insert("sub".into(), Value::from(name));
    m.insert("agg".into(), agg_map(counts));
    m.insert("replace".into(), Value::Bool(true));
    m.insert("cursor".into(), Value::from(cursor));
    m.insert("shadow".into(), Value::Bool(shadow));
    Value::Object(m)
}

// An aggregate sub's delta: sub, agg, cursor, shadow.
fn agg_delta(name: &str, delta: &[(String, i64)], cur: i64) -> Value {
    let mut m = Map::new();
    m.insert("sub".into(), Value::from(name));
    m.insert("agg".into(), agg_map(delta));
    m.insert("cursor".into(), Value::from(cur));
    m.insert("shadow".into(), Value::Bool(false));
    Value::Object(m)
}

// Object.fromEntries(counts): a value→count object in the map's own order.
fn agg_map(counts: &[(String, i64)]) -> Value {
    let mut m = Map::new();
    for (k, n) in counts {
        m.insert(k.clone(), Value::from(*n));
    }
    Value::Object(m)
}

// { limit, total? } — total omitted exactly when the answerer could not vouch
// for it (subserve.ts window).
fn window_value(w: (i64, Option<i64>)) -> Value {
    let mut m = Map::new();
    m.insert("limit".into(), Value::from(w.0));
    if let Some(t) = w.1 {
        m.insert("total".into(), Value::from(t));
    }
    Value::Object(m)
}

// bodied (subs.ts): card/route/entries subs carry doc bodies; every other sub
// defers them.
fn bodied(name: &str) -> bool {
    name.starts_with("card:") || name.starts_with("route:") || name.starts_with("entries:")
}

// cursorStale (db.ts): a held cursor can't be trusted for a delta when the epoch
// or vocab moved, or the client's frontier sits beyond our tip.
fn cursor_stale(
    store: &Store,
    epoch_held: Option<&str>,
    vocab_held: Option<&str>,
    since: i64,
) -> bool {
    let reset = snap::reset_frame(store);
    let snap = &reset["snapshot"];
    let epoch = snap["epoch"].as_str().unwrap_or("");
    let vocab = snap["vocabHash"].as_str().unwrap_or("");
    epoch_held != Some(epoch) || vocab_held != Some(vocab) || since > cursor_of(&store.conn)
}
