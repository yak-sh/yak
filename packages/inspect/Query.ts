/**
 * A query's page: the line, run, and its answer. Rows show as a table whose
 * columns are the components the rows share, each cell what that component
 * holds, a page at a time (unless the line names its own window) with how
 * many there are in all; a press on a row picks it. An aggregate shows as
 * what it counts: a number, or each value beside how many hold it.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { conjoin, orderOf, parse, type Query, windowOf } from '@yaks/query'
import { Head, Rows, Value } from '@yaks/ui'
import type { Bundle, Io } from './host.ts'
import { Grid, paged } from './grid.ts'
import { comp, comps, count, face, line, shape, str } from './read.ts'
import { rows, waiting } from './rows.ts'
import { key } from './state.ts'

let AGGREGATES = new Set(['count', 'tally', 'distinct'])

/** A query as typed: its tree, the aggregate it asks for, or why it does not
 * parse. */
export let read = (
  text: string,
): { ast?: Query; agg?: string; error?: string } => {
  try {
    let ast = parse(text)
    let agg = ast.clauses.find((c) => AGGREGATES.has(c.kind))?.kind
    return { ast, agg }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// Every component each row brings, unless the line says what it brings.
let whole = (text: string) =>
  /(^|&)(\*|\.fields=[^&]*|\?[\w]+)(&|$)/.test(text) ? text : conjoin(text, '*')

/**
 * The components every row carries, in the order the first row carries them.
 *
 * ```ts
 * import { shared } from './Query.ts'
 * shared([
 *   { entity: { eid: 'a' }, doc: {}, task: {}, created: {} },
 *   { entity: { eid: 'b' }, task: {}, doc: {} },
 * ]) // ['doc', 'task']
 * ```
 */
export let shared = (rows: Bundle[]): string[] =>
  rows.length
    ? comps(rows[0]).map(([n]) => n).filter((n) => rows.every((b) => b[n]))
    : []

// What a component holds, in a cell: its first few values that are there.
let summed = (b: Bundle, name: string) => {
  let set = Object.entries(comp(b, name)).filter(([, v]) =>
    v != null && v !== ''
  )
  return set.length
    ? set.slice(0, 3).flatMap(([k, v], i) => [
      i ? ' ' : null,
      h(Value, { mod: 'id' }, k),
      ' ',
      h(Value, { mod: shape(v) }, line(face(v), 40)),
    ])
    : h(Value, { mod: 'nil' }, 'present')
}

// A tally, or a distinct list read as one: each value beside its count.
let Tallied = ({ io, id, tally }: {
  io: Io
  id: string
  tally: Record<string, number>
}) =>
  h(Grid, {
    io,
    id,
    local: true,
    pick: false,
    rows: Object.keys(tally).toSorted((a, b) => tally[b] - tally[a])
      .map((v): Bundle => ({ entity: { eid: v } })),
    columns: [
      { name: 'value', cell: (b) => line(b.entity.eid, 120) || '""' },
      {
        name: 'entities',
        mod: 'num',
        cell: (b) => count(tally[b.entity.eid] ?? 0),
      },
    ],
  })

/** The rows a query answers, a page at a time. */
let Answered = ({ io, text, ast }: { io: Io; text: string; ast: Query }) => {
  let id = key('query', text)
  let own = windowOf(ast).limit != null || !!orderOf(ast)
  let got = io.ask({
    rows: whole(own ? text : paged(io, id, text)),
    total: { query: conjoin(text, '.count'), once: true },
  })
  let all = rows(got.rows)
  let titled = all.some((b) => str(b, 'doc', 'title'))
  let cols = shared(all).filter((n) => !(titled && n == 'doc'))
  return waiting(got.rows) ?? h(Grid, {
    io,
    id,
    rows: all,
    total: own ? all.length : got.total?.count,
    columns: [
      {
        name: 'id',
        cell: (b) => h('a', { href: io.link(b.entity.eid) }, io.id(b)),
      },
      ...titled
        ? [{
          name: 'title',
          cell: (b: Bundle) => line(str(b, 'doc', 'title'), 80),
        }]
        : [],
      ...cols.map((n) => ({
        name: n,
        cell: (b: Bundle) => summed(b, n),
      })),
    ],
  })
}

/** A query's own page. */
export let QueryPage = (
  { io, text }: { io: Io; text: string },
): JSX.Element => {
  let { ast, agg, error } = read(text)
  let got = io.ask(agg ? { answer: text } : {})
  let a = got.answer
  return h(
    'div',
    { 'data-query': text },
    h(
      Head,
      {},
      h(Head.Title, {}, 'query', h(Head.Kind, {}, agg ?? 'rows')),
      h(Head.Sub, {}, h(Value, { mod: 'id' }, text)),
    ),
    error
      ? h(Rows.More, {}, error)
      : agg == 'count'
      ? waiting(a) ?? h(Value, { mod: 'num' }, count(a?.count ?? 0))
      : agg
      ? waiting(a) ??
        h(Tallied, { io, id: key('query', text), tally: a?.tally ?? {} })
      : h(Answered, { io, text, ast: ast! }),
  )
}
