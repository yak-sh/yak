# Apply attribution

`apply-profile.ts` composes the configured box plugins for the `graph` role on
an owned scratch SQLite file beside the configured database. It records the
ordinary apply trace, tracker construction and flushes, the storage callback's
entry and exit, and SQL calls through the driver. These observers add overhead;
the unprofiled ratchet supplies baseline timings. Production modules are
unchanged. [Retained samples](apply-profile.json) include the load averages,
phase timings, statement counts and scan counts.

Reproduce from the checkout:

```sh
flock /tmp/yaks-throughput-bench.lock deno run -A bench/apply-profile.ts 9
flock /tmp/yaks-throughput-bench.lock deno run -A bench/apply-profile.ts 101 edit-1
flock /tmp/yaks-throughput-bench.lock deno run -A bench/apply-profile.ts 1 create-200 counts
flock /tmp/yaks-throughput-bench.lock deno run -A bench/apply-profile.ts 1 create-1000 counts
flock /tmp/yaks-throughput-bench.lock deno run -A --cpu-prof --cpu-prof-md --cpu-prof-interval=200 --cpu-prof-dir=/tmp/apply-profile-cpu --cpu-prof-name=create.cpuprofile bench/apply-profile.ts 12 create-1000
```

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

Two candidates for later tasks are building the effect-entity set once per
`matched()` call, and answering numbering-exception presence in one batch
instead of 21 queries per entity. Neither optimization is implemented here.
