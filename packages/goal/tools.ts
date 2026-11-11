// What anybody may ask of a graph's goals: the module a server imports as
// `@yaks/goal/tools`, the implementations behind the declarations marked
// `tool: true` in ./vocab.json.
//
// A goal has no status, so there is no finishing one: work serves it, and
// says so with a `satisfies` link from the work to the goal. A goal's words
// are @yaks/doc's `doc` and its links are @yaks/edge's `edge`; a tool returns
// bundles, which are plain data, so naming them costs no import, and a server
// that composes neither refuses the write, naming the component it lacks.

import type { Bundle, Comp } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import type { Runs } from '@yaks/graph/tools'
import { conjoin } from '@yaks/query'

type Args = Record<string, unknown>

// What a call said of `keys`, as a patch of `comp`: an argument nobody passed
// is left out, so the stored value stays, and `null` clears it.
let said = (args: Args, comp: string, keys: string[]): Record<string, Comp> => {
  let given = keys.filter((k) => Object.hasOwn(args, k))
  return given.length
    ? { [comp]: Object.fromEntries(given.map((k) => [k, args[k]])) }
    : {}
}

// A `satisfies` link from each piece of work to the goal.
let serving = (args: Args, goal: string, prefix: string): Bundle[] =>
  ((args.satisfied_by ?? []) as string[]).map((from, n) => ({
    entity: { eid: `${prefix}-${n}` },
    edge: { from: String(from), to: goal },
    satisfies: {},
  }))

/**
 * The query a listing runs, with `.goal` always part of it and every goal
 * whole. A goal is never finished, so without a query it lists them all.
 */
export let listing = (query?: unknown, limit?: unknown): string =>
  conjoin(
    '.goal',
    String(query ?? '').trim(),
    limit == null ? '' : `.limit=${Number(limit)}`,
    '*',
  )

/** The implementations behind ./vocab.json. */
export let runs = (): Runs => ({
  goal_new: (call): Bundle[] => {
    let args = argsOf(call)
    let doc: Comp = { title: String(args.title) }
    if (args.body != null) doc.body = String(args.body)
    return [
      {
        entity: { eid: '$goal' },
        goal: args.scope == null ? {} : { scope: String(args.scope) },
        doc,
      },
      ...serving(args, '$goal', '$goal-link'),
    ]
  },

  goal_list: (call, graph) =>
    graph.read(listing(argsOf(call).query, argsOf(call).limit)),

  goal_update: (call): Bundle[] => {
    let args = argsOf(call)
    let goal = String(args.goal)
    let patch = {
      ...said(args, 'doc', ['title', 'body']),
      ...said(args, 'goal', ['scope']),
    }
    return [
      ...Object.keys(patch).length ? [{ entity: { eid: goal }, ...patch }] : [],
      ...serving(args, goal, '$goal-link'),
    ]
  },
})
