// Bug tools speak the same graph queries and mark patches as every other door.

import type { Bundle, Graph } from '@yaks/graph'
import { argsOf, referenced } from '@yaks/graph/call'
import { after } from '@yaks/fp'
import type { Runs } from '@yaks/graph/tools'
import {
  and,
  eq,
  every,
  fields,
  limit,
  order,
  orderOf,
  parse,
  present,
  type Query,
} from '@yaks/query'
import { CallError } from '@yaks/tools/errors'
import { comp, str } from './model.ts'
import { type Options, read } from './routes.ts'
import { mark as upstream } from './remote.ts'
import { explanation } from './resolution.ts'

let one = (g: Graph, eid: string): Bundle | Promise<Bundle> =>
  after(g.get([eid]), ([row]) => {
    if (!row?.bug) throw new CallError('bug', `not a bug: ${eid}`)
    return row
  })

/** Bug reads preserve caller ordering, defaulting to worst first. */
export let bugs = (g: Graph, query: Query, count = 50) =>
  g.read(and(
    present('bug'),
    ...query.clauses,
    every(),
    ...orderOf(query) ? [] : [order('-bug.hits')],
    limit(count),
  ))

/** A bug and its retained occurrences, with no copies written locally. */
export let bug = (g: Graph, input: string): Bundle[] | Promise<Bundle[]> =>
  after(
    referenced(g, [input], 'bug'),
    ([eid]) =>
      after(one(g, eid), (row) =>
        after(
          g.read(and(eq('error.bug', eid), every(), order('-error.at'))),
          (occurrences) => {
            let requests = [
              ...new Set(
                occurrences.map((e) => str(comp(e, 'during').request))
                  .filter(Boolean),
              ),
            ]
            return after(
              requests.length ? g.get(requests, ['request']) : [],
              (companions) => [row, ...occurrences, ...companions],
            )
          },
        )),
  )
let answer = (call: Bundle, data: Record<string, unknown>): Bundle[] => {
  let value = { source: argsOf(call).source ?? 'box', ...data }
  return [{
    entity: { eid: '$said' },
    content: { body: JSON.stringify(value, null, 2) },
    output: { source: call.entity.eid, value },
  }]
}
export let runs = (
  _host: unknown = {},
  options: Options = {},
  go: typeof fetch = fetch,
): Runs => {
  let mark =
    (name: 'resolved' | 'archived') =>
    async (call: Bundle, g: Graph): Promise<Bundle[]> => {
      let args = argsOf(call)
      let remote = args.source == 'yaks.app'
      let [eid] = remote
        ? [str(args.bug)]
        : await referenced(g, [str(args.bug)], 'bug')
      let [bug] = remote ? [] : await g.read(and(
        eq('entity.eid', eid),
        present('bug'),
        fields('entity.eid'),
      ))
      if (!remote && !bug) throw new CallError('bug', `not a bug: ${eid}`)
      // A resolution carries its explanation to each store it marks.
      let said = name == 'resolved' ? explanation(args) : {}
      if (remote || options.remote) {
        try {
          let held = await upstream(options.remote ?? {}, eid, name, go, said)
          if (!held && remote) throw Error('Remote tracker bug not found')
        } catch (error) {
          throw new CallError('remote', (error as Error).message)
        }
      }
      if (bug) return [{ entity: bug.entity, [name]: said }]
      return answer(call, { bug: eid, mark: name })
    }
  let remote = async (
    call: Bundle,
    params: URLSearchParams,
  ): Promise<Bundle[]> => {
    let result = await read(options, 'bugs', params, undefined, go)
    if (!result.ok) throw new CallError('remote', result.error)
    return answer(call, { rows: result.value })
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
      return after(
        bugs(
          g,
          parse(str(args.query) || '.bug.status=open'),
          Number(args.limit ?? 50),
        ),
        (rows) => answer(call, { rows }),
      )
    },
    bug_show: (call, g) => {
      let args = argsOf(call)
      if (args.source == 'yaks.app') {
        return remote(call, new URLSearchParams({ bug: str(args.bug) }))
      }
      return after(bug(g, str(args.bug)), (rows) => answer(call, { rows }))
    },
    bug_resolve: mark('resolved'),
    bug_archive: mark('archived'),
  }
}
