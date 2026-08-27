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
// over query.rs's list/show grammar subset, PLUS (T-22756) the `.fields`
// projection, the `.reaches` bounded traversal, and the `.edges!` rider —
// incident dep triples + `.edges.peers=` far-endpoint projection, composed with
// membership and window maintenance (riderOpen/riderDelta/peerPayload/outside).
// The lazy `entries:` partition and path/reverse-hop sub filters are still
// refused loudly by parse_query_line (the standing follow-up), never half-served.

use crate::deps::eager_deps;
use crate::emit::{change_comp, dep_to_wire, entity_changes, js_num};
use crate::{live, snap};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use tokio::sync::mpsc::UnboundedSender;
use yak_kernel::change::Change;
use yak_kernel::feed::{cursor_of, data_version, journal_since, row_changes};
use yak_kernel::query::{self, Ctx, Field, Hop, Pred};
use yak_kernel::subquery::{eval_agg, eval_sub, moving, parse_query_line, reach_sets, Parsed, SUB_CAP};
use yak_kernel::vocab::{vocab, PropType};
use yak_kernel::{Dep, Store};

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
    fields: Option<Vec<Field>>, // the declared projection's cut (query.ts projected)
    has_window: bool,       // members are a bounded prefix — RE-ANSWER, not per-eid
    win_total: Option<i64>, // the total the window is a prefix of, restated on change
    agg: Option<Vec<(String, i64)>>, // an aggregate's standing value→count answer
    moving: bool,
    edges: Option<Rider>, // the .edges! rider: incident dep triples + peer projection
}

// The `.edges!` rider's standing state (subserve.ts Rider). `keys` is the
// incident set this client currently holds (insertion-ordered like a JS Map, so
// a delta's `want`/`unpeers` order matches); `held` the far endpoints whose
// projected columns rode along (insertion-ordered like the JS Set outside()
// builds), remembered so a later write to one re-projects.
struct Rider {
    peers: Vec<Hop>,
    keys: Vec<(String, Dep)>,
    held: Vec<String>,
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
            // Unscreened, like TS rowsFor→eager: a route sub loads ONE entity
            // whole regardless of quarantine — it dies only with the row.
            if let Some(row) = store.row_revealed(eid) {
                members.insert(eid.to_string());
                changes = carry(true, None, entity_changes(&row));
            }
            self.subs.push(Sub {
                name: name.into(),
                parsed: Parsed::default(),
                preds: vec![],
                members,
                bodies: true,
                only: Some(eid.to_string()),
                fields: None,
                has_window: false,
                win_total: None,
                agg: None,
                moving: false,
                edges: None,
            });
            return Ok(reply_frame(name, changes, vec![], cursor, shadow, None, None, None));
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
                fields: None,
                has_window: false,
                win_total: None,
                agg: Some(counts),
                moving: moving_time,
                edges: None,
            });
            return Ok(frame);
        }
        // The declared projection, compiled once: every payload — the initial
        // set, an ADD, a standing-match patch — rides through the same cut.
        let fields = parsed.fields.clone();
        let answer = eval_sub(store, &parsed, SUB_CAP)?;
        let members: HashSet<String> =
            answer.hits.iter().map(|r| r.eid.clone()).collect();
        let mut changes: Vec<Value> = vec![];
        for r in &answer.hits {
            changes.extend(carry(bodies, fields.as_deref(), entity_changes(r)));
        }
        let win_total = answer.window.as_ref().and_then(|(_, t)| *t);
        // Open the edges rider over the member set, if the query asked for one:
        // its first frame carries THIS query's incident edges and their far-side
        // projection, and seeds the state every later delta speaks from.
        let (edges_state, ride_frame) = match parsed.edges.clone() {
            Some(peers) => {
                let (rider, deps, peer_changes) =
                    rider_open(store, peers, &members);
                (Some(rider), Some((deps, peer_changes)))
            }
            None => (None, None),
        };
        self.subs.push(Sub {
            name: name.into(),
            parsed,
            preds,
            members,
            bodies,
            only: None,
            fields: fields.clone(),
            has_window: answer.window.is_some(),
            win_total,
            agg: None,
            moving: moving_time,
            edges: edges_state,
        });
        Ok(reply_frame(
            name,
            changes,
            vec![],
            cursor,
            shadow,
            answer.window,
            fields.as_deref(),
            ride_frame,
        ))
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
                let mut entered: Vec<String> = vec![];
                for r in &answer.hits {
                    if !sub.members.contains(&r.eid) {
                        changes.extend(carry(sub.bodies, sub.fields.as_deref(), entity_changes(r)));
                        entered.push(r.eid.clone());
                    } else if let Some(p) = patch.get(&r.eid) {
                        changes.extend(carry(sub.bodies, sub.fields.as_deref(), p.clone()));
                    }
                }
                let mut drop: Vec<String> = vec![];
                let mut left = false;
                for eid in &sub.members {
                    if next.contains(eid) {
                        continue;
                    }
                    left = true;
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
                // A window and a rider compose: the members are a bounded prefix,
                // and the edges are the ones incident to THAT prefix — a row
                // scrolling out takes its edges exactly as a departure does.
                let mut rider = sub.edges.take();
                let rd = rider.as_mut().map(|r| {
                    rider_delta(store, r, &sub.members, &entered, left, &gone, batch, &touched)
                });
                sub.edges = rider;
                let rode = rd.as_ref().map(rider_moved).unwrap_or(false);
                if !changes.is_empty() || !drop.is_empty() || moved || rode {
                    let ride = rd.filter(rider_moved);
                    let _ = tx.send(
                        window_delta(&sub.name, changes, drop, cur, (limit, total), ride.as_ref())
                            .to_string(),
                    );
                }
                continue;
            }
            // A plain membership sub: re-test each touched eid. Any `.reaches`
            // closure is resolved FRESH for this batch (an edge just committed
            // may move who reaches the target), the way TS rebuilds walker(db).
            let reveal = sub.preds.iter().any(|p| p.comp == "quarantined");
            let reaches = reach_sets(store, &sub.preds);
            let ctx = Ctx { reaches: Some(&reaches) };
            let mut changes: Vec<Value> = vec![];
            let mut drop: Vec<String> = vec![];
            let mut entered: Vec<String> = vec![];
            for eid in &touched {
                // store.row already screens a quarantined/tombstoned entity to
                // None; `gone` is the batch's own entity-null.
                let row = if gone.contains(eid) {
                    None
                } else {
                    // Unscreened: a member that became quarantined must read as
                    // ALIVE-but-not-listed → a REMOVE (drop), never a death.
                    reads
                        .entry(eid.clone())
                        .or_insert_with(|| store.row_revealed(eid))
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
                                && query::matches_comps_ctx(&r.comps, &sub.preds, now, &ctx)
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
                        changes.extend(carry(sub.bodies, sub.fields.as_deref(), patch.get(eid).cloned().unwrap_or_default()));
                    } else {
                        sub.members.insert(eid.clone());
                        entered.push(eid.clone());
                        changes.extend(carry(sub.bodies, sub.fields.as_deref(), entity_changes(row.as_ref().unwrap())));
                    }
                } else if was {
                    sub.members.remove(eid);
                    drop.push(eid.clone());
                }
            }
            // The rider composes with membership: an entered member brings its
            // edges, a departed one takes the edges no member holds (subserve.ts).
            let mut rider = sub.edges.take();
            let rd = rider.as_mut().map(|r| {
                rider_delta(store, r, &sub.members, &entered, !drop.is_empty(), &gone, batch, &touched)
            });
            sub.edges = rider;
            let rode = rd.as_ref().map(rider_moved).unwrap_or(false);
            if !changes.is_empty() || !drop.is_empty() || rode {
                let ride = rd.filter(rider_moved);
                let _ = tx.send(delta_frame(&sub.name, changes, drop, cur, ride.as_ref()).to_string());
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
            let reaches = reach_sets(store, &sub.preds);
            let ctx = Ctx { reaches: Some(&reaches) };
            let mut changes: Vec<Value> = vec![];
            let mut drop: Vec<String> = vec![];
            for eid in sub.members.clone() {
                let row = reads
                    .entry(eid.clone())
                    .or_insert_with(|| store.row_revealed(&eid))
                    .clone();
                let alive = row.is_some();
                let is_quar =
                    row.as_ref().map(|r| r.comps.contains_key("quarantined")).unwrap_or(false);
                let matches = match &row {
                    None => false,
                    Some(r) => {
                        (reveal || !is_quar)
                            && query::matches_comps_ctx(&r.comps, &sub.preds, now, &ctx)
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
                // aged() drops moving members only; the rider does not re-fire on
                // the clock (subserve.ts aged carries no ride).
                let _ = tx.send(delta_frame(&sub.name, changes, drop, cur, None).to_string());
            }
        }
    }
}

// --- payload shaping ---------------------------------------------------------

// carry (subserve.ts): a row payload passes through the ONE cut, then always
// drops any edge change — edges ride the .edges rider, never a row payload. A
// declared PROJECTION wins over the body deferral where it names a column (a
// caller asking for `.fields=doc.body` is asking for the body); absent a
// projection, a bodied sub keeps everything and every other sub defers bodies.
fn carry(bodies: bool, fields: Option<&[Field]>, changes: Vec<Value>) -> Vec<Value> {
    unedged(match fields {
        Some(f) => projected(f, changes),
        None if bodies => changes,
        None => bodyless(changes),
    })
}

// projected (subs.ts): a batch cut to a PROJECTION — the columns a sub DECLARED
// it reads. The SPINE (`entity`) and a comp deletion / entity death always ride
// (membership news, not column news); a change touching no projected column
// projects to nothing and is dropped. Changes are SPREAD (clone + rewrite comp),
// never rebuilt, so a precondition riding beside `comp` survives.
fn projected(fields: &[Field], changes: Vec<Value>) -> Vec<Value> {
    let mut keep: HashMap<String, HashSet<String>> = HashMap::new();
    for f in fields {
        keep.entry(f.comp.clone()).or_default().insert(f.prop.clone());
    }
    let mut out = vec![];
    for c in changes {
        let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("");
        // entity spine and a comp deletion (comp null/absent) pass whole.
        if name == "entity" || !matches!(c.get("comp"), Some(Value::Object(_))) {
            out.push(c);
            continue;
        }
        let Some(cols) = keep.get(name) else { continue };
        let Some(Value::Object(obj)) = c.get("comp") else { continue };
        let mut m = Map::new();
        for (k, v) in obj {
            if cols.contains(k) {
                m.insert(k.clone(), v.clone());
            }
        }
        if m.is_empty() {
            continue;
        }
        let mut nc = c.clone();
        if let Value::Object(o) = &mut nc {
            o.insert("comp".into(), Value::Object(m));
        }
        out.push(nc);
    }
    out
}

// --- the .edges! rider (subserve.ts) -----------------------------------------

// An edge's identity is its whole sentence — a triple has no row key (subserve.ts
// depKey).
fn dep_key(d: &Dep) -> String {
    format!("{}\0{}\0{}", d.parent, d.type_, d.child)
}

// The far endpoints a set of edges names that the member set does not hold
// (subserve.ts outside) — insertion-ordered and unique, the JS Set's order.
fn outside(deps: &[Dep], members: &HashSet<String>) -> Vec<String> {
    let mut out = vec![];
    let mut seen = HashSet::new();
    for d in deps {
        for e in [&d.parent, &d.child] {
            if !members.contains(e) && seen.insert(e.clone()) {
                out.push(e.clone());
            }
        }
    }
    out
}

// A peer row cut to its PROJECTION (subserve.ts peerPayload): the spine (so the
// client can name it) + its kind comp (so kindOf resolves) + the `.edges.peers=`
// columns and nothing else — never a body. One batched read for the whole set.
// The comp values are RAW (js_num'd), NOT the eager change shape: entity is
// `{eid,num}`, the kind comp is `{}`, a peer hop comp is `{prop: v, …}`.
fn peer_payload(store: &Store, peers: &[Hop], eids: &[String]) -> Vec<Value> {
    if eids.is_empty() || peers.is_empty() {
        return vec![];
    }
    let mut out = vec![];
    for row in store.rows_of(eids) {
        let Some(Value::Object(entity)) = row.comps.get("entity") else {
            continue;
        };
        out.push(change_of(&row.eid, "entity", change_comp(&row.eid, "entity", entity)));
        // picked, insertion-ordered: the kind comp first (empty), then each peer
        // comp — a hop on the kind comp merges into the same {} entry.
        let mut order: Vec<String> = vec![];
        let mut picked: HashMap<String, Map<String, Value>> = HashMap::new();
        if let Some(kind) =
            vocab().kind_order.iter().find(|c| row.comps.contains_key(*c))
        {
            order.push(kind.clone());
            picked.insert(kind.clone(), Map::new());
        }
        for h in peers {
            let v = row.comps.get(&h.comp).and_then(|c| c.get(&h.prop));
            let Some(v) = v.filter(|v| !v.is_null()) else { continue };
            if !picked.contains_key(&h.comp) {
                order.push(h.comp.clone());
                picked.insert(h.comp.clone(), Map::new());
            }
            picked
                .get_mut(&h.comp)
                .unwrap()
                .insert(h.prop.clone(), js_num(v.clone()));
        }
        for name in &order {
            let comp = picked.remove(name).unwrap();
            out.push(change_of(&row.eid, name, Value::Object(comp)));
        }
    }
    out
}

// A `{eid, name, comp}` change value.
fn change_of(eid: &str, name: &str, comp: Value) -> Value {
    let mut m = Map::new();
    m.insert("eid".into(), Value::from(eid));
    m.insert("name".into(), Value::from(name));
    m.insert("comp".into(), comp);
    Value::Object(m)
}

// Open a rider over a fresh member set (subserve.ts riderOpen): its incident
// edges, the far endpoints they name, and the state every later delta speaks
// from. Returns the standing Rider and the frame's `{edges, peers}`.
fn rider_open(
    store: &Store,
    peers: Vec<Hop>,
    members: &HashSet<String>,
) -> (Rider, Vec<Dep>, Vec<Value>) {
    let member_vec: Vec<String> = members.iter().cloned().collect();
    let deps = if members.is_empty() {
        vec![]
    } else {
        eager_deps(store, &member_vec)
    };
    let held = outside(&deps, members);
    let keys: Vec<(String, Dep)> =
        deps.iter().map(|d| (dep_key(d), d.clone())).collect();
    let peer_changes = peer_payload(store, &peers, &held);
    (Rider { peers, keys, held }, deps, peer_changes)
}

// What one committed batch does to a rider (subserve.ts riderDelta) — bounded by
// the delta, never by the graph. Mutates the rider's keys/held; returns the four
// streams a frame carries. `joined` are members that just entered, `moved` says a
// member left (so held edges may need re-screening), `touched` the batch's eids.
struct RiderDelta {
    edges: Vec<Dep>,
    unedges: Vec<Dep>,
    peers: Vec<Value>,
    unpeers: Vec<String>,
}

// take: add an edge we don't already hold; lose: drop one we do — the rider's
// keys are an insertion-ordered map (subserve.ts take/lose).
fn take(keys: &mut Vec<(String, Dep)>, add: &mut Vec<Dep>, d: Dep) {
    let k = dep_key(&d);
    if keys.iter().any(|(kk, _)| kk == &k) {
        return;
    }
    keys.push((k, d.clone()));
    add.push(d);
}
fn lose(keys: &mut Vec<(String, Dep)>, cut: &mut Vec<Dep>, k: &str) {
    if let Some(pos) = keys.iter().position(|(kk, _)| kk == k) {
        let (_, d) = keys.remove(pos);
        cut.push(d);
    }
}

fn rider_delta(
    store: &Store,
    r: &mut Rider,
    members: &HashSet<String>,
    joined: &[String],
    moved: bool,
    gone: &HashSet<String>,
    batch: &[Change],
    touched: &[String],
) -> RiderDelta {
    let mut add: Vec<Dep> = vec![];
    let mut cut: Vec<Dep> = vec![];
    // A member that JOINED brings its whole incident set (one keyed read).
    if !joined.is_empty() {
        for d in eager_deps(store, joined) {
            take(&mut r.keys, &mut add, d);
        }
    }
    // An edge WRITTEN in the batch: ask the same eager screen about its
    // endpoints and believe the answer (an unlink needs no ask — gone is gone).
    let linked: Vec<&Change> = batch
        .iter()
        .filter(|c| c.name == "dependency" && c.comp.is_some())
        .collect();
    let mut admits: HashSet<String> = HashSet::new();
    if linked.iter().any(|c| !comp_gone(c)) {
        let mut ends: Vec<String> = vec![];
        for c in &linked {
            ends.push(c.eid.clone());
            if let Some(child) = comp_child(c) {
                ends.push(child);
            }
        }
        for d in eager_deps(store, &ends) {
            admits.insert(dep_key(&d));
        }
    }
    for c in &linked {
        let Some(ty) = comp_type(c) else { continue };
        let Some(child) = comp_child(c) else { continue };
        let d = Dep { parent: c.eid.clone(), type_: ty, child };
        let ours = members.contains(&d.parent) || members.contains(&d.child);
        let k = dep_key(&d);
        if comp_gone(c) || !ours || !admits.contains(&k) {
            lose(&mut r.keys, &mut cut, &k);
        } else {
            take(&mut r.keys, &mut add, d);
        }
    }
    // A member that DIED takes every edge touching it; one that merely LEFT the
    // set takes the edges no remaining member holds.
    if !gone.is_empty() || moved {
        for (k, d) in r.keys.clone() {
            if gone.contains(&d.parent) || gone.contains(&d.child) {
                lose(&mut r.keys, &mut cut, &k);
            } else if !members.contains(&d.parent) && !members.contains(&d.child) {
                lose(&mut r.keys, &mut cut, &k);
            }
        }
    }
    let mut peers: Vec<Value> = vec![];
    let mut unpeers: Vec<String> = vec![];
    if !add.is_empty() || !cut.is_empty() {
        let edges: Vec<Dep> = r.keys.iter().map(|(_, d)| d.clone()).collect();
        let want = outside(&edges, members);
        let want_set: HashSet<&String> = want.iter().collect();
        let held_set: HashSet<&String> = r.held.iter().collect();
        let fresh: Vec<String> =
            want.iter().filter(|e| !held_set.contains(*e)).cloned().collect();
        unpeers = r.held.iter().filter(|e| !want_set.contains(*e)).cloned().collect();
        r.held = want;
        peers = peer_payload(store, &r.peers, &fresh);
    }
    // A held peer someone WROTE to re-projects: it is nobody's member, so no
    // membership pass would have noticed the edit its edge exists to show.
    let again: Vec<String> = touched
        .iter()
        .filter(|e| r.held.contains(*e) && !gone.contains(*e))
        .cloned()
        .collect();
    if !again.is_empty() {
        peers.extend(peer_payload(store, &r.peers, &again));
    }
    RiderDelta { edges: add, unedges: cut, peers, unpeers }
}

// Did a rider delta MOVE anything (subserve.ts rider)? A silent rider must not
// put a frame on the wire.
fn rider_moved(d: &RiderDelta) -> bool {
    !d.edges.is_empty()
        || !d.unedges.is_empty()
        || !d.peers.is_empty()
        || !d.unpeers.is_empty()
}

// A committed dependency Change's fields (its comp is `{type, child, gone?}`).
fn comp_gone(c: &Change) -> bool {
    c.comp
        .as_ref()
        .and_then(|m| m.get("gone"))
        .map(|v| v == &Value::Bool(true))
        .unwrap_or(false)
}
fn comp_type(c: &Change) -> Option<String> {
    c.comp.as_ref().and_then(|m| m.get("type")).and_then(|v| v.as_str()).map(String::from)
}
fn comp_child(c: &Change) -> Option<String> {
    c.comp.as_ref().and_then(|m| m.get("child")).and_then(|v| v.as_str()).map(String::from)
}

// The `fields` a projected sub's frame states — the client asked for it, but a
// frame carrying the contract is one the client believes without re-deriving
// it. Key order comp, prop, wake matches the TS object literal byte-for-byte.
fn fields_value(fields: &[Field]) -> Value {
    Value::Array(
        fields
            .iter()
            .map(|f| {
                let mut m = Map::new();
                m.insert("comp".into(), Value::from(f.comp.as_str()));
                m.insert("prop".into(), Value::from(f.prop.as_str()));
                m.insert("wake".into(), Value::Bool(f.wake));
                Value::Object(m)
            })
            .collect(),
    )
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
// JSON.stringify — sub, changes, drop, replace, cursor, shadow, [window],
// [fields].
fn reply_frame(
    name: &str,
    changes: Vec<Value>,
    drop: Vec<String>,
    cursor: i64,
    shadow: bool,
    window: Option<(i64, Option<i64>)>,
    fields: Option<&[Field]>,
    ride: Option<(Vec<Dep>, Vec<Value>)>,
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
    // A projected sub STATES its projection so the client believes the contract
    // without re-deriving it (subserve.ts control). Present exactly when the
    // query named `.fields=` — `Some([])` (the eids-only form) still states it.
    if let Some(f) = fields {
        m.insert("fields".into(), fields_value(f));
    }
    // The edges rider's opening frame: the incident edges and their far-side
    // projection (subserve.ts `...ride.frame`), keys `edges` then `peers`.
    if let Some((edges, peers)) = ride {
        m.insert("edges".into(), Value::Array(edges.iter().map(dep_to_wire).collect()));
        m.insert("peers".into(), Value::Array(peers));
    }
    Value::Object(m)
}

// A maintain delta (subserve.ts): sub, changes, drop, cursor, shadow, then the
// rider's four streams when it moved. Shadow is always false in this rung (no
// shadow subs), stated for byte-parity.
fn delta_frame(
    name: &str,
    changes: Vec<Value>,
    drop: Vec<String>,
    cur: i64,
    ride: Option<&RiderDelta>,
) -> Value {
    let mut m = Map::new();
    m.insert("sub".into(), Value::from(name));
    m.insert("changes".into(), Value::Array(changes));
    m.insert("drop".into(), Value::Array(drop.into_iter().map(Value::from).collect()));
    m.insert("cursor".into(), Value::from(cur));
    m.insert("shadow".into(), Value::Bool(false));
    add_ride(&mut m, ride);
    Value::Object(m)
}

// A moved rider's four streams appended to a delta frame (subserve.ts `...ride`):
// edges, unedges (dep triples), peers (far-endpoint changes), unpeers (eids).
fn add_ride(m: &mut Map<String, Value>, ride: Option<&RiderDelta>) {
    let Some(rd) = ride else { return };
    m.insert("edges".into(), Value::Array(rd.edges.iter().map(dep_to_wire).collect()));
    m.insert("unedges".into(), Value::Array(rd.unedges.iter().map(dep_to_wire).collect()));
    m.insert("peers".into(), Value::Array(rd.peers.clone()));
    m.insert(
        "unpeers".into(),
        Value::Array(rd.unpeers.iter().map(|e| Value::from(e.as_str())).collect()),
    );
}

// A windowed sub's delta restates its bound: sub, changes, drop, cursor,
// shadow, window, then the rider's streams when it moved.
fn window_delta(
    name: &str,
    changes: Vec<Value>,
    drop: Vec<String>,
    cur: i64,
    window: (i64, Option<i64>),
    ride: Option<&RiderDelta>,
) -> Value {
    let mut m = Map::new();
    m.insert("sub".into(), Value::from(name));
    m.insert("changes".into(), Value::Array(changes));
    m.insert("drop".into(), Value::Array(drop.into_iter().map(Value::from).collect()));
    m.insert("cursor".into(), Value::from(cur));
    m.insert("shadow".into(), Value::Bool(false));
    m.insert("window".into(), window_value(window));
    add_ride(&mut m, ride);
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
