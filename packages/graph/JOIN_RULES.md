# Multi-entity rule prototype

This is an experimental parser and bounded evaluator, **not a new production
rule-registration path**. Existing `Rule.match`, `parse()`, storage queries, and
single-entity rule behavior are unchanged.

## Syntax

```text
$call .entry{$session} .call;
.result{$call} +!entry{$session}
```

- `$call` binds the first pattern's entity ID.
- `;` separates entity patterns in one conjunction. Variables are shared across
  patterns; repeated bindings compare values for equality.
- `.entry{$session}` means `.entry{session: $session}`. Curly braces describe
  properties, never positional arguments. Explicit `property: $variable`
  bindings can use a different property and variable name.
- `.result{$call}` matches the reference property `call` against that ID.
- `+!entry{$session}` matches only if `entry` is absent, then produces an
  `entry` patch on that pattern's matched entity. It does not upsert or create
  another entity. An existing membership, even a different one, does not match.

Sequence allocation is a separate rule. The example writes only `entry.session`.

The initial grammar supports positive component patterns, entity/property
variables, and absent/add gates. It deliberately excludes literals, comparisons,
optional joins, traversal directives, resources, aggregates, removals, and
arbitrary expressions. Unknown syntax produces an offset-bearing error rather
than being interpreted as full-text search.

## APIs

`parseJoinRule(source)` in `@yaks/query` returns a serializable `JoinRule` AST.
`joinRule(source, vocab, limits?)` in `@yaks/graph` validates vocabulary names,
coarse binding types, and bound action variables, then returns a pure evaluator:

```ts
const plan = joinRule(
  '$call .entry{$session} .call; .result{$call} +!entry{$session}',
  vocab,
)
const patches = plan.run([callCandidates, resultCandidates])
```

There is one candidate set per entity pattern. Candidates must be complete,
consistent entity views assembled from committed state plus the current batch.
Duplicate entity IDs in a set are deduplicated. The same entity can satisfy
multiple patterns; distinctness is not implicit. Null/missing binding values do
not bind variables. No input bundles are mutated.

The evaluator does not access storage. A host must gather candidates using
reference lookups or indexed queries **inside the transaction**, then append
returned patches to that transaction's batch. `join_test.ts` demonstrates this
with a target-triggered precondition hook: it reads only the calls referenced by
incoming results, overlays the current batch, enriches the existing results, and
lets an independent stamp rule assign sequences. Post-commit observers see the
stored membership and sequence together. This fixture's constant sequence is
intentionally not a production allocator.

A second example, unrelated to sessions, copies a label between entities sharing
a key:

```text
.source{$key, $value}; .target{$key} +!label{$value}
```

## Bounds and determinism

Default limits are 1,024 supplied candidates in total and 10,000 candidate
visits. Evaluation fails when either limit is exceeded. This prevents the pure
prototype from silently running an unbounded Cartesian join. It is not an
optimizer: unsuitable candidate sets can still be expensive or exceed the cap.
The evaluator lists component dependencies, including absence tests, but does
not install subscriptions or infer an indexed query plan.

Identical derivations coalesce. Derivations assigning different values to the
same target property throw before any patches are returned. Declaration order
never selects an arbitrary winning session. Reference-target constraints, enums,
and full column validation remain the graph admission layer's job; compile-time
checks only reject incompatible primitive binding types. A host must not bypass
normal validation for externally supplied candidate data.

## Deliberately unresolved integration

The current rule engine evaluates a phase against frozen views. It does not
repeatedly join newly produced entities until a fixpoint. This prototype does
not change that contract.

Before general registration, the following need an explicit design:

1. **Candidate planning and invalidation:** a change to either side may produce
   new matches. The fixture only demonstrates incoming-result enrichment. A
   production planner must also find committed dependents when a call gains or
   changes membership, without scanning all entities per write.
2. **Transaction phase dependencies:** membership must precede the existing
   sequence allocator. Separate phases work in the fixture; same-phase ordering
   or a dependency/fixpoint mechanism is not implemented.
3. **Termination:** one evaluator call is bounded and never recurses. Repeated
   host invocation and cyclic rule sets need an engine-level policy. The gate
   alone does not authorize an unlimited fixpoint loop.
4. **Reference/type inference:** entity-ID bindings are strings in the
   prototype; it does not prove that a variable's candidate entity has the kind
   required by every reference column.
5. **Language integration:** `parseJoinRule` is a separate experimental
   entrypoint so semicolons/braces do not alter ordinary query semantics.
   Integrating this AST with existing gate declarations, SQL planning and
   `Rule.match` is future work, not a second syntax users must permanently
   learn.

The immediate call/result execution refactor can use existing function rules. It
does not need to depend on this experimental grammar.
