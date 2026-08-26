// The mail plugin (D-22530 §8): outbound/inbound mail (mail.ts, mailer.ts,
// mailaddr.ts, inbound.ts), webhooks, and the address book.

use yak_vocab::{Body, Bool, Ref, Text, Time};
use yak_vocab_derive::Comp;

// Outbound mail, asked for as data. Subject rides doc.title, body doc.body.
// `from` is NOT wire-writable — the sender is the server's fact (T-9511).
#[derive(Comp)]
#[comp(plugin = "mail", rank = 670, kind_rank = 240, prefix = "E", stamped_rank = 190)]
struct Mail {
    #[col(eid = "entity", death = "keep")]
    target: Ref,
    #[col(eid = "mail", death = "keep")]
    reply_to: Ref,
    #[stamped]
    from: Text,
    #[stamped]
    to_addr: Text,
    #[stamped]
    message_id: Text,
    #[stamped]
    received_at: Time,
    #[stamped]
    verified: Bool,
    #[stamped]
    sent_id: Text,
    #[stamped]
    in_reply_to: Text,
    #[stamped]
    headers: Text,
}

// A webhook delivery, derived from the edge's raw request spool (inbound.ts).
// Tag-style like conflict — every column is server-stamped.
#[derive(Comp)]
#[comp(plugin = "mail", rank = 700, kind_rank = 250, prefix = "H", stamped_rank = 200)]
struct Hook {
    #[stamped]
    source: Text,
    #[stamped]
    event: Text,
    #[stamped]
    payload: Body,
    #[stamped]
    spool_id: Text,
    #[stamped]
    received_at: Time,
    #[stamped]
    method: Text,
    #[stamped]
    path: Text,
    #[stamped]
    headers: Body,
    #[stamped]
    sig_ok: Bool,
}

// An address is a FACET, not a person-column: any entity may wear one. The
// whole address book is this comp. kind_rank near the tail.
#[derive(Comp)]
#[comp(plugin = "mail", rank = 790, kind_rank = 370, prefix = "A")]
struct Email {
    address: Text,
}
