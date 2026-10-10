// Bug tools speak the same graph queries and mark patches as every other door.

import { argsOf, type Bundle, type Graph, referenced } from '@yaks/graph'
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
import { type Options, routes } from './routes.ts'

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
export let runs = (
  host: unknown = {},
  options: Options = {},
  go: typeof fetch = fetch,
): Runs => {
  let remote = async (
    call: Bundle,
    params: URLSearchParams,
  ): Promise<Bundle[]> => {
    let response = await routes(host, options, go).find((r) =>
      r.path == '/tracker/bugs'
    )!.handle(new Request(`http://box/tracker/bugs?${params}`))
    let body = await response.json()
    if (!response.ok) throw new CallError('remote', body.error)
    let value = { source: 'yaks.app', rows: body }
    return [{
      entity: { eid: '$said' },
      content: { body: JSON.stringify(value, null, 2) },
      output: { source: call.entity.eid, value },
    }]
  }
  return {
    bug_list: (call, g) => {
      let args = argsOf(call)
      if (args.source == 'yaks.app') {
        return remote(
          call,
          new URLSearchParams({
            query: str(args.query) || '.bug.status=open',
            limit: String(args.limit ?? 50),
          }),
        )
      }
      let query = parse(str(args.query) || '.bug.status=open')
      return g.read(
        and(
          present('bug'),
          ...query.clauses,
          every(),
          ...orderOf(query) ? [] : [order('-bug.hits')],
          limit(Number(args.limit ?? 50)),
        ),
      )
    },
    bug_show: async (call, g) => {
      let args = argsOf(call)
      if (args.source == 'yaks.app') {
        return remote(call, new URLSearchParams({ bug: str(args.bug) }))
      }
      let [eid] = await referenced(g, [str(args.bug)], 'bug')
      let bug = await one(g, eid)
      return [
        bug,
        ...await g.read(
          and(eq('error.bug', bug.entity.eid), every(), order('-error.at')),
        ),
      ]
    },
    bug_resolve: mark('resolved'),
    bug_archive: mark('archived'),
  }
}
