# Declared-rule scaling on RAM

T-126277, 2026-10-16. Run `deno run -A bench/ram-rules.ts` from the repo root.
Each vocabulary declares 10, 100 or 1,000 rules, each gated by its own input
component. One entity wears the first input; each frame clears that rule's
output and the rule adds it again. Parsing and index construction are warmed up
before measuring. Results are medians of seven groups of 500 applies.

| Declared rules | Before (bf30f42ad) | Compiled candidates |
| -------------- | -----------------: | ------------------: |
| 10             |           0.100 ms |            0.100 ms |
| 100            |           0.392 ms |            0.093 ms |
| 1,000          |           6.061 ms |            0.110 ms |

These are local measurements on a shared machine, not latency guarantees. The
regression test budgets the `Tx.bindings` plans evaluated: two instead of 2,002,
including the quiescence round, with 1,000 unrelated rules.

The solver indexes necessary component presences of every outer pattern. It
selects against the batch's stored entities **and** its patches, not just
changed components: an unrelated edit can still trigger a rule on an entity
already wearing its input. Rules with an unguarded outer join pattern or
absence-only predicates remain unconditional candidates. Each fixpoint round
selects again, retaining order, chaining and repeated-firing refusal. Writer
policies run on eligible candidates and can change between writes.

Work is proportional to eligible rules, not necessarily constant for every rule
set: 1,000 rules that can all match still need evaluation. Mutable plugin
registration content is still inspected each write; fixed vocabulary rules reuse
their parsed declarations, eligibility array and index. The benchmark measures
this fixed-vocabulary path, not mutation detection or cold compile.
