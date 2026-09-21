// The implementations of the tools declared with `tool: true` in
// ./vocab.json, exported as `@yaks/project/tools` — the entry point a server
// imports to register them. Both are CHECKS: tools whose verb is `check`,
// which is all a "doctor" is (@yaks/tools ./check.ts).
//
// Two invariants, and both are about a portfolio quietly stopping being one:
//
// A BOARD IS ITS QUERY. ./guard.ts refuses an unroutable query as it is
// written, while whoever typed it is still there — but that is not the only way
// a query stops routing. The VOCABULARY moves: a column is renamed, a status
// retires, a component this server used to load is gone. Every board written
// against the old declarations now matches nothing and reports no error, which
// is exactly the failure the precondition hook exists to prevent, arriving from
// the other direction.
//
// GOVERNED WORK IS UNDER A PROJECT. `governed` is the keyword a component
// declares to mean that a project answers for the entities carrying it
// (@yaks/kernel): a task, a memory, a design. One that is filed under no
// project, and that no project reaches along a containment edge, is work
// nobody's portfolio can see — it is on no board, in nobody's queue, and
// nothing will ever report that it was dropped.

import { and, present } from '@yaks/query'
import { human } from '@yaks/id'
import { checked, type Finding } from '@yaks/tools'
import type { Bundle, Comp, ToolCtx } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import type { Vocab } from '@yaks/vocab'
import { BOARD, FILED, PROJECT } from './comp.ts'
import { unroutable } from './guard.ts'

/** The configuration `@yaks/project`'s checks accept. */
export type Options = {
  /** which relation tags mean containment, when working out whether a project
   * reaches something. The default is `contains` — @yaks/task's tag, and the
   * one the fleet graph uses — because a package cannot know what another
   * package named the edge meaning "part of". */
  through?: string[]
}

/** The containment relation tags assumed when configuration names none. */
let CONTAINS = ['contains']

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

// The components a project answers for, read off the loaded vocabulary rather
// than listed here: a server that loads another governed component gets it
// checked without an edit to this file.
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

/** The implementations of the tools ./vocab.json declares. The loaded
 * vocabulary is what a board's query routes through, and what declares which
 * components are governed, so both checks are built against the components this
 * graph actually has. */
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
