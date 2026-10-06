---
name: graph-reads-and-writes
description: >
  How writing to and reading from the yaks graph works: bundles and patch
  rules, `$was`, writer stamps, deletes and tombstones, derived ids and edges,
  queries and the archetype index, scripts against ~/.yak/yak.db. Use it when
  writing bundles (`yak graph apply`, `graph_apply`, a script, tool or rule),
  querying (`yak graph query`, `graph_query`, a board or filter), writing db
  scripts or SQL, or surprised by a refusal, missing component, wrong count,
  wrong writer or a deleted entity returning. Value-free composed anatomy and
  causal observation are `platform-visualize`, not stored rows or returned
  values. Query syntax is `query-grammar`; component design is `vocabulary`;
  changing stored row shape is `data-migration`; rules and effects are
  `effects-and-rules`; full-text and `.near` are `search-and-embeddings`.
---

# Writing to and reading from the graph

Everything passes through one door. The graph is entities carrying components:
a write applies a batch of bundles in one transaction, and a read is a query.
Behind the door sits everything nobody wants to think about on each write: the
stamps that say who did it, the journal that can undo it, the archetype pointers
that answer presence filters, the full-text and vector indexes, the rules that
run inside the transaction and the effects that run after it. A write through
the graph gets all of them. A write that reaches around it gets none, and
nothing says so. packages/graph/README.md is the reference ("Writes and reads",
"IDs and names", "Stamps and actors", "Rules"); this skill is the feel of it.

The graph is also shared and lasting. The box, every page, every yaks.app store
and every agent write into it at once, and the owner reads it as his working
memory. Jeff, verbatim (M-39645): "assume that "the graph" is global and
boundless, hence UUIDs. the goal will be to converge towards a p2p (CRDT
perhaps) sync model. this is part of why we had a journal."

So write like a careful guest in a busy shared house: say only what you're
changing, show what you based it on, sign it as yourself, and ask only for what
you'll read. When the graph refuses, it is telling you something true (a word
the vocabulary lacks, a value that moved under you, an id that names nothing),
and the fix is where the refusal points.

## A write is a patch

A batch is an array of bundles applied all or nothing. Each bundle is a patch,
not a record: an omitted property is unchanged, `null` clears a property, a
`null` component removes it, `$delete: true` deletes the entity. Saying only
what changed is what lets two writers touch one entity without trampling each
other. What comes back is the applied batch (one composed patch per entity, with
whatever plugins and reference handling added), not a snapshot, so a cache that
keeps its own copy casts it in or keeps ghosts.

- `yak graph apply --bundles @file.json --check` runs every phase and rolls
  back: the cheapest way to see what a write will do. A large check prints every
  bundle; parse the JSON to count rather than reading it.
- An argument that starts with `@` is read as a file path on every `yak`
  command (`inflate` in packages/cli/args.ts), so a title like "@yaks/fp on jsr"
  fails with "No such file". Phrase it so it doesn't start with `@`.
- `$name` as an eid is an alias local to one batch. A human id (`T-12`) is
  resolved at the door by `g.address`, and one that names nothing is refused
  rather than taken for an eid.
- Admission refuses a component or property no vocabulary declares, naming it.
  The vocabulary is the contract every reader relies on, so the fix is a
  declaration (`vocabulary`), not a bundle shaped to slip past it.

## Show what you read: `$was`

A read-then-write says what it was based on. `$was` gives, per property, the
SHA-256 of the value you read (`token(value)` from @yaks/graph, `null` for "it
had none"); if any of them moved, the whole batch is refused with `Stale`,
naming the current value (packages/graph/guard.ts). It is compare-and-set: of
two callers claiming the same thing, one wins and the other learns why. The
guard rides inside the bundle, so a bundle passes through each hop whole;
rebuilding it from its components drops the guard without a sound. Memory edits
take it as `was` on `memory_save`: the `$was.doc.body` that `memory_recall`
handed back with the memory you read.

## Who wrote it

Each entity in a batch is stamped as the writer its own first bundle names in
`$actor`, else the batch's writer (`writers()` in packages/graph/stamp.ts;
`signed()` sets one), and the journal records one transaction per writer. A
session's own rows (a persona snapshot, a report) name the session, and a person
is the writer only of what that person typed or asked for. Jeff, verbatim
(M-31958): "i think "closing the door" is probably a fleet-wide prompt
clarifying they should only mark me as the actor if i *explicitly* ask them to
do that exact thing. any follow-ups or later things should be marked as the
agent". A row stamped with the wrong writer moves with `data-migration`, and the
code that chose that writer is fixed where it chose.

## Deleting

`$delete` tombstones the entity: `tombstone: {}` keeps its eid and number. A
later write whose `$was` was read before the delete raced it and is dropped; any
other write brings the entity back holding only what that write gives (M-17876).
References follow their `death` keyword (packages/graph/cascade.ts): `cascade`
deletes the referrer, `detach` clears the property, `release` drops the
referencing component, `keep` leaves history. Deleting an entity also deletes
the edges that point at it, so a delete can take more than it names, and
`--check` counts it first. The journal's `undo` brings a deleted entity back with
what its delete cascaded (packages/journal/README.md, "Undo"), but not its
`created` stamp or anything written before the journal began.

## Ids and edges

- `mint()` (packages/graph/mint.ts) is a random v4 uuid. A derived eid
  (`derivedEid`, `identityEid` in packages/graph/identity.ts, the `identity`
  keyword) makes the same facts land on the same entity, so a retried write is
  idempotent. Derived or minted, an eid means the same thing in every store
  (M-39645).
- `entity.num` (`T-12`) is a label for people, not an identity.
- An edge is an entity, `edge{from, to}` plus a relation component, with eid
  `edgeEid(from, relation, to)` (packages/edge): linking twice is one edge, and
  unlinking deletes that eid.
- A component with `durable: "0s"` is an event: rules see it and `apply()` hands
  it back in the applied bundles, but nothing stores, stamps or journals it
  (packages/graph/mutate.ts).

## Reading

How a query is written is `query-grammar`. How one is answered:

- Row reads are the cost, on the box and in a Durable Object alike, so ask for
  what you'll read: `.count` over rows, `.fields` over whole bundles,
  `g.get(eids, comps)` over a query by eid.
- Computed properties (`task.status`, a component's `status` keyword,
  `build.cost`) are derived at read, never stored, and a filter on a status binds
  as presence.
- Presence tests and status filters are answered from the archetype index:
  `entity.archetype` names the set of tables an entity holds (packages/archetype,
  `byArchetype` in packages/sql/bind.ts). It is only as true as that pointer,
  which is why the next section matters.

## Scripts against the db

A script writes through the graph: it opens one, or hands bundles to
`yak graph apply`. That is what keeps the stamps, the journal, the archetype
pointers and the full-text and vector indexes true. SQL is @yaks/sql's AST.
Jeff, verbatim (M-39498): "nothing anywhere else should ever be writing raw sql
strings." A raw SQL writer that has to exist calls `reclassify(driver, eids)`
from @yaks/sqlite in the same transaction (packages/sqlite/README.md), or the
pointers go stale and presence filters, status filters and whole-entity reads
answer wrong; `archetype_check` finds the drift. The live ~/.yak/yak.db is the
owner's working graph, so experiments run on a copy made with `VACUUM INTO`
behind a scratch config (`end-to-end-checks`, `data-migration`).

## Rules and effects ride along

A write is more than its bundles. Declared rules (packages/graph/README.md, "A
rule with no code at all") run inside its transaction, on @yaks/sqlite and
@yaks/ram alike: a `+` clause with a value writes it, the patches a rule makes
run the rules again, and a rule fires once per match, so its match has to stop
matching its own output. A server rule marked `optimistic: true` also runs in a
page's graph. Effects (@yaks/effects) run after the commit, can't undo it and
aren't exactly-once, so a retried one carries its own idempotency and its own
write never owes the effect again. Writing them is `effects-and-rules`.

## Looking at it

`yak graph show <id>`, `yak graph query '<q>' --json`, `yak graph schema
<comp>`, `yak history <id>` (the journal), and `yak inspect` (the map, an id or a
query) in a terminal, or https://tasks.yak.sh/?map in a browser.

When this skill is wrong or missing something, fix it in the same change.
