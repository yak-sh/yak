// The roles plugin (D-22530 §8): persistent fleet capacity (roles.ts), the
// dream consolidation cursor (dream.ts), and self-healing's diagnosis
// vocabulary (heal.ts).

use yak_vocab::{Number, Ref, Sel, Text, Time};
use yak_vocab_derive::Comp;

// A role is desired capacity. `held` is the crash-loop breaker's verdict,
// distinct from `stopped` (an owner's off switch).
venum!(
    "roles",
    "roleStates",
    50,
    ["running", "stopped", "paused", "disabled", "retired", "held"]
);

// Native owns an interactive provider TUI; managed owns a resumable session.
venum!("roles", "roleSurfaces", 60, ["native", "managed"]);

venum!(
    "roles",
    "wakePolicies",
    70,
    ["always", "attention", "scheduled", "manual"]
);

#[derive(Comp)]
#[comp(plugin = "roles", rank = 60, kind_rank = 140, prefix = "R", by_name, stamped_rank = 250)]
struct Role {
    #[col(sel = "roleStates")]
    state: Sel,
    #[col(sel = "roleSurfaces")]
    surface: Sel,
    // Scope is attachment, not execution ground; checkout names the
    // repo-bearing entity when scope is not one.
    #[col(eid = "entity", death = "detach")]
    scope: Ref,
    #[col(eid = "entity", death = "detach")]
    checkout: Ref,
    schedule: Text,
    #[col(sel = "wakePolicies")]
    wake_policy: Sel,
    #[col(eid = "entity", death = "detach")]
    wake_target: Ref,
    // The crash-loop breaker's fresh-start boundary; the reconciler never
    // writes it.
    retry_at: Time,
    // System-role throttling as graph data (D-18722 part C): SECONDS.
    quiet: Number,
    cooldown: Number,
    // A concurrency ceiling for system roles whose work spawns (T-18729).
    cap: Number,
    #[stamped]
    applied_hash: Text,
    #[stamped]
    applied_at: Time,
    #[stamped]
    stopped_at: Time,
    #[stamped]
    decision: Text,
    #[stamped]
    reason: Text,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    observed: Ref,
    #[stamped]
    decided_at: Time,
}

// A dream: a venture's consolidation cursor (T-12800, D-17362). One per
// venture. `scope` the venture, `floor` the sliding session cursor.
#[derive(Comp)]
#[comp(plugin = "roles", rank = 660, kind_rank = 230, prefix = "Z")]
struct Dream {
    #[col(eid = "project", death = "cascade")]
    scope: Ref,
    floor: Time,
}

// Self-healing's diagnosis facet (D-17077): a task wearing `bug` was
// auto-filed about an `exception`. `fault` is the stable dedup key. NOT in
// kindOrder: a bug IS a task.
#[derive(Comp)]
#[comp(plugin = "roles", rank = 930)]
struct Bug {
    fault: Text,
    hits: Number,
    last: Time,
}

// The dream's dedup marker (T-17407), the consolidation twin of `bug`. Rides
// on whatever the finding became — a task or a memory. NOT in kindOrder.
#[derive(Comp)]
#[comp(plugin = "roles", rank = 940)]
struct Finding {
    key: Text,
    hits: Number,
    last: Time,
}

// Self-healing phase 2 (D-17077): `fixer` marks a session AUTO-spawned to fix
// a bug ticket — presence alone. NOT in kindOrder — a fixer IS a session.
#[derive(Comp)]
#[comp(plugin = "roles", rank = 950)]
struct Fixer {}

// The auto-spawn mute (D-17077): `nofix` on a PROJECT silences fixer spawns;
// on the self-healing HOME project it is the GLOBAL switch. NOT in kindOrder.
#[derive(Comp)]
#[comp(plugin = "roles", rank = 960)]
struct Nofix {}
