// The comms plugin (D-22530 §8, provisional grouping): attention and delivery
// — knocks, wakes, subscriptions, and the shared deliver/delivered/error triad
// every deliverable wears.

use yak_vocab::{Ref, Sel, Text, Time};
use yak_vocab_derive::Comp;

// What an actor has said about a thread. There is no 'auto': absent IS auto.
venum!("comms", "subModes", 110, ["watch", "mute"]);

// An actor's standing instruction about ONE entity: watch though nothing is
// aimed at me, or mute though something is. Both ends cascade.
#[derive(Comp)]
#[comp(plugin = "comms", rank = 610, kind_rank = 190)]
#[index(cols(actor, target), unique)]
struct Subscription {
    #[col(eid = "entity", death = "cascade")]
    actor: Ref,
    #[col(eid = "entity", death = "cascade")]
    target: Ref,
    #[col(sel = "subModes")]
    mode: Sel,
}

// A knock: bring THIS entity to THAT actor's attention, NOW. WHO should look
// is the `deliver {to}` facet, not a column here.
#[derive(Comp)]
#[comp(plugin = "comms", rank = 640, kind_rank = 210, prefix = "K")]
struct Knock {
    #[col(eid = "entity", death = "cascade")]
    target: Ref,
}

// A wake is a knock with a clock: the same sentence, said LATER. `at` is
// absolute — resolved once, at mint.
#[derive(Comp)]
#[comp(plugin = "comms", rank = 650, kind_rank = 220, prefix = "W")]
struct Wake {
    at: Time,
    #[col(eid = "entity", death = "cascade")]
    target: Ref,
    note: Text,
}

// Addressing as a facet (D-14945): WHERE a deliverable goes. `to` names a
// graph ENTITY, never a raw string. death 'keep'. Wire-writable. NOT in
// kindOrder.
#[derive(Comp)]
#[comp(plugin = "comms", rank = 890)]
struct Deliver {
    #[col(eid = "entity", death = "keep")]
    to: Ref,
}

// Outcome and health (D-14945): `delivered` says it reached its destination
// (`via` = how it went out). Server-owned and EFFECT-written. NOT in kindOrder.
#[derive(Comp)]
#[comp(plugin = "comms", rank = 900, stamped_rank = 150)]
struct Delivered {
    #[stamped]
    at: Time,
    #[stamped]
    via: Text,
}

// `error` is a KNOWN/expected failure state — worth surfacing, NOT a bug, so
// it does not trigger self-healing. The BREAK facet is `exception` (kernel).
#[derive(Comp)]
#[comp(plugin = "comms", rank = 910, stamped_rank = 160)]
struct Error {
    #[stamped]
    at: Time,
    #[stamped]
    message: Text,
}
