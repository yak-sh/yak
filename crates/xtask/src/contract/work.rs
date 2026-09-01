// The work plugin (D-22530 §8): tasks, projects/ventures, boards, designs —
// the portfolio vocabulary.

use yak_vocab::{Body, Bool, Priority, Query, Ref, Sel, Text, Time, Url, Well};
use yak_vocab_derive::Comp;

// The status vocabulary, in board-column order — now a DERIVED value, not a
// stored column (D-24102). `status(task)`: `cancelled` comp → cancelled; else
// `completed` comp → done; else an active `claim` → wip; else open. The list
// stays for board columns, sort order, and the derived `.status=` predicate.
venum!("work", "statuses", 10, ["open", "wip", "done", "cancelled"]);

// A venture's lifecycle, from a glimmer to its end. `hold`/`paused` are
// reversible stops; `shuttered`/`killed` are terminal.
venum!(
    "work",
    "ventureStates",
    80,
    [
        "incubating",
        "idea",
        "building",
        "launching",
        "live",
        "hold",
        "paused",
        "shuttered",
        "killed"
    ]
);

// How a venture is run: long-loop keeps a session alive, cold spawns fresh,
// cron wakes it on a schedule.
venum!("work", "ventureModes", 90, ["long-loop", "cold", "cron"]);

// A review is a comment with one of these verdicts.
venum!("work", "verdicts", 120, ["approved", "rejected", "changes_requested"]);

#[derive(Comp)]
#[comp(plugin = "work", rank = 20, kind_rank = 20, prefix = "T")]
struct Task {
    priority: Priority,
    #[col(eid = "project", death = "detach")]
    project: Ref,
    // Whose PLATE this is — durable routing to any entity. Orthogonal to
    // claim (who holds it NOW); a dead assignee detaches.
    #[col(eid = "entity", death = "detach")]
    assignee: Ref,
    #[col(well = "domains")]
    domain: Well,
}

// The criteria a task must satisfy before an independent review can approve
// its current completion. The review records the outcome; this facet owns only
// the specification it judges.
#[derive(Comp)]
#[comp(plugin = "work", rank = 21)]
struct Accept {
    body: Body,
}

// color: the venture's tmux window colour; empty means DERIVE it.
#[derive(Comp)]
#[comp(plugin = "work", rank = 30, kind_rank = 30, prefix = "P", by_name)]
struct Project {
    color: Text,
}

// The project's checkout and public repository URL. `gate` is its one complete
// test command; `push` is standing permission for the projection to push —
// OFF by default and off for unknown repos.
#[derive(Comp)]
#[comp(plugin = "work", rank = 40)]
struct Repo {
    path: Text,
    url: Url,
    base_branch: Text,
    gate: Text,
    push: Bool,
}

// A project's venture facet: lifecycle phase + operating config. A facet, not
// an identity — a doc+project+venture is still a project.
#[derive(Comp)]
#[comp(plugin = "work", rank = 50)]
struct Venture {
    #[col(sel = "ventureStates")]
    phase: Sel,
    #[col(sel = "ventureStates")]
    paused_from: Sel,
    #[col(sel = "ventureStates")]
    hold_from: Sel,
    #[col(sel = "ventureModes")]
    run_mode: Sel,
    agent_model: Text,
    operated_by: Text,
    tagline: Text,
    site: Url,
}

// A board is a saved filter over tasks (query.ts grammar); an empty query
// selects NOTHING.
#[derive(Comp)]
#[comp(plugin = "work", rank = 70, kind_rank = 50, prefix = "B", by_name)]
struct Board {
    query: Query,
}

// The thinking that precedes a build. A tag — the doc carries the writing and
// proposed/decided carry its life. kind_rank ahead of task: a design stays a
// design until decided.
#[derive(Comp)]
#[comp(plugin = "work", rank = 100, kind_rank = 10)]
struct Design {}

// A goal: a standing purpose — guidance, never completed or reviewed
// (M-31946 §5). Work points at it with a `satisfies` edge; `scope` names
// the project it guides, absent means fleet-wide. kind_rank between design
// and task so a goal is never mistaken for either.
#[derive(Comp)]
#[comp(plugin = "work", rank = 105, kind_rank = 15, prefix = "V")]
struct Goal {
    #[col(eid = "project", death = "keep")]
    scope: Ref,
}

// Marks a doc as architecture documentation — the graph's self-description.
// NOT in kindOrder: an architecture doc is still a plain doc.
#[derive(Comp)]
#[comp(plugin = "work", rank = 110)]
struct Architecture {}

// The BLOCK facet (D-17094): stuck on something EXTERNAL with no entity to
// name in a `requires` edge. Orthogonal to status. The only thing that
// reddens the Dot.
#[derive(Comp)]
#[comp(plugin = "work", rank = 970, stamped_rank = 180)]
struct Blocked {
    on: Text,
    #[stamped]
    since: Time,
}

// A task FINISHED (D-24102): the `done` mark that replaces the stored status.
// Presence IS done — `status(task)` derives it, and it takes priority over an
// active claim. at/by are wire-writable like `decided` (a completion recorded
// after the fact); `via` is server-owned. Not in kindOrder: a task stays a task.
#[derive(Comp)]
#[comp(plugin = "work", rank = 971, stamped_rank = 350)]
#[index(cols(at))]
struct Completed {
    at: Time,
    #[col(eid = "entity", death = "keep")]
    by: Ref,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    via: Ref,
}

// A task CALLED OFF (D-24102): the `cancelled` mark. Authored, not deletion —
// it preserves a decision about real work — and outranks `completed` in the
// derivation. `reason` is the optional why; at/by wire-writable, `via` server-owned.
#[derive(Comp)]
#[comp(plugin = "work", rank = 972, stamped_rank = 360)]
struct Cancelled {
    at: Time,
    #[col(eid = "entity", death = "keep")]
    by: Ref,
    reason: Text,
    #[stamped]
    #[col(eid = "entity", death = "keep")]
    via: Ref,
}

// A verdict-bearing comment. The aim/rationale/authorship stay on
// comment+doc+created; this contributes only judgment.
#[derive(Comp)]
#[comp(plugin = "work", rank = 740, kind_rank = 280)]
struct Review {
    #[col(
        sel = "verdicts",
        alias(approve = "approved", reject = "rejected", changes = "changes_requested")
    )]
    verdict: Sel,
}
