# @yaks/context

Explicit instruction snapshots, independent of their source and of a model's
execution lifecycle. Ordinary file reads are **not** instructions.

- `contextDoc` declares `prompt{scope,source,revision}`. Its content lives in
  the entry's ordinary `content.body`; no second body or private CAS is
  introduced.
- `snapshot(body, source)` records exact text and its SHA-256 revision. A source
  identity can resolve to new text later without changing an admitted snapshot.
- `SourceResolver` is the portable asynchronous source-resolution boundary.
- `promptEntry(...)` constructs an admission; the caller allocates transcript
  order and writes it through its graph. Admission never silently edits history.
- `@yaks/context/host` exports `instructionFiles(cwd, home?)`: global guidance,
  then ancestor `AGENTS.md` files in root-to-leaf order. Canonical paths dedupe
  aliases; missing files are skipped, other errors fail admission. No mtimes
  reorder instruction precedence.

The harness composes admission policy. Sessions retain transcript order and fork
boundaries; forks reuse the parent's exact snapshots without rereading files.
Fresh children inherit shared snapshots, with child guidance added afterward.
Provider adapters map explicitly admitted prompts to their instruction roles.
For compatibility, `sessionDoc` includes `contextDoc`; applications composing
session vocabulary do not need to change existing loaders.

## Storage and future sources

`@yaks/blob` alone handles transparent CAS storage. The harness registers
`content.body` and `doc.body`, uses the SQLite blob backend/read overrides, and
migrates old inline prose transactionally with a migration marker. Hash-shaped
legacy prose is text, never guessed to be an already-stored address. Back up the
SQLite database before upgrading; older harness builds without blob reads are
not compatible with the upgraded database.

The current loader deliberately records disk provenance even when a generated
AGENTS header mentions a graph entity. It does **not** pretend to have resolved
that graph. A future resolver can verify an explicit generated-source marker,
resolve the graph source, and deduplicate by source identity; if unavailable it
must record a disk fallback. Unmarked repositories continue to use files.

`revision` hashes an individual text, not the aggregate provider prefix. Cache
scope, prefix identities, provider observations, and refresh policy are future
composition points; no five-minute TTL or guaranteed cache warmth is inferred.

## Pilot seams

Admission currently takes positional arguments for compatibility; a richer
source descriptor can replace this once graph resolution has a real consumer.
The host loader is POSIX-oriented. Browser core has no filesystem dependency.
Snapshots are immutable by convention of the session admission API, not a graph
write prohibition: explicit historical edits remain possible through the graph.
