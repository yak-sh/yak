// What anybody may ask of a to-do list: the module a server imports as
// `@yaks/task/tools` — the implementations behind the declarations marked
// `tool: true` in ./vocab.json.
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
// name for either would be two implementations of one thing. task_new turns a
// compact plan into tasks and links in one transaction; graph_apply remains
// the door for arbitrary vocabulary.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { answer } from './decision.ts'
import { type Edit, edited, type Runs, type TextEdit } from '@yaks/graph/tools'
import { Refused } from '@yaks/graph/errors'
import { conjoin } from '@yaks/query'

// Where the work is filed, as arguments. The two that name an entity arrive
// as eids: a person types `P-19`, and the runner resolves every argument the
// declaration marks `ref` before a tool sees it (@yaks/tools).
let PLACES = ['project', 'assignee', 'priority', 'domain'] as const

// The text a person reads, as arguments. An argument nobody passed is left out
// of the patch, so the stored title stays as it was instead of being blanked —
// writing `null` is what clears a property.
let picked = (
  args: Record<string, unknown>,
  keys: readonly string[],
): Comp | undefined => {
  let said = keys.filter((key) => Object.hasOwn(args, key))
  return said.length
    ? Object.fromEntries(said.map((key) => [key, args[key]]))
    : undefined
}

let filedIn = (args: Record<string, unknown>): Comp | undefined =>
  picked(args, PLACES)
let docIn = (args: Record<string, unknown>): Comp | undefined =>
  picked(args, ['title', 'body'])

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
 * The default is `.task.status=open,wip`. A caller's own query is passed
 * through as typed and narrowed to tasks as a whole (`.a|.b` lists the tasks
 * that are either), and every task comes back whole (`*`): a listing shows
 * tasks, not the words it matched.
 */
export let listing = (query?: unknown, limit?: unknown): string =>
  conjoin(
    '.task',
    String(query ?? '').trim() || '.task.status=open',
    limit == null ? '' : `.limit=${Number(limit)}`,
    '*',
  )

type Args = Record<string, unknown>

let conditions = (args: Args): Record<string, Comp | null> => ({
  ...(Object.hasOwn(args, 'accept')
    ? { accept: args.accept == null ? null : { body: String(args.accept) } }
    : {}),
  ...(Object.hasOwn(args, 'blocked')
    ? { blocked: args.blocked == null ? null : { on: String(args.blocked) } }
    : {}),
  ...(Object.hasOwn(args, 'reason') &&
      (!args.status || args.status == 'cancelled')
    ? {
      cancelled: { reason: args.reason == null ? null : String(args.reason) },
    }
    : {}),
})

let fields = (args: Args): Record<string, Comp | null> => {
  let doc = docIn(args)
  let filed = filedIn(args)
  return {
    ...(args.status ? marked[String(args.status)] : {}),
    ...(doc ? { doc } : {}),
    ...(filed ? { filed } : {}),
    ...conditions(args),
  }
}

let plans = (args: Args): Bundle[] => {
  let tasks = args.tasks as Args[] | undefined
  let rows = tasks ?? [args]
  let named = rows.flatMap((item) => item.id ? [String(item.id)] : [])
  let used = new Set(named)
  if (used.size != named.length) {
    throw new Refused('Each task id must be distinct')
  }
  let fresh = (name: string): string => {
    while (used.has(name)) name += '-'
    used.add(name)
    return name
  }
  let ids = rows.map((item, i) =>
    String(item.id ?? fresh(tasks ? `$task-${i + 1}` : '$task'))
  )
  return rows.flatMap((item, i) => {
    let task = tasks ? { ...args, ...item } : item
    if (typeof task.title != 'string') {
      throw new Refused('Supply title, or tasks with a title each')
    }
    let eid = ids[i]
    if (!eid.startsWith('$')) {
      throw new Refused('A new task id must start with $')
    }
    let links = [
      ...(task.parent
        ? [{ from: String(task.parent), relation: 'contains', to: eid }]
        : []),
      ...((task.requires ?? []) as string[]).map((to) => ({
        from: eid,
        relation: 'requires',
        to,
      })),
    ]
    return [
      { entity: { eid }, task: {}, ...fields(task) },
      ...links.map(({ from, relation, to }, n) => ({
        entity: { eid: fresh(`$task-link-${i}-${n}`) },
        edge: { from, to },
        [relation]: {},
      })),
    ]
  })
}

let updates = async (args: Args, graph: Graph): Promise<Bundle[]> => {
  let items = args.updates as Args[] | undefined
  let edits: Edit[] = (items ?? [args]).map((item) => {
    let task = items ? { ...args, ...item } : item
    if (typeof task.task != 'string') {
      throw new Refused('Supply task, or updates with a task each')
    }
    let set = Object.fromEntries(
      Object.entries(fields(task)).flatMap(([comp, value]) =>
        value == null || !Object.keys(value).length
          ? [[comp, value]]
          : Object.entries(value).map(([prop, v]) => [`${comp}.${prop}`, v])
      ),
    )
    return {
      id: task.task,
      set,
      ...((Object.hasOwn(task, 'body') || task.edit) && task.was !== undefined
        ? { was: { 'doc.body': task.was as string | null } }
        : {}),
      ...(task.edit
        ? {
          text: [{
            was: task.was as string | null | undefined,
            ...(task.edit as TextEdit),
            path: 'doc.body',
          }],
        }
        : {}),
    }
  })
  return await edited(graph, edits)
}

/** The implementations behind ./vocab.json. Scalar changes are data; partial
 * text changes read through the graph and keep the shared compiler's guard. */
export let runs = (): Runs => ({
  decision_new: (call): Bundle[] => {
    let args = argsOf(call)
    let question = String(args.question).trim()
    let filed = filedIn(args)
    return [{
      entity: { eid: '$decision' },
      task: {},
      doc: { title: question },
      decision: {
        question,
        choices: args.choices,
        recommended: args.recommended,
      },
      ...(filed ? { filed } : {}),
    }]
  },

  decision_answer: (call): Bundle[] => {
    let args = argsOf(call)
    return answer(
      String(args.decision),
      String(args.choice),
      args.by as string | undefined,
    )
  },

  task_new: (call): Bundle[] => plans(argsOf(call)),

  task_list: (call, graph) =>
    graph.read(listing(argsOf(call).query, argsOf(call).limit)),

  task_update: (call, graph) => updates(argsOf(call), graph),
})
