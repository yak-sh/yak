// An app's query door over its graph: listing, aggregates and ranked answers.
// Storage supplies full-text hits for the reader's scope; the door owns their
// wire shape, so a SQLite graph and a hosted Store answer the same question.
import { type Authenticate, type Handler, json } from '@yaks/api'
import type { Bundle, Graph, ReadOpts } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import type { Hit } from '@yaks/fts'
import { personalsIn } from '@yaks/member'
import { parse } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { decode } from '@yaks/vocab/wire'
import { kinded } from './app-subs.ts'
import { asking, screened } from './listing.ts'

type Agg = 'count' | 'distinct' | 'tally'
let AGGS: Agg[] = ['count', 'distinct', 'tally']
let aggregate = (line: string) =>
  parse(line).clauses.map((c) => c.kind as Agg).find((k) => AGGS.includes(k))

type Options = {
  graph: Graph
  vocab: Vocab
  route: Handler
  authenticate: Authenticate
  read: (request: Request) => ReadOpts
  own: boolean
  spoke: (line: string) => void
  trusted: () => Graph
  found: (text: string, opts: ReadOpts, limit: number) => Hit[]
  speak: (rows: Bundle[]) => Bundle[] | Promise<Bundle[]>
  taught: (answer: Response) => Promise<Response>
}

/** The production read behavior, independent of the object's lifecycle. */
export let appRead = (options: Options): Handler => {
  let { graph, vocab, route, authenticate, read, own } = options
  let words = screened((word) => !!vocab.comp(word), own)
  let personal = personalsIn(vocab)
  let counted = async (line: string, agg: Agg, opts: ReadOpts) => {
    let rows = await graph.rows(line, opts) as { value: string; n: number }[]
    if (agg == 'count') return json({ count: rows[0]?.n ?? 0 })
    let said = rows.map((r) => [String(r.value ?? ''), r.n] as const)
    return json(
      agg == 'distinct'
        ? { distinct: said.map(([v]) => v) }
        : { tally: Object.fromEntries(said) },
    )
  }
  let ranked = (rows: Bundle[], line: string, opts: ReadOpts): Bundle[] => {
    let text = parse(line).clauses
      .flatMap((c) => c.kind == 'text' ? [c.value] : []).join(' ')
    if (!text.trim() || !rows.length) return rows
    let hits = options.found(text, opts, Math.max(rows.length, 20))
    let at = new Map(hits.map((h, i) => [h.entity, { i, h }]))
    return rows.map((row) => {
      let hit = at.get(row.entity.eid)
      return hit
        ? { ...row, rank: { score: -hit.h.rank, snip: hit.h.snippet } }
        : row
    }).sort((a, b) =>
      (at.get(a.entity.eid)?.i ?? rows.length) -
      (at.get(b.entity.eid)?.i ?? rows.length)
    )
  }
  return async (request) => {
    let url = new URL(request.url)
    let line = url.searchParams.get('q') ?? ''
    if (url.searchParams.get('listing') == '1') {
      line = asking(line, words, personal)
      url.searchParams.set('q', line)
      request = new Request(url, request)
    }
    if (line.split('&').some((part) => part.startsWith('work='))) {
      throw new Refused('work lanes are not served by this store')
    }
    options.spoke(line)
    let agg = aggregate(line)
    if (url.searchParams.get('trusted') == '1') {
      if (request.headers.get('x-yak-kernel') != '1') {
        throw new Refused('trusted queries require the kernel')
      }
      let opts = {
        administrative: true,
        graves: url.searchParams.get('graves') == '1',
      }
      return agg
        ? await counted(line, agg, opts)
        : json(await options.trusted().read(line, opts))
    }
    let opts = read(request)
    if (agg && url.searchParams.get('live') != '1') {
      await authenticate(request)
      return await counted(line, agg, opts)
    }
    let answer = await route(request)
    if (!answer.ok) return options.taught(answer)
    let rows = await answer.json()
    if (!Array.isArray(rows)) return json(rows)
    let visible = ranked(decode(vocab, rows) as Bundle[], line, opts)
      .map((row) => kinded(vocab, row))
    return json(
      url.searchParams.get('names') == '0'
        ? visible
        : await options.speak(visible),
    )
  }
}
