// The inbox's candidate union (client.ts inboxFor), each arm one way an
// item can reach a reader, gathered by targeted reverse lookups — then the
// pure inbox_item/addressed screen decides. READ-ONLY: listing here never
// stamps `notified`, unlike the TS bus — a deliberate divergence the CLI
// documents (read-stamps belong to the write-capable doors).

use crate::query::{self, Pred};
use crate::reader::{self, Reader};
use crate::store::{Row, Store};

#[derive(Clone, Copy)]
pub enum Mode {
    Inbox,
    All,
}

fn uniq(eids: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    eids.into_iter().filter(|e| seen.insert(e.clone())).collect()
}

// directMail (client.ts `.mail.message_id!`): the box/address arms admit only
// ARRIVED mail — an outbound letter carries no message_id yet. The WATCHED mail
// arm has no such screen (inboxFor), so a watched target's outbound letter still
// enters the union and rides in on the watch override. Screening here (not just
// in the keep) is load-bearing for ORDER: it decides which arm first-sees an eid,
// and the union is emitted in arm order.
fn inbound(store: &Store, eids: Vec<String>) -> Vec<String> {
    eids.into_iter()
        .filter(|e| {
            store
                .row(e)
                .and_then(|r| {
                    r.comps
                        .get("mail")
                        .and_then(|m| m.get("message_id"))
                        .and_then(|v| v.as_str())
                        .map(|s| !s.is_empty())
                })
                .unwrap_or(false)
        })
        .collect()
}

// The union for a resolved reader: comments/notices at the session, its
// claims, and (operator) its actor; knocks via deliver.to; arrived mail at
// the session or (operator) the scope and the reader's addresses; plus
// watched targets in inbox mode.
pub fn inbox_rows(store: &Store, who: &Reader, filters: &[Pred], mode: Mode) -> Vec<Row> {
    let mut comments: Vec<String> = vec![];
    if let Some(s) = &who.session {
        comments.push(s.clone());
    }
    comments.extend(who.claims.iter().cloned());
    if who.operator {
        if let Some(a) = &who.actor {
            comments.push(a.clone());
        }
    }
    let mut knocks: Vec<String> = vec![];
    if let Some(s) = &who.session {
        knocks.push(s.clone());
    }
    if who.operator {
        if let Some(a) = &who.actor {
            knocks.push(a.clone());
        }
    }
    let mut boxes: Vec<String> = vec![];
    if let Some(s) = &who.session {
        boxes.push(s.clone());
    }
    if who.operator {
        if let Some(sc) = &who.scope {
            boxes.push(sc.clone());
        }
    }
    let addrs: Vec<String> =
        if who.operator { who.addrs.iter().cloned().collect() } else { vec![] };
    let watched: Vec<String> = match mode {
        Mode::Inbox => who.watching.iter().cloned().collect(),
        Mode::All => vec![],
    };
    let mut eids: Vec<String> = vec![];
    eids.extend(store.eids_where_ref("comment", "target", &comments));
    eids.extend(store.eids_where_ref("notice", "target", &comments));
    eids.extend(store.eids_where_ref("deliver", "to", &knocks));
    eids.extend(inbound(store, store.eids_where_ref("mail", "target", &boxes)));
    eids.extend(inbound(store, store.eids_where_text("mail", "to_addr", &addrs)));
    eids.extend(store.eids_where_ref("comment", "target", &watched));
    eids.extend(store.eids_where_ref("notice", "target", &watched));
    eids.extend(store.eids_where_ref("knock", "target", &watched));
    eids.extend(store.eids_where_ref("mail", "target", &watched));
    let now = query::now_ms();
    let mut rows: Vec<Row> = uniq(eids)
        .into_iter()
        .filter_map(|e| store.row(&e))
        .filter(|r| {
            // mode-inbox screens archived at the index (`.archived=`);
            // quarantined content stays screened like every query door
            crate::store::visible(r)
                && (matches!(mode, Mode::All) || reader::in_inbox(r))
                && query::matches_at(r, filters, now)
        })
        .collect();
    // client.ts `uniq`: one row per eid, num ASCENDING — "a snapshot walks the
    // entity table in num order, so a set stitched from several queries answers
    // in that same order". The arms are gathered in arm order above; this is the
    // final ordering the /inbox route (and the CLI bus) serialize in.
    rows.sort_by_key(|r| r.num.unwrap_or(0));
    rows
}

// The FINISHED inbox the server /inbox route serves: the candidate union, then
// the route's own keep predicate (client.ts `union.filter(mode=='all' ?
// addressed(who) : inboxItem(who))`). inbox_rows already screened archived,
// quarantine and the caller's filters; this is the attention decision the bus
// applies too — addressed-to (with watch/mute overriding in normal mode). Order
// is the union's, preserved. READ-ONLY: nothing here stamps `notified`.
pub fn inbox(store: &Store, who: &Reader, filters: &[Pred], mode: Mode) -> Vec<Row> {
    let all = matches!(mode, Mode::All);
    inbox_rows(store, who, filters, mode)
        .into_iter()
        .filter(|r| if all { reader::addressed(who, r) } else { reader::inbox_item(who, r) })
        .collect()
}

// One inbox line (cli.ts inboxLine): the read dot, the id, the kind, the
// first line of the body.
pub fn line(v: &crate::vocab::Vocab, r: &Row) -> String {
    let dot = if r.comps.contains_key("archived") {
        "×"
    } else if reader::is_unread(r) {
        "●"
    } else {
        "·"
    };
    let doc = r.comps.get("doc").and_then(|d| d.as_object());
    let body = doc
        .and_then(|d| {
            d.get("body")
                .and_then(|b| b.as_str())
                .filter(|b| !b.is_empty())
                .or_else(|| d.get("title").and_then(|t| t.as_str()))
        })
        .unwrap_or("")
        .lines()
        .next()
        .unwrap_or("")
        .chars()
        .take(80)
        .collect::<String>();
    let id = v.id_of(&r.kind, &r.eid, r.num);
    if body.is_empty() {
        format!("{dot} {id} {}", r.kind)
    } else {
        format!("{dot} {id} {} — {body}", r.kind)
    }
}

// bornAt, for the oldest→newest sort.
pub fn born_at(r: &Row) -> String {
    r.comps
        .get("created")
        .and_then(|c| c.get("at"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}
