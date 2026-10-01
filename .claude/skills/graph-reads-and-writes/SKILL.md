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

The graph is entities carrying components; a write is a change, a read is a
query. packages/graph/README.md is the reference ("Writes and reads", "IDs and
names", "Plugins and transactions"). This skill is the part you get wrong when
you go by feel.

## A write is a list of patches

A change is an array of bundles applied in one transaction, all or nothing.
Each bundle is a patch: an omitted property is unchanged, `null` clears a
property, a `null` component removes it, `$delete: true` deletes the entity.
What comes back is the change as applied (one composed patch per entity, with
whatever plugins and reference handling added), not a snapshot; cast it into
any cache you keep, or the cache keeps ghosts.

- Try it first: `yak graph apply --change @file.json --check` runs every phase
  and rolls back. With a large change the check prints every bundle; parse the
  JSON to count rather than reading it.
- An argument that starts with `@` is read as a file path, on every `yak`
  command: a title like "@yaks/fp on jsr" fails with "No such file". Phrase
  titles so they don't start with `@`.
- `$name` as an eid is an alias local to one change; human ids (`T-12`) are
  resolved by `g.address`, and one that names nothing is refused, not taken for
  an eid.
- Admission refuses a component or property the vocabulary doesn't declare,
  naming it. The fix is the vocabulary (the `vocabulary` skill), never a
  workaround in the bundle.

## Read-then-write carries `$was`

`$was` names the SHA-256 of each value you read, per property; if one moved,
the whole change is refused (packages/graph/guard.ts). Pass a bundle through
whole at every hop; rebuilding it from its components silently drops the guard.
Memory edits take it as `was` (`memory_save`): compute it from the body you
actually read, never guess it.

## Who a write is stamped as

Each entity in a change is stamped with the writer its own first bundle names in
`$actor`, else the change's writer (`writers()` in packages/graph/stamp.ts), and
the journal records one transaction per writer. So a session's own rows (a
persona snapshot, a report) name the session, and the person is the writer only
of what that person typed or asked for. The owner is the actor only for an act he
explicitly asked for (M-31958). A row stamped with the wrong writer is fixed
with a migration (the `data-migration` skill), and the writer that stamped it is
fixed at its root.

## Deleting

`$delete` tombstones the entity: it keeps its eid and number, and a write whose
`$was` was read before the delete is swallowed as a race; any other write
brings it back (M-17876). References follow their `death` keyword
(packages/graph/cascade.ts): `cascade` deletes the referrer, `detach` clears the
property, `release` drops the referencing component, `keep` leaves history.
Deleting an entity deletes the edges that point at it, so count what a delete
takes with `--check` first. The journal's `undo` brings a deleted entity back
with what the delete cascaded (packages/journal/README.md, "Undo"), but not its
`created` stamp or anything written before the journal began.

## Ids and edges

- `mint()` is a random v4 uuid. A derived eid (`derivedEid`, `identityEid` in
  packages/graph/identity.ts, the `identity` keyword) makes the same facts land
  on the same entity, so a retried write is idempotent. Eids are global
  (M-39645): never derive one that only makes sense in one store.
- `entity.num` (`T-12`) is a label for people, not an identity.
- An edge is an entity, `edge{from, to}` plus a relation component, with eid
  `edgeEid(from, relation, to)` (packages/edge): linking twice is one edge, and
  unlinking deletes that eid.
- A component with `durable: "0s"` is an event: `apply()` hands it back in the
  applied change and stores nothing, and a bundle carrying only events is
  neither stamped nor journaled.

## Reading

How a query is written (prefixes, operators, walks, directives, rule matches,
naming a property with its component) is the `query-grammar` skill. This is how one is answered.

- Ask for what you need: `.count` instead of rows, `.fields` instead of whole
  bundles, `g.get(eids, comps)` instead of a query by eid. Row reads are the
  cost on both the box and a Durable Object.
- Computed properties (`task.status`, a component's `status` keyword,
  `build.cost`) are derived at read, never stored, and a filter on a status
  binds as presence.
- Presence tests and status filters are answered from the archetype index:
  `entity.archetype` names the set of tables an entity holds (packages/archetype,
  `byArchetype` in packages/sql/bind.ts). It is only as true as the pointer.

## Scripts against the db

Write through the graph: a script opens it, or a change goes through
`yak graph apply`. Then stamps, journal, archetype pointers and the full-text
and vector indexes stay right. SQL is @yaks/sql's AST, and nothing else writes a
SQL string (M-39498). A raw SQL writer that must exist calls
`reclassify(driver, eids)` from @yaks/sqlite in the same transaction
(packages/sqlite/README.md); otherwise pointers go stale and presence filters,
status filters and whole-entity reads answer wrong. `archetype_check` finds
drift. Never experiment on the live ~/.yak/yak.db: copy it with `VACUUM INTO`
and point a scratch config at the copy (the `end-to-end-checks` and
`data-migration` skills).

## Rules and effects

Declared rules (packages/graph/README.md, "A rule with no code at all") run in
the write's transaction on @yaks/sqlite and @yaks/ram: a `+` clause with a
value writes it, generated patches run the rules again, and a rule fires once
per match, so write its match to stop matching its own output. A server
rule marked `optimistic: true` also runs in a page's graph. Effects
(@yaks/effects) run after the commit, can't undo it, and aren't exactly-once:
give a retried one its own idempotency, and never let an effect's own write owe
the effect again.

## Looking at it

`yak graph show <id>`, `yak graph query '<q>' --json`, `yak graph history <id>`
(the journal), `yak graph schema <comp>`, and `yak graph inspect` or
https://tasks.yak.sh/inspect to browse the data model.

When this skill is wrong or missing something, fix it in the same change.
