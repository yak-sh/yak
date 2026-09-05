# @yaks/session

**Who is working, what they hold, and what happened when two of them wanted the
same thing** — the session component domain for a
[@yaks/graph](https://jsr.io/@yaks/graph).

## Install

```sh
deno add jsr:@yaks/session
# or: npx jsr add @yaks/session
```

## The shared editor

A team edits documents together, and some of the editors are agents that run
unattended for an hour at a time. Four things follow immediately, and this
package is the four answers.

**Who is working?** A run — a person's editor window, an agent's turn.

```
{ entity: { eid: '…' }, session: { id: 'tab-7', actor: ada, model: 'opus' } }
```

**What do they hold?** A lock, and it rides the thing it locks.

```
{ entity: { eid: page }, claim: { session: run } }
```

One lock per page by construction: `claim` is a component ON the page, so "who
has this open?" is a question the page itself answers, and "what is locked?" is
a query for entities wearing `claim`.

**How do you ask one to stop?** A lever, not a note.

```
{ entity: { eid: '…' }, stop_request: { target: run } }
```

It may only be pulled on a run that is still going. A run that finishes leaves a
`brief` — what it says it did.

**And when two want one page?** The second is refused, and the collision is
written down.

```
{ entity: { eid: '…' }, conflict: { target: page, loser: run2, holder: run1, at: … } }
```

## A lock is a lease, not a patch

Writing a lock over somebody else's fails the whole batch loudly — release, then
claim:

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { sessionDoc, sessions } from '@yaks/session'

let vocab = loadVocab([sessionDoc, mine])
let g = graph({ storage, vocab, plugins: [sessions()] })

g.apply([{ entity: { eid: page }, claim: { session: ada } }])
g.apply([{ entity: { eid: page }, claim: { session: bo } }])
// Bounced: <page> is already claimed by <ada>
```

The same run re-claiming is a no-op refresh, so a worker replaying its own take
is idempotent. A **release** (`claim: null`) is deliberately unguarded: letting
go is how a lock is handed over, and the start-up reap frees a dead run's locks
without pretending to be that run.

## Three places the rule holds

**A write** is refused inside `apply()`, on the `precondition` phase — inside
the batch's own transaction, and before any row moves. Both halves matter.
Inside the transaction, so the holder read is the holder the batch would write
against. Before any write, so the holder is read before the `cascade` phase
could remove it: a batch that deletes a run and takes its lock in the same
breath still bounces, where a check that ran after the cascade would find an
empty lock and admit the take.

**The collision** is recorded after that rollback, on the `audit` phase, through
a detached transaction — a record that condemns a batch cannot ride inside it. A
side that no longer exists is written `null`, and a failed audit is telemetry:
the refusal reaches the caller either way.

**A run that never ended properly** is corrected at start-up:

```ts
import { reapLeases } from '@yaks/session'

let freed = reapLeases(storage) // every lock whose run is over
```

Nothing expires on its own. A lease with a timeout has to be renewed, and a
worker that is merely thinking hard would lose its lock mid-edit — so the
correction happens at the one moment there is a fresh answer available. It is
idempotent by construction: a freed lock is gone, so the next start-up finds
nothing to do.

## A dying run lets go, and that is vocabulary

`claim.session` dies by `release`: delete a run's entity and its locks go while
the pages live. There is no code for that here — it is declared in `sessionDoc`
and executed by @yaks/graph's cascade, which is the point of declaring death in
the vocabulary at all.

## The surface

| export                                          | is                                             |
| ----------------------------------------------- | ---------------------------------------------- |
| `sessionDoc`                                    | the five components, to load beside your own   |
| `SESSION`, `CLAIM`, `STOP`, `BRIEF`, `CONFLICT` | their names                                    |
| `Status`, `Turn`, `STATUSES`, `ACTIVE`          | the words a run wears                          |
| `status(v)`, `awake(comp)`                      | a stored status read; is this run still going? |
| `sessions(opts)`                                | the @yaks/graph plugin — components and hooks  |
| `leasing(opts)`, `takes`, `stops`               | the `precondition` hook, and what it reads     |
| `auditing(opts)`                                | the `audit` hook that records a collision      |
| `reapLeases(storage)`, `staleLeases(tx)`        | start-up reconciliation, doing and reading     |
| `Bounced`, `NotRunning`                         | the two refusals, with their facts as fields   |

## What is deliberately not here

**Running anything.** Spawning a process, choosing a provider's arguments,
tailing a log, reaping a pid. A committed `stop_request` is acted on by a
`created('stop_request')` handler on
[@yaks/effects](https://jsr.io/@yaks/effects) — post-commit, so the request is
durable before anything is signalled, and isolated, so a process that will not
die does not refuse the batch. This package is the model and the rules.

**Lease timeouts and heartbeats.** See the reap above: they trade a correct lock
for a punctual one.

**What the work IS.** A page, a task, a drawing are plain entities in your own
vocabulary. This package never looks at them — which is why a lock works on
anything.

## Where it sits

A component domain over [@yaks/graph](https://jsr.io/@yaks/graph), the same
shape an application's own plugin has — like
[@yaks/member](https://jsr.io/@yaks/member), it ships components and hooks and
nothing privileged.

## Compatibility

Pure TypeScript; the only platform API it touches is `crypto.randomUUID`, and
that only to name a conflict record (pass your own `mint` to avoid it). Reads go
through @yaks/graph's `Storage` seam. Runs on **Deno**, **Node**, and in the
**browser**.
