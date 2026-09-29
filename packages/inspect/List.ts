/**
 * `Inspect.List`: a listing, its saved query and its rows. A listing is an
 * entity of the inspector's own (`listing{title, query, of, open, limit}`,
 * ./vocab.json), so whether it is folded and how far it reaches is state in
 * the page's own graph, and a press on its fold is a patch to it.
 *
 * What a listing's rows are (`of`) says what it asks beside its query and how
 * it draws them:
 *
 * - `query`: the rows of any query, a tile each, or the answer of an
 *   aggregate (`.count`, `.tally`, `.distinct`).
 * - `components`: every component, with its package, what it is and how many
 *   entities carry it.
 * - `archetypes`: every set of components that occurs together, by how many
 *   entities are made of it.
 * - `packages`: every package, with the components it declares.
 * - `relations`: every component that is an edge relation, what it reads as
 *   from the far end, and how many edges state it.
 *
 * How many entities carry a component is read off the archetypes (./read.ts
 * `census`): one tally of every entity's archetype, where a count per
 * component would be a query each. That tally reads every entity, so it is
 * asked once, when the listing opens, not kept live (README, Limits).
 *
 * @module
 */

import { type ComponentChildren, h, type VNode } from 'preact'
import { conjoin, parse, type Query, windowOf } from '@yaks/query'
import { Button, Pairs, Rows, Section, Value } from '@yaks/ui'
import type { Answer, Ask, Asks, Bundle, Io, Props, View } from './host.ts'
import { census, comp, count, face, str } from './read.ts'
import { rows, waiting } from './rows.ts'

/** The census every listing of components reads its counts from: each set
 * of components that occurs, and how many entities are made of each. */
export let CENSUS = {
  sets: '.archetype&.fields=archetype.tables',
  tally: '.tally=entity.archetype',
}

// The census reads every entity, so it is asked once, as a listing opens.
let once = (query: string): Ask => ({ query, once: true })

/** A listing, as its bundle carries it. */
export type Listing = {
  title?: string
  query?: string
  of?: string
  open?: boolean
  limit?: number
}

let listing = (e: Bundle): Listing => comp(e, 'listing') as Listing

let AGGREGATES = new Set(['count', 'tally', 'distinct'])

/** A query as typed: its tree, whether it asks for an aggregate, or why it
 * does not parse. */
export let read = (
  line: string,
): { ast?: Query; agg?: string; error?: string } => {
  try {
    let ast = parse(line)
    let agg = ast.clauses.find((c) => AGGREGATES.has(c.kind))?.kind
    return { ast, agg }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** A line cut to a window of `n` rows, unless it names its own. */
export let windowed = (line: string, n: number): string => {
  let { ast } = read(line)
  return ast && windowOf(ast).limit != null
    ? line
    : conjoin(line, `.limit=${n}`)
}

// The frame every listing shares: its fold, title, how many, and its query,
// which opens the map with it in the bar; then its body while it is open.
let Frame = (
  { e, io, total, children }: {
    e: Bundle
    io: Io
    total?: number
    children?: ComponentChildren
  },
): VNode => {
  let l = listing(e)
  let toggle = () =>
    io.set([{ entity: { eid: e.entity.eid }, listing: { open: !l.open } }])
  return h(
    Section,
    { 'data-listing': e.entity.eid },
    h(
      Section.Title,
      {},
      h(Section.Fold, {
        type: 'button',
        mod: l.open && 'open',
        'aria-label': l.open ? `fold ${l.title}` : `unfold ${l.title}`,
        onClick: toggle,
      }),
      l.title ?? '',
      total != null ? h(Section.Count, {}, count(total)) : null,
      l.of != 'query' && l.query
        ? h(Section.Note, {}, h('a', { href: io.find(l.query) }, l.query))
        : null,
    ),
    l.open ? children : null,
  )
}

// The first `n` of some rows, each drawn by `row`, and how many were left.
let window = (
  e: Bundle,
  io: Io,
  all: ComponentChildren[],
  total = all.length,
): VNode => {
  let n = listing(e).limit ?? 50
  let more = total - Math.min(n, all.length)
  return h(
    Rows,
    {},
    all.slice(0, n).map((row, i) => h(Rows.Item, { key: i }, row)),
    more > 0
      ? h(
        Rows.More,
        {},
        `${count(more)} more `,
        h(Button, {
          type: 'button',
          mod: 'quiet',
          onClick: () =>
            io.set([{
              entity: { eid: e.entity.eid },
              listing: { limit: n + 50 },
            }]),
        }, 'show more'),
      )
      : null,
  )
}

// ---- a query and its rows ----

let queryAsks = (e: Bundle): Asks => {
  let l = listing(e)
  let line = (l.query ?? '').trim()
  let { ast, agg } = read(line)
  if (!l.open || !ast) return {}
  return agg
    ? { answer: line }
    : { rows: windowed(line, l.limit ?? 50), total: conjoin(line, '.count') }
}

// An aggregate's answer: a count, or each value beside its count.
let Aggregate = ({ a }: { a: Answer }) =>
  a.tally
    ? h(
      Pairs,
      {},
      Object.entries(a.tally).sort(([, x], [, y]) => y - x).flatMap((
        [v, n],
      ) => [
        h(Pairs.Key, { key: `k${v}` }, v),
        h(Pairs.Value, { key: `v${v}` }, h(Value, { mod: 'num' }, count(n))),
      ]),
    )
    : h(Value, { mod: 'num' }, count(a.count ?? 0))

let QueryList = ({ e, got, io }: Props) => {
  let l = listing(e)
  let line = (l.query ?? '').trim()
  let { error, agg } = read(line)
  let body = !line
    ? h(Rows.More, {}, 'type a query')
    : error
    ? h(Rows.More, {}, error)
    : agg
    ? waiting(got.answer) ?? h(Aggregate, { a: got.answer })
    : waiting(got.rows) ??
      window(
        e,
        io,
        rows(got.rows).map((b) => io.show(b, 'Inspect.Tile')),
        got.total?.count ?? rows(got.rows).length,
      )
  return h(Frame, { e, io, total: got.total?.count }, body)
}

// ---- the components, and the archetypes they occur in ----

let censusAsks = (e: Bundle, more: Asks = {}): Asks =>
  listing(e).open
    ? { sets: once(CENSUS.sets), tally: once(CENSUS.tally), ...more }
    : {}

// How many entities carry each component, once the census is in.
let carried = (got: Props['got']) =>
  got.tally?.tally ? census(rows(got.sets), got.tally.tally) : undefined

let named = (a: Bundle, b: Bundle) =>
  str(a, '_comp', 'name').localeCompare(str(b, '_comp', 'name'))

let CompList = ({ e, got, io }: Props) => {
  let n = carried(got)
  let all = rows(got.comps).toSorted(named)
  return h(
    Frame,
    { e, io, total: all.length || undefined },
    waiting(got.comps) ??
      window(
        e,
        io,
        all.map((b) =>
          io.show(b, 'Inspect.Tile', {
            count: n?.[str(b, '_comp', 'name')],
          })
        ),
      ),
  )
}

let ArchetypeList = ({ e, got, io }: Props) => {
  let tally = got.tally?.tally ?? {}
  let all = rows(got.sets).toSorted((a, b) =>
    (tally[b.entity.eid] ?? 0) - (tally[a.entity.eid] ?? 0)
  )
  return h(
    Frame,
    { e, io, total: all.length || undefined },
    waiting(got.sets) ?? waiting(got.tally) ??
      window(
        e,
        io,
        all.map((b) =>
          io.show(b, 'Inspect.Tile', { count: tally[b.entity.eid] })
        ),
      ),
  )
}

let PackageList = ({ e, got, io }: Props) => {
  let by = Map.groupBy(rows(got.comps), (b) => str(b, '_comp', 'package'))
  let all = rows(got.packs).toSorted((a, b) =>
    str(a, '_package', 'name').localeCompare(str(b, '_package', 'name'))
  )
  return h(
    Frame,
    { e, io, total: all.length || undefined },
    waiting(got.packs) ??
      window(
        e,
        io,
        all.map((b) => {
          let mine = (by.get(b.entity.eid) ?? []).toSorted(named)
          return io.show(b, 'Inspect.Tile', {
            comps: mine.map((c) => str(c, '_comp', 'name')),
            count: mine.length,
          })
        }),
      ),
  )
}

// A relation is a component its vocabulary marks `edge` (@yaks/edge).
let relational = (b: Bundle) => {
  let k = comp(b, '_comp').keywords as Record<string, unknown> | undefined
  return k?.edge != null && k.edge !== false
}

let RelationList = ({ e, got, io }: Props) => {
  let n = carried(got)
  let all = rows(got.comps).filter(relational).toSorted(named)
  return h(
    Frame,
    { e, io, total: all.length || undefined },
    waiting(got.comps) ??
      window(
        e,
        io,
        all.map((b) => {
          let k = comp(b, '_comp').keywords as Record<string, unknown>
          return h(
            'div',
            {},
            io.show(b, 'Inspect.Tile', {
              count: n?.[str(b, '_comp', 'name')],
            }),
            k.reversed
              ? h(
                Pairs,
                {},
                h(Pairs.Key, {}, 'from the far end'),
                h(Pairs.Value, {}, face(k.reversed)),
              )
              : null,
          )
        }),
      ),
  )
}

// Every component, whole: its keywords are JSON, which a projection cannot
// carry yet (README, Limits).
let COMPS = '._comp&.order=_comp.name'
let PACKAGES = '._package&.order=_package.name'

// What each kind of listing asks, and how it draws its rows.
let kinds: Record<string, Pick<View, 'asks' | 'Render'>> = {
  query: { asks: queryAsks, Render: QueryList },
  components: {
    asks: (e) => censusAsks(e, { comps: COMPS, packs: PACKAGES }),
    Render: CompList,
  },
  archetypes: { asks: (e) => censusAsks(e), Render: ArchetypeList },
  packages: {
    asks: (e): Asks => listing(e).open ? { packs: PACKAGES, comps: COMPS } : {},
    Render: PackageList,
  },
  relations: {
    asks: (e) => censusAsks(e, { comps: COMPS }),
    Render: RelationList,
  },
}
let kind = (e: Bundle) => kinds[listing(e).of ?? 'query'] ?? kinds.query

/** A listing, drawn as its kind of row says. */
export let lists: View[] = [{
  view: 'Inspect.List',
  match: parse('.listing'),
  asks: (e, io, ctx) => kind(e).asks?.(e, io, ctx) ?? {},
  Render: (p) => h(kind(p.e).Render, p),
}]
