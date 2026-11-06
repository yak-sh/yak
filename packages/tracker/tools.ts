// Bug tools speak the same graph queries and mark patches as every other door.

import { type Bundle, type Graph, reduced } from '@yaks/graph'
import { argsOf, referenced, who } from '@yaks/graph/call'
import { after } from '@yaks/fp'
import type { Runs } from '@yaks/graph/tools'
import {
  after as past,
  and,
  count,
  eq,
  every,
  fields,
  limit,
  list,
  order,
  orderOf,
  parse,
  present,
  type Query,
  stringify,
  want,
} from '@yaks/query'
import { CallError } from '@yaks/tools/errors'
import { valued } from '@yaks/tools/value'
import { commitOf } from '@yaks/git/source'
import { comp, str } from './model.ts'
import { type Options, read } from './routes.ts'
import { mark as upstream } from './remote.ts'
import { type Explanation, explanation } from './resolution.ts'
import { survivor } from './merge.ts'
import { occurring } from './reading.ts'

/** The part of a store the bug tools read and mark: this graph, or the box
 * tracker's graph over its wire. */
type Store = Pick<Graph, 'vocab' | 'get' | 'read' | 'address'> & {
  /** how many entities a query selects, where the store is not a graph that
   * counts its own rows */
  count?: (q: Query) => Promise<number>
  rows?: Graph['rows']
  /** apply a mark's patch where the store keeps it, or hand it back for the
   * runner to apply here */
  mark?: (bundles: Partial<Bundle>[]) => Promise<void>
}

/** The box tracker's graph at `url`, read through its `/query` and marked
 * through its `/apply`, in this graph's vocabulary, as the run `via` names in
 * `x-via`, which that graph's door signs its marks with (@yaks/api `asking`).
 * A reference resolves the way that graph resolves one in a query. */
export let wire = (
  url: string,
  vocab: Graph['vocab'],
  go: typeof fetch = fetch,
  via?: string,
): Store => {
  let at = (path: string) => `${url.replace(/\/$/, '')}${path}`
  let send = async (path: string, body: unknown) => {
    let response = await go(at(path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...via ? { 'x-via': via } : {},
      },
      body: JSON.stringify(body),
    })
    let said = await response.json().catch(() => null)
    // A refusal of what was asked is the box's own answer; any other failure
    // names where it failed.
    let why = said?.message ?? said?.error
    if (response.status == 400 && why) throw new CallError('bug', why)
    if (!response.ok) {
      throw new CallError('box', `${url} failed ${path} (${response.status})`)
    }
    return said
  }
  let read = async (q: string | Query): Promise<Bundle[]> => {
    let rows = await send('/query', stringify(q))
    if (!Array.isArray(rows)) {
      throw new CallError('box', `${url} answered no rows`)
    }
    return rows
  }
  return {
    vocab,
    read: read as Graph['read'],
    get: ((eids: string[], comps?: string[]) =>
      eids.length
        ? read(and(
          eq('entity.eid', list(...eids)),
          ...comps ? comps.map(want) : [every()],
        ))
        : []) as Graph['get'],
    address: async (ids: string[]) =>
      new Map(
        await Promise.all(ids.map(async (id) => {
          let rows = await read(and(eq('entity.eid', id), fields('entity.eid')))
          return [id, rows.length == 1 ? rows[0].entity.eid : id] as const
        })),
      ),
    count: async (q) => Number((await send('/query', stringify(q)))?.count),
    mark: (bundles) => send('/apply', bundles),
  }
}

let counted = async (g: Store, q: Query): Promise<number> =>
  g.count
    ? g.count(q)
    : (reduced('count', await g.rows!(q)) as { count: number }).count

let one = (g: Store, eid: string): Bundle | Promise<Bundle> =>
  after(survivor(g, eid), (row) => {
    if (!row?.bug) throw new CallError('bug', `not a bug: ${eid}`)
    return row
  })

/** Bug reads preserve caller ordering, defaulting to worst first. */
export let bugs = (
  g: Pick<Store, 'read'>,
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

/** A bug read: the bug, a page of its retained occurrences, newest first,
 * and the requests they ran during; how many occurrences it retains; and,
 * where older ones remain, the last one read, which `after` reads past. */
export type Shown = { rows: Bundle[]; occurrences: number; next?: string }

/** A bug and its `size` newest retained occurrences past the one `cursor`
 * names, at most 100, with no copies written locally. */
export let bug = async (
  g: Store,
  input: string,
  size = 5,
  cursor?: string,
): Promise<Shown> => {
  let [eid] = await referenced(g, [input], 'bug')
  let row = await one(g, eid)
  let n = Math.min(Math.max(size, 1), 100)
  let read = await g.read(and(
    ...occurring(row.entity.eid).clauses,
    ...cursor ? [past(cursor)] : [],
    limit(n + 1),
  ))
  let page = read.slice(0, n)
  let requests = [
    ...new Set(
      page.map((e) => str(comp(e, 'during').request)).filter(Boolean),
    ),
  ]
  let companions = requests.length ? await g.get(requests, ['request']) : []
  return {
    rows: [row, ...page, ...companions],
    occurrences: await counted(
      g,
      and(eq('error.bug', row.entity.eid), count()),
    ),
    ...read.length > n ? { next: page[n - 1].entity.eid } : {},
  }
}
// What a mark writes on its bug: a resolution with its explanation, an
// archival with its reason, or a reopening, which takes the resolution back.
let written = (
  name: 'resolved' | 'archived' | 'reopened',
  said: Record<string, string>,
): Partial<Bundle> => name == 'reopened' ? { resolved: null } : { [name]: said }
let answer = (
  call: Bundle,
  data: Record<string, unknown>,
  source = 'box',
): Bundle[] => [valued(call, { source, ...data })]

/** The tools' options: the tracker's remote, the store a call naming no
 * source reads and marks (`box` unless said), the box tracker's graph where
 * this one holds no bugs, and the checkout whose commits a resolution names,
 * where a short sha is read as Git reads one. */
export type ToolOptions = Options & {
  source?: 'box' | 'yaks.app'
  /** the base URL of the box tracker's graph, such as
   * `http://127.0.0.1:5175`; without it the box is this graph */
  box?: string
  code?: { cwd?: string }
}

export let runs = (
  host: { fetch?: typeof fetch } = {},
  options: ToolOptions = {},
  go: typeof fetch = host.fetch ?? fetch,
): Runs => {
  let source = (call: Bundle) =>
    str(argsOf(call).source) || options.source || 'box'
  // Where the box source reads and marks: the box tracker's graph when one is
  // named, as the run that called, else this graph, whose runner applies the
  // marks a tool answers.
  let box = (g: Graph, call?: Bundle): Store =>
    options.box ? wire(options.box, g.vocab, go, call && who(call)?.via) : g
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
    async (call: Bundle, here: Graph): Promise<Bundle[]> => {
      let args = argsOf(call)
      let remote = source(call) == 'yaks.app'
      let g = box(here, call)
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
      // A resolution carries its explanation to each store it marks, and an
      // archival its reason.
      let said: Record<string, string> = name == 'resolved'
        ? await full(explanation(args)) as Record<string, string>
        : name == 'archived' && args.reason != null
        ? { reason: String(args.reason) }
        : {}
      if (remote || options.remote) {
        try {
          let held = await upstream(options.remote ?? {}, eid, name, go, said)
          if (!held && remote) throw Error('Remote tracker bug not found')
        } catch (error) {
          throw new CallError('remote', (error as Error).message)
        }
      }
      let patch = { entity: bug?.entity, ...written(name, said) } as Bundle
      if (bug && !g.mark) return [patch]
      if (bug) await g.mark!([patch])
      return answer(call, { bug: eid, mark: name }, source(call))
    }
  let remote = async (params: URLSearchParams) => {
    let result = await read(options, 'bugs', params, undefined, go)
    if (!result.ok) throw new CallError('remote', result.error)
    return result.value
  }
  return {
    bug_list: (call, g) => {
      let args = argsOf(call)
      if (source(call) == 'yaks.app') {
        return remote(
          new URLSearchParams({
            query: str(args.query) || '.bug.status=open',
            limit: String(args.limit ?? 50),
          }),
        ).then((rows) => answer(call, { rows }, 'yaks.app'))
      }
      return after(
        bugs(
          box(g),
          parse(str(args.query) || '.bug.status=open'),
          Number(args.limit ?? 50),
        ),
        (rows) => answer(call, { rows }),
      )
    },
    bug_show: async (call, g) => {
      let args = argsOf(call)
      let size = Number(args.limit ?? 5), cursor = str(args.after) || undefined
      if (source(call) == 'yaks.app') {
        let shown = await remote(
          new URLSearchParams({
            bug: str(args.bug),
            limit: String(size),
            ...cursor ? { after: cursor } : {},
          }),
        )
        return answer(call, shown as Shown, 'yaks.app')
      }
      return answer(call, await bug(box(g), str(args.bug), size, cursor))
    },
    bug_resolve: mark('resolved'),
    bug_archive: mark('archived'),
    bug_reopen: mark('reopened'),
  }
}
