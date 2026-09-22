// What anybody may ask of a to-do list: the module a server imports as
// `@yaks/task/tools` — the implementations behind the three declarations marked
// `tool: true` in ./vocab.json. These are the three commands a person types all
// day.
//
// They write components that are not this package's, and that is the point: a
// task with a title carries @yaks/doc's `doc`, and one filed in a portfolio
// carries @yaks/project's `filed`. A tool returns bundles, which are plain
// data, so naming a neighbour's component costs no import — and a server that
// composes neither package simply has those columns dropped when the write is
// admitted.
//
// There is no `task show`, no `task search` and no `task tree` here. Showing an
// entity whole is `graph_show`, and ranked text search is `search`; both are in
// @yaks/mcp's generic tier and work over any vocabulary at all, so a second
// name for either would be two implementations of one thing. A plan is the same
// story: a tree is a list of bundles — tasks under `$alias` ids, and the links
// between them, whose ids are derived from their two ends and the relation
// (@yaks/edge) — applied in one transaction, and `graph_apply` with `check`
// rehearses it before it is written. See the README.

import { addressed, type Bundle, type Comp, type ToolCtx } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'

// Where the work is filed, as arguments. The two that name an entity are
// resolved to eids by `addressed`; a person types `P-19`, never an eid.
let PLACES = ['project', 'assignee', 'priority', 'domain'] as const
let REFS = new Set(['project', 'assignee'])

let filedIn = async (ctx: ToolCtx): Promise<Comp | undefined> => {
  let said = PLACES.filter((k) => ctx.args[k] != null)
  if (!said.length) return undefined
  let refs = said.filter((k) => REFS.has(k))
  let at = await addressed(ctx.graph, refs.map((k) => String(ctx.args[k])))
  let filed: Comp = {}
  for (let k of said) {
    filed[k] = REFS.has(k)
      ? at[refs.indexOf(k)]
      : k == 'priority'
      ? Number(ctx.args[k])
      : String(ctx.args[k])
  }
  return filed
}

// The text a person reads, as arguments. An argument nobody passed is left out
// of the patch, so the stored title stays as it was instead of being blanked —
// writing `null` is what clears a column.
let docIn = (ctx: ToolCtx): Comp | undefined => {
  let doc: Comp = {}
  if (ctx.args.title != null) doc.title = String(ctx.args.title)
  if (ctx.args.body != null) doc.body = String(ctx.args.body)
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
 * work around. A caller's own query is passed through as typed.
 */
export let listing = (query?: unknown, limit?: unknown): string => {
  let said = String(query ?? '').trim()
  return [
    '.task',
    said || '.task.status=open',
    ...(limit == null ? [] : [`.limit=${Number(limit)}`]),
  ].join('&')
}

/** The implementations behind the tools ./vocab.json declares. It is a factory,
 * like every subpath export in these packages, though this one needs nothing
 * from the server: everything a call reads arrives on the call's own context. */
export let runs = (): Runs => ({
  task_new: async (_bundles, ctx): Promise<Bundle[]> => {
    let filed = await filedIn(ctx)
    let doc = docIn(ctx)
    return [{
      entity: { eid: '$task' },
      task: {},
      ...(doc ? { doc } : {}),
      ...(filed ? { filed } : {}),
    }]
  },

  task_list: (_bundles, ctx) =>
    ctx.read(listing(ctx.args.query, ctx.args.limit)),

  task_update: async (_bundles, ctx): Promise<Bundle[]> => {
    let [eid] = await addressed(ctx.graph, [String(ctx.args.task)])
    let filed = await filedIn(ctx)
    let doc = docIn(ctx)
    return [{
      entity: { eid },
      ...(ctx.args.status ? marked[String(ctx.args.status)] : {}),
      ...(doc ? { doc } : {}),
      ...(filed ? { filed } : {}),
    }]
  },
})
