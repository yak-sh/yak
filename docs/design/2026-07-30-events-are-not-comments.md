# Mechanistic events are not comments

Owner decision, standing since before T-7018 (2026-07-24): mechanistic events
are not reified as comments. This is how `comment.event` comes out.

## What the mark is actually holding

`comment.event` reads like one idea and is doing three unrelated jobs. That is
why "delete the rows and drop the column" stalled — two thirds of the rows are
not notices at all, and each job wants a different answer.

| job                                    | rows | answer                     |
| -------------------------------------- | ---- | -------------------------- |
| a duplicate of state the graph holds   | 361  | delete it, read the entity |
| speech addressed to an agent           | 1    | a comment, unmarked        |
| a notice about something that happened | 158  | the new representation     |
| neither — authored prose and strays    | 46   | a comment, unmarked        |

Counted by each notice's opening shape, which is the only way that works: a
settle notice carries the agent's whole closing summary inside it, so bucketing
by "long, or has markdown headings" reads 354 machine notices as authored prose
and turns a 46 into a 376.

The 46 are not all authored either — a handful are machine strays with no mint
site of their own, like a knock receipt or a bare "session brief written". They
want reading before anything is decided about them.

### Job 1 — duplicates (361 rows)

`settled()` (sessions.ts) writes `S-… completed · exit 0` plus the agent's final
text onto the task. The `session` row already carries `status`, `exit_code` and
`final_text`; the resume refusal beside it duplicates `session.error`. These
comments are a second copy, minted so the task's thread displays them and the
bus delivers them.

The graph already refuses derived copies everywhere else — a board is a saved
query, membership is never stored; telemetry is log data, never graph. A copy
drifts, and this one is 361 rows deep.

**So the replacement for the largest bucket is nothing.** Both consumers read
the session row: the thread renders the session's own state where it already
links to it, and the bus wakes on the session's `status` change rather than on a
comment about it.

### Job 2 — speech (1 row)

The `:scribe` ask ("brief S-31 — write its session doc") is a comment on a
session, which IS a message to that agent. It is addressed speech; it was marked
only to keep it off the relay. It stays a comment and loses the mark. Whether it
should also be quiet is the reader's business, and `task mute` already answers
it.

One row, but the mint site is what matters — left marked, it teaches the next
machine-speaks-to-an-agent path to mark itself too.

### Job 3 — notices (158 rows)

What is left is the real category: a lease lapse, a sweep finding, a `:fix`
scene capture. Something happened, and somebody should know.

## The representation

A **notice** is its own entity: `doc + notice{target_eid, kind}`.

```ts
// A notice: something happened ABOUT this entity that nobody said. Not a
// comment — it was emitted, so it is not in the conversation, is not
// counted as one, and never reaches the mail relay. The bus and the inbox
// deliver it; `kind` is what happened, and the body says it in words.
notice: {
  target_eid: { eid: '', death: 'cascade' }, // what it is about
  kind: { enum: noticeKinds },               // lapse | sweep | scene | …
},
```

It is not a renamed comment. `kindOf` answers `notice`, renderers pattern-match
the component, the comment thread never selects it, and `fanout` cannot see it
because it only ever looked at comments.

### Why not telemetry, and why not a knock

**Telemetry** (`tool_call`) is the other precedent for "log data, not graph": no
eid, no components, `snapshot()` never walks it. It is the right shape for
volume, and the wrong shape here — an inbox item must be addressable, archivable
per actor, and reachable by `task show`. Telemetry is none of those.

**A knock** is closer than it looks: "the artifact of an attention ask, always
minted, GC-able later". The difference is that a knock is addressed (`to_eid`)
and a notice often is not — a lapse is true whether or not anyone is listening.

Worth naming: knock has the same disease this task is removing. Its own comment
says _"words ride as a plain comment on the target, never in the knock"_ — so
every knock mints a comment to carry its sentence. A notice carries its own
body, and knock should follow. That is its own row, not this one.

## Order

Each step is separately landable and leaves the tree working.

1. Add `notice` to the vocabulary (types.ts `comps` + `Ent` + `kindOrder`, db.ts
   `schema`). Nothing mints it yet.
2. Teach the two readers — `notices()` in client.ts and the inbox predicate — to
   serve notices beside comments.
3. Move job 3's mints: wrap's lease lapse (client.ts), the sweep door, the
   `:fix` scene capture. Each becomes a notice; each stops being a comment.
4. Job 1: delete the mints. `settled()` and the resume refusal write nothing;
   the thread and the bus read the session row.
5. Job 2: drop the mark from the `:scribe` ask.
6. Remove the doors — `--event` on `task comment` and `task set`, `event` on the
   MCP tools, and their manual entries.
7. Migrate the data (below), then drop the column and its consumers: `mail.ts`
   fanout skip, the two `client.ts` filters, `sessions.ts` unnotified + reply
   skip, `live.ts` talk set, `Comments.tsx` modifier.

## The data — owner's call, not mine

566 rows. T-7018 asks to delete them; I would rather migrate, and the buckets
differ:

- **Job 1 (361)** — safe to delete outright, with one check first: every one
  should be a verbatim copy of a session row that still exists. Where the
  session is gone, the comment is the only record and becomes a notice instead.
  Confirm before deleting; the check is a join.
- **Job 3 (158)** — migrate to notices. These are lapses and findings with no
  other home, and they are the lifecycle history worth keeping.
- **Job 2 (1) and the 46** — keep as comments, drop the mark. Letters somebody
  wrote; the mark was always wrong on them.

Deletion is the irreversible half, so nothing is touched until the owner has
read this. Everything above it is reversible and proceeds.

## What must not happen again

The decision was made, then answered "not yet", then closed. Five days later we
shipped the `--event` door (T-9747), a second door on `set --comment` (T-9767),
and a fleet memory teaching both (M-9752) — 142 rows became 566.

A standing decision that is not yet implemented stays **open**. Closing it on an
explanation is how the fleet learns to build the opposite.
