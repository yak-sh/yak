# SQLite syntax-node yardstick — October 16, 2026

Baseline only for D-126429 / T-126525. No Rust, new engine, or store changes.
The reproducible emitter, graph workload and raw samples are
`yardstick-tree.ts`, `yardstick.ts`, and `yardstick.results.json`. This is not a
proposed budget passing: SQLite misses load, small-edit and subtree targets on
this shared box.

## Corpus and composition

Corpus commit **64debacbd3129ba0bcb08bd5de583bd36d57172b**: `git ls-files`
ending in `.ts`, `.tsx`, `.js`, including tests, fixtures and skills. **3,267
files, 21,819,939 source bytes, 6,677,779 syntax nodes** (anonymous nodes and
punctuation included), **586,576 reference records**. Two parses agree on counts
and corpus SHA-256
`3f3b695f310be24469305a30a1ca40cbdc294754f9c93340900fe7a21e717186`. This
replaces the design's estimated 2.2–6.5 million nodes for its older checkout; it
is not a count for that older commit.

Deno 2.9.1 / V8 14.9.207.2-rusty, Linux x86_64, Intel i7-8700K @ 3.70GHz, 24 GiB
host memory. `web-tree-sitter@0.20.8` and `tree-sitter-wasms@0.1.13` are pinned
through the root import map/lock. Runtime and TS/TSX/JS grammars are prebuilt
npm wasm; no compiler or build script runs. Grammar byte counts and SHA-256s are
in the results. The grammar package's build inputs are TS/TSX
`tree-sitter-typescript ^0.20.5` and JS `tree-sitter-javascript ^0.20.3`; the
**wasm hashes**, not those ranges, identify what actually ran. There are 1,426
ERROR/missing syntax nodes, retained and counted, not rejected files. This
grammar vintage and intentionally invalid fixtures are part of the baseline, not
a claim that the repo has 1,426 TypeScript errors.

The external resolver is deliberately **file-local same-spelling identifier and
type_identifier occurrences pointing to their first occurrence**, excluding that
first occurrence itself. It is deterministic syntax-reference traffic, **not
lexical binding, cross-file resolution or a TypeScript symbol benchmark**.
Identical emitted records must be used by a later engine comparison.

Each file emits preorder `node{file,parent,ordinal,kind,start,end}` with UTF-8
byte spans and `reference{source,target}`. Only one file's objects are retained;
the spool separates parsing from SQLite. Parents/source/target are graph entity
refs with `death:keep`; node indexes cover `(file,start,end)`,
`(parent,ordinal)`, and reference indexes cover source and target. The workload
uses normal `@yaks/graph.apply`, admission, created/updated stamps and SQLite
transactions, not direct SQL inserts or a trusted bypass. Created rows exist for
every loaded entity. There is no journal plugin or business plugin composition:
these are the specified benchmark-only vocabulary plus stamps, **not full
production business end-to-end timings**. No original source or retained
historical journal is stored.

SQLite uses the existing `@yaks/sqlite/db` defaults: WAL, synchronous NORMAL,
4,096-byte pages, 2,000 KiB cache, foreign keys on; batches are at most 1,000
bundles, each with its own normal transaction. Load timing includes graph work,
FFI, SQLite commit/checkpoint work; it does not separate core from durability or
claim power-loss durability (NORMAL is not FULL). Parse/emission/resolution and
spool I/O are separate and excluded from apply time.

## Results

Two **serial, fresh-database, fresh-process** full repetitions. Values below are
run A / run B, not pooled into a fictitious p95 from two samples.

| Measure                                              |                 A |                 B |
| ---------------------------------------------------- | ----------------: | ----------------: |
| Parse + emit + fixture resolution                    |          14.866 s |          22.355 s |
| Write spool (separate)                               |           5.514 s |          20.859 s |
| Parser process sampled peak RSS                      |         495.3 MiB |         477.3 MiB |
| SQLite load apply, summed batches                    |       1,095.782 s |         715.948 s |
| Spool read/decode, excluded from apply               |          42.895 s |          17.067 s |
| Nodes/s (denominator includes reference apply too)   |             6,094 |             9,327 |
| Load batches p50 / p95                               | 69.40 / 200.56 ms | 66.72 / 139.54 ms |
| Checkpointed database size                           |   1,964,249,088 B |   1,964,249,088 B |
| Database bytes / syntax node                         |            294.15 |            294.15 |
| Load sampled peak process RSS                        |         428.8 MiB |         423.5 MiB |
| RSS after edits/reads                                |         681.5 MiB |         547.1 MiB |
| Final process RSS / syntax node                      |          107.01 B |           85.91 B |
| Reopen + schema install in fresh child               |          28.505 s |          25.339 s |
| First child subtree read                             |         118.46 ms |         122.24 ms |
| Whole restart child (launch/module startup included) |          29.049 s |          25.870 s |

Database bytes include references, identities, provenance, presence and indexes,
normalized by syntax nodes, not bytes of an isolated node row or compressed log.
RSS is process RSS including JS/wasm/SQLite, **not native resident index
bytes**; load peak is sampled after batches and may miss intra-batch peaks.
Final RSS can exceed it because the whole large diff and validation are
materialized. OS file cache and other sessions' memory are not charged to this
process. File growth samples are not physical write amplification or WAL byte
traffic.

### Actual file diffs (7 applies each, restoration outside timing)

Replace the first numeric literal `n` with `(n + 1)`. Explicit
kind/transformed-span matching retains unrelated subtrees' IDs, including their
descendants; parser handles and offsets alone are not identity. New syntax gets
new IDs, removed syntax is tombstoned. Byte shifts still change stored start/end
values on retained nodes: a one-literal edit can have a large real diff.
Reference endpoint/row IDs are remapped with nodes. Each apply is checked
against every expected node field, then the original file is restored outside
the timed region.

| File                   | Original nodes | Changed bundles |         p50 A / B |         p95 A / B |
| ---------------------- | -------------: | --------------: | ----------------: | ----------------: |
| `workers/yak/rtc.ts`   |            999 |             822 |  44.06 / 50.88 ms | 97.53 / 127.74 ms |
| `workers/yak/tools.ts` |         52,647 |          50,449 | 13.212 / 14.611 s | 15.182 / 16.242 s |

Separate parse/diff preparation: small 26.23 / 37.11 ms; large 355.60 / 364.14
ms. These are warm end-to-end graph applies, not 1k core-only changed-node
timings. The first apply is included in the seven-sample p95 (nearest rank, thus
max). Restoration changes stamps and retains identity/tombstone rows; this is
not a snapshot reset between samples. Database growth: small zero; large first
apply 2,945,024 B then zero in both runs.

### Reads (one first use, then 21 warm samples)

A file's whole tree is fetched through graph with its file index; parent/ordinal
adjacency reconstructs **preorder** in JS and is included in timing. An initial
start/end comma-order pilot was invalid query syntax; it was discarded and both
reported repetitions use the corrected traversal. `apps/vale/hud.ts` gives
**10,098 nodes, 1,679,912 serialized output bytes**.

| Operation                               |    First use A / B |   Warm p50 A / B |    Warm p95 A / B |
| --------------------------------------- | -----------------: | ---------------: | ----------------: |
| File subtree                            | 183.35 / 185.66 ms | 65.87 / 82.91 ms | 76.37 / 116.29 ms |
| Reverse references, 480 rows / 67,573 B |    8.79 / 58.29 ms | 1.756 / 1.631 ms |  3.587 / 2.226 ms |
| Forward reference, 1 row / 140 B        |   0.689 / 3.146 ms | 0.060 / 0.051 ms |  0.181 / 0.162 ms |

Reference target is `workers/yak/tools.ts#1840`. First-use means this process's
first query, **not cold disk**: no global cache drop on a shared box. A fresh
restart process verifies subtree count. An independent read-only SQLite audit of
both finished databases verifies all 6,677,779 nodes / 586,576 references, every
non-null parent, and both endpoints of every reference after restart.

## Shared host and limits

`uptime` was captured at each start/end in the raw reports. SQLite A:
`15:06:15 up 29 days, 19:08, 7 users, load average: 5.87, 7.27, 6.94` →
`15:29:28 up 29 days, 19:31, 5 users, load average: 4.28, 7.05, 9.85`. SQLite B:
`15:29:29 up 29 days, 19:31, 5 users, load average: 4.28, 7.05, 9.85` →
`15:46:11 up 29 days, 19:48, 5 users, load average: 6.89, 5.88, 6.83`. These are
host-local times (UTC−04); raw ISO timestamps are UTC on October 16. Other
sessions ran throughout; do not interpret the spread as engine variance alone.
The second parse overlapped an exploratory load; both reported SQLite runs were
serial. No attempt to stop other users or tune host settings.

This is the task's baseline subset (load, small/large edit, subtree, refs,
restart), not the design's entire candidate acceptance suite.
Branch/diverge/merge, time travel, compaction, schema renaming, independent
writer conflicts/crashes, reader/GC races and 100-session replay are **not
measured here**. No historical retention parity, compressed log budget,
core-only frame budget or semantic reference quality is established.

## Reproduce and checks

Use a clean checkout at the corpus SHA for the input, and this revision's
harness:

```sh
deno run -A bench/yardstick.ts parse /path/to/corpus /path/to/spool
deno run -A bench/yardstick.ts run /path/to/spool /path/to/fresh-a.db /path/to/a.json
deno run -A bench/yardstick.ts run /path/to/spool /path/to/fresh-b.db /path/to/b.json
```

Do not reuse a populated database as a fresh load. Spool keeps per-file source
and records and is not committed. Raw reports retain file manifest, all
batch/read/ edit samples, environment and grammar hashes; no database blobs are
committed.

Checks: `deno check`, `deno fmt`, `deno lint` on changed files; focused
three-case suite and `deno task test:budget bench/yardstick-tree_test.ts` pass
(budget rerun six passes). Replacing UTF-8 offsets with raw UTF-16 indexes makes
the Unicode fixture fail, then restoring the emitter passes. A two-file
end-to-end smoke run exercises parse/spool/load/diffs/reads/fresh-process
restart with answer checks.
