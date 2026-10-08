# @yaks/inbox

A person's inbox, as a plugin: the threads waiting on them, in lanes, read from
facts already in the graph. Its policy reads facts and builds queries; it
declares no stored lane or membership. A config that leaves `@yaks/inbox` out of
its plugins loads none of it: no `inbox_summary` read, no inbox tools, views or
letters, and every other plugin works the same.

```json
{
  "use": "@yaks/inbox",
  "with": {
    "person": "<person eid>",
    "from": "inbox@books.example",
    "base": "https://books.example",
    "hour": 9
  }
}
```

Every option is for its [email door](#the-email-door); `"@yaks/inbox"` alone is
the inbox without one.

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

| Export      | Owns                                                                       |
| ----------- | -------------------------------------------------------------------------- |
| `.`         | Thread and attention policy, reader profiles, `inboxDoc`                   |
| `./queries` | Inbox read queries                                                         |
| `./read`    | `readInbox` and `readThread`, the server reads                             |
| `./vocab`   | `conversation{}`, `inbox_summary`, `mail_notice` and the tool declarations |
| `./graph`   | The `inbox_summary` view                                                   |
| `./tools`   | `inbox_new`, `inbox_list` and `inbox_archive`                              |
| `./views`   | The Inbox a browsing app draws, and its home page                          |
| `./service` | The email door's letters, as a duty                                        |
| `./mail`    | The email door's reading of letters that arrive (@yaks/mail `Reading`)     |

The shared policy exports remain usable without a graph or session runtime.

```sh
yak inbox list                      # the caller's threads, blocking first
yak inbox list --lane 'Needs you'
yak inbox list --search dinner --direction received --all
yak inbox archive T-12              # hidden until its next qualifying activity
```

`inbox_list` returns one row per thread, its root, at most `limit` (default 50);
`who` defaults to the caller. `inbox_archive` archives the thread an item is in:
a letter's thread follows its `reply_to` chain to its root, then to what that
root is about.

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
arbitrary edits do not resurface threads. A mark on a message in the thread
counts as one on its root: @yaks/mail marks the letter it shows `opened`, and
the letter it answers `archived`, and that is the thread read or put away.
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
messages. Its subscription refreshes when inbox policy dependencies change. A
bounded completed-summary working set is reused only while the storage data
revision is unchanged; SQLite observes commits from other connections too.
Stores without a revision token recompute every read. Returned summaries are
isolated from caller mutations. The web host executes it in its ordinary read
worker.

The lower-level `candidates`, `discussion`, `requirements` and `dependents`
query helpers belong to this read implementation. Callers use `readInbox` or
`readThread`, not a second copy of its read pipeline.

## In a browsing app

The `./views` facet is the inbox a browsing app (@yaks/browse, in a browser and
in `yak browse`) draws, and all of it: a config without @yaks/inbox has no inbox
page, tab or count, and no page asks for a thread summary.

- `inspectViews`: the `Inbox` view of a person (lanes, a search over said and
  received words that can include archived threads, each thread opened in place
  to read and answer, a new conversation) and of a project (one line per thread,
  the whole count above a `limit` from the caller's context). Both are
  @yaks/inspect views written against `io`: every entity in them is drawn
  through the host's shared renderers (`Inbox.List.Tile`, `Inbox.Full`), and
  marks go out through `io.apply`.
- `home`: the owner's inbox as the app's home page, named Inbox.
- `tabs`: `Inbox` as a tab on each person and project, ahead of the app's own.
- `icons`: the glyph both wear.

The views ask one summary subscription for a list and hold only the root and
newest rows they draw; opening a thread adds one full-thread subscription for as
long as it is open. A home page's or tab's count of unread threads, `waiting`,
reads that same summary, so it never disagrees with the list.

Which threads are open and how the search is switched is page state, kept in a
page graph of the views' own (`front.json`, a @yaks/client over RAM that no
server hears of), so a remount finds it again. What the person types (search
words, replies, a new conversation) is a @yaks/draft draft, kept everywhere.

```ts
import { home, tabs } from '@yaks/inbox/views'
import { equal } from '@yaks/testing'

equal([home.name, home.view], ['Inbox', 'Inbox'])
equal(tabs.map((t) => t.view), ['Inbox'])
```

## The email door

With `person`, `from` and `base`, the inbox reaches a mail client. Its service
(`./service`, a duty) reads the person's inbox on every pass (`every`, ten
seconds by default) and queues a letter for each newly blocking decision. After
`hour` (UTC, default 9) it also queues at most one digest a day; a missed day is
not replayed as a backlog of digests. Alerts and updates are left out unless
`alerts: true` or `updates: true` asks for them. Read, muted and archived
threads do not cross this door. @yaks/mail sends the letters, so the person
needs `email.address`, and the mail plugin its sender and an inbound route or
pull.

`./letters.ts` holds the policy: `inboxAt`, `eligible`, `rendered`, `planned`
and `queue`, for hosts supplying their own clocks and writes. It has no
transport of its own. `mail_notice{activity, comment, thread, letter}` keeps the
activity as rendered: on a thread letter it points to the shown comment, on a
digest entry to its thread and digest letter. These snapshots deduplicate queued
mail; they are not conversation or new inbox activity.

Thread letters use the previous letter's Message-ID as In-Reply-To. A digest
contains links and a separate reply address for each thread (or shown comment),
so a reply can select a thread without guessing from a digest's subject. The
sender's domain must route those id-shaped addresses to this graph's mail edge.

What comes back is read by the `./mail` facet, which @yaks/mail asks at both of
its receiving doors (@yaks/mail, "What else a letter means"). A reply to the
digest itself is kept as mail, not assigned to an arbitrary thread. A verified
reply from whom a thread letter was sent to, or from the person to a thread's
own address, keeps its envelope and also carries `comment{target, reply_to}`, so
it reaches the same conversation as web and TUI. A reply containing only a
choice number (before quoted text) selects that choice of the thread's open
decision; other words are a custom answer, and out-of-range numbers remain
comments. Answers are attributed to the sender and complete the decision through
the usual task and kernel rules; an already answered or cancelled decision keeps
further replies as comments. Unverified or unknown senders are kept as mail
only, never attributed to the recipient.

A conversation starts when a letter has no `In-Reply-To` or `References`, is
addressed to `from`, and has a verified author resolving to `person`. The
received entity keeps its `mail` envelope and Message-ID, gains
`conversation{}`, and carries the person's full text in `doc.body` with its
first line as `doc.title`. Its `created.by` is the sender, never the mailbox's
operator. Empty text, unverified senders, unknown senders and other people
remain mail only, and a repeated Message-ID creates nothing.

Provenance is checked first, independently of the person: a known session, role,
effect, call, output or transcript entry as sender, the inbox address as sender,
or `Auto-Submitted` other than `no` is kept as mail only. DKIM authenticates a
sending domain, not whether a person or an automation typed the words. Keep the
arrival endpoint behind a perimeter or configure its `door.secret`; do not let
untrusted callers assert that verdict.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernel, kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { inboxDoc } from '@yaks/inbox/vocab'
import { reading } from '@yaks/inbox/mail'
import { arrived, mailDoc } from '@yaks/mail'
import { equal } from '@yaks/testing'

let vocab = loadVocab([kernelDoc, docDoc, inboxDoc, mailDoc], [kernelKeywords])
let g = graph({ vocab, storage: ram(vocab), plugins: [kernel()] })
await g.apply([{
  entity: { eid: 'ana' },
  email: { address: 'ana@example.com' },
}])
let receive = arrived({
  graph: g,
  readings: [reading({ person: 'ana', from: 'inbox@example.com' })!],
})
await g.apply(
  await receive({
    from: 'relay@example.com',
    to: 'inbox@example.com',
    headers: new Headers({
      From: 'Ana <ana@example.com>',
      'Message-ID': '<hello@example.com>',
    }),
  }, { text: 'Can we plan dinner?\nTomorrow would work.', verified: true }),
)
let [conversation] = await g.read('.conversation *')
equal(conversation.created?.by, 'ana')
equal(conversation.doc?.title, 'Can we plan dinner?')
```

No probe needs a real address: use @yaks/mail's `stash` transport, which keeps
messages in memory.
