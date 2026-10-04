# Apply attribution

`apply-profile.ts` composes the configured box plugins for the `graph` role on
an owned scratch SQLite file beside the configured database. It records the
ordinary apply trace, tracker construction and flushes, the storage callback's
entry and exit, and SQL calls through the driver. These observers add overhead;
the unprofiled ratchet supplies baseline timings. Production modules are
unchanged. [Retained samples](apply-profile.json) include the load averages,
phase timings, statement counts and scan counts.
[SQL span samples](apply-trace.json) retain the box profile and the
apply-benchmark fixture recording.

Reproduce from the checkout:

```sh
flock /tmp/yaks-throughput-bench.lock deno run -A bench/apply-profile.ts 9
flock /tmp/yaks-throughput-bench.lock deno run -A bench/apply-profile.ts 101 edit-1
flock /tmp/yaks-throughput-bench.lock deno run -A bench/apply-profile.ts 101 edit-1 spans
flock /tmp/yaks-throughput-bench.lock deno run -A bench/apply-profile.ts 101 edit-1 bench
flock /tmp/yaks-throughput-bench.lock deno run -A bench/apply-profile.ts 1 create-200 counts
flock /tmp/yaks-throughput-bench.lock deno run -A bench/apply-profile.ts 1 create-1000 counts
flock /tmp/yaks-throughput-bench.lock deno run -A --cpu-prof --cpu-prof-md --cpu-prof-interval=200 --cpu-prof-dir=/tmp/apply-profile-cpu --cpu-prof-name=create.cpuprofile bench/apply-profile.ts 12 create-1000
```

The `spans` mode uses `record()` alone, without the storage, driver or tracker
wrappers. Its `trace.coverage_percent` measures the union of the transaction's
direct child intervals divided by its duration. Nested SQL is counted inside its
phase once; SQL outside phases is counted directly under the transaction.
`trace.sql_outside_phases` reports the table and verb for those statements. The
`bench` mode uses the file fixture from `apply_bench.ts`, including its fleet
corpus, vocabulary, plugins and numbering policy, with those same observers
disabled.

## Batched numbering-exception presence (T-64969)

`patch()` answers numbering-exception presence for every declared table and
existing entity in its live batch with one statement. It binds the eid list as
one JSON parameter and probes each component's indexed owner column. Undeclared
exceptions are ignored; components supplied in the batch still exclude their
entities before any identity is minted. Existing excluded entities keep their
numbering behavior, including when a patch removes their excluded component.

The configured box composition's 21 exceptions require three batch presence
statements per warm lone edit, replacing the 84 single-table statements in the
retained profile. The 101-sample wrapped profile has a median of **2,837.6 µs**
per apply at a one-minute load average of 2.18. Its transaction is 2,565.6 µs;
the two tracker flushes total 527.0 µs. The retained wrapped sample measured
3,563 µs/apply and 651 µs in flushes at load 5.96. These separate shared-box
samples establish attribution, rather than isolating a latency delta.

The file apply-benchmark fixture uses `number: true`, so it has no numbering
exceptions. Its statements per lone edit therefore measure the ordinary
pipeline, while the configured-box profile exercises this optimization. The
seven-round ratchet measurements are recorded below after verification. The
batching regression also patches 152 existing entities across three exception
tables with two SELECTs total (identity and presence), versus 457 with the
single-table loop, under the 100-bound-parameter limit.

## Time outside named transaction phases

The 101-sample lone-edit median was 3,563 µs on Deno 2.9.1 at a one-minute load
average of 5.96. Its transaction took 3,378 µs; named phases inside it totalled
2,521 µs. The remaining 858 µs was:

| Work outside named phases                              | µs/apply |
| ------------------------------------------------------ | -------: |
| Two archetype tracker flushes                          |      651 |
| Storage entry, including schema check and BEGIN        |       45 |
| Storage exit, including ledger settlement and COMMIT   |       97 |
| Tracker construction                                   |        2 |
| Phase selection, continuation and observation overhead |       62 |

The SQL COMMIT itself took 92 µs. The design's absolute 2.3 ms residual is not a
stable constant on this shared box; its suspected location is resolved: tracker
flushes account for most of the untraced work, while COMMIT is a small part.
Graph runs the first flush after stamping and the second after commit hooks,
outside `phase(...)` in `packages/graph/graph.ts`. Storage then settles its own
ledger and commits in `packages/sqlite/mod.ts` and `unit.ts`.

The warmed edit issues 84 individual presence SELECTs for numbering exceptions:
21 excluded component tables twice inside named phases, then the same 21 tables
twice in tracker flushes. `patch()` in `packages/sqlite/write.ts` calls
`wears()` separately for every excluded table and every existing entity. The
second flush classifies the effect rows written by commit hooks; the first
normally has no dirty entity once the initial `updated` component exists.

## SQL statement attribution

A recording of 101 lone edits on the file apply-benchmark fixture has a median
transaction of 1,034.0 µs. Its direct children cover 997.6 µs: **96.48%**, above
the design's 95% requirement. This records the ordinary statement spans without
adding a phase around tracker flushes. The selected sample is the median by
transaction duration; the profile command selects its sample by apply wall time.

The configured box composition has 21 numbering exceptions. Its 101-sample
`spans`-mode median attributes the transaction as follows:

| Transaction work                         | µs/apply |
| ---------------------------------------- | -------: |
| Named phases, including their nested SQL |  2,420.4 |
| SQL in the two archetype tracker flushes |    740.5 |
| Schema-version SQL                       |     23.8 |
| BEGIN SQL                                |     10.8 |
| COMMIT SQL                               |    172.0 |
| Uncovered work                           |    210.3 |
| Total transaction                        |  3,577.8 |

This box trace covers **94.12%**. SQL names expose the individual presence
SELECTs and entity updates inside the flushes; the remaining 210.3 µs includes
statement construction and control work outside phases. A separate wrapped
profile measured 121.8 µs of flush construction/control outside driver calls.
T-64970 moves those flushes into phases. The previous 651 µs of flush time is
therefore attributed by table and verb, while the remaining non-SQL work is
visible as a residual. These are separate samples on a shared box, rather than
an absolute before/after latency comparison.

The unsubscribed seven-round throughput check passed against the preserved
`throughput.baseline.json`: file-apply time deltas have a median of +2.16%,
ranging from −0.10% to +13.65%, within the suite’s tolerance. Per-case numbers
and the recording samples are retained in [apply-trace.json](apply-trace.json).
`deno task bench:check` now runs this check under the same box-wide lock;
T-64924 replaced `bin/bench.sh` without rebanking its baseline.

## Create growth

There is a quadratic scan in `packages/effects/registry.ts`, `matched()`'s
`inPool`: for each eligible event it asks `bundles.some(...)` whether that
entity carries an effect component. A normal task create has no such component,
so the scan traverses the entire phase batch, including birth, stamp and
archetype patches. The counted hook preserves the same array operations and
counts predicate visits:

| Task creates | Calls to bundles.some | Predicate visits |
| -----------: | --------------------: | ---------------: |
|          200 |                   200 |          160,000 |
|        1,000 |                 1,000 |        4,000,000 |

This composition performs exactly 4N² visits: five times as many creates makes
25 times as much scanning. The V8 CPU report at N=1,000 attributes 11.0% self
time and 14.3% inclusive time to `inPool`. The larger linear cost remains SQLite
calls, especially numbering-exception reads: 21N SELECTs during stamps plus 21N
during archetype flushes. These statement counts grow linearly.

Repeated warmed medians did not reproduce the design's single-run 681 → 1,259
µs/create magnitude: nine samples gave 782 µs at N=200 and 756 µs at N=1,000,
under one-minute load averages of 6.79 and 6.28. An earlier seven-sample run
gave 814 → 863 µs. Thus the quadratic source is established by operation counts
and CPU attribution; the original wall-time jump also includes conditions that a
single run cannot distinguish, such as warm-up, shared load and schema cache
state. It should not be treated as a measured doubling of steady-state
per-bundle cost.

The effect-entity set is built once per `matched()` call (T-64968), and
numbering-exception presence is answered in one batch (T-64969). The scan and
individual-statement measurements above retain the attribution behind those
changes.
