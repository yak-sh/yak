# Preconditions — the graph's `--ff-only` for whole-value writes

Two agents editing one memory silently lose one edit. `memory_save` with an `id`
reads the graph, builds a `doc` patch carrying the caller's whole `body`, and
writes it; nothing compares the stored body against the one the caller started
from. The wire being a PATCH protocol does not help: omitted _columns_ are
untouched, but `body` is one column, and a memory edit is inherently a
whole-value replacement.

This design adds one optional field to `Change`: the value the caller believes
is there. `apply()` refuses the batch if the stored value has moved. A refused
merge is the mechanism working.

## The four decisions

### 1. Compare a hash, not the value

`Change.was` maps column → **SHA-256 of the value the caller read**. The server
hashes the stored value and compares.

Verbatim prior values are exactly as precise and need no new column, but they
double the payload of every guarded write — a memory body is kilobytes, and the
guarded write is the common case, not the rare one. A hash is 64 characters and
compares identically.

The caller needs nothing new from the read path: it hashes the body it already
holds. That is the point of hashing the _value_ rather than tracking a version —
both sides compute the same function of the same string, so no column, no
read-path change, and no stamp to keep in sync.

`null` is a value: absent-and-expected-absent must compare equal, so the
sentinel for "this column had no value" is distinct from "I am not guarding this
column".

**Rejected: `updated.at` as the version token.** It exists and is
server-stamped, but it fires on _any_ touch of the entity — a title edit or a
status move would refuse an unrelated body write. Over-refusal trains callers to
retry blindly, which is the clobber again with extra steps. Millisecond
granularity is also not a guarantee; the observed collisions were 1.8 s apart,
but nothing makes that a floor. Per-column hashing refuses exactly when the
thing being replaced has changed.

### 2. General over doc-only

`was` is a property of a `Change`, not of `doc`. Any component, any column.

The narrow form — a rule that only guards `doc.body` — is the same code with a
condition wrapped around it, and the first non-doc case removes the condition.
`board.query`, a persona body, a session brief: all whole-value replacements
where the new value is a function of the old.

This is not the speculative layer rule 9 warns about. Generality here is in
_what is compared_, not in new semantics: `was` means "the value I read," and
restricting which columns may say that is the arbitrary part, not the general
part.

### 3. Optional on the wire, mandatory at the door

Making an unguarded write refuse would break every existing caller — the CLI,
the canvas, the TUI, the boot seed, the persona materializer — and none of them
have a concurrency problem. A first-party caller passing no precondition is
exactly today's behavior, and stays exactly today's behavior.

But "a refusal that callers can skip will be skipped" is right, and M-4066 is
blunt about it: agents take the warm path, not the careful one. So the wire
field is optional and **`memory_save` with an `id` requires it**. A whole-body
replacement that names no prior state is refused at the tool, with an error that
says what to pass.

That is the structural answer rather than the paragraph asking people to be
careful: the door that had the bug is the door that cannot be opened carelessly,
and nobody has to opt in.

The remaining doors that replace a doc body wholesale — `task <id> .body=`, the
web editor — are single-writer-at-a-time in practice and stay unguarded until
something shows otherwise. Widening is one call site each.

### 4. A refusal hands back the value

A bare error re-runs the same clobber one retry later. The refusal carries the
eid, the column, and **the current stored value in full**.

The consumer is an agent, not a human at a prompt, and the loop is three steps:

1. The write is refused, with the current value in hand.
2. The agent merges its intended change into the value it was just handed.
3. It re-sends with `was` = the hash of that value.

Step 3's hash is fresh by construction because step 1 supplied the value.
Handing back only "conflict" would force a re-read, and the state can move
between the refusal and that read — the same race one level up.

The refusal is a thrown error like the claim lease and the `stop_request` gate,
so the whole batch rolls back. A batch that guards two columns and loses one
keeps neither: partial application is how you get a body from one writer and a
title from another.

## Where it lives

`apply()`, beside the existing in-transaction rules — the claim lease
(`db.ts:1366`), the `stop_request` gate (`:1389`), the board-query parse
(`:1409`). They reject a whole batch by throwing inside the transaction, and
they hold for every entry path by construction. A check in `memory_save` would
be reintroduced as a bug by the next door that writes a body.

`memory_save`'s own read cannot serve as the precondition. It reads the graph
milliseconds before it writes (`mcp.ts:770`), while the agent's real prior state
is what it read minutes earlier when it decided what to write. Comparing against
the tool's own read would shrink the race window from minutes to milliseconds
and hide the bug rather than fix it — a check that almost never fires is worse
than none, because it manufactures confidence.

### The structural constraint, verified

`was` **cannot** ride inside `comp`. `admitted()` (`db.ts:865`) throws on any
key that is neither wire-writable nor a real column, and silently drops
server-stamped ones:

```
$ apply(db, [{ eid, name: 'doc', comp: { body: 'TWO', was: 'ONE' } }])
alien key REFUSED: unknown column: doc.was
body after attempt: ONE
```

So it is a sibling field on `Change`: `{eid, name, comp, was?}`.

The three hops that must preserve it, traced:

- `normalizeChanges` (`props.ts:194`) returns `{ ...change, eid, comp }` —
  spreads
- `admitted` (`db.ts:883`) returns `{ ...change, comp }` — spreads
- `/apply` (`server.ts:628`) hands `req.json()` straight to `apply()` — no
  reshaping

All three preserve unknown siblings today. **This is the fragile part of the
design and the thing to test directly**: a precondition dropped in transit fails
_open_, silently, which is the original bug wearing a safety label. A test must
assert the field survives the wire, not merely that the rule works when called
in-process.

## Rejected alternatives

**Server-side three-way merge.** The journal (`db.ts:337`) stores every batch
verbatim, so the common ancestor is available and this is feasible. Rejected
because a silent auto-merge of prose produces well-formed text nobody reviewed —
invisible in exactly the way the lost update was invisible. `--ff-only` is the
stated model because it refuses rather than resolves. The graph would also be
choosing prose semantics it cannot validate.

**A text CRDT for bodies.** Costed already on the harness board (T-2490, P-26):
register-level MV vs. char-level CRDT, with a research pass concluding that only
native-op-events compose with that project's redaction and determinism
invariants. That is a large, live design problem there. Here it would replace
"one SQLite file, patches in, snapshot out" with an op-log and a fold, to solve
a problem that a refusal solves in a few lines.

**Append-structured bodies** — a memory as independently addressed chunks.
Genuinely eliminates whole-value replacement, but changes the data model of
every doc in the graph, breaks the title+body simplicity the rendering registry
rests on, and does not help the actual case, where an agent _rewrites_ a
paragraph rather than appending one.

**Advisory-only: the note in M-4492 telling operators to re-read after
writing.** Already there, and it is the stopgap the ticket says it is. It should
be trimmed once this lands.

## Compatibility

Additive. An absent `was` is today's behavior at every door. No schema change,
no new column, no migration. Old clients keep working; a client that sends `was`
to an older server is silently unguarded, which argues for landing the server
rule before any caller depends on it.

## Verification

The hazard is a precondition that never fires. It passes every test that does
not try to make it reject, and it passes before the feature exists — so every
check below needs its positive control.

- **The refusal fires.** Write A. From A's pre-state, write B. Assert B is
  refused _and_ A's content survives. The control: the same B with a `was`
  matching current state must succeed — otherwise the test proves only that
  something is broken.
- **The ordinary path still works.** A single-writer body edit with no `was`
  applies unchanged. This is the compatibility claim and most callers depend on
  it.
- **`null` compares.** Guarding a column that is absent, and expecting absent,
  must succeed; expecting a value where there is none must refuse.
- **The field survives the wire.** Drive it over `POST /apply`, not in-process.
  A guarded write that should refuse must refuse _through HTTP_. Assert the
  refusal, then assert the same request without `was` succeeds — proving the
  test can tell the two apart.
- **Whole-batch rollback.** A batch with one passing and one failing guard
  leaves _neither_ applied.
- **The refusal carries the value.** Assert the error payload contains the
  current stored value, and that re-sending with its hash succeeds — the
  three-step loop actually terminates.
- **`memory_save` requires it.** `memory_save(id, body)` with no `was` is
  refused; with a correct one it succeeds. Both halves, or the requirement is
  untested.

A mutation check earns its place here: break the comparison to always-equal and
confirm the refusal tests fail. A guard that cannot be made to fail is not a
guard.
