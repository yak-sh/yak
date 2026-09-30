# @yaks/project

Organize graph entities into projects, assign priorities and people, save query
filters as boards, and record a business's phase and repository policy. Tasks
belong to [@yaks/task](../task); this package declares their optional project
metadata. Data lives in the graph you provide, with no separate database.

```sh
deno add jsr:@yaks/project
```

## Stored components

- `project` — something work is grouped under. It is addressed by name as well
  as by id.
- `filed{project, priority, domain, assignee}` — the filing itself, kept
  separate from being a task so that a task can have none. `priority` orders a
  queue (lower is more urgent) and `domain` names the area of work.
  `filed.project` is a reference declared `death: detach`, so deleting a project
  removes that reference instead of deleting the tasks. A project filed under
  another project is its sub-project (below).
- `board{query}` — a saved filter over the portfolio. A board is its query.
  Membership is never stored — there is no row saying this task is on that board
  — so a board is always current, and a task that starts matching is on it with
  nothing to reconcile. The empty query selects nothing, which is what a board
  nobody has written a filter for should show.
- `venture{phase, tagline, site}` — a business being built. It has a phase —
  `building`, `launching` or `live` — separate from a task's completion status.
  A venture put away for good wears [@yaks/kernel](../kernel)'s `archived`.
- `paused{at}` — work on it is suspended. It is a separate component rather than
  a phase, so the phase underneath is untouched and resuming means removing the
  component; there is no `paused_from` property remembering where to put the
  phase back.
- `repo{repository, base_branch, gate, push}` — a project's policy for landing
  its source: which repository the work is in, which branch it branches from and
  lands into, the command a change must pass first (`gate`), and whether landing
  also pushes. The repository, its checkouts and its remote are
  [@yaks/git](../git)'s. A sub-project without a `repo` lands through the
  nearest project above it that has one.

## Sub-projects

A project filed under another project is its sub-project: its parent is its own
`filed.project`, the property that files a task under it. A property holds one
value, so a project has at most one parent. Everything under a project, at any
depth, is one walk in the query grammar:

- `.filed.project->P-19` — what is filed under P-19, its sub-projects, what is
  filed under those, and so on down;
- `.task .filed.project->P-19` — the tasks among them, which is what a board
  rolling up a project's work says;
- `.filed.project=P-19` — only what is filed directly under it.

`lineage(g, eid)` reads the other way: the projects an entity is under, nearest
first — the entity itself when it is a project, then each `filed.project` above
it. It is how a sub-project finds the `repo` it lands through and the common
personas its agents are owed ([@yaks/persona](../persona)). The plugin refuses a
project filed under itself or under a project already under it, so the projects
form a tree.

## Checking a board's query

`projects(vocab)` returns a graph plugin registering a `precondition` hook. It
runs inside the write transaction, before any row has changed, and rejects a
board query with an unknown property or task status. It does not reject a valid
query merely because no current records match. Because a board is its query, an
empty board and a board with a typo in its filter look exactly alike — no error,
no empty state saying why, just a board that is always blank. Two ways a query
is wrong are caught:

- it names a property the vocabulary does not have (`.staus=open`);
- it names a status outside the closed set (`.status=complete`, where @yaks/task
  declares `done`, `cancelled` and `open`).

The set of statuses a board may name is the ladder the loaded vocabulary
declares (@yaks/vocab's `status` keyword), so a graph that also loads
[@yaks/session](../session) gets `wip` in the check by composing it, and one
without leases knows only the three @yaks/task declares.

The empty query is still allowed, and `task.status` needs no check here: it is
declared `computed: true`, and @yaks/graph drops a computed property before this
hook sees the write.

## Two checks

`@yaks/project/tools` implements the two tools this package declares, both
read-only, both declared with the verb `check` so @yaks/tools can discover them:

- `board_check` reads every saved board query and reports the ones that refer to
  unknown properties or task statuses. The hook above refuses a bad query while
  the person who typed it is still there, but loaded schemas can change: a
  property can be renamed, a status removed, or a component no longer loaded.
  The check detects invalid saved queries even when no one is writing the board.
- `project_check` reports governed entities that no project can reach. A
  component declaring the `governed` keyword ([@yaks/kernel](../kernel)) is one
  a project answers for: a task, a memory, a design. The check walks out from
  the projects and from everything filed under one, following containment edges
  (`contains` by default; set `through` in config for other relation tags), and
  reports governed entities it does not reach. This detects missing project
  associations; it does not imply that those entities are invisible to every
  possible board query.

## Use and exports

A bundle is a JSON object containing one entity's components. This example
stores a project and a saved board in RAM and enables query validation:

```ts
import { docDoc } from '@yaks/doc'
import { graph } from '@yaks/graph'
import { projectDoc, projects } from '@yaks/project'
import { ram } from '@yaks/ram'
import { taskDoc } from '@yaks/task'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab([docDoc, taskDoc, projectDoc])
let g = graph({ storage: ram(vocab), vocab, plugins: [projects(vocab)] })
await g.apply([
  { entity: { eid: 'website' }, project: {}, doc: { title: 'Website' } },
  {
    entity: { eid: 'website-board' },
    board: { query: '.filed.project=website' },
    doc: { title: 'Website work' },
  },
])
```

- `@yaks/project`: `projectDoc`, `PROJECT`, `FILED`, `BOARD`, `VENTURE`,
  `projects(vocab)`, `guarding(vocab)`, `unroutable(query, vocab)` (a diagnostic
  string or `null`), `lineage(g, eid)`, and `nesting` (the hook keeping projects
  a tree).
- `@yaks/project/vocab`: schema documents in `docs`.
- `@yaks/project/rules`: `rules(host)` supplies the validation plugin.
- `@yaks/project/tools`: `runs(host, options)` supplies the two checks above;
  `options.through` chooses containment relation tags.

Here `host` is the process that opened the graph; these factories need its
loaded vocabulary. A schema keyword is metadata on a declaration: `governed`
identifies components the project check should examine, and must be loaded
through @yaks/kernel's `kernelKeywords` (imported from `@yaks/kernel`).

## Compatibility

Deno and Node. The vocabulary is a JSON document with no runtime calls; the
plugin and the two checks need a loaded vocabulary and a graph.
