# @yaks/task

Task components and operations for [@yaks/graph](../graph). The package defines
open, completed and cancelled tasks, records completion attribution, counts
unfinished dependencies, and supplies create, list and update tools.

A task is an entity with a `task` component. It can also carry a title from
[@yaks/doc](../doc), filing information from [@yaks/project](../project), or
components your application defines.

## Install

```sh
deno add jsr:@yaks/task
# or: npx jsr add @yaks/task
```

The examples also use `@yaks/graph`, `@yaks/vocab`, `@yaks/ram`, `@yaks/doc` and
`@yaks/edge`.

## What it is

The package declares these stored components:

| Component                        | Meaning                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `task{}`                         | Identifies an entity as a task.                                              |
| `completed{at, by, via}`         | Records when the task finished, who finished it and the source of the write. |
| `cancelled{at, by, via, reason}` | Records cancellation and an optional reason.                                 |
| `blocked{on, since}`             | Describes an external obstacle; `since` is declared server-owned.            |
| `accept{body}`                   | Describes the conditions for completion.                                     |
| `requires{}`, `contains{}`       | Relation components on an `edge{from, to}` entity.                           |

`task.status` is computed from component presence; it is never stored. The first
matching entry in `MARKS` wins: `cancelled` means `cancelled`, otherwise
`completed` means `done`, otherwise a task is `open`. An entity without `task`
has no task status. If both completion and cancellation are present,
cancellation takes precedence.

This package does not open or own storage. The graph's storage adapter keeps
these components, using memory, SQLite or another supported backend. References
from completion and cancellation records remain as history when the referenced
entity is deleted. `accept.body` is declared for blob storage; composing
[@yaks/blob](../blob) supplies that behavior.

Project, priority, domain and assignee are columns on `filed`, which belongs to
[@yaks/project](../project). That package also owns `board{query}`, a saved
query whose results determine board membership. Neither filing nor a board is
required to create a task.

## Use

A **bundle** is one entity's components as a JSON object. A **batch** is a list
of changes applied in one transaction. This complete example creates two tasks
and their dependency in an in-memory graph:

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { openDeps, statusOf, taskDoc, tasks } from '@yaks/task'

let vocab = loadVocab([docDoc, edgeDoc, taskDoc], [edgeKeywords])
let storage = ram(vocab)
let g = graph({ storage, vocab, plugins: [edges(vocab), tasks()] })

await g.apply([
  { entity: { eid: 't1' }, task: {}, doc: { title: 'Buy the cake' } },
  { entity: { eid: 't2' }, task: {}, doc: { title: 'Book the room' } },
  link('t1', 'requires', 't2'),
])
console.log(await openDeps(storage, 't1')) // 1

await g.apply([{ entity: { eid: 't2' }, completed: {} }])
let [room] = await g.read('.completed')
console.log(statusOf(room)) // done
console.log(await openDeps(storage, 't1')) // 0

await g.apply([{ entity: { eid: 't2' }, completed: null }]) // reopen
```

Write `completed: {}` to finish a task. The graph fills the server-owned `at`,
`by` and `via` fields from its clock and the batch's `$actor`; an anonymous
write has no actor identity to record. Client-supplied values for those fields
are dropped. Trusted server writes may supply them. The `tasks()` plugin
preserves the original completion author when an existing completion is edited.
To attribute a new completion, supply an authenticated actor:

```ts
await g.apply([{
  entity: { eid: 't2' },
  completed: {},
  $actor: { by: 'dana' },
}])
```

Code accepting remote requests must authenticate that identity and replace any
actor supplied by the client.

## A plan is one list of bundles

Create related tasks together by putting their bundles and edge bundles in one
batch. An id beginning with `$` is a temporary alias resolved during `apply()`.
Give each new edge an alias too: the edge plugin derives its final id after
resolving its endpoints. Use `link()` only when the endpoint ids are already
known, because it computes the edge id immediately.

Using `g` from the preceding example:

```ts
let plan = [
  { entity: { eid: '$goal' }, task: {}, doc: { title: 'Organize the event' } },
  { entity: { eid: '$step' }, task: {}, doc: { title: 'Choose the date' } },
  {
    entity: { eid: '$dependency' },
    edge: { from: '$goal', to: '$step' },
    requires: {},
  },
]

let preview = await g.apply(plan, { check: true })
let written = await g.apply(plan)
```

A dry run returns the proposed changes with resolved ids, then rolls back the
transaction. It runs admission, preconditions and rules, but keeps no entity or
journal writes and runs no post-commit effects. Invalid changes still fail. Ids
generated during a preview are not reserved for a later write. The HTTP form is
`POST /apply?check=1`; the CLI form is `yak apply --dry-run`.

## The status rule is written once

The same ordered list of marks supplies three ways to read status:

```ts
import { compute, derived, statusOf } from '@yaks/task'

statusOf({ entity: { eid: 't1' }, task: {} }) // open
derived() // SQL expressions for @yaks/sql's derived option
compute() // per-bundle readers for @yaks/match's computed option
```

Configure the evaluator used by your storage when filtering on `.task.status`.
Calling `tasks()` alone does not register these readers. For example, filter
already-loaded bundles with `@yaks/match`:

```ts
import { matcher } from '@yaks/match'

let open = matcher('.task.status=open', vocab, { computed: compute() })
console.log(open(await g.read('.task')))
```

Applications can extend the ordered list. A `claim` component can indicate work
in progress without counting as completion:

```ts
import { MARKS } from '@yaks/task'

let marks = [...MARKS, { status: 'wip', comp: 'claim', settled: false }]
// Pass marks to statusOf(), derived(), compute(), openDeps() and done().
```

For dependency helpers, pass `{ marks }` as their third argument. Declare the
additional component and status values in the vocabulary too.
[@yaks/session](../session) provides the `claim` component and an extended SQL
status definition through `@yaks/session/vocab`; plugin assembly loads that
definition after `@yaks/task/vocab`.

## Blocked is not a status

`blocked{on}` describes an external obstacle independently of status. Adding it
to an open task leaves the task open. `gated(bundle)` tests for the component's
presence.

`openDeps(storage, eid, options?)` follows outgoing `requires` and `contains`
links and counts distinct direct endpoints that are unfinished. Cancelled and
completed tasks both count as settled. Missing endpoints and entities without
`task` remain counted. It does not recursively inspect descendants.

`done(storage, eid, options?)` returns true only when the entity is a settled
task and has no unfinished direct dependencies. Both helpers accept
`{ marks, relations }` to override the status definitions or relation names.
They return values with synchronous storage and promises with asynchronous
storage. A UI can display the dependency count as "3 left" and omit zero; this
package does not render it.

## The three tools

`@yaks/task/tools` exports `runs()`, which supplies implementations for the
three tool declarations in `taskDoc`. A server that loads these tools exposes
them through CLI or MCP:

```sh
yak task new 'Buy the cake' --project P-19 --priority 1
yak task list '.filed.project=P-19&.priority<3'
yak task update T-42 done
```

| MCP name      | Behavior                                                            |
| ------------- | ------------------------------------------------------------------- |
| `task_new`    | Returns a new task, its supplied title/body, and any filing fields. |
| `task_list`   | Reads matching task bundles; it does not write them.                |
| `task_update` | Returns patches for supplied status, text and filing fields.        |

The tool runner commits results from the write tools. `done` adds `completed`
and removes `cancelled`; `cancelled` does the reverse; `open` removes both.
Omitted arguments leave existing values unchanged.

`task_list` always includes `.task`, combines it with the caller's query using
`&`, and defaults to `.task.status=open`. The qualified status name avoids
ambiguity with components such as `session.status`. Its storage must support
that computed status, as described above.

The tools can write `doc` and `filed` without importing their packages because
bundles are plain data. Load `@yaks/doc` and `@yaks/project` to retain those
components: graph admission drops undeclared components. An unknown column on a
declared component is refused instead.

Showing a complete entity uses the generic `graph_show` tool. Ranked search uses
`search` when the server supplies a search implementation. Applying a plan uses
`graph_apply`, whose `check` option previews it. This package supplies no
separate show, search or tree tool.

## The board guard

[@yaks/project](../project) validates saved board queries in a `precondition`
hook. It rejects unknown columns such as `.staus=open` and unsupported status
values such as `.status=complete`. A refusal rolls back the whole batch. Writing
`task.status` itself does not set status: graph admission drops computed columns
before that hook runs.

## Integration

Use [@yaks/edge](../edge) for dependency relations, [@yaks/project](../project)
for filing and boards, and [@yaks/sql](../sql) or [@yaks/match](../match) for
status filtering. The task package supplies no database, transport or UI.

## Compatibility

Pure TypeScript with no platform API imports. It can run on Deno, Node, browsers
and Cloudflare Workers with suitable storage and package resolution.

## Interface

| Import path        | Exports                                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/task`       | `taskDoc`, `tasks`, `MARKS`, `OPEN`, `statuses`, `declared`, `settled`, `statusOf`, `compute`, `derived`, `gated`, `openDeps`, `done`; types `Mark`, `Status`, `Compute`, `DepOpts`; constants `TASK`, `COMPLETED`, `CANCELLED`, `BLOCKED`, `REQUIRES`, `CONTAINS`. |
| `@yaks/task/vocab` | `taskDoc`, `docs`, and the default SQL `derived()` definitions.                                                                                                                                                                                                     |
| `@yaks/task/rules` | `rules()`, returning the task graph plugin in an array.                                                                                                                                                                                                             |
| `@yaks/task/tools` | `runs()`, status patches in `marked`, and the query-building helper `listing()`.                                                                                                                                                                                    |
