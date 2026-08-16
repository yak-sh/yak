# Content-addressed body survey

Measured for T-18272 from an online SQLite backup taken at 2026-08-16 18:47 UTC.
The backup was 865,304,576 bytes (825.22 MiB).

## Result

Content addressing is not worthwhile for only the current component rows. Their
62.94 MiB of non-empty bodies contain 1.05 MiB of exact duplicates. A 32-byte
key in every source row and content-store row turns that into a 0.57 MiB
increase before SQLite row and index overhead.

The journal changes the answer. It retains another 235.33 MiB of raw body
values, or 248.34 MiB after JSON escaping. Deduplicating current and historical
values together gives an estimated 70.69 MiB logical saving before SQLite row,
index, and page overhead. That is 8.57% of the file, or 11.74% of its occupied
pages. Physical space does not return to the filesystem until a rebuild or
`VACUUM`.

| Scope                  | Occurrences | Distinct |   Raw bytes | Exact duplicate bytes |
| ---------------------- | ----------: | -------: | ----------: | --------------------: |
| Current component rows |      27,551 |   25,595 |  65,993,317 |             1,100,041 |
| Current rows + journal |     141,806 |  102,661 | 312,757,647 |            72,189,325 |

The useful design is therefore one store shared by live component rows and the
journal. Addressing only live rows adds indirection without buying space.

Compression is a larger opportunity than exact deduplication. Independently
DEFLATE-compressing each distinct body reduces the proposed store payload from
229.42 MiB to 91.06 MiB. Content addressing plus that compression has an
estimated 209.06 MiB logical saving under the same key model. Compressing each
existing journal batch, without changing its contents, saves 227.65 MiB by
itself.

## Where the file goes

`dbstat` accounts for the snapshot's 602.30 MiB of occupied pages as follows.
The remaining 222.92 MiB is free pages inside the file.

| Area                       | Physical MiB | Share of occupied pages | What it holds                         |
| -------------------------- | -----------: | ----------------------: | ------------------------------------- |
| Journal                    |       404.81 |                  67.21% | Historical wire batches as JSON       |
| Component tables and other |        98.26 |                  16.32% | Live graph rows and telemetry         |
| Search indexes             |        72.55 |                  12.05% | `doc_gram` and `doc_fts`              |
| Embeddings                 |        15.89 |                   2.64% | Float32 semantic vectors              |
| Relational indexes         |        10.79 |                   1.79% | Primary, reference, and query indexes |

The largest individual objects after the journal are `doc_gram_data` at 61.65
MiB, `content` at 38.80 MiB, `doc` at 21.04 MiB, `embedding` at 15.51 MiB,
`doc_fts_data` at 10.38 MiB, and `opaque` at 7.90 MiB. The component table sizes
include keys and record overhead, so they are not expected to equal the raw body
totals below.

The search structures are intentional derived duplication: `doc_fts` supports
word search and `doc_gram` supports indexed substring search. Content addressing
does not remove their postings. Removing or narrowing trigram search has at most
a roughly 62 MiB prize and trades away its access path.

The embedding table has 7,763 vectors. Their Float32 payload is 11.38 MiB of the
table's 15.51 MiB; Float16 quantization could save at most about 5.7 MiB of
payload before evaluating recall quality. It is not a leading opportunity.

## Current rows

The survey follows the schema's `body` type rather than a hand-picked table
list. At the snapshot it covered:

| Column               | Occurrences | Distinct |  Raw bytes | Local duplicate bytes |
| -------------------- | ----------: | -------: | ---------: | --------------------: |
| `content.body`       |       5,081 |    4,630 | 38,798,785 |               303,643 |
| `doc.body`           |      13,380 |   12,426 | 16,421,303 |               372,982 |
| `opaque.data`        |       5,318 |    5,313 |  6,763,668 |                   200 |
| `stderr.text`        |         592 |      482 |  2,615,501 |               220,408 |
| `bash.command`       |       2,500 |    2,231 |    554,002 |                17,267 |
| `patch.diff`         |         294 |      294 |    512,607 |                     0 |
| `session.final_text` |         358 |      358 |    315,243 |                     0 |
| `apply.changes`      |          28 |       28 |     12,208 |                     0 |

`headers.data`, `hook.payload`, and `hook.headers` had no non-empty rows. Empty
strings were excluded: 617 `doc.body` rows were empty and contribute no payload
bytes. Exact identity means equal UTF-8 bytes; no whitespace normalization or
near-duplicate matching was used.

There were 767 repeated values among current rows. Cross-column sharing saves
only 185,541 bytes beyond deduplicating each column independently. The largest
single repeat was a 5,888-byte `content.body` stored 23 times, accounting for
129,536 duplicate bytes.

## Journal

The journal occupied 424,476,672 bytes (404.81 MiB) for 182,506 batches. Its
JSON batches contained 114,255 non-empty body-field writes:

| Component | Occurrences | Distinct |   Raw bytes | JSON value bytes |
| --------- | ----------: | -------: | ----------: | ---------------: |
| `content` |      58,206 |   51,915 | 201,347,504 |      212,994,989 |
| `doc`     |      17,163 |   16,104 |  24,578,530 |       24,995,485 |
| `bash`    |      28,894 |   26,081 |   9,814,194 |       10,143,647 |
| `opaque`  |       5,318 |    5,313 |   6,763,668 |        7,015,802 |
| `stderr`  |         611 |      485 |   2,616,203 |        3,566,124 |
| `session` |       2,437 |    2,437 |     911,371 |          920,136 |
| `patch`   |       1,614 |    1,214 |     723,542 |          762,356 |
| `apply`   |          12 |       12 |       9,318 |            9,909 |

The journal is where most of the opportunity lives: a body's creation is both
the current component value and a journal value, and repeated edits preserve
older copies.

## Estimate

The 70.69 MiB estimate uses this concrete representation:

- one copy of each distinct body: 240,568,322 bytes;
- one 32-byte binary SHA-256 key per 102,661 content-store row;
- one 32-byte binary reference per 27,551 current component occurrence; and
- one quoted 64-character hex digest (66 JSON bytes) per 114,255 journal
  occurrence.

That representation needs 252,275,936 logical bytes in place of 326,401,765
bytes of current raw values plus journal-encoded values, a difference of
74,125,829 bytes (70.69 MiB). A tag or renamed JSON property that distinguishes
a digest from literal content costs roughly another 0.4–0.8 MiB. B-tree record
headers, the content-store index, and partly filled pages reduce physical
savings further. A `WITHOUT ROWID` store keyed by the binary digest avoids a
second copy of every key and is the favorable SQLite layout.

This estimate deliberately leaves the FTS and trigram indexes unchanged. They
still need searchable terms even when canonical bodies are addressed. It also
does not count ordinary `text`, URL, timestamp, or identifier columns.

## Compression and retention alternatives

Compression was measured with zlib DEFLATE level 6, keeping the original when
compression made a value larger. Each value was compressed independently, so the
figures do not assume one unrealistic whole-database stream.

| Representation                            | Logical bytes before | Logical bytes after |     Saving |
| ----------------------------------------- | -------------------: | ------------------: | ---------: |
| Current bodies, compressed in place       |           65,993,317 |          25,645,004 |  38.48 MiB |
| Distinct content-store bodies, compressed |          240,568,322 |          95,478,506 | 138.37 MiB |
| Journal batches, compressed individually  |          372,869,394 |         134,156,295 | 227.65 MiB |
| Content addressing + compressed store     |          326,401,765 |         107,186,120 | 209.06 MiB |

The journal-batch result beats body-only content addressing because a normal
compressor also exploits repeated JSON keys, UUIDs, and other non-body text. It
is operationally harder than the byte count suggests: current history and undo
queries use SQLite's `json_each`, so compressed cold batches need an
application-level read path, a materialized lookup index, or a checkpoint plus
uncompressed tail. T-18296 tracks that design separately.

Retention or checkpointing has the largest absolute ceiling: dropping all
history would remove most of the journal's 404.81 MiB of occupied pages. It
would also remove replay, audit, and undo history, so this survey does not treat
it as free savings. A compact state checkpoint plus a bounded journal tail
deserves comparison with cold compression.

These alternatives overlap and must not be added together. In particular,
compressing journal batches already compresses their repeated body values;
moving those same values to a compressed content store cannot claim both
savings.

## Database context

The snapshot had 233,750,528 bytes (222.92 MiB) on SQLite's freelist, unrelated
to content duplication. That is a larger immediately reclaimable pool than
content addressing, but it is an operational compaction question rather than a
content-store benefit; follow-up is tracked separately in T-18290.
