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
import { commitOf } from '@yaks/git/source'
import { type Config, facetsOf, used } from '@yaks/host/config'
import { comp, str } from './model.ts'
import { type Options, read } from './routes.ts'
import { mark as upstream } from './remote.ts'
import { type Explanation, explanation } from './resolution.ts'
import { survivor } from './merge.ts'
import { occurring } from './reading.ts'

let one = (g: Graph, eid: string): Bundle | Promise<Bundle> =>
  after(survivor(g, eid), (row) => {
    if (!row?.bug) throw new CallError('bug', `not a bug: ${eid}`)
    return row
  })

/** Bug reads preserve caller ordering, defaulting to worst first. */
export let bugs = (
  g: Graph,
  query: Query,
  count = 50,
): Bundle[] | Promise<Bundle[]> =>
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
          g.read(occurring(row.entity.eid)),
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
// What a mark writes on its bug: a resolution with its explanation, an
// archival, or a reopening, which takes the resolution back.
let written = (
  name: 'resolved' | 'archived' | 'reopened',
  said: Record<string, string>,
): Partial<Bundle> => name == 'reopened' ? { resolved: null } : { [name]: said }
let answer = (
  call: Bundle,
  data: Record<string, unknown>,
  source = 'box',
): Bundle[] => {
  let value = { source, ...data }
  return [{
    entity: { eid: '$said' },
    content: { body: JSON.stringify(value, null, 2) },
    output: { source: call.entity.eid, value },
  }]
}

/** Whether a host's graph holds bugs of its own: it does unless its config
 * composes the tracker without the tracker's graph, as the box's default yak
 * does to serve the platform tracker's bugs beside `admin errors`. */
let holds = (host: { config?: Config }): boolean => {
  let plug = host.config?.plugins?.find((p) => used(p) == '@yaks/tracker')
  return !plug || (facetsOf(plug)?.includes('graph') ?? true)
}

/** The tools' options: the tracker's remote, and the checkout whose commits a
 * resolution names, where a short sha is read as Git reads one. */
export type ToolOptions = Options & { code?: { cwd?: string } }

export let runs = (
  host: { config?: Config } = {},
  options: ToolOptions = {},
  go: typeof fetch = fetch,
): Runs => {
  let home = holds(host) ? 'box' : 'yaks.app'
  let source = (call: Bundle) => str(argsOf(call).source) || home
  let cwd = options.code?.cwd
  // A resolution's commits by their full shas; one Git cannot read stays as
  // said, for the graph to refuse.
  let full = async (said: Partial<Explanation>) => {
    for (let k of ['since', 'fix'] as const) {
      let sha = said[k] && cwd && await commitOf(cwd, said[k])
      if (sha) said[k] = sha
    }
    return said
  }
  let mark =
    (name: 'resolved' | 'archived' | 'reopened') =>
    async (call: Bundle, g: Graph): Promise<Bundle[]> => {
      let args = argsOf(call)
      let remote = source(call) == 'yaks.app'
      let [address] = remote
        ? [str(args.bug)]
        : await referenced(g, [str(args.bug)], 'bug')
      let eid = remote
        ? address
        : (await survivor(g, address))?.entity.eid ?? address
      let [bug] = remote ? [] : await g.read(and(
        eq('entity.eid', eid),
        present('bug'),
        fields('entity.eid'),
      ))
      if (!remote && !bug) throw new CallError('bug', `not a bug: ${eid}`)
      // A resolution carries its explanation to each store it marks.
      let said = name == 'resolved' ? await full(explanation(args)) : {}
      if (remote || options.remote) {
        try {
          let held = await upstream(options.remote ?? {}, eid, name, go, said)
          if (!held && remote) throw Error('Remote tracker bug not found')
        } catch (error) {
          throw new CallError('remote', (error as Error).message)
        }
      }
      if (bug) return [{ entity: bug.entity, ...written(name, said) }]
      return answer(call, { bug: eid, mark: name }, source(call))
    }
  let remote = async (
    call: Bundle,
    params: URLSearchParams,
  ): Promise<Bundle[]> => {
    let result = await read(options, 'bugs', params, undefined, go)
    if (!result.ok) throw new CallError('remote', result.error)
    return answer(call, { rows: result.value }, 'yaks.app')
  }
  return {
    bug_list: (call, g) => {
      let args = argsOf(call)
      if (source(call) == 'yaks.app') {
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
      if (source(call) == 'yaks.app') {
        return remote(call, new URLSearchParams({ bug: str(args.bug) }))
      }
      return after(bug(g, str(args.bug)), (rows) => answer(call, { rows }))
    },
    bug_resolve: mark('resolved'),
    bug_archive: mark('archived'),
    bug_reopen: mark('reopened'),
  }
}
