import { unfound } from '@yaks/fts'
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import {
  absent,
  and,
  eq,
  fields,
  limit,
  list,
  present,
  text,
} from '@yaks/query'

type Directory = Pick<Graph, 'vocab' | 'read' | 'get'>
type Match = { entity: Eid; snippet: string }

let value = (row: Bundle, comp: string, prop: string) =>
  String((row[comp] as Comp | undefined)?.[prop] ?? '')

let name = (row: Bundle) => value(row, 'doc', 'title')
let same = (a: string, b: string) => a.toLowerCase() == b.toLowerCase()
let named = (title: string, words: string) =>
  same(title, words) ||
  title.toLowerCase().startsWith(`${words.toLowerCase()} `)

let people = async (
  graph: Directory,
  words: string,
  hidden: string[],
  n: number,
) =>
  (await graph.read(and(
    present('person'),
    text(words),
    fields('doc.title'),
    limit(n),
    ...hidden.map(absent),
  ))).filter((row) => named(name(row), words))

let relatives = async (
  graph: Directory,
  words: string,
  hidden: string[],
  n: number,
): Promise<Match[]> => {
  if (!graph.vocab.comp('relationship')) return []
  let possessive = words.match(/^(.+?)['’]s ([\p{L}-]+)$/iu)
  let related = possessive ?? words.match(/^(.+) ([\p{L}-]+)$/u)
  if (!related) return []
  let [, anchor, role] = related
  let anchors = await people(graph, anchor, hidden, n)
  if (!anchors.length) return []
  let links = await graph.read(and(
    eq('relationship.role', role.toLowerCase()),
    eq(
      possessive ? 'edge.to' : 'edge.from',
      list(...anchors.map((row) => row.entity.eid)),
    ),
    fields('edge'),
    limit(n),
    ...hidden.map(absent),
  ))
  let ends = new Set(
    links.flatMap((
      row,
    ) => [value(row, 'edge', 'from'), value(row, 'edge', 'to')]),
  )
  let rows = await graph.get([...ends], ['person', 'doc.title', ...hidden])
  let by = new Map(
    rows.filter((row) => row.person && !hidden.some((c) => row[c]))
      .map((row) => [row.entity.eid, row]),
  )
  return links.flatMap((row) => {
    let from = value(row, 'edge', 'from'), to = by.get(value(row, 'edge', 'to'))
    return by.has(from) && to
      ? [{ entity: from, snippet: `${name(to)}'s ${role}` }]
      : []
  })
}

let accounts = async (
  graph: Directory,
  words: string,
  hidden: string[],
  n: number,
): Promise<Match[]> => {
  if (!graph.vocab.comp('yaks_account')) return []
  let rows = await graph.read(and(
    present('yaks_account'),
    text(words),
    fields('yaks_account'),
    limit(n),
    ...hidden.map(absent),
  ))
  return rows.flatMap((row) => {
    let holder = value(row, 'yaks_account', 'holder')
    let label = ['name', 'handle'].map((prop) =>
      value(row, 'yaks_account', prop)
    )
      .find((value) => same(value, words))
    return holder && label ? [{ entity: holder, snippet: label }] : []
  })
}

let onYaks = async (graph: Directory, matches: Match[], hidden: string[]) => {
  if (!matches.length || !graph.vocab.comp('yaks_account')) return []
  let rows = await graph.read(and(
    eq('yaks_account.holder', list(...new Set(matches.map((h) => h.entity)))),
    fields('yaks_account.holder', 'yaks_account.handle'),
    ...hidden.map(absent),
  ))
  let spaces = new Map<Eid, string[]>()
  for (let row of rows) {
    let holder = value(row, 'yaks_account', 'holder')
    let handle = value(row, 'yaks_account', 'handle')
    if (handle) {
      spaces.set(holder, [...spaces.get(holder) ?? [], `${handle}.yaks.app`])
    }
  }
  return matches.flatMap((match) => {
    let urls = spaces.get(match.entity)
    return urls?.length
      ? [{
        ...match,
        snippet: [match.snippet, urls.sort().join(', ')].filter(Boolean).join(
          ' · ',
        ),
      }]
      : []
  })
}

// Resolve short name and relationship lookups from the graph before merging
// the general full-text and meaning ranks of documents and transcripts.
export let peopleSearch = async (
  graph: Directory,
  words: string,
  n: number,
): Promise<Match[]> => {
  if (!graph.vocab.comp('person') || !graph.vocab.prop('doc', 'title')) {
    return []
  }
  let phrase = words.trim().replace(/^"(.*)"$/, '$1').replace(/\s+/g, ' ')
  let withAccount = / yaks\.app(?: (?:account|space))?$/iu
  let subject = phrase.replace(withAccount, '')
  if (
    !/^[\p{L}\p{N}][\p{L}\p{N} .&'’_-]{0,79}$/u.test(phrase) ||
    subject.split(' ').length > 5
  ) return []
  let hidden = unfound(graph.vocab).not ?? []
  let [names, relations, handles] = await Promise.all([
    people(graph, subject, hidden, n),
    relatives(graph, subject, hidden, n),
    accounts(graph, subject, hidden, n),
  ])
  let matches = [
    ...names.map((row) => ({ entity: row.entity.eid, snippet: '' })),
    ...relations,
    ...handles,
  ]
  return subject == phrase ? matches : onYaks(graph, matches, hidden)
}
