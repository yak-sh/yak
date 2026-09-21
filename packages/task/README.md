# @yaks/task

To-do items for a [@yaks/graph](https://jsr.io/@yaks/graph): the `task`
component, the `completed` and `cancelled` marks, a status computed from those
marks rather than stored, counts over `requires` and `contains` links, and three
tools. A task entity can carry other components as well — document text, an
estimate, whatever the application declares. Where a task is filed (its project,
priority, domain and assignee) belongs to [@yaks/project](../project).

## Install

```sh
deno add jsr:@yaks/task
# or: npx jsr add @yaks/task
```

## What it is

Say a team keeps a list of what it has to do. Four questions come up, and this
package is the four answers.

**What is on the list?** An entity with a `task{}` component is a to-do item.
`task` is one component among the entity's others, not a record type of its own:
the same entity also carries your `doc`, your `estimate`, anything else it is.
Adding `task` to something makes it something to do without making it stop being
what it was. [@yaks/project](../project)'s optional
`filed{project, priority, domain, assignee}` places it in a portfolio; a
microtask needs only `doc` and `task`, with nothing filed.

**Where does it stand?** No column holds the answer. A task with a `completed`
component is done, one with `cancelled` is cancelled, and one with neither is
open. `status` is computed from those components, so finishing something records
_when_ and _by whom_, and reopening it means removing a component rather than
guessing what the status used to be.

**How do you look at the list?** [@yaks/project](../project)'s `board{query}` is
a saved filter over the portfolio. Membership is never stored — no row anywhere
records that a task is on a board — so a board is always current, and a task
that starts matching the query is on it. The empty query selects nothing, on
purpose.

**What is it waiting for?** `requires` and `contains` relate one task to another
through [@yaks/edge](https://jsr.io/@yaks/edge), and `blocked{on}` records that
something outside the graph is in the way.

## Use

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { projectDoc, projects } from '@yaks/project'
import { taskDoc, tasks } from '@yaks/task'

let vocab = loadVocab([edgeDoc, taskDoc, projectDoc, mine], [edgeKeywords])
let g = graph({
  storage,
  vocab,
  plugins: [edges(vocab), tasks(), projects(vocab)],
})

g.apply([
  {
    entity: { eid: 't1' },
    doc: { title: 'Buy the cake' },
    task: {},
    filed: { priority: 1 },
  },
  {
    entity: { eid: 't2' },
    doc: { title: 'Book the room' },
    task: {},
    filed: { priority: 0 },
  },
  link('t1', 'requires', 't2'),
  {
    entity: { eid: 'b1' },
    doc: { title: 'Up next' },
    board: { query: '.status=open&.order=priority' },
  },
])
```

Finish a task by writing the mark, not by setting a status. The mark is written
with no columns: `completed.at`, `.by` and `.via` are server-owned, filled in by
@yaks/graph from the clock of the `apply()` call and the `$actor` that call
carries (stamp.ts); values a client sends for those columns are dropped before
the write.

```ts
g.apply([{ entity: { eid: 't2' }, completed: {}, $actor: { by: dana } }])
```

## A plan is one list of bundles

Work of three steps or more is a tree — the outcome, what it needs, what it
contains — and there is no tool for building one. A tree is a list of bundles:
the tasks, each under a `$alias` id, and the links that connect them, applied in
one transaction. An edge entity's id is derived from its two ends and the
relation ([@yaks/edge](https://jsr.io/@yaks/edge)), so the ends may be entities
the same transaction is creating. That is why each link is written under an
alias of its own rather than through `link()`: `link()` computes the id from the
ids you hand it, and `$goal` is not an id yet.

```ts
let plan = [
  {
    entity: { eid: '$goal' },
    task: {},
    doc: { title: 'The outcome' },
    filed: { project: 'p19' },
  },
  {
    entity: { eid: '$link~goal' },
    edge: { from: 'p19', to: '$goal' },
    contains: {},
  },
  {
    entity: { eid: '$gate' },
    task: {},
    doc: { title: 'First' },
    filed: { project: 'p19' },
  },
  {
    entity: { eid: '$link~gate' },
    edge: { from: '$goal', to: '$gate' },
    requires: {},
  },
]

g.apply(plan, { check: true }) // what WOULD be written, and none of it kept
g.apply(plan) // the whole tree, or none of it
```

A dry run executes every phase — admission, the preconditions, the rules — and
then rolls the transaction back. What comes back is the list of bundles as it
would have been written, with every alias resolved to the id it would have been
given and every link under its derived id, while nothing is stored, no journal
row is kept and no effect runs. A refusal is still a refusal, which is the whole
reason to ask. The same rehearsal over HTTP is `POST /apply?check=1`
([@yaks/api](https://jsr.io/@yaks/api)); from the command line it is
`yak apply --dry-run`.

## The status rule is written once

`task.status` is declared `computed: true` — no column holds it. Its value is
the first mark the task has, and that one ordered list is what all three readers
are built from:

```ts
import { compute, derived, statusOf } from '@yaks/task'

statusOf(bundle) // for an entity already in hand
derived() // the same rule as SQL, for @yaks/sql's `derived` hook
compute() // the same rule per bundle, for @yaks/match
```

Because it is one list, a saved filter selects the same tasks in a database and
in a page — which is the property that makes a board portable at all.

Add a rung and every reader learns it at once. A graph that leases its tasks
reads a held lease as `wip`:

```ts
import { MARKS } from '@yaks/task'

let marks = [...MARKS, { status: 'wip', comp: 'claim', settled: false }]
// derived(marks), compute(marks), statusOf(b, marks), projects(vocab, marks)
```

`settled: false` is what records that a lease means somebody is _on_ it, not
that they finished it — so it still counts as work left.
[@yaks/session](../session) does exactly this: it owns the `claim` component, so
its `@yaks/session/vocab` module restates `task.status` with the lease in the
ladder, and a server that loads it after this package gets the wider reading.

## Blocked is not a status

There is no `blocked` status, and that is a decision rather than an omission. A
blocked task is still open work: rolling it into the status would hide it from
every query for open work exactly when somebody needs to see it.

So the two questions stay apart, and they read differently:

```ts
import { done, gated, openDeps } from '@yaks/task'

gated(bundle) // something OUTSIDE the graph is in the way — an alarm
openDeps(storage, 't1') // how many children are unfinished — a count
done(storage, 't1') // settled itself AND no unfinished children
```

`openDeps` follows `requires` and `contains` and counts what has not settled. A
task with three unfinished children is a task in progress, not a task in
trouble: it renders as "3 left", and zero renders as nothing at all. A child
that is not a task cannot settle, so it stays counted. `done` accepts the same
optional `marks` and `relations` as `openDeps`; both return a value for
synchronous storage and a promise for asynchronous storage. They look at direct
children, not at a recursive closure.

## The three tools

`@yaks/task/tools` exports `runs`, the implementations behind the three
declarations marked `tool: true` in `vocab.json`:

```sh
yak task new 'Buy the cake' --project P-19 --priority 1
yak task list '.filed.project=P-19&.priority<3'
yak task update T-42 done
```

Over MCP the same three are named `task_new`, `task_list` and `task_update`.
Each one returns bundles and lets the tool runner commit them. `task_update`
writes a status as the marks that mean it: `done` adds `completed` and removes
`cancelled`, `cancelled` does the reverse, and `open` removes both.

`task_list` always puts `.task` in the query and joins whatever the caller
passed onto it with `&`; a caller who passes nothing gets `.task.status=open`.
That default names `.task.status` rather than `.status` because a graph that
also keeps transcripts has a `session.status`, and a bare `.status` would be
ambiguous there.

These tools write components other packages own — `doc{title, body}` and
`filed{…}` — which is deliberate. A tool returns bundles, and a bundle is plain
data, so naming a neighbour's component costs no import; a server that composes
neither package simply has those columns dropped when the write is admitted.

There is no `task show`, no `task search` and no `task tree` here. Showing an
entity whole is `graph_show` and ranked text search is `search`, both in
@yaks/mcp's generic tier, over any vocabulary at all; a second name for either
would be two implementations of one thing. A plan is the same story: it is a
list of bundles applied in one transaction, and `graph_apply` with `check`
rehearses it before it is written.

## The board guard

It lives in [@yaks/project](../project), beside the `board` it guards. A board
whose query would quietly match nothing is refused when it is written, because
an empty board looks exactly like a board whose filter is right and whose answer
happens to be nothing. That package registers a `precondition` hook that catches
both ways a query can be wrong:

- **Routing** — `.staus=open` names no column.
- **Members** — `.status=complete` names no status.

The refusal happens inside the transaction, so nothing in that `apply()` call is
written. Writing `task.status` needs no refusal: @yaks/graph's `admit` phase
drops a computed column before the hook ever sees it.

## Integration

One of the domain plugins over [@yaks/graph](https://jsr.io/@yaks/graph),
alongside [@yaks/member](https://jsr.io/@yaks/member) and others. It composes
with [@yaks/edge](https://jsr.io/@yaks/edge) for the two relations,
[@yaks/sql](https://jsr.io/@yaks/sql) for the derived status in a database, and
[@yaks/match](https://jsr.io/@yaks/match) for the same status in memory.

## Compatibility

Runs on Deno, Node, browsers and Cloudflare Workers — it imports no platform
API.

## Interface

`taskDoc`, `tasks`, `MARKS`, `Mark`, `Status`, `OPEN`, `statuses`, `declared`,
`settled`, `statusOf`, `compute`, `derived`, `gated`, `openDeps`, `done`, and
the component-name constants.
