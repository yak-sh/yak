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

// Resolve short name and relationship lookups from the graph before merging
// the general full-text and meaning ranks of documents and transcripts.
export let peopleSearch = async (
  graph: Directory,
  words: string,
  n: number,
): Promise<Match[]> => {
  if (!graph.vocab.comp('person')) return []
  let phrase = words.trim().replace(/^"(.*)"$/, '$1').replace(/\s+/g, ' ')
  if (
    !/^[\p{L}\p{N}][\p{L}\p{N} .&'’_-]{0,79}$/u.test(phrase) ||
    phrase.split(' ').length > 5
  ) return []
  let hidden = unfound(graph.vocab).not ?? []
  let [names, relations, handles] = await Promise.all([
    people(graph, phrase, hidden, n),
    relatives(graph, phrase, hidden, n),
    accounts(graph, phrase, hidden, n),
  ])
  return [
    ...names.map((row) => ({ entity: row.entity.eid, snippet: '' })),
    ...relations,
    ...handles,
  ]
}
