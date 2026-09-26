// What anybody may ask of a to-do list: the module a server imports as
// `@yaks/task/tools` — the implementations behind the three declarations marked
// `tool: true` in ./vocab.json. These are the three commands a person types all
// day.
//
// They write components that are not this package's, and that is the point: a
// task with a title carries @yaks/doc's `doc`, and one filed in a portfolio
// carries @yaks/project's `filed`. A tool returns bundles, which are plain
// data, so naming a neighbour's component costs no import — and a server that
// composes neither package refuses the write, naming the component it does not
// know.
//
// There is no `task show`, no `task search` and no `task tree` here. Showing an
// entity whole is `graph_show`, and ranked text search is `search`; both are in
// @yaks/mcp's generic tier and work over any vocabulary at all, so a second
// name for either would be two implementations of one thing. A plan is the same
// story: a tree is a list of bundles — tasks under `$alias` ids, and the links
// between them, whose ids are derived from their two ends and the relation
// (@yaks/edge) — applied in one transaction, and `graph_apply` with `check`
// rehearses it before it is written. See the README.

import { argsOf, type Bundle, type Comp } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'

// Where the work is filed, as arguments. The two that name an entity arrive
// as eids: a person types `P-19`, and the runner resolves every argument the
// declaration marks `ref` before a tool sees it (@yaks/tools).
let PLACES = ['project', 'assignee', 'priority', 'domain'] as const

let filedIn = (args: Record<string, unknown>): Comp | undefined => {
  let said = PLACES.filter((k) => args[k] != null)
  if (!said.length) return undefined
  return Object.fromEntries(
    said.map((k) => [k, k == 'priority' ? Number(args[k]) : String(args[k])]),
  )
}

// The text a person reads, as arguments. An argument nobody passed is left out
// of the patch, so the stored title stays as it was instead of being blanked —
// writing `null` is what clears a property.
let docIn = (args: Record<string, unknown>): Comp | undefined => {
  let doc: Comp = {}
  if (args.title != null) doc.title = String(args.title)
  if (args.body != null) doc.body = String(args.body)
  return Object.keys(doc).length ? doc : undefined
}

/**
 * A status, as the marks that mean it. Nothing writes `task.status` — it is
 * computed from these — so moving a task means adding one mark and removing
 * the other, which is why finishing something records when and by whom instead
 * of overwriting a value.
 */
export let marked: Record<string, Record<string, Comp | null>> = {
  open: { completed: null, cancelled: null },
  done: { completed: {}, cancelled: null },
  cancelled: { cancelled: {}, completed: null },
}

/**
 * The query a listing runs, with `.task` always part of it.
 *
 * The default names `.task.status`, not `.status`: a graph that also keeps
 * transcripts has a `session.status` too, so a bare `.status` there would be
 * ambiguous — the query grammar reporting a genuine ambiguity, not a bug to
 * work around. A caller's own query is passed through as typed, and every
 * task comes back whole (`*`): a listing shows tasks, not the words it matched.
 */
export let listing = (query?: unknown, limit?: unknown): string => {
  let said = String(query ?? '').trim()
  return [
    '.task',
    said || '.task.status=open',
    ...(limit == null ? [] : [`.limit=${Number(limit)}`]),
    '*',
  ].join('&')
}

/** The implementations behind the tools ./vocab.json declares. It is a factory,
 * like every subpath export in these packages, though this one needs nothing
 * from the server: everything a call reads arrives on the call it is handed. */
export let runs = (): Runs => ({
  task_new: (call): Bundle[] => {
    let args = argsOf(call)
    let filed = filedIn(args)
    let doc = docIn(args)
    return [{
      entity: { eid: '$task' },
      task: {},
      ...(doc ? { doc } : {}),
      ...(filed ? { filed } : {}),
    }]
  },

  task_list: (call, graph) =>
    graph.read(listing(argsOf(call).query, argsOf(call).limit)),

  task_update: (call): Bundle[] => {
    let args = argsOf(call)
    let filed = filedIn(args)
    let doc = docIn(args)
    return [{
      entity: { eid: String(args.task) },
      ...(args.status ? marked[String(args.status)] : {}),
      ...(doc ? { doc } : {}),
      ...(filed ? { filed } : {}),
    }]
  },
})
