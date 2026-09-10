# Journal bytes and history shapes — live-corpus copy, 2026-09-10

Measurement for **T-37050**, P-19. No product code, live SQL state, or live
indexes were changed. The only repository artifact is this report. Follow-ups:
**T-37062** (orphan-field investigation) and **T-37063** (narrow-index
validation).

## Recommendation

**Prefer per-component after-image history with integer identities, exclusive
transaction intervals, and only entity/transaction indexes by default.** On this
corpus that is **157.004 MB**, saving **78.217 MB (33.3%)** including its
generated schema, while the week-old board and one-hop walk remain about **9 ms
/ 10 ms**. Make value indexes opt-in rather than duplicating every live index.
Before a layout migration, prototype the smaller independent changes: typed
spine references/scalars (**22.872 MB**), selective hash-keyed value interning
(**19.173 MB**), and narrower existing indexes (**12.149 MB**); these savings
overlap and must not be added. Do not spend time suppressing
camera/cursor/notified/updated/embedding history: it is already tiny or absent.
Keep transcript history unless the owner explicitly opts out: it dominates
bytes, but generic history, session subscriptions, and durable catch-up consume
it. Separate optional historical retention from the durable change feed before
introducing `journal: false`; do not drop any current journal index outright or
discard trace data. Retain legacy fields and investigate the orphan rows before
migration. The tested hybrid is larger, not a reason to introduce another
identity spine or a speculative indexed-field subsystem.

## Method and scope

Snapshot command (the only direct SQL access to the live file):

```sh
sqlite3 -readonly ~/.tasks/tasks.db "vacuum into '$PWD/.scratch-journal/journal.db'"
```

The copy contains **145,616 transactions**, **1,072,269 changes**, and
**1,425,481 fields**, through **tx 2291602 / 2026-09-10T17:03:57.959Z**. Its
earliest transaction is 2026-07-20T22:18:24.073Z. Counts differ slightly from
the task's earlier sample. All numbers below use **decimal MB (1,000,000
bytes)**, **4,096-byte pages**, SQLite **3.53.3**, and `dbstat` on repacked
copies. The fresh journal is **235.221 MB including its 4 KB schema page**;
indexes are **55.489 MB (23.6%)**, not an assumed 57 MB. Code was inspected at
repository commit **4c0e7f76**.

Each reduction starts from the same isolated three-table journal copy, retains
original ids and transaction rows, applies one stated transformation, then
VACUUMs. Shape totals include the shared transaction table, all required
history/replay indexes, dictionaries, and orphan preservation; the Total column
additionally includes schema/statistics pages. The existing entity spine and
`blob_text` are shared dependencies, not counted again. New history rows have
internal integer ids, not eids and not spine rows. The 144 generated component
tables include empty vocabulary tables and historical components no longer in
the vocabulary.

Timing is Python `sqlite3.execute(...).fetchall()` wall time, median of five
runs on one connection per shape, `PRAGMA cache_size=-64000` (64,000 KiB), with
statement caching disabled and SQL preparation/result construction included.
These are predominantly warm-cache measurements, not cold-I/O or production
latency guarantees. The point/changelog return raw component values and blob
ids, without fetching blob bodies. No HTTP, rendering, FTS, or full
query-compiler overhead is included. All four query results were validated
against an independent ordered replay of the source journal, including exact
changelog field values and removal flags for the selected entity.

## One comparison table

All reductions are independent, **not additive**. Dump is logical journal data
serialized with `bin/backup`'s `.mode insert` approach, uncompressed, including
any new dictionary/history tables. P/B/W/C means point / board / walk /
changelog median milliseconds. “—” means not benchmarked, not zero.

| Case                                            | Tables MB | Indexes MB | Total MB | Saved MB | Dump MB | P / B / W / C ms           |
| ----------------------------------------------- | --------- | ---------- | -------- | -------- | ------- | -------------------------- |
| Current                                         | 179.728   | 55.489     | 235.221  | 0.000    | 295.978 | —                          |
| Exclude camera/cursor/pin/fold/shelf            | 179.720   | 55.484     | 235.209  | 0.012    | 295.970 | —                          |
| Exclude notified                                | 179.724   | 55.484     | 235.213  | 0.008    | 295.973 | —                          |
| Exclude archived                                | 179.683   | 55.448     | 235.135  | 0.086    | 295.875 | —                          |
| Exclude explicit updated                        | 179.728   | 55.489     | 235.221  | 0.000    | 295.977 | —                          |
| Exclude embedding (already absent)              | 179.728   | 55.489     | 235.221  | 0.000    | 295.978 | —                          |
| Exclude lease                                   | 177.345   | 54.395     | 231.743  | 3.478    | 290.748 | —                          |
| Exclude session                                 | 177.054   | 54.391     | 231.449  | 3.772    | 290.685 | —                          |
| Exclude recalled                                | 176.493   | 53.596     | 230.093  | 5.128    | 288.585 | —                          |
| Exclude finding                                 | 178.295   | 54.870     | 233.169  | 2.052    | 292.999 | —                          |
| Exclude content                                 | 134.222   | 54.579     | 188.805  | 46.416   | 251.834 | —                          |
| Exclude opaque                                  | 166.179   | 55.058     | 221.241  | 13.980   | 283.285 | —                          |
| Exclude UI + notified + lease                   | 177.345   | 54.395     | 231.743  | 3.478    | 290.736 | —                          |
| Exclude named log components¹                   | 94.736    | 44.888     | 139.629  | 95.592   | 193.600 | —                          |
| 7d compact UI/stamp/lease/session fields²       | 179.692   | 55.476     | 235.172  | 0.049    | 295.899 | —                          |
| 7d compact named log fields²                    | 179.728   | 55.489     | 235.221  | 0.000    | 295.978 | —                          |
| 7d expire named log fields³                     | 175.092   | 55.353     | 230.449  | 4.772    | 291.505 | —                          |
| Intern every value, UNIQUE(value)               | 156.545   | 144.822    | 301.371  | -66.150  | 280.973 | —                          |
| Intern repeats ≥32 bytes, UNIQUE(value)         | 157.676   | 60.064     | 217.743  | 17.478   | 282.183 | —                          |
| Intern every value, UNIQUE(SHA-256)             | 166.199   | 64.360     | 230.564  | 4.657    | 304.354 | —                          |
| Intern repeats ≥32 bytes, UNIQUE(SHA-256)       | 158.966   | 57.078     | 216.048  | 19.173   | 284.827 | —                          |
| Ref UUIDs → spine ids in JSON numeric text      | 160.756   | 55.489     | 216.248  | 18.973   | 277.348 | —                          |
| Native scalars + encoding tag                   | 175.469   | 55.489     | 230.961  | 4.260    | 298.823 | —                          |
| Spine ids + native scalars                      | 156.856   | 55.489     | 212.349  | 22.872   | 280.194 | —                          |
| Narrow existing 3 indexes                       | 179.728   | 43.340     | 223.072  | 12.149   | 295.978 | —                          |
| Drop change(tx,ordinal), diagnostic only        | 179.728   | 40.190     | 219.922  | 15.299   | 295.978 | —                          |
| Drop change(entity,component), diagnostic only  | 179.728   | 34.501     | 214.233  | 20.988   | 295.978 | —                          |
| Drop field(change,ordinal), diagnostic only     | 179.728   | 36.794     | 216.527  | 18.694   | 295.978 | —                          |
| Drop field(ref), diagnostic only                | 179.728   | 54.981     | 234.713  | 0.508    | 295.978 | —                          |
| Remove trace, diagnostic only                   | 171.872   | 55.489     | 227.365  | 7.856    | 288.622 | —                          |
| Shape A: component intervals, all value indexes | 122.937   | 62.689     | 186.229  | 48.992   | 183.263 | 4.06 / 9.17 / 3.18 / 11.60 |
| Shape A: entity/tx indexes only                 | 122.937   | 33.980     | 157.004  | 78.217   | 183.263 | 4.28 / 9.29 / 9.98 / 12.81 |
| Shape B: hybrid field intervals                 | 172.126   | 101.540    | 273.707  | -38.486  | 300.368 | 2.61 / 89.31 / 7.44 / 9.78 |

¹ Named log components:
`apply, attention, bash, call, cancel, checkpoint, content, entry, exit, fetch, generation, graph_query, headers, imported, lease, message, opaque, output, patch, reasoning, response, result, runner, stderr, task_context, timeout, tool, usage`.
The exclusion removes changes and their fields, not entity births, other facets
on log entities, or tx/trace. It is a counterfactual upper bound, not a safe
default. `content` and `opaque` exclusions also affect any non-log entities
wearing them.

² Compaction deletes only superseded field rows before
**2026-09-03T17:03:57.959Z**, keeping the latest pre-cut row for every
entity/component/field as a boundary seed and keeping every tx/change row.
UI/stamp/lease/session means camera, cursor, pin, fold, shelf, notified, lease,
session. The log-compaction saving is zero: this cohort's pre-cut values are
effectively write-once. This does not retain exact pre-cut history, and does not
compact change or trace rows.

³ Expiry deletes _all_ pre-cut field rows for the named log components, while
retaining tx/change rows; it loses both older history and reconstruction seeds.
Even this destructive policy saves only **4.772 MB**: most retained transcript
payload is newer than the cutoff. None of the retention policies was applied to
the live database.

The all-value UNIQUE(value) experiment stores long values twice, once in the
dictionary table and again in its unique B-tree; that is why it gets much
bigger. Hash variants use a 32-byte SHA-256 BLOB index and verify value equality
on lookup. The all-hash variant retains an inline fallback column; the selective
variants only intern values with count >1 and UTF-8 length ≥32, retaining
everything else inline. Hashes are internal dictionary keys, not graph eids.

## Where field bytes go

`journal_field` occupies **129.884 MB of pages**, with **112.197 MB of SQLite
record payload**. The remainder is page/cell/overflow overhead and unused space.
SQLite does not assign a mixed B-tree page to one component. Below, Payload is
the exact sum of SQLite record bytes (serial-type header + stored values, with
integer-primary-key alias encoded as NULL); Attributed pages is **129.884 ×
group payload / 112.197**, an explicitly proportional estimate, not a claimed
per-row physical page measurement. Both breakdowns reconcile to the real
`dbstat` payload after adding the orphan rows. Exclusion savings above are
actual repacked `dbstat` measurements, not this estimate. Field index pages are
not included in these attribution columns.

### Top 30 components

| Component  | Field rows | Payload MB | Attributed pages MB | JSON value bytes MB |
| ---------- | ---------- | ---------- | ------------------- | ------------------- |
| content    | 27,129     | 41.121     | 47.603              | 40.676              |
| edge       | 368,001    | 17.865     | 20.682              | 12.675              |
| opaque     | 14,646     | 11.270     | 13.047              | 11.028              |
| dependency | 166,109    | 8.034      | 9.300               | 5.402               |
| entity     | 264,910    | 4.956      | 5.737               | 1.207               |
| patch      | 6,174      | 3.176      | 3.677               | 3.079               |
| bash       | 12,814     | 2.972      | 3.441               | 2.761               |
| entry      | 69,018     | 2.572      | 2.978               | 1.462               |
| doc        | 69,981     | 2.283      | 2.643               | 1.084               |
| tool       | 4,620      | 1.891      | 2.189               | 1.815               |
| session    | 41,771     | 1.723      | 1.995               | 0.958               |
| recalled   | 54,776     | 1.647      | 1.907               | 0.848               |
| lease      | 46,074     | 1.471      | 1.703               | 0.749               |
| task       | 49,407     | 1.323      | 1.531               | 0.398               |
| output     | 21,984     | 1.064      | 1.232               | 0.713               |
| finding    | 24,510     | 0.945      | 1.094               | 0.576               |
| imported   | 38,564     | 0.839      | 0.971               | 0.222               |
| stderr     | 923        | 0.768      | 0.890               | 0.754               |
| comment    | 12,079     | 0.632      | 0.732               | 0.409               |
| generation | 17,330     | 0.599      | 0.694               | 0.266               |
| result     | 9,055      | 0.480      | 0.556               | 0.344               |
| yield      | 722        | 0.458      | 0.531               | 0.444               |
| mail       | 11,861     | 0.454      | 0.526               | 0.257               |
| brief      | 426        | 0.429      | 0.496               | 0.422               |
| call       | 9,126      | 0.416      | 0.482               | 0.288               |
| usage      | 13,784     | 0.297      | 0.344               | 0.049               |
| delivered  | 7,644      | 0.260      | 0.302               | 0.157               |
| claim      | 6,582      | 0.250      | 0.290               | 0.125               |
| memory     | 4,691      | 0.229      | 0.265               | 0.152               |
| process    | 465        | 0.198      | 0.230               | 0.191               |

### Top 30 component.field pairs

| Field              | Field rows | Payload MB | Attributed pages MB | JSON value bytes MB |
| ------------------ | ---------- | ---------- | ------------------- | ------------------- |
| content.body       | 16,538     | 40.898     | 47.346              | 40.634              |
| opaque.data        | 7,323      | 11.000     | 12.735              | 10.883              |
| edge.from          | 164,763    | 8.732      | 10.108              | 6.260               |
| edge.to            | 164,763    | 8.402      | 9.727               | 6.261               |
| dependency.child   | 130,512    | 7.048      | 8.159               | 4.959               |
| entity.num         | 258,840    | 4.675      | 5.412               | 1.057               |
| patch.diff         | 3,087      | 2.957      | 3.424               | 2.908               |
| bash.command       | 6,407      | 2.851      | 3.301               | 2.730               |
| entry.session      | 36,092     | 2.021      | 2.340               | 1.371               |
| tool.detail        | 2,310      | 1.824      | 2.111               | 1.783               |
| doc.title          | 27,934     | 1.533      | 1.774               | 1.084               |
| recalled.at        | 33,001     | 1.116      | 1.292               | 0.687               |
| dependency.type    | 33,022     | 0.843      | 0.976               | 0.349               |
| stderr.text        | 923        | 0.768      | 0.890               | 0.754               |
| doc.body           | 42,047     | 0.750      | 0.869               | 0.000               |
| edge.ord           | 38,475     | 0.731      | 0.846               | 0.154               |
| lease.holder       | 15,358     | 0.578      | 0.669               | 0.316               |
| entry.seq          | 32,926     | 0.551      | 0.638               | 0.090               |
| recalled.source    | 21,775     | 0.531      | 0.615               | 0.161               |
| output.key         | 7,328      | 0.500      | 0.579               | 0.398               |
| imported.source    | 19,282     | 0.488      | 0.565               | 0.161               |
| result.call        | 9,055      | 0.480      | 0.556               | 0.344               |
| lease.until        | 15,358     | 0.478      | 0.553               | 0.217               |
| finding.key        | 7,120      | 0.442      | 0.512               | 0.341               |
| brief.text         | 426        | 0.429      | 0.496               | 0.422               |
| session.final_text | 451        | 0.425      | 0.493               | 0.415               |
| yield.final_text   | 451        | 0.425      | 0.492               | 0.415               |
| lease.at           | 15,358     | 0.416      | 0.482               | 0.217               |
| call.key           | 9,126      | 0.416      | 0.482               | 0.288               |
| output.source      | 7,328      | 0.403      | 0.467               | 0.278               |

**Orphans:** 147 fields have no parent change: 7,256 payload bytes, excluded
from component attribution because no component can be known. 112 of them
contain invalid JSON (672 value bytes); all malformed JSON in this snapshot is
in that orphan set. Both shapes preserve all 147 in `orphan_field`. There are no
orphan change→tx rows or missing field.ref→entity targets. T-37062 tracks
investigation; no cleanup was attempted.

## Transactions and churn sources

Actor/via classes below are inferred from current **or historically recorded**
person/project/session/client facets, not invented from arbitrary actor names.
Their tx payload sums to the transaction table's **12.099 MB payload / 13.480 MB
pages**. “Other” means no such retained facet; an additional current-facet check
identifies **30,705 runner-authored transactions** within the via-other
population. Null ownership does not mean a browser or human wrote the
transaction.

| Actor / via class | Tx rows | Tx payload MB | Attributed tx pages MB | Trace bytes MB |
| ----------------- | ------- | ------------- | ---------------------- | -------------- |
| null/null         | 63,778  | 6.600         | 7.353                  | 4.665          |
| project/session   | 41,660  | 3.813         | 4.248                  | 2.404          |
| null/other        | 30,707  | 0.983         | 1.095                  | 0.000          |
| project/null      | 2,967   | 0.262         | 0.292                  | 0.169          |
| other/session     | 1,316   | 0.226         | 0.252                  | 0.179          |
| other/null        | 1,934   | 0.074         | 0.082                  | 0.010          |
| person/null       | 1,373   | 0.044         | 0.050                  | 0.001          |
| null/session      | 314     | 0.039         | 0.043                  | 0.029          |
| person/client     | 854     | 0.035         | 0.039                  | 0.006          |
| person/session    | 692     | 0.024         | 0.026                  | 0.000          |
| project/other     | 21      | 0.001         | 0.001                  | 0.000          |

The following classifications are **overlapping tx cohorts**, so their byte
columns must not be added. Tx payload includes the entire envelope of a
transaction touching that class; the final column includes only fields of
matching changes. Imported managed/native classification uses retained
`imported.source` prefixes and is a lower bound, not a claim that all historical
log entries still carry that marker.

| Write class             | Touched tx | Tx payload MB | Matching changes | Field rows | Value MB |
| ----------------------- | ---------- | ------------- | ---------------- | ---------- | -------- |
| browser UI              | 36         | 0.002         | 36               | 59         | 0.001    |
| notified                | 56         | 0.006         | 56               | 0          | 0.000    |
| archived                | 883        | 0.115         | 1,279            | 0          | 0.000    |
| updated                 | 2          | 0.000         | 7                | 7          | 0.000    |
| embedding               | 0          | 0.000         | 0                | 0          | 0.000    |
| finding/sweep candidate | 8,695      | 1.750         | 8,695            | 24,510     | 0.576    |
| recalled                | 2,186      | 0.916         | 33,031           | 54,776     | 0.848    |
| session runtime casts   | 14,029     | 1.059         | 16,099           | 41,771     | 0.958    |
| lease                   | 15,358     | 0.491         | 15,358           | 46,074     | 0.749    |
| all entry entities      | 60,084     | 5.117         | 321,706          | 447,742    | 64.868   |
| managed-entry entities  | 11,027     | 1.377         | 55,673           | 66,742     | 6.144    |
| native-entry entities   | 20,966     | 1.995         | 143,156          | 172,970    | 15.295   |

Interpretation and reader audit:

- **UI:** only 36 changes / 59 fields across camera, cursor, pin, fold and
  shelf. Removing them saves 12 KB after repacking. No specialized historical
  consumer was found, but current clients still need live/catch-up state. Pin
  history is potentially user-authored layout, not automatically disposable
  telemetry.
- **notified / archived / updated:** notified and archived are presence-only
  changes here, with zero field rows. Ordinary created/updated provenance
  already comes from the tx envelope (`rowChanges`), not repeated stamp fields.
  Only 7 explicit updated fields survive. archived is a durable user-visible
  state and should not be thrown away to save 86 KB.
- **embedding / recall / sweep:** embedding and recall have no journal changes;
  embedding writes are already a derived direct-SQL path. `finding` (8,695
  changes) and `recalled` (33,031) are real graph data; labels such as “sweep”
  cannot be inferred reliably from a null actor. Their exclusions save 2.052 and
  5.128 MB respectively, but would erase provenance/dedup evidence, not free
  unused embedding history.
- **leases and session casts:** lease is a plausible optional
  historical-retention target, but not safe to omit from the durable feed.
  Session lifecycle is consumed by boot recovery (`sessions.ts` spawnPending),
  not merely by a changelog UI. `latest_seq`-only session updates are already
  deliberately excluded from record/cast; suppressing that again saves nothing.
- **session entries:** native/managed append paths produce graph data and
  subscriptions rely on it; lazy root filtering does not make the journal
  unused. `content.body` (40.634 MB JSON bytes) and `opaque.data` (10.883 MB)
  dominate. Source inspection does not support blaming repeated no-op streaming
  casts: the largest adjacent repeated key/value payload group is only 85.9 KB
  (`dependency.type`), followed by 49.1 KB (`lease.holder`) and 41.5 KB
  (`session.cwd`).
- **Generic readers prevent a “nobody reads this” guarantee:** history/undo APIs
  can read every component, while `journalSince` feeds durable cross-process
  catch-up, effects, and subscription maintenance. A manifest `journal: false`
  must mean optional _long-term_ history, not silent removal from this
  authoritative feed. A separate bounded feed would need its own cursor horizon
  and resnapshot policy.

### References, repetition, and scalar encodings

`journal_change.entity`, `journal_tx.actor/via`, and content-addressed
`journal_field.ref` are **already spine integers**. Ordinary reference fields
are **not**: the writer JSON-stringifies wire eids. The measured conversion
resolves **562,722 reference values** to existing spine ids; unresolved
historical references stay inline, never disappear through an inner join. The
ref-only experiment leaves numeric JSON text in the existing TEXT column; the
combined experiment stores native SQLite scalars and a type tag to preserve
string/number/bool/null/JSON distinctions. `doc.body` already shares
`blob_text`; resolving that blob is excluded from all layout comparisons.

There are **1,342,928 non-null encoded values**, **215,820 distinct values**,
**90.301 MB** of value bytes, and **62.654 MB** if each distinct value were
stored once: a **27.646 MB payload-only upper bound** before ids, dictionary
rows, indexes, and page packing. Arbitrary corpus values are not reproduced
below; hashes identify repeated values without copying transcript or potentially
sensitive text. Lengths and counts are measured on the actual values.

Equivalent aggregation:
`SELECT value,count(*) FROM journal_field WHERE value IS NOT NULL GROUP BY value ORDER BY 2 DESC LIMIT 30`.
SQL NULL refs/tombstones are excluded from this value-intern calculation.

| Value or SHA-256 prefix | Count   | UTF-8 bytes each | Repeated payload bytes removable |
| ----------------------- | ------- | ---------------- | -------------------------------- |
| `null`                  | 358,441 | 4                | 1,433,760                        |
| `sha256:1c1349a5a19b`   | 20,131  | 38               | 764,940                          |
| `sha256:f951cac19e40`   | 18,822  | 12               | 225,852                          |
| `sha256:4333d880d7e2`   | 13,015  | 8                | 104,112                          |
| `0`                     | 11,275  | 1                | 11,274                           |
| `sha256:12ae32cb1ec0`   | 10,760  | 2                | 21,518                           |
| `1`                     | 9,893   | 1                | 9,892                            |
| `sha256:582a956c5d63`   | 8,331   | 38               | 316,540                          |
| `sha256:9c72ea76bbb2`   | 6,511   | 9                | 58,590                           |
| `sha256:c1ffe835cdc1`   | 6,254   | 13               | 81,289                           |
| `sha256:13fb6a72b612`   | 6,106   | 10               | 61,050                           |
| `sha256:c1b04fc434ea`   | 5,289   | 7                | 37,016                           |
| `sha256:d0eba251409d`   | 5,156   | 6                | 30,930                           |
| `sha256:7d124c1a7f40`   | 4,906   | 6                | 29,430                           |
| `sha256:0f1c28850828`   | 4,210   | 38               | 159,942                          |
| `sha256:550a4cd03676`   | 4,188   | 38               | 159,106                          |
| `2`                     | 3,940   | 1                | 3,939                            |
| `sha256:08f6b5855924`   | 3,699   | 7                | 25,886                           |
| `sha256:7ad81c272791`   | 3,566   | 22               | 78,430                           |
| `sha256:6a7ae39bdf4f`   | 3,446   | 15               | 51,675                           |
| `sha256:62411998f846`   | 3,415   | 38               | 129,732                          |
| `"agent"`               | 3,401   | 7                | 23,800                           |
| `"open"`                | 3,258   | 6                | 19,542                           |
| `sha256:b57c4299afe3`   | 2,941   | 6                | 17,640                           |
| `sha256:0c26f024b9a9`   | 2,871   | 38               | 109,060                          |
| `sha256:1ab830b8b3ff`   | 2,722   | 18               | 48,978                           |
| `sha256:14475ee78524`   | 2,525   | 38               | 95,912                           |
| `sha256:7a6b56862c36`   | 2,461   | 38               | 93,480                           |
| `3`                     | 2,326   | 1                | 2,325                            |
| `"done"`                | 2,301   | 6                | 13,800                           |

## Index accounting and actual access paths

**Correction to the brief:** at the inspected revision `journalSince` seeks
**journal_tx.id**, then reconstructs each transaction with `journal_change_tx`;
`JournalRow.rowid` is the tx id. `journal_change.id` is the operation id, not
the catch-up cursor. Treating change(tx,ordinal) as redundant with a rowid seek
would break the actual access pattern.

| Index                                         | MB     | Why it is used                                                        |
| --------------------------------------------- | ------ | --------------------------------------------------------------------- |
| journal_change_tx (tx, ordinal)               | 15.299 | normalizedBatch; journalSince/journalBy; undo reads whole tx          |
| journal_change_ent (entity, component)        | 20.988 | journalOf, stateBefore, writer field-predecessor lookup               |
| journal_field_change (change, ordinal)        | 18.694 | rebuildChanges and removal field history                              |
| journal_field_ref (ref) WHERE ref IS NOT NULL | 0.508  | blob garbage collection NOT EXISTS lookup; not a history-screen index |

Sample read microbenchmarks (median of five; selected entity 9, tx 2270724,
change 4500729). These are small path probes, not proof that narrow indexes are
safe for every workload:

| Path   | Current ms | Index dropped ms | Narrow ms | Rows |
| ------ | ---------- | ---------------- | --------- | ---- |
| tx     | 0.022      | 36.049           | 0.023     | 1    |
| entity | 0.456      | 17.177           | 1.190     | 50   |
| fields | 0.045      | 70.835           | 0.024     | 3    |
| gc_ref | 0.016      | 76.362           | 0.016     | 1    |

Dropped-index EQPs are full table SCANs (plus ordinal/group temp B-trees where
required). Narrow definitions preserve `entity`, `tx`, and `change` seeks, but
add temp ORDER BY for ordinals. The ref index is unchanged in the narrow case.
T-37063 requires writer-predecessor, large-transaction, replay, redaction and GC
regression coverage before changing definitions. **No existing index was proven
unused.**

`journal_tx.trace` contains 7.462 MB of JSON value bytes; removing it saves
7.856 MB allocated and 7.356 MB dump, but destroys created/removed/effect
information. Its 52,860 non-null rows have 37,367 distinct trace values; 15,428
share the empty 27-byte trace. The source uses trace for effect-bearing
birth/recovery logic and implicit provenance; removal is only a diagnostic upper
bound, not a recommendation.

## Prototype schema and historical semantics

### A — one history table per component

```sql
CREATE TABLE h_<component> (
  hid INTEGER PRIMARY KEY,       -- original journal_change.id
  entity INTEGER, tx_from INTEGER, tx_to INTEGER, ordinal INTEGER,
  present INTEGER, known_mask INTEGER, written_mask INTEGER,
  -- same value columns/affinities as the live component table,
  -- plus retired fields found in the historical journal
  ...
);
CREATE INDEX h_<component>_ent ON h_<component>(entity, tx_from);
CREATE INDEX h_<component>_tx ON h_<component>(tx_from, ordinal);
-- Full-index experiment only, for vocabulary/live indexed fields:
CREATE INDEX h_<component>_<field>
  ON h_<component>(<field>, tx_from, tx_to, entity) WHERE present=1;
```

Each source change creates exactly one row, including empty tags, removals and
entity births/deaths. A partial patch is merged with that entity/component's
prior known fields; removals clear state. `known_mask` distinguishes missing
historical values from explicit NULL; `written_mask` identifies the source patch
fields for exact changelog reconstruction. Constraints that enforce
uniqueness/current existence in live tables are not copied to history. Reference
fields and doc.body are integer-affinity columns, with unresolved legacy text
retained by SQLite's permissive affinity. Declared historical string/number
semantics follow the vocabulary. No current component rows seed old snapshots,
and no unknown defaults are fabricated.

`tx_to` is the next write to the same entity/component, ordered by tx then
source ordinal, with NULL for an open interval. Same-tx intermediate rows have
empty `[tx_from,tx_to)` intervals but remain in the changelog. Entity death also
clips surviving component intervals. The core 144-table UNION is intentionally
straightforward; no global entity→component lookup table or new spine was added.
Provenance is shared via journal_tx. Full-index A stores **122.937 MB tables /
62.689 MB indexes / 0.602 MB catalog+statistics**; minimal-index A keeps the
same value rows and data dump, with fewer generated index definitions.

### B — per-field intervals, typed indexed values and plain remainder

```sql
CREATE TABLE history_change (
  id INTEGER PRIMARY KEY, tx INTEGER, ordinal INTEGER, entity INTEGER,
  component TEXT, operation TEXT, tx_to INTEGER
);
CREATE TABLE slot (
  id INTEGER PRIMARY KEY, component TEXT, field TEXT, typed INTEGER,
  UNIQUE(component,field)
);
CREATE TABLE plain (
  id INTEGER PRIMARY KEY, change INTEGER, ordinal INTEGER, slot INTEGER,
  entity INTEGER, tx_from INTEGER, tx_to INTEGER, present INTEGER,
  value TEXT, ref INTEGER
);
CREATE TABLE typed (
  id INTEGER PRIMARY KEY, change INTEGER, ordinal INTEGER, slot INTEGER,
  entity INTEGER, tx_from INTEGER, tx_to INTEGER, present INTEGER,
  ref INTEGER, num REAL, text TEXT, encoding INTEGER
);
-- Component presence, empty tags, and replay order:
CREATE INDEX hc_ent ON history_change(entity,component,tx);
CREATE INDEX hc_tx ON history_change(tx,ordinal);
-- Both field tables have (entity,slot,tx_from) and (change,ordinal).
-- Typed value indexes, each partial to its non-null storage column:
CREATE INDEX typed_ref ON typed(slot,ref,tx_from,tx_to,entity)
  WHERE ref IS NOT NULL;
-- typed_num / typed_text have the analogous definition.
```

The slot dictionary avoids repeating component/field names on every field
interval. Typed membership is generated from vocabulary reference metadata, live
foreign keys and indexes, plus retained legacy task/dependency reference fields
and task.status. Non-indexed fields keep original JSON/ref representation in
plain. B retains every source change, including zero-field tags, because fields
alone cannot represent component presence/removal. Each field's exclusive tx_to
comes from the next write to its own entity/component/field, not the next
unrelated component patch; entity death clips it too. Same-tx field versions and
removal tombstones survive. The extra interval and seek metadata plus
replay/value indexes outweigh encoding savings in this candidate. This is a
measured implementation, not a lower bound on every possible hybrid.

**Historical schema caveat:** the source journal contains old
`task.project/status`, `dependency.*`, and session lifecycle fields alongside
newer filed/edge/run/yield forms. A layout generated only from today's
vocabulary would silently lose history. Both prototypes preserve those fields;
the board SQL explicitly bridges legacy and current project/status shapes.
Ordinary generated created/updated stamps are still derived from tx/trace by the
product, not materialized by these raw-history prototypes. A production “normal
query as of time” compiler needs those temporal views/schema adapters; these
measurements are not a claim that such an API already exists.

## Four reads and EXPLAIN QUERY PLAN

All temporal reads use **tx 2220747**, last tx at or before
**2026-09-03T17:03:57.959Z** (actual tx time **2026-09-03T17:02:35.385Z**); no
earlier-id tx is timestamped after this cutoff. Target is **P-19**, eid
`a6433884-44a7-4033-9517-37f371087a47`, spine id **9**. The point has **4
explicit components**, the board returns **3,535 entities**, the inbound one-hop
walk **1,677 sources**, and the all-time changelog **2,436 source changes**. The
changelog is deliberately not cut to one week: it is the separate
reified-history use case.

Point: return active component rows where
`entity=9 AND present=1 AND tx_from<=2220747 AND (tx_to>2220747 OR tx_to IS NULL)`;
A UNIONs all 144 generated tables, B finds active change rows and their
independently active fields. Changelog: the same entity, every change, tx
DESC/ordinal order, joined to journal_tx; A projects written_mask fields, B
joins field rows by change. All corresponding source values/removal flags
matched, not just row counts.

The board uses `.project=a6433884-44a7-4033-9517-37f371087a47 .status=open`,
excludes archived/dead entities, uses filed.project with historical
task.project/project_eid fallback, and gives cancelled/completed/claim presence
precedence over historical task.status. The walk is a text-free inbound **one
hop across all edge natures**, `edge.to=9 → edge.from`, with source/edge
existence checks; it is not a recursive or FTS query. It measures the generic
`->` direction, not just one relation tag.

### Executed board and walk SQL

#### A board

```sql
select t.entity from h_task t
left join h_filed f on f.entity=t.entity and f.present=1 and f.tx_from<=2220747 and (f.tx_to>2220747 or f.tx_to is null)
where t.present=1 and t.tx_from<=2220747 and (t.tx_to>2220747 or t.tx_to is null) and coalesce(f.project,t.project,t.project_eid)=9
and coalesce(t.status,'open')='open'
and not exists(select 1 from "h_completed" z where z.entity=t.entity and z.present=1 and z.tx_from<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) and not exists(select 1 from "h_cancelled" z where z.entity=t.entity and z.present=1 and z.tx_from<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) and not exists(select 1 from "h_claim" z where z.entity=t.entity and z.present=1 and z.tx_from<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) and not exists(select 1 from "h_archived" z where z.entity=t.entity and z.present=1 and z.tx_from<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) and exists(select 1 from "h_entity" z where z.entity=t.entity and z.present=1 and z.tx_from<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) order by t.entity;
```

#### A walk

```sql
select distinct e."from" from h_edge e where e."to"=9 and e.present=1 and e.tx_from<=2220747 and (e.tx_to>2220747 or e.tx_to is null) and exists(select 1 from "h_entity" z where z.entity=e.entity and z.present=1 and z.tx_from<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) and exists(select 1 from "h_entity" z where z.entity=e."from" and z.present=1 and z.tx_from<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) order by e."from";
```

#### B board

```sql
select t.entity from history_change t
left join (select entity,ref v from typed z where z.slot=127 and z.present=1 and z.tx_from<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) fp on fp.entity=t.entity
left join (select entity,ref v from typed z where z.slot=391 and z.present=1 and z.tx_from<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) tp on tp.entity=t.entity
left join (select entity,ref v from typed z where z.slot=390 and z.present=1 and z.tx_from<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) te on te.entity=t.entity
left join (select entity,text v from typed z where z.slot=385 and z.present=1 and z.tx_from<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) st on st.entity=t.entity
where t.component='task' and t.operation='upsert' and t.tx<=2220747 and (t.tx_to>2220747 or t.tx_to is null)
and coalesce(fp.v,tp.v,te.v)=9 and coalesce(st.v,'open')='open'
and not exists(select 1 from history_change z where z.entity=t.entity and z.component='completed' and z.operation='upsert' and z.tx<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) and not exists(select 1 from history_change z where z.entity=t.entity and z.component='cancelled' and z.operation='upsert' and z.tx<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) and not exists(select 1 from history_change z where z.entity=t.entity and z.component='claim' and z.operation='upsert' and z.tx<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) and not exists(select 1 from history_change z where z.entity=t.entity and z.component='archived' and z.operation='upsert' and z.tx<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) and exists(select 1 from history_change z where z.entity=t.entity and z.component='entity' and z.operation='upsert' and z.tx<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) order by t.entity;
```

#### B walk

```sql
select distinct f.v from (select entity,ref v from typed z where z.slot=99 and z.present=1 and z.tx_from<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) t join (select entity,ref v from typed z where z.slot=98 and z.present=1 and z.tx_from<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) f on f.entity=t.entity
where t.v=9 and exists(select 1 from history_change z where z.entity=t.entity and z.component='edge' and z.operation='upsert' and z.tx<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) and exists(select 1 from history_change z where z.entity=t.entity and z.component='entity' and z.operation='upsert' and z.tx<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) and exists(select 1 from history_change z where z.entity=f.v and z.component='entity' and z.operation='upsert' and z.tx<=2220747 and (z.tx_to>2220747 or z.tx_to is null)) order by f.v;
```

### Query plans

Below are the actual EQP detail lines. Only A's mechanically repeated UNION
branches are compacted; the counts are exact. The remaining plans are complete.
Plans were collected after ANALYZE. The final hybrid walk uses `ref` directly so
SQLite can select typed_ref; an earlier COALESCE(ref,num,text) projection hid
that access path and was corrected before the final run.

#### A point

717 detail lines in the generated plan. Factored without discarding any
operation:

| EQP detail                                                        | Occurrences |
| ----------------------------------------------------------------- | ----------- |
| `MERGE (UNION ALL)`                                               | 143         |
| `LEFT`                                                            | 143         |
| `SEARCH h USING INDEX h_<component>_ent (entity=? AND tx_from<?)` | 136         |
| `USE TEMP B-TREE FOR ORDER BY`                                    | 144         |
| `RIGHT`                                                           | 143         |
| `SCAN h`                                                          | 8           |

#### A board

```text
SCAN t
CORRELATED SCALAR SUBQUERY 1
SEARCH z USING INDEX h_completed_ent (entity=? AND tx_from<?)
CORRELATED SCALAR SUBQUERY 2
SEARCH z USING INDEX h_cancelled_ent (entity=? AND tx_from<?)
CORRELATED SCALAR SUBQUERY 3
SEARCH z USING INDEX h_claim_ent (entity=? AND tx_from<?)
CORRELATED SCALAR SUBQUERY 4
SEARCH z USING INDEX h_archived_ent (entity=? AND tx_from<?)
BLOOM FILTER ON f (entity=?)
SEARCH f USING INDEX h_filed_ent (entity=? AND tx_from<?) LEFT-JOIN
SEARCH z EXISTS USING INDEX h_entity_ent (entity=? AND tx_from<?)
USE TEMP B-TREE FOR ORDER BY
```

#### A walk

```text
SEARCH e USING INDEX h_edge_to (to=? AND tx_from<?)
SEARCH z EXISTS USING INDEX h_entity_ent (entity=? AND tx_from<?)
SEARCH z EXISTS USING INDEX h_entity_ent (entity=? AND tx_from<?)
USE TEMP B-TREE FOR DISTINCT
```

#### A changelog

861 detail lines in the generated plan. Factored without discarding any
operation:

| EQP detail                                          | Occurrences |
| --------------------------------------------------- | ----------- |
| `MERGE (UNION ALL)`                                 | 143         |
| `LEFT`                                              | 143         |
| `SEARCH h USING INDEX h_<component>_ent (entity=?)` | 139         |
| `SEARCH t USING INTEGER PRIMARY KEY (rowid=?)`      | 144         |
| `USE TEMP B-TREE FOR LAST TERM OF ORDER BY`         | 139         |
| `RIGHT`                                             | 143         |
| `SCAN h`                                            | 5           |
| `USE TEMP B-TREE FOR ORDER BY`                      | 5           |

#### B point

```text
SEARCH c USING INDEX hc_ent (entity=?)
CORRELATED SCALAR SUBQUERY 3
CO-ROUTINE (subquery-2)
COMPOUND QUERY
LEFT-MOST SUBQUERY
SEARCH z USING INDEX plain_ent (entity=?)
SEARCH s USING INTEGER PRIMARY KEY (rowid=?)
UNION ALL
SEARCH z USING INDEX typed_ent (entity=?)
SEARCH s USING INTEGER PRIMARY KEY (rowid=?)
SCAN (subquery-2)
```

#### B board

```text
SCAN t USING INDEX hc_ent
CORRELATED SCALAR SUBQUERY 5
SEARCH z USING INDEX hc_ent (entity=? AND component=? AND tx<?)
CORRELATED SCALAR SUBQUERY 6
SEARCH z USING INDEX hc_ent (entity=? AND component=? AND tx<?)
CORRELATED SCALAR SUBQUERY 7
SEARCH z USING INDEX hc_ent (entity=? AND component=? AND tx<?)
CORRELATED SCALAR SUBQUERY 8
SEARCH z USING INDEX hc_ent (entity=? AND component=? AND tx<?)
SEARCH z USING INDEX typed_ent (entity=? AND slot=? AND tx_from<?) LEFT-JOIN
SEARCH z USING INDEX typed_ent (entity=? AND slot=? AND tx_from<?) LEFT-JOIN
SEARCH z USING INDEX typed_ent (entity=? AND slot=? AND tx_from<?) LEFT-JOIN
SEARCH z EXISTS USING INDEX hc_ent (entity=? AND component=? AND tx<?)
SEARCH z USING INDEX typed_ent (entity=? AND slot=? AND tx_from<?) LEFT-JOIN
```

#### B walk

```text
SEARCH z USING INDEX typed_ref (slot=? AND ref=? AND tx_from<?)
SEARCH z EXISTS USING INDEX hc_ent (entity=? AND component=? AND tx<?)
SEARCH z EXISTS USING INDEX hc_ent (entity=? AND component=? AND tx<?)
SEARCH z USING INDEX typed_ent (entity=? AND slot=? AND tx_from<?)
SEARCH z EXISTS USING INDEX hc_ent (entity=? AND component=? AND tx<?)
USE TEMP B-TREE FOR DISTINCT
```

#### B changelog

```text
SEARCH c USING INDEX hc_ent (entity=?)
SEARCH t USING INTEGER PRIMARY KEY (rowid=?)
CORRELATED SCALAR SUBQUERY 3
CO-ROUTINE (subquery-2)
COMPOUND QUERY
LEFT-MOST SUBQUERY
SEARCH z USING INDEX plain_change (change=?)
SEARCH s USING INTEGER PRIMARY KEY (rowid=?)
UNION ALL
SEARCH z USING INDEX typed_change (change=?)
SEARCH s USING INTEGER PRIMARY KEY (rowid=?)
SCAN (subquery-2)
USE TEMP B-TREE FOR ORDER BY
```

### A with only entity/transaction indexes

These are the measured minimal-index variant plans for the board and walk.
Point/changelog retain their per-component entity seeks and UNION structure; the
optional value indexes are not used there.

#### A minimal board

```text
SCAN t
CORRELATED SCALAR SUBQUERY 1
SEARCH z USING INDEX h_completed_ent (entity=? AND tx_from<?)
CORRELATED SCALAR SUBQUERY 2
SEARCH z USING INDEX h_cancelled_ent (entity=? AND tx_from<?)
CORRELATED SCALAR SUBQUERY 3
SEARCH z USING INDEX h_claim_ent (entity=? AND tx_from<?)
CORRELATED SCALAR SUBQUERY 4
SEARCH z USING INDEX h_archived_ent (entity=? AND tx_from<?)
BLOOM FILTER ON f (entity=?)
SEARCH f USING INDEX h_filed_ent (entity=? AND tx_from<?) LEFT-JOIN
SEARCH z EXISTS USING INDEX h_entity_ent (entity=? AND tx_from<?)
USE TEMP B-TREE FOR ORDER BY
```

#### A minimal walk

```text
SCAN e
SEARCH z EXISTS USING INDEX h_entity_ent (entity=? AND tx_from<?)
SEARCH z EXISTS USING INDEX h_entity_ent (entity=? AND tx_from<?)
USE TEMP B-TREE FOR DISTINCT
```

### Reproduction and validation checklist

1. Snapshot with read-only VACUUM INTO; open only that copy thereafter. Extract
   the three journal DDLs/indexes from sqlite_master and copy original ids into
   a journal-only baseline. `PRAGMA page_size` is 4096.
2. Read `comps`, `stamped`, and live
   `PRAGMA table_info/foreign_key_list/index_list` metadata; union in every
   component/field appearing in the source journal. Map wire reference eids
   through copied entity(eid,id), retaining unmatched text.
3. Stream changes ordered by entity, component, tx, change ordinal, field
   ordinal. Merge A's after-images and close the previous component version; for
   B close only the previous matching field version and separately the component
   presence version. Keep tombstones, masks, same-tx rows, and zero-field
   changes. Clip both at entity death. Preserve orphan_field separately.
4. VACUUM, ANALYZE for plan selection, then
   `SELECT name,sum(pgsize),sum(payload) FROM dbstat GROUP BY name`. Classify
   tables/indexes through sqlite_master; count schema/statistics separately.
   This accounts for every generated table and index, not just selected query
   tables.
5. Run each query five times with fetchall and median wall time; obtain EXPLAIN
   QUERY PLAN after schema changes on an uncached statement (otherwise Python's
   statement cache can show stale plan text). Compare point/board/walk to an
   independent tx-ordered source replay and compare changelog source ids,
   values, field presence and removals. All ten validation checks passed.
6. Serialize each logical journal table with
   `sqlite3 -batch -init /dev/null <copy> '.mode insert "<table>"' 'select * from "<table>"'`;
   count bytes without retaining or publishing raw values. Include BEGIN
   TRANSACTION/COMMIT (27 bytes). IDs, original JSON and trace are not rendered
   in this report.
7. Delete every snapshot/prototype/dump and untracked measurement script after
   publishing the report. No source migration, index change, database cleanup,
   or service restart is part of this task.

`bin/backup` currently hard-codes journal_tx/journal_change/journal_field as the
journal partition. New A/B/dictionary tables would otherwise be routed to
graph.sql, not disappear: the reported dump numbers are the **logical journal
total**, not an artificial saving from moving history to the other file. A
migration must update that partition/manifest and restore validation. Index-only
changes do not change data INSERT bytes. Scalar unquoting alone actually
**increases** dump size because the explicit encoding tag costs more text than
the saved quoting; the combined spine/scalar change still saves 15.784 MB of
dump. No gzip ratio or Git history-growth extrapolation was made.

## Handoff

Measurement complete; product schema and live data untouched. The report and
recommendation are also posted on T-37050. T-37062 and T-37063 are contained
follow-ups, not prerequisites to this measurement. Runtime gates and final
snapshot cleanup are recorded in the task completion comment.

## Repository validation

All ten corpus-replay/layout checks passed. `deno task check` passed (1,309
package tests); `deno task test` passed (3,492 tests, 584 ignored). An initial
package run hit `cannot release savepoint - SQL statements in progress` in
`packages/harness/prompts_test.ts`; the isolated retry and two subsequent full
checks passed. The broader project command
`deno fmt src/ && deno task check && deno task test:all` reached the slow
Durable Object integration probe, then failed during sign-in in
`workers/yak/probe.ts:505` (`src/store/do_test.ts`, 874 passed, 1 failed, 1
ignored in that test group). Thus the standard gates are green, but the full
slow integration gate is **not** claimed green. No product-code changes were
made to work around either failure.
