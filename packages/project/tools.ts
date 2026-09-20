// What an agent may ASK for here: the `tools` facet a host takes
// (`@yaks/project/tools`) — the runs behind the `tool: true` declarations in
// ./vocab.json. Both are CHECKS: tools whose verb is `check`, which is the
// whole of what a "doctor" is (@yaks/tools ./check.ts).
//
// Two invariants, and both are about a portfolio quietly stopping being one:
//
// A BOARD IS ITS QUERY. ./guard.ts refuses an unroutable query at the door,
// while whoever typed it is still there — but the door is not the only way a
// query stops routing. The VOCABULARY moves: a column is renamed, a status
// word retires, a component this host used to compose is gone. Every board
// written against the old words is now a board that matches nothing and never
// says why, which is exactly the failure the guard exists to prevent, arriving
// from the other direction.
//
// GOVERNED WORK IS UNDER A PROJECT. `governed` is the kernel keyword a
// component wears to say a project answers for its entities (@yaks/kernel):
// a task, a memory, a design. One that is filed under no project and hangs off
// no project's containment is work nobody's portfolio can see — it does not
// show on a board, it is not in anybody's queue, and nothing ever says it was
// dropped.

import { and, present } from '@yaks/query'
import { human } from '@yaks/id'
import { checked, type Finding } from '@yaks/tools'
import type { Bundle, Comp, ToolCtx } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import type { Vocab } from '@yaks/vocab'
import { BOARD, FILED, PROJECT } from './comp.ts'
import { unroutable } from './guard.ts'

/** What a config says to `@yaks/project`'s checks. */
export type Options = {
  /** which relation tags carry containment, for reading whether a project
   * reaches a thing. The default is `contains` — @yaks/task's word, and the
   * one a fleet graph uses — because a package cannot know what another
   * package called the edge that means "part of". */
  through?: string[]
}

/** The containment relations this host links with. */
let CONTAINS = ['contains']

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

// The components a project answers for, read off the loaded vocabulary rather
// than listed here: a host that composes another governed word gets it watched
// without touching this file.
let governedIn = (v: Vocab): string[] =>
  v.all.filter((name) => v.comp(name)?.keywords.governed === true)

// Everything a project can see: the projects themselves, whatever is filed
// under one, and whatever those reach along the containment edges. A cycle of
// orphans looks internally connected, so reachability is only meaningful from
// the project seed — which is the whole reason this is a walk and not a column
// read.
let reached = async (
  ctx: Pick<ToolCtx, 'read'>,
  through: string[],
): Promise<Set<string>> => {
  let seeds = [
    ...await ctx.read(and(present(PROJECT))),
    ...await ctx.read(and(present(`${FILED}.project`))),
  ]
  let links = (await ctx.read(and(present('edge'))))
    .filter((b) => through.some((tag) => tag in b))
  let out = new Map<string, string[]>()
  for (let b of links) {
    let e = comp(b, 'edge')
    if (!e?.from || !e?.to) continue
    out.set(String(e.from), [...out.get(String(e.from)) ?? [], String(e.to)])
  }
  let seen = new Set(seeds.map((b) => b.entity.eid))
  let front = [...seen]
  while (front.length) {
    let here = front.pop()!
    for (let there of out.get(here) ?? []) {
      if (seen.has(there)) continue
      seen.add(there)
      front.push(there)
    }
  }
  return seen
}

/** The runs behind the tools ./vocab.json declares. The host's vocabulary is
 * what a board's query routes through and what says which words are governed,
 * so both checks are built against the words this host actually speaks. */
export let runs = (
  host: { vocab: Vocab },
  options: Options = {},
): Runs => ({
  board_check: async (_bundles, ctx) => {
    let id = human(host.vocab)
    let found = (await ctx.read(and(present(`${BOARD}.query`))))
      .flatMap((b): Finding[] => {
        let query = String(comp(b, BOARD)?.query ?? '')
        let why = query.trim() && unroutable(query, host.vocab)
        return why
          ? [{
            level: 'fail',
            text: `${id(b)} no longer routes (${why}): ${query}`,
          }]
          : []
      })
    return checked(ctx.call, 'every saved board query still routes', found)
  },

  project_check: async (_bundles, ctx) => {
    let id = human(host.vocab)
    let seen = await reached(ctx, options.through ?? CONTAINS)
    let found: Finding[] = []
    for (let word of governedIn(host.vocab)) {
      for (let b of await ctx.read(and(present(word)))) {
        if (seen.has(b.entity.eid)) continue
        found.push({
          level: 'fail',
          text: `${id(b)} (${word}) is under no project — nobody's portfolio ` +
            `holds it, so nothing will ever say it was dropped`,
        })
      }
    }
    return checked(
      ctx.call,
      'every governed entity is reachable from a project',
      found,
    )
  },
})
