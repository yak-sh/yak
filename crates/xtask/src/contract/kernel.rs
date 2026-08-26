// Plugin zero — the kernel's own vocabulary (D-22530 §1): the comps that ARE
// the graph mechanics, declared in the same annotated form the kernel demands
// of every plugin. Also kernel-owned singletons: the edge vocabulary and the
// global, add-only renames table.

use yak_vocab::{Body, Number, Ref, Sel, Text, Time};
use yak_vocab_derive::Comp;

// What a notice records — the kinds of thing that happened but nobody said
// (D-13858). A closed set like statuses.
venum!("kernel", "noticeKinds", 140, ["lapse", "sweep", "scene"]);

// The edge vocabulary — every edge reads as a sentence, parent first. The LIST
// is the source of truth: db.ts bakes it into the dependency check constraint.
inventory::submit! {
    yak_vocab::EdgesDef {
        plugin: "kernel",
        edges: &[
            "requires",
            "contains",
            "reads",
            "about",
            "supervises",
            "delegates",
            "recalled",
            "supersedes",
            "worked",
            "referenced",
            "wants",
        ],
    }
}

// Old spellings that still resolve — the compatibility promise in data. A
// rename ADDS a row here and NEVER removes one.
inventory::submit! { yak_vocab::RenameDef { plugin: "kernel", from: "view:Show", to: "Full" } }
inventory::submit! { yak_vocab::RenameDef { plugin: "kernel", from: "view:Id", to: "Inline" } }
inventory::submit! { yak_vocab::RenameDef { plugin: "kernel", from: "view:List.Item", to: "List.Tile" } }
inventory::submit! { yak_vocab::RenameDef { plugin: "kernel", from: "view:Task.Row", to: "Board.List.Tile" } }
inventory::submit! { yak_vocab::RenameDef { plugin: "kernel", from: "view:Debug.ListItem", to: "Debug.Tile" } }

// The spine: identity and nothing else. Stamped-only (wire = false): num is
// server-minted on first touch.
#[derive(Comp)]
#[comp(plugin = "kernel", wire = false, stamped_rank = 10)]
struct Entity {
    #[stamped]
    num: Number,
}

// The written face of an entity — title and markdown body.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 10, kind_rank = 360)]
struct Doc {
    title: Text,
    body: Body,
}

// An attached file (T-12781): metadata only, the bytes live content-addressed
// beside the db. A named file still reads as a blob (kind_rank ahead of doc).
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 140, kind_rank = 350)]
struct Blob {
    mime: Text,
    name: Text,
    sha: Text,
    bytes: Number,
    w: Number,
    h: Number,
}

// A non-secret runtime override, keyed by a catalog entry. NOT in kindOrder.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 230)]
struct Setting {
    key: Text,
    value: Text,
}

// Shared navigation as a graph fact. Stays out of kindOrder; `at` records when
// it joined navigation.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 220, stamped_rank = 80)]
struct Favorite {
    #[stamped]
    at: Time,
}

// A comment is a doc AIMED at something — target is any entity, so ANYTHING is
// commentable.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 710, kind_rank = 300)]
struct Comment {
    #[col(eid = "entity", death = "cascade")]
    target: Ref,
}

// A notice: something happened ABOUT this entity that nobody said. `event`,
// not `kind` (which is the universal listing scope).
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 720, kind_rank = 290)]
struct Notice {
    #[col(eid = "entity", death = "cascade")]
    target: Ref,
    #[col(sel = "noticeKinds")]
    event: Sel,
}

// A quiet transcript memo (T-17319): a bare tag a comment wears to say
// "harvest at consolidation, never inject live". Not in kindOrder.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 730)]
struct Meta {}

// A stable external name for an entity. `slug` is the PRIMARY handle, `slugs`
// a space-delimited resolvable-only set. Every member unique graph-wide.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 750, kind_rank = 380)]
struct Alias {
    slug: Text,
    slugs: Text,
}

// A value the graph deliberately forgot. Server-owned and permanent; the
// removed bytes never ride the facet.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 690, kind_rank = 270, prefix = "X", stamped_rank = 240)]
struct Redaction {
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    target: Ref,
    #[stamped]
    #[col(sel(title, body))]
    column: Sel,
    #[stamped]
    hash: Text,
}

// A claim that BOUNCED, kept as an entity. Server-minted only; audit rows
// outlive everything they mention.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 680, kind_rank = 260, stamped_rank = 230)]
struct Conflict {
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    target: Ref,
    #[stamped]
    loser: Text,
    #[stamped]
    holder: Text,
    #[stamped]
    at: Time,
}

// Server-minted recall aggregates — count·first_at·last_at is the decay
// model's whole memory. Any entity can grow warm.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 820, stamped_rank = 220)]
struct Recall {
    #[stamped]
    count: Number,
    #[stamped]
    first_at: Time,
    #[stamped]
    last_at: Time,
}

// Provenance: `created` set once, `updated` the last edit. `by` wire-writable
// (defaults to the writing actor); `at`/`via` server-owned. Death 'keep'.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 830, stamped_rank = 20)]
struct Created {
    #[col(eid = "entity", death = "keep")]
    by: Ref,
    #[stamped]
    at: Time,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    via: Ref,
}

#[derive(Comp)]
#[comp(plugin = "kernel", rank = 840, stamped_rank = 30)]
struct Updated {
    #[col(eid = "entity", death = "keep")]
    by: Ref,
    #[stamped]
    at: Time,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    via: Ref,
}

// Notification lifecycle — the inbox's read-state (T-7006). Each a PRESENCE
// stamp: the wire writes the bare component, the server freezes clock + actor.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 850, stamped_rank = 40)]
struct Notified {
    #[stamped]
    at: Time,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    by: Ref,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    via: Ref,
}

#[derive(Comp)]
#[comp(plugin = "kernel", rank = 860, stamped_rank = 50)]
struct Opened {
    #[stamped]
    at: Time,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    by: Ref,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    via: Ref,
}

#[derive(Comp)]
#[comp(plugin = "kernel", rank = 870, stamped_rank = 60)]
struct Archived {
    #[stamped]
    at: Time,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    by: Ref,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    via: Ref,
}

// A safety boundary over ANY entity. The server signs the whole stamp so graph
// content cannot forge who quarantined it. NOT in kindOrder.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 880, stamped_rank = 70)]
struct Quarantined {
    #[stamped]
    at: Time,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    by: Ref,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    via: Ref,
}

// The BREAK facet (D-17077): our code hit something UNEXPECTED — the
// self-healing trigger. Server-owned/effect-written, mirroring error.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 920, stamped_rank = 170)]
struct Exception {
    #[stamped]
    at: Time,
    #[stamped]
    message: Text,
    #[stamped]
    stack: Text,
}

// The git-anchor facet (D-18378): the revision an entity was VERIFIED against.
// All wire-writable; staleness is re-derived from git, never stored.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 980)]
struct Anchor {
    paths: Text,
    sha: Text,
    symbol: Text,
    hunk: Body,
    start: Number,
    end: Number,
}

// A decision was TAKEN about this entity — `at`/`by`/`verdict` wire-writable
// (a decision is written up long after it is made), `via` server-only.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 990, stamped_rank = 90)]
struct Decided {
    at: Time,
    #[col(eid = "entity", death = "keep")]
    by: Ref,
    #[col(sel(approved, declined))]
    verdict: Sel,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    via: Ref,
}

// An idea awaiting acceptance. Mirrors decided: proposer/date after the fact,
// instrument server-owned. Absence is self-authorizing work.
#[derive(Comp)]
#[comp(plugin = "kernel", rank = 1000, stamped_rank = 100)]
struct Proposed {
    at: Time,
    #[col(eid = "entity", death = "keep")]
    by: Ref,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    via: Ref,
}
