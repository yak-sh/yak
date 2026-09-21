# @yaks/project

The components that make a portfolio out of a graph of work: what a piece of
work is filed under, the filing itself, the saved filters you look at it
through, and the businesses being built. The tasks are [@yaks/task](../task)'s;
this package is what they are filed in.

- `project` — something work is grouped under. It is addressed by name as well
  as by id.
- `filed{project, priority, domain, assignee}` — the filing itself, kept
  separate from being a task so that a task can have none. `priority` orders a
  queue (lower is more urgent) and `domain` names the area of work.
  `filed.project` is a reference declared `death: detach`, so deleting a project
  frees its tasks instead of deleting them: they were filed under it, not about
  it.
- `board{query}` — a saved filter over the portfolio. A board is its query.
  Membership is never stored — there is no row saying this task is on that board
  — so a board is always current, and a task that starts matching is on it with
  nothing to reconcile. The empty query selects nothing, which is what a board
  nobody has written a filter for should show.
- `venture{phase, tagline, site}` — a business being built. It has a phase —
  incubating, building, live, shuttered — rather than a status, because nothing
  here is ever done.
- `paused{at}` — work on it is suspended. It is a separate component rather than
  a phase, so the phase underneath is untouched and resuming means removing the
  component; there is no `paused_from` column remembering where to put the phase
  back.
- `repo{repository, base_branch, gate, push}` — a project's policy for landing
  its source: which repository the work is in, which branch it branches from and
  lands into, the command a change must pass first (`gate`), and whether landing
  also pushes. The repository, its checkouts and its remote are
  [@yaks/git](../git)'s.

## The one piece of machinery: checking a board's query

`projects(vocab)` returns a graph plugin registering a `precondition` hook. It
runs inside the write transaction, before any row has changed, and refuses a
board whose query would quietly match nothing. Because a board is its query, an
empty board and a board with a typo in its filter look exactly alike — no error,
no empty state saying why, just a board that is always blank. Two ways a query
is wrong are caught:

- it names a column the vocabulary does not have (`.staus=open`);
- it names a status outside the closed set (`.status=complete`, where @yaks/task
  declares `done`, `cancelled` and `open`).

The set of statuses a board may name comes from the loaded vocabulary — every
package's `statuses` enum, read as a union — so a graph that also loads
[@yaks/session](../session)'s claim gets `wip` in the check by composing it, and
one without leases knows only the three @yaks/task declares. Pass `marks` to
`projects(vocab, marks)` to check against exactly that list instead.

The empty query is still allowed, and `task.status` needs no check here: it is
declared `computed: true`, and @yaks/graph drops a computed column before this
hook sees the write.

## Two checks

`@yaks/project/tools` implements the two tools this package declares, both
read-only, both named with the verb `check` — which is all a "doctor" is
(@yaks/tools):

- `board_check` reads every saved board query and reports the ones that no
  longer route. The hook above refuses a bad query while the person who typed it
  is still there, but a vocabulary moves: a column is renamed, a status retires,
  a component this server used to load is gone. Every board written against the
  old declarations now matches nothing and reports no error — the same failure,
  arriving from the other direction.
- `project_check` reports governed entities that no project can reach. A
  component declaring the `governed` keyword ([@yaks/kernel](../kernel)) is one
  a project answers for: a task, a memory, a design. The check walks out from
  the projects and from everything filed under one, following containment edges
  (`contains` by default; set `through` in config for other relation tags), and
  anything it does not reach is work nobody's portfolio holds — it is on no
  board, in nobody's queue, and nothing will ever report that it was dropped.

## Compatibility

Deno and Node. The vocabulary is a JSON document with no runtime calls; the
plugin and the two checks need a loaded vocabulary and a graph.
