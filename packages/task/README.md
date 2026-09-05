# @yaks/task

A to-do list as a component domain for a
[@yaks/graph](https://jsr.io/@yaks/graph).

## Install

```sh
deno add jsr:@yaks/task
# or: npx jsr add @yaks/task
```

## What it is

Say a team keeps a list of what it has to do. Four questions come up, and this
package is the four answers.

**What is on the list?** An entity carrying `task{status, priority, project}` is
a to-do item. It is a facet, not a record — the same entity carries your `doc`,
your `estimate`, whatever else it is. Adding `task` to something makes it
something to do without making it stop being what it was.

**Where does it stand?** Nowhere in a column. A task wearing `completed` is
done, one wearing `cancelled` is cancelled, and one wearing neither is open.
`status` is computed from those marks, so finishing something records _when_ and
_by whom_, and un-finishing it is dropping a component rather than guessing what
the status used to say.

**How do you look at the list?** A `board{query}` is a saved filter. Membership
is never stored — nothing anywhere says "this task is on that board" — so a
board is always current, and a task that starts matching is simply on it. The
empty query selects nothing, on purpose.

**What is it waiting for?** `requires` and `contains` relate one task to another
through [@yaks/edge](https://jsr.io/@yaks/edge), and `blocked{on}` says
something outside the list is in the way.

## Use

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { taskDoc, tasks } from '@yaks/task'

let vocab = loadVocab([edgeDoc, taskDoc, mine], [edgeKeywords])
let g = graph({ storage, vocab, plugins: [edges(vocab), tasks(vocab)] })

g.apply([
  {
    entity: { eid: 't1' },
    doc: { title: 'Buy the cake' },
    task: { priority: 1 },
  },
  {
    entity: { eid: 't2' },
    doc: { title: 'Book the room' },
    task: { priority: 0 },
  },
  link('t1', 'requires', 't2'),
  {
    entity: { eid: 'b1' },
    doc: { title: 'Up next' },
    board: { query: '.status=open&.order=priority' },
  },
])
```

Finish one by writing the mark, never the word:

```ts
g.apply([{
  entity: { eid: 't2' },
  completed: { at: new Date().toISOString(), by: dana },
}])
```

## The status rule is said once

`task.status` is declared `persist: false` — no column holds it. Its value is
the first mark the task wears, and that one ordered list is what all three
readers are built from:

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
import { MARKS, tasks } from '@yaks/task'

let marks = [...MARKS, { status: 'wip', comp: 'claim', settled: false }]
// tasks(vocab, marks), derived(marks), compute(marks), statusOf(b, marks)
```

`settled: false` is what says a lease means somebody is _on_ it, not that they
finished it — so it still counts as work left.

## Blocked is not a status

There is no `blocked` status, and that is a decision rather than an omission. A
blocked task is still open work: rolling it into the status would hide it from
every query for open work exactly when somebody needs to see it.

So the two questions stay apart, and they read differently:

```ts
import { gated, openDeps } from '@yaks/task'

gated(bundle) // something OUTSIDE is in the way — an alarm
openDeps(storage, 't1') // how many children are unfinished — a count
```

`openDeps` follows `requires` and `contains` and counts what has not settled. A
task with three unfinished children is a task in progress, not a task in
trouble: it renders as "3 left", and zero renders as nothing at all. A child
that is not a task cannot settle, so it stays counted.

## The board guard

A board that would quietly match nothing is refused when it is written, because
an empty board looks exactly like a board whose filter is right and whose answer
happens to be nothing. The plugin registers a `precondition` hook that catches
both ways a query is wrong:

- **Routing** — `.staus=open` names no column.
- **Members** — `.status=complete` names no status.

The refusal happens inside the transaction, so the whole batch rolls back.
Writing `task.status` needs no refusal: `@yaks/graph`'s `admit` phase drops a
computed column before the hook ever sees it.

## Where it sits

One of the domain plugins over [@yaks/graph](https://jsr.io/@yaks/graph),
alongside [@yaks/member](https://jsr.io/@yaks/member) and others. It composes
with [@yaks/edge](https://jsr.io/@yaks/edge) for the two relations,
[@yaks/sql](https://jsr.io/@yaks/sql) for the derived status in a database, and
[@yaks/match](https://jsr.io/@yaks/match) for the same status in memory.

## Compatibility

Runs on Deno, Node, browsers and Cloudflare Workers — it imports no platform
API.

## Interface

`taskDoc`, `tasks`, `MARKS`, `Mark`, `Status`, `OPEN`, `statuses`, `settled`,
`statusOf`, `compute`, `derived`, `unroutable`, `guarding`, `gated`, `openDeps`,
and the component-name constants.
