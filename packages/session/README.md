# @yaks/session

**A session is a transcript** — the entries that make it, the daemon that reacts
to its newest line, the lock it holds, and what happened when two of them wanted
the same thing. The session component domain for a
[@yaks/graph](https://jsr.io/@yaks/graph).

## Install

```sh
deno add jsr:@yaks/session
# or: npx jsr add @yaks/session
```

## The transcript

Nothing is spawned, started or stopped. A session is identity only; everything
it does is an entry, and what it is doing is read off the newest one.

```
{ entity: { eid: run }, session: { id: 'spike' } }
{ entity: { eid: e1 }, entry: { session: run, seq: 1 },
  content: { body: 'List your tools, then say done.' },
  using: { provider, model, effort: 'low' } }
```

An `entry` is `{session, seq}` and nothing else. The comp beside it says what
kind of line it is:

| beside `entry`                   | it is                                                            |
| -------------------------------- | ---------------------------------------------------------------- |
| `content{body}`                  | an **input**: prose from a person or a system                    |
| `content{body, source}`          | an **output**: what a model said, `source` the ask it came from  |
| `ask{to, through}`               | the daemon asked model `to`, from the prefix ending at `through` |
| `call{to, id, args, source}`     | a tool the model asked for, from that ask                        |
| `result{call}` + `content`       | what the tool answered                                           |
| `using{provider, model, effort}` | set or switched on an input; recorded as served on an ask        |
| `stop`                           | a mark: the daemon performs nothing after it                     |
| `error{code}` + `content`        | an outcome the code expected                                     |
| `exception` + `content`          | one it did not: a defect report                                  |

There is no `input` or `output` comp — the two directions are one comp, told
apart by `source` — and no status column anywhere. `statusOf(entries)` says what
is owed: a call the newest ask made that no result answers is `running` whatever
landed after it, and otherwise the newest entry decides (`input`/`result` →
pending, `ask`/`call` → running, output → settled, `stop` → stopped, `exception`
or three errors → failed). `sessionDerived` is the same rule as SQL, so
`.session.status=running` filters through a @yaks/sqlite index without a stored
word to keep in sync.

What a provider keeps about an ask is the provider's own comp on the ask entry:
[@yaks/openai](../openai) declares `openai{response_id}` and stamps it through
the model's `mark`; its `anchor` reads it back so the next ask continues from
the reply with only what followed. The seam carries the question, never the
answer.

`fork{from}` on a session continues another transcript from one of its entries:
the parent's entries up to `from` are the fork's prefix, and where the provider
kept that reply, the fork's first ask travels with only its own input.

## The daemon

`react(g, session, { model, tools })` is one step: read the newest entry, do the
one thing it asks for — ask the model, run an open tool call, retry an error
under the bound — and append what happened. `daemon(g, fx, deps)` registers it
as a `created(entry)` effect so entries wake steps and steps write entries until
a step finds nothing to do; `settle()` loops it by hand.

```ts
import { effects } from '@yaks/effects'
import { graph } from '@yaks/graph'
import { modelDoc } from '@yaks/model'
import { openaiDoc, responses } from '@yaks/openai'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { daemon, sessionDoc, sessions } from '@yaks/session'

let vocab = loadVocab([sessionDoc, modelDoc, openaiDoc])
let fx = effects(vocab)
let g = graph({ storage: ram(vocab), vocab, plugins: [sessions(), fx] })
let d = daemon(g, fx, { model: responses({ credential }), tools })
g.apply([session, input]) // the input wakes the first step
await d.idle(session.entity.eid)
```

`deno task session:spike` runs exactly that against the model and prints the
transcript through the package's `Line` and `Status` renderers.

## A lock is a lease, not a patch

A `claim{session}` is a session's lock, and it rides the thing it locks — one
lock per entity by construction, and "who has this?" is answered by the entity
itself. Writing one over somebody else's fails the whole batch loudly:

```ts
g.apply([{ entity: { eid: page }, claim: { session: ada } }])
g.apply([{ entity: { eid: page }, claim: { session: bo } }])
// Bounced: <page> is already claimed by <ada>
```

The same session re-claiming is a no-op refresh. A **release** (`claim: null`)
is unguarded: letting go is how a lock is handed over.

The write is refused on the `precondition` phase — inside the batch's own
transaction, before any row moves, so the holder is read before the `cascade`
phase could remove it. The collision is recorded after the rollback, on the
`audit` phase, as a `conflict{target, loser, holder, at}` through a detached
transaction. And at start-up, `reapLeases(storage)` frees every lock whose
holder is not a session in the graph. Nothing expires on its own: a lease with a
timeout has to be renewed, and a worker that is merely thinking hard would lose
its lock mid-edit.

`claim.session` dies by `release`: delete a session's entity and its locks go
while the documents live. That is declared in `sessionDoc` and executed by
@yaks/graph's cascade — no code for it here.

## The surface

| export                                           | is                                                       |
| ------------------------------------------------ | -------------------------------------------------------- |
| `sessionDoc`                                     | the vocabulary, one document to load beside your own     |
| `SESSION`, `CLAIM`, `CONFLICT`, `ENTRY`, …       | the comp names                                           |
| `sessions(opts)`                                 | the @yaks/graph plugin — vocabulary, rules, audit        |
| `react`, `settle`, `daemon`, `transcript`        | the daemon: one step, a loop, an effect, a fork's prefix |
| `statusOf`, `kindOf`, `textOf`, `sessionDerived` | the status rule over bundles and as SQL                  |
| `views`                                          | `Line` and `Status`, portable @yaks/render renderers     |
| `leasing(opts)`, `naming`, `auditing(opts)`      | the hooks on their own                                   |
| `reapLeases(storage)`, `staleLeases(tx)`         | start-up reconciliation, doing and reading               |
| `Bounced`, `Unnamed`                             | the refusals, with their facts as fields                 |

## What is deliberately not here

**A process.** Pid, pane, a log to tail — the words a run's PROCESS needs belong
to the application that runs processes. **A transport.** The daemon is handed a
@yaks/model `Model`; @yaks/openai is one. **What the work IS.** A page, a task,
a drawing are plain entities in your own vocabulary; a lock works on anything.

## Compatibility

Pure TypeScript; the only platform API it touches is `crypto.randomUUID`, to
mint entries and conflict records (pass your own `mint` to avoid it). Runs on
**Deno**, **Node**, in the **browser**, and inside a Cloudflare Worker.
