// The identity/knowledge plugin (D-22530 §8, provisional grouping): people,
// personas, models, memories, feedback.

use yak_vocab::{Ref, Sel, Text, Time};
use yak_vocab_derive::Comp;

// A model's capability tier (supply book D-21285). Coarse on purpose.
venum!("identity", "grades", 130, ["frontier", "mid", "small"]);

// A durable identity — the owner, an operator. A person is who a session runs
// FOR.
#[derive(Comp)]
#[comp(plugin = "identity", rank = 760, kind_rank = 320, prefix = "U", by_name, plural = "people")]
struct Person {}

// A voice a session can wear: the doc is its irreducible core, its TIERS are
// edges. home is its home project; null = fleet-shared.
#[derive(Comp)]
#[comp(plugin = "identity", rank = 770, kind_rank = 330, prefix = "N", by_name)]
struct Persona {
    #[col(eid = "project", death = "detach")]
    home: Ref,
}

// A model as an entity (D-21308): the attribution cascade's terminal. `name`
// is the wire spelling; `vendor` who MAKES it (not `provider`, the runner).
#[derive(Comp)]
#[comp(plugin = "identity", rank = 780, kind_rank = 340, prefix = "O", by_name)]
struct Model {
    name: Text,
    vendor: Text,
    #[col(sel = "grades")]
    grade: Sel,
}

// A distilled fact worth keeping — content rides the doc, provenance the
// created stamp. `scope` is scope, NOT project (bare '.project' routes to
// task). last_confirmed_at server-stamped.
#[derive(Comp)]
#[comp(plugin = "identity", rank = 800, kind_rank = 310, prefix = "M", stamped_rank = 210)]
struct Memory {
    #[col(eid = "project", death = "keep")]
    scope: Ref,
    #[stamped]
    last_confirmed_at: Time,
}

// This entity records feedback, and `by` is who GAVE it. `by` wire-only,
// deliberately NOT defaulted to the writing actor. Death 'keep'. Not in
// kindOrder.
#[derive(Comp)]
#[comp(plugin = "identity", rank = 810)]
struct Feedback {
    #[col(eid = "entity", death = "keep")]
    by: Ref,
}
