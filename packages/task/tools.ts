// What anybody may ask of a to-do list: the `tools` facet a host takes
// (`@yaks/task/tools`) — the runs behind the `tool: true` declarations in
// ./vocab.json. These are the three words a person types all day.
//
// They write words that are not this package's, and that is the point: a task
// with a title wears @yaks/doc's `doc`, and one filed in a portfolio wears
// @yaks/project's `filed`. A tool answers BUNDLES, which are data — so naming
// a neighbour's component costs no import, and a host that composes neither
// simply has those columns dropped at the door.
//
// There is no `task show` and no `task search` here. Showing an entity whole
// is `graph_show` and ranked words are `search`, both in the generic tier
// (@yaks/mcp) over any vocabulary at all; a second spelling of either would be
// two shapes of one thing.

import { addressed, type Bundle, type Comp, type ToolCtx } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'

// Where the work is filed, as arguments. The two that name an entity are
// addressed; a person types `P-19`, never an eid.
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

// The words a person reads, as arguments. `null` clears a column, so a title
// nobody gave is left alone rather than blanked.
let docIn = (ctx: ToolCtx): Comp | undefined => {
  let doc: Comp = {}
  if (ctx.args.title != null) doc.title = String(ctx.args.title)
  if (ctx.args.body != null) doc.body = String(ctx.args.body)
  return Object.keys(doc).length ? doc : undefined
}

/**
 * A status, as the marks that MEAN it. Nothing writes `task.status` — it is
 * read off these — so moving a task is adding one mark and dropping the other,
 * which is why finishing something records when and by whom instead of
 * overwriting a word.
 */
export let marked: Record<string, Record<string, Comp | null>> = {
  open: { completed: null, cancelled: null },
  done: { completed: {}, cancelled: null },
  cancelled: { cancelled: {}, completed: null },
}

/**
 * The line a listing reads, with `.task` always on it.
 *
 * The default says `.task.status`, not `.status`: a graph that also keeps
 * transcripts has a `session.status` too, and a bare `.status` there is
 * ambiguous — which is the query grammar telling the truth, not a bug to work
 * around. A caller's own line is passed through as typed.
 */
export let listing = (query?: unknown, limit?: unknown): string => {
  let said = String(query ?? '').trim()
  return [
    '.task',
    said || '.task.status=open',
    ...(limit == null ? [] : [`.limit=${Number(limit)}`]),
  ].join('&')
}

/** The runs behind the tools ./vocab.json declares. A factory, as every facet
 * is, though this one needs nothing from the host: what a run reads arrives on
 * the call's own context. */
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
