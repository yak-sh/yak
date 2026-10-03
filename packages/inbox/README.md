# @yaks/inbox

Pure person and thread attention policy, with conversation rows shared by inbox
doors. It reads facts and builds queries; it performs no I/O, sends no
notifications, and declares no stored lane or membership.

A **conversation** is a thread with no other subject: `conversation{}` on a
`doc{title, body}`. The body holds the caller's words verbatim; the title is
their first line. Replies are `comment{target, reply_to}` on that root.

```sh
yak inbox new "Help me plan this work"
yak inbox new @question.md
```

`inbox_new({text})` returns a conversation bundle. The tool runner writes it as
the caller; the inbox plugin has no person option and never substitutes a
writer. Empty or whitespace-only text is refused. Creation starts no session
itself; answering belongs to the host's session policy.

```ts
import { equal } from '@yaks/testing'
import { loadTools } from '@yaks/graph/tools'
import { inboxDoc } from '@yaks/inbox/vocab'
import { runs } from '@yaks/inbox/tools'
import { argsFor } from '@yaks/cli/grammar'

let tool = loadTools(inboxDoc, runs())[0]
equal(await argsFor(tool, ['Help', 'me', 'plan']), { text: 'Help me plan' })
```

| Export      | Owns                                                     |
| ----------- | -------------------------------------------------------- |
| `.`         | Thread and attention policy, reader profiles, `inboxDoc` |
| `./queries` | Inbox read queries                                       |
| `./vocab`   | `conversation{}` and the `inbox_new` declaration         |
| `./tools`   | Pure `inbox_new` bundle construction                     |

A host composes `@yaks/inbox` as a plugin to expose its vocabulary and tool. The
shared policy exports remain usable without a graph or session runtime.

`threads(rows, reader, {lane?, text?, direction?: 'said' | 'received', all?})`
returns one record per thread: `eid`, `row` (root), `latest`, `messages`,
`lane`, `reason`, `blocking`, `at`, and `unread`. Lanes are Needs you, Replies,
Updates, Recent, with that precedence. Unassigned decisions reach the operator;
explicit assignments reach that person. Open tasks requiring an outstanding
assigned decision or ask make it blocking. Blocking threads sort first, then
newest qualifying activity.

Replies follow comment reply ancestry to the person's words. On a conversation
the person started, a comment on the root also answers their opening words.
Direct address retains session/claim policy. Session prose answers personal
inputs; instructions, tool traffic and reasoning are excluded. Updates are
completion, failure, stuck and other state marks, or commits on work the person
started or watches. Watching alone does not deliver progress chatter. Recent
contains what the person said, started, opened or decided. Said search includes
decision choices; received search excludes the person's words. Mute wins over
direct address.

A root's archive timestamp hides the thread through that instant. Later
qualifying activity resurfaces it without removing the archive mark. Reading and
arbitrary edits do not resurface threads.
`attention(eid, 'archived' | 'opened')` returns two bundles for **one atomic
apply**: remove the old mark, then add it, so the server supplies a fresh
timestamp on repeated attention. No sweep is involved.

Each door owns the following reads from `@yaks/inbox/queries`, using
`words(vocab)` so sparse vocabularies are supported:

1. `candidates(reader, words)` — direct address, assignments, watches and
   personal attention, including archived roots.
2. `discussion(candidates, words)` — roots, full conversation and commits.
3. `requirements([...candidates, ...discussion], words)` — requires edges to
   those roots.
4. `dependents(requirements, words)` — dependent task state, to exclude
   completed or cancelled blockers.

Combine the results into `{eid, comps}` rows and pass them to `threads`. Do not
count notification rows or filter out archive marks in the query. In web/TUI,
`useInboxThreads(actor, search)` owns these subscriptions and returns
`{threads, ready}`. The count uses the same records; failed or incomplete reads
remain unknown.
