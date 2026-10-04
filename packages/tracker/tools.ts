// Bug tools speak the same graph queries and mark patches as every other door.

import { argsOf, type Bundle, type Graph } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import {
  and,
  eq,
  every,
  limit,
  order,
  orderOf,
  parse,
  present,
} from '@yaks/query'
import { CallError } from '@yaks/tools'
import { str } from './model.ts'

let one = async (g: Graph, eid: string): Promise<Bundle> => {
  let [row] = await g.get([eid])
  if (!row?.bug) throw new CallError('bug', `not a bug: ${eid}`)
  return row
}
let mark =
  (name: string) => async (call: Bundle, g: Graph): Promise<Bundle[]> => {
    let bug = await one(g, str(argsOf(call).bug))
    return [{ entity: bug.entity, [name]: {} }]
  }
export let runs = (): Runs => ({
  bug_list: (call, g) => {
    let args = argsOf(call)
    let query = parse(str(args.query) || '.bug.status=open')
    return g.read(
      and(
        present('bug'),
        query,
        every(),
        ...orderOf(query) ? [] : [order('-bug.hits')],
        limit(Number(args.limit ?? 50)),
      ),
    )
  },
  bug_show: async (call, g) => {
    let bug = await one(g, str(argsOf(call).bug))
    return [
      bug,
      ...await g.read(
        and(eq('error.bug', bug.entity.eid), every(), order('-error.at')),
      ),
    ]
  },
  bug_resolve: mark('resolved'),
  bug_archive: mark('archived'),
})
