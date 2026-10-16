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

Measurement engine/package code is pinned to corpus/base commit
`64debacbd3129ba0bcb08bd5de583bd36d57172b`. Landing rebased the harness onto
newer main (including SQL changes); the reported full-corpus numbers are **not**
measurements of that newer main. The focused suite, type check and two-file
end-to-end smoke were repeated after rebasing. For engine comparisons use the
pinned engine code and identical corpus/grammar hashes, not floating main.

## File and declaration JSONB grains (T-126603)

The same harness now has a `coarse` mode; it reuses the emitter, per-file spool,
graph composition, timers and checks above, not another benchmark. Input is the
**same 3,267 files / 6,677,779 nodes / 586,576 fixture references**, hash
`3f3b695f310be24469305a30a1ca40cbdc294754f9c93340900fe7a21e717186`, exported
from the pinned corpus commit. Host is the same i7-8700K / 24 GiB box. SQLite is
**3.53.3**. Coarse runs use package code at
**ab8e2225fc2674c6a3b8633fa9ae3e5c6ff999bf**; the historical node rows above use
**64debac**. Do not attribute the difference solely to grain: the engine is not
identical (notably query binder changes). The report `engineSha` records the
harness checkout at report time (the measurement process started earlier in the
same branch); package code stayed unchanged throughout all four runs. No
production code changed for this measurement; the new SQL integration tests
exercise capabilities already present. Raw reports:
`yardstick.coarse.results.json`.

### What is stored

**Actual SQLite JSONB BLOBs**, not JSON strings or an imagined future feature:
`tree.value` is an object property and the current adapter writes it through
`jsonb(?)`. The harness checks `typeof(value)='blob'` for every coarse entity,
the sum of all stored `json_array_length(value,'$.nodes')` against the corpus
node count, graph round-trips after each edit, and SQL answers after reopen.
JSON text is still encoded at the JS/SQLite boundary; JSONB is the disk value.

A file entity holds one `{nodes:[...]}` value. Declaration units are each
**program child subtree**, including top-level functions/classes/exports and
residual imports, comments, statements and punctuation; one extra unit retains
the program root. This broader partition deliberately loses no syntax. Nested
functions remain inside their top-level owner's value. Nodes keep kind, relative
byte span, local parent index, sibling ordinal, compact original ID suffix,
identifier spelling and the baseline fixture reference target when present. The
separate `tree.start` is the absolute base. Thus moving a later declaration need
not rewrite its JSONB value. This is normalization/packing as well as entity
coarsening: the old baseline repeats file and full parent IDs on all node rows;
the coarse layout does not. It **adds identifier spellings** so cross-file name
traffic can be measured. No source text or retained journal is stored at either
grain. Bytes/node includes the whole checkpointed database, not just JSON
payload.

Two serial fresh-database/fresh-process repetitions per grain; run order is file
A, declaration A, file B, declaration B. Spool I/O and packing are timed
separately from normal `graph.apply` batches (at most 1,000 entities). Reads
include answer validation and materialization. First use is not cold disk; no
host-wide cache changes. Shared-host load is recorded in every raw report.

| Measure                                      |                File A / B |         Declaration A / B |
| -------------------------------------------- | ------------------------: | ------------------------: |
| Graph entities                               |             3,267 / 3,267 |         102,086 / 102,086 |
| Load graph apply (s)                         |             52.42 / 49.20 |             60.36 / 63.07 |
| Packing (s), excluded from apply             |               8.56 / 7.38 |               7.15 / 6.27 |
| Spool read/decode (s), excluded              |             26.79 / 11.34 |             13.11 / 10.26 |
| Checkpointed base DB (B)                     | 474,841,088 / 474,841,088 | 500,015,104 / 500,015,104 |
| Base database bytes / syntax node            |             71.11 / 71.11 |             74.88 / 74.88 |
| Sampled load peak RSS (MiB)                  |           412.74 / 396.02 |           399.54 / 334.59 |
| Node location index build (ms)               |             13.70 / 13.84 |           140.17 / 124.72 |
| Node location index growth (B)               |         122,880 / 122,880 |     3,833,856 / 3,833,856 |
| Name/path side-table extraction + insert (s) |             14.48 / 11.06 |             11.02 / 11.49 |
| Name/path side-table growth (B)              |   17,338,368 / 17,338,368 |   17,170,432 / 17,170,432 |
| Name covering-index build (s)                |               1.13 / 0.94 |               0.89 / 0.85 |
| Name covering-index growth (B)               |   17,887,232 / 17,887,232 |   17,719,296 / 17,719,296 |
| Name side table + index total growth (B)     |   35,225,600 / 35,225,600 |   34,889,728 / 34,889,728 |
| Base + both query indexes (B/node)           |             76.40 / 76.40 |             80.68 / 80.68 |
| Load apply + both index builds (s)           |             68.05 / 61.21 |             72.41 / 75.54 |

Historical every-node baseline beside these new rows: **715.95–1,095.78 s** load
and **294.15 B/node**, versus the coarse base and indexed totals above. This is
descriptive, not a controlled same-engine speedup ratio. Index bytes are
incremental checkpointed file growth (including page allocation/slack), not an
isolated logical payload size. Peak RSS is sampled after graph batches.

| Query (warm ms, p50 / p95)             |                File A |               File B |         Declaration A |         Declaration B |
| -------------------------------------- | --------------------: | -------------------: | --------------------: | --------------------: |
| Read function through graph + slice    |         12.41 / 15.51 |        21.14 / 26.54 |         11.16 / 16.72 |         16.82 / 31.49 |
| Read node by JSON path, scan           |           5.59 / 6.53 |          3.97 / 4.82 |         54.80 / 62.27 |         61.38 / 67.42 |
| Read node by JSON path, indexed        |           0.33 / 0.38 |          0.31 / 0.36 |           0.22 / 0.24 |           0.18 / 0.23 |
| References to `graph`, JSON tree scan  | 10,943.15 / 11,717.81 | 9,937.71 / 12,699.09 | 10,080.71 / 12,221.20 | 10,783.68 / 14,265.85 |
| References to `graph`, name/path index |       473.50 / 582.96 |      330.39 / 373.49 |       106.83 / 133.40 |       107.21 / 124.63 |

Node/function reads and indexed refs have **21 warm samples**; the full JSON
reference scan has **7**, plus one first use for each. Each reference query
returns **1,869 node objects**, not just a count. First-use times and all
samples are in the raw reports. Node paths are file `$.nodes[3353]` and
declaration `$.nodes[1842]`; both identify the same function root. A JSON
node-path read returns one root object; the graph function read returns all
**443 nodes**.

| Function edit, seven samples         |                        File A / B |                Declaration A / B |
| ------------------------------------ | --------------------------------: | -------------------------------: |
| Graph patch bundles                  |                             1 / 1 |                            5 / 5 |
| Whole JSON values changed            |                             1 / 1 |                            2 / 2 |
| UTF-8 JSON input bytes rewritten     |                 890,492 / 890,492 |                739,037 / 739,037 |
| Parse/diff/pack preparation (ms)     |                   183.64 / 246.61 |                  233.05 / 210.93 |
| Graph apply p50 / p95 (ms)           | 122.61 / 274.43 / 101.37 / 341.68 | 104.65 / 203.09 / 75.29 / 151.36 |
| Name/path maintenance p50 / p95 (ms) |    45.23 / 68.74 / 53.28 / 105.48 |  94.52 / 169.90 / 81.94 / 148.08 |

### Queries inside the values and their indexes

Every statement is built through **`@yaks/sql`'s AST**, including table-function
arguments, `json_tree`, `json_extract`, joins, `INSERT ... SELECT`, DDL and
`EXPLAIN QUERY PLAN`. No SQL strings or production AST extensions were needed.
`packages/sql/json_tree_test.ts` proves JSONB traversal, expression-index
matching, and index search versus scan. A fixed expression-index path must be
`lit(path)` in both index and query, not a bound path parameter. An expression
index cannot index every arbitrary array member; the benchmark uses a small side
table for the multi-valued name lookup instead.

- **Node by path:** identical node object from `json_extract(value, path)`. Scan
  disables secondary indexes on `tree`; selection is file/base plus root ID
  (needed because a program residual and first child may share base zero).
  Indexed selection adds `(file,start)`, then reads the same path. Plans confirm
  `SCAN tree` versus
  `SEARCH tree USING INDEX tree_location (file=? AND start=?)`. The path is a
  local JSON array address, not a persistent graph identity.
- **Every reference to a name across files:** traverse
  `json_tree(value,
  '$.nodes')`, select object entries with `name='graph'` and
  a non-null fixture `target`. This is the **same deliberately file-local
  first-occurrence resolver** as the baseline, gathered across all files, not
  TypeScript binding resolution or all lexical occurrences. The first occurrence
  in each file is not a reference. Expected IDs/targets/spellings are
  independently gathered from the spool and checked against all returned
  objects; scan/index answers also agree in full, not merely count.
- **Name index:** `name_path(owner,path,name)` contains **only the 586,576
  fixture reference sources**, built from stored JSONB with `INSERT ... SELECT`
  and indexed on `(name,owner,path)`. Lookup searches that covering name index,
  fetches the owner by integer primary key, then `json_extract(value,path)`
  returns the node, not a cached node object in the side table. Plans are in the
  reports. The side table is not 6.7M graph entities, nor an all-node index.
  Extraction/population time and secondary-index build time/bytes are reported
  separately. These are bulk-build costs after load, not online incremental
  import throughput; base plus index times gives the measured combined work.

The selected function is `apps/vale/buildings/kit.ts#3353` (443 syntax nodes) at
both grains. It is nested inside a large top-level owner, so declaration grain
rewrites that owner's subtree, **not only those 443 function nodes**. The
changed declaration values include the tiny program-root residual because its
end span grows; later units receive base-only patches. This fixture is not a
best-case standalone top-level function. The selected function is the same at
both grains; a numeric expression in its body is replaced by `(n + 1)`, using
the existing explicit identity/diff mapper. The fixture selection now rejects
TypeScript's `number` keyword (this grammar calls that a `number` too), requires
a parse without errors, and checks the edit preserves parse validity. An earlier
pilot editing that keyword was discarded; none of its measurements are reported.
Seven identical edits restore original content outside timing. Unchanged later
declarations patch only `tree.start`; changed values are replaced whole.
Reported rewrite bytes are **UTF-8 JSON input bytes**, not physical BLOB/WAL
write amplification. Name/path entries for changed values are deleted/rebuilt in
their own transaction, timed separately. The two phases are **not atomic
together**: this is an index-maintenance cost measurement, not a
production-ready transactional side-index implementation. No per-node history is
inferred from created/updated stamps.

### What the graph/query language would need

Current `@yaks/query` routes declared component/reference paths; a JSON-valued
property supports presence/whole-value reads, but the SQL binder rejects value
filter/order/tally on it (`packages/sql/bind.ts`, `opaque`). These measured SQL
queries are **not currently expressible as graph query strings**. Supporting
Jeff's suggestion needs a typed JSON-path operator distinct from reference hops,
array/recursive descent or an `exists`/unnest scope so predicates refer to the
same node, projection of owner + local path + node, defined missing/null/type
and comparison semantics, and planner/index registration for fixed expressions
or maintained multi-valued side indexes. None requires changing package
boundaries, and this benchmark does not propose a concrete grammar spelling.

Without that extension, both coarse grains lose direct graph queries over
internal nodes. SQL JSON traversal **can recover those predicates** (with the
measured scan/index trade-off); it does not automatically restore graph
identity, referential integrity, or history. An edge can target a
file/declaration entity; an edge to a nested node needs an explicit
`(owner, stable node ID/path)` address contract, path repair on edits and
validation, not a normal entity ref. File-grain history would replace the whole
file value; declaration history could replace just its owner value. Neither
supplies independently versioned per-node history. A positional path alone
shifts under insertion. The optional name index restores selected lookup speed,
not arbitrary node-query coverage.

Reproduce using the same spool and scratch-only paths:

```sh
deno run -A bench/yardstick.ts coarse /path/to/spool /scratch/file-a.db /scratch/file-a.json file
deno run -A bench/yardstick.ts coarse /path/to/spool /scratch/decl-a.db /scratch/decl-a.json declaration
# Repeat serially into new file-b.db / decl-b.db.
```

Focused checks include six emitter/packing/edit tests, four SQL AST/JSON/index
integration cases, type check, `deno fmt` and `deno lint`. Both coarse grains
also pass a separate synthetic end-to-end smoke corpus and independently reopen
the measured databases. Ten focused tests pass on a forced rerun. The diagnostic
1 ms test budget run flags the function packing/edit test at 1.6 ms under shared
host load; no budget exception was added. All scratch databases, WAL/SHM, source
archive and spool were deleted after preserving reports; no live graph was used
as benchmark data.

Cleanup: **3,133,486,440 B (2.92 GiB)** of benchmark databases/WAL/SHM deleted,
including discarded pilots; **4,251,226,658 B** of final scratch tree + child
worktrees removed (in addition to the **1,022,711,144 B** of discarded database
files removed earlier). Logical file lengths, not allocated blocks. Zero scratch
databases remain. Cleanup manifest is retained in the raw report.

Post-rebase focused checks pass again (10 tests); another **32,967 B** of check
logs and task-local helper files were removed, with no new database files.
