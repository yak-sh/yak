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

A **thread summary** is an exact policy record without historical message
bodies. `readInbox` reads metadata on the server and returns the same lanes,
ordering, unread state and blockers as `threads`. Text and direction search read
complete words on the server, then return thread summaries; they never send the
candidate history to a browser.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { readInbox } from '@yaks/inbox/read'
import { equal } from '@yaks/testing'

let v = loadVocab({
  $defs: {
    task: { component: true, type: 'object', properties: {} },
    filed: {
      component: true,
      type: 'object',
      properties: {
        assignee: { type: 'string' },
      },
    },
  },
})
let g = graph({ vocab: v, storage: ram(v) })
await g.apply([{
  entity: { eid: 'work' },
  task: {},
  filed: { assignee: 'person' },
}])
equal((await readInbox(g, v, 'person')).map((t) => [t.eid, t.lane]), [
  ['work', 'Needs you'],
])
```

`readThread(graph, vocab, actor, root)` reads one thread's complete messages,
including archived history, for detail. A digest needs only its selected
root/latest bodies and can get those explicitly. The read interface must be a
Graph read, which folds projections, not a storage transaction's raw read.

The graph facet answers the computed
`inbox_summary{actor, text, direction,
all, lane, thread, threads}` component.
It is not stored policy state. `summaryQuery(actor, search, thread?)` builds its
query. A summary's `messages` is empty; a query naming `thread` carries complete
messages. Its subscription refreshes when inbox policy dependencies change. The
web host executes it in its ordinary read worker. Browser/TUI hooks own one
summary subscription and hold only the root/latest rows they draw; opening
detail adds one full-thread subscription. Counts consume those same
authoritative summaries.

The lower-level `candidates`, `discussion`, `requirements` and `dependents`
query helpers belong to this read implementation. Callers use `readInbox` or
`readThread`, not a second copy of its read pipeline.
