// What a read answers, beside what it selects: the query grammar's projection
// (@yaks/query `*`, `?comp`). Jeff, 2026-09-03: "we should query for the
// exact components we want: `.book&?recipe` = must be book, recipe is
// optional but requested. asking for all comps is i imagine most useful for
// debugging". So a row carries the components the filter names — by presence
// (`.book`), by request (`?loan`), or by a predicate of its own — and nothing
// else. A filter that names none (an `.eid=` fetch, a bare search term) left
// nothing out and answers the whole bundle, which is also the only useful
// answer to someone who does not yet know what they found; `*` asks for
// everything by name.
//
// A `.fields` projection names properties instead, each by a path that may
// cross references (`.fields=_prop.name,_prop.comp._comp.name`), and it
// answers in bundles too: each selected entity carries only the properties
// named, and each entity a path reaches comes back as a bundle of its own,
// carrying what was read off it. `projection` plans it: the rows are read with
// every reference a path crosses projected beside it, so a row names each
// entity it reaches, and `fold` turns them into those bundles. A property the
// projection names and the entity lacks is left out of its bundle; what the
// bundle answers for is its coverage, which a replica needs so that it clears
// such a property and keeps every one the projection never named (@yaks/sync).
//
// One rule for every door (T-38063): `Graph.read` answers it, and a
// subscription cuts the bundles a commit pushes the same way (@yaks/api
// subs.ts), so a page that swaps a query for a subscription gets the same rows.
// The graph decides the projection and asks storage for only those component
// tables. `only` keeps the answer true for an adapter that cannot narrow its
// read.

import { type And, type Fields, meaning, parse } from '@yaks/query'
import type { Hop, Vocab } from '@yaks/vocab'
import { type Bundle, type Comp, type Eid, reserved } from './bundle.ts'
import { composed } from './compose.ts'
import type { Graph } from './graph.ts'
import { then } from './pipe.ts'
import type { Query, ReadOpts, Row } from './storage.ts'

/** Which properties of each component a delivered bundle answers for, whether
 * or not it holds a value: `true` for the whole bundle, a component mapped to
 * `true` for all of that component, and `[]` for only its presence. A property
 * covered and left out is absent; one not covered was not read. */
export type Coverage = true | Record<string, true | string[]>

/** A query's `.fields` projection, planned. */
export type Projection = {
  /** the query its rows are read with: the one asked, with every reference a
   * path crosses projected beside it */
  query: And
  /** the columns naming each entity a path reaches through a reference, which
   * the answer carries beside the ones selected; none when no path crosses
   * one */
  reaches: string[]
  /** what each selected entity's bundle covers */
  own: Record<string, string[]>
  /** a whole bundle cut to its own named properties */
  cut: (b: Bundle) => Bundle
  /** the rows read with `query`, as bundles */
  fold: (rows: Row[]) => Projected
}

/** A projection's answer: each entity selected, in the rows' order, and apart
 * from them each entity a path reaches, with what each of those covers. */
export type Projected = {
  found: Bundle[]
  reached: Bundle[]
  covers: Map<Eid, Record<string, string[]>>
}

// One hop of a projected path: the property it reads, off the entity whose
// eid comes back in column `on`, or off the selected row itself.
type Step = Hop & { on?: string }

// A path's hops, spelled the way they read back.
let spelled = (hops: Hop[]) => hops.map((h) => `${h.comp}.${h.prop}`).join('.')

// A value onto a bundle being built. An entity's own number rides on its
// identity; an absent value is left out.
let put = (b: Bundle, s: Hop, value: unknown) => {
  if (value == null || s.prop == 'eid') return
  if (s.comp == 'entity') b.entity = { ...b.entity, [s.prop]: value }
  else ((b[s.comp] ??= {}) as Comp)[s.prop] = value
}

let cover = (into: Record<string, string[]>, s: Hop) => {
  if (s.comp == 'entity') return
  let props = into[s.comp] ??= []
  if (!props.includes(s.prop)) props.push(s.prop)
}

/**
 * The `.fields` projection a query asks for, or `null` when it asks for none.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { projection } from '@yaks/graph'
 * import { loadVocab, type PropSchema } from '@yaks/vocab'
 *
 * let comp = (properties: Record<string, PropSchema>) =>
 *   ({ component: true, type: 'object', properties })
 * let vocab = loadVocab({
 *   $defs: {
 *     doc: comp({ title: { type: 'string' } }),
 *     review: comp({
 *       stars: { type: 'number' },
 *       book: { type: 'string', ref: 'entity' },
 *     }),
 *   },
 * })
 * let q = '.review&.fields=review.stars,review.book.doc.title'
 * let p = projection(vocab, q)!
 * // each row names the book its review reaches
 * let rows = [{
 *   eid: 'r1',
 *   'review.stars': 4,
 *   'review.book.doc.title': 'Dune',
 *   'review.book': 'b1',
 * }]
 * assertEquals(p.fold(rows).found, [{
 *   entity: { eid: 'r1' },
 *   review: { stars: 4, book: 'b1' },
 * }])
 * assertEquals(p.fold(rows).reached, [{
 *   entity: { eid: 'b1' },
 *   doc: { title: 'Dune' },
 * }])
 * ```
 */
export let projection = (vocab: Vocab, query: Query): Projection | null => {
  let meant = meaning(vocab)(query)
  let ast = typeof meant == 'string' ? parse(meant) : meant
  let asked = ast.clauses.find((c): c is Fields => c.kind == 'fields')
  if (!asked) return null
  let paths = asked.fields.map((f) => {
    let col = f.path.join('.')
    let hops = vocab.aim(col)
    let steps: Step[] = hops.map((h, i) =>
      i ? { ...h, on: spelled(hops.slice(0, i)) } : h
    )
    return { col, steps, wake: f.wake }
  })
  // The references a row must name beside what was asked.
  let cols = new Set(paths.map((p) => p.col))
  let refs = paths.flatMap(({ steps, wake }) =>
    steps.flatMap((s) =>
      s.on && !cols.has(s.on)
        ? (cols.add(s.on), [{ path: s.on.split('.'), wake }])
        : []
    )
  )
  let fields: Fields = { ...asked, fields: [...asked.fields, ...refs] }
  let own: Record<string, string[]> = {}
  for (let { steps } of paths) cover(own, steps[0])
  return {
    query: refs.length
      ? { ...ast, clauses: ast.clauses.map((c) => c == asked ? fields : c) }
      : ast,
    reaches: [
      ...new Set(paths.flatMap((p) => p.steps.flatMap((s) => s.on ?? []))),
    ],
    own,
    cut: (b) => {
      let out: Bundle = { entity: { eid: b.entity.eid } }
      for (let { steps: [s] } of paths) {
        let from = s.comp == 'entity' ? b.entity : b[s.comp]
        put(out, s, (from as Record<string, unknown> | null)?.[s.prop])
      }
      return out
    },
    fold: (rows) => {
      let found = new Map<Eid, Bundle>()
      let reached = new Map<Eid, Bundle>()
      let covers = new Map<Eid, Record<string, string[]>>()
      for (let row of rows) {
        let eid = String(row.eid)
        let mine = found.get(eid) ?? { entity: { eid } }
        found.set(eid, mine)
        for (let { col, steps } of paths) {
          steps.forEach((s, i) => {
            // A hop reads a reference, the next hop's entity, or the leaf.
            let value = row[steps[i + 1]?.on ?? col]
            if (!s.on) return put(mine, s, value)
            let host = row[s.on]
            if (host == null) return
            let at = String(host)
            let b = reached.get(at) ?? { entity: { eid: at } }
            reached.set(at, b)
            put(b, s, value)
            let c = covers.get(at) ?? {}
            covers.set(at, c)
            cover(c, s)
          })
        }
      }
      return {
        found: [...found.values()],
        reached: [...reached.values()],
        covers,
      }
    },
  }
}

/** A projection's answer read through a graph: the rows its planned query
 * selects, folded into bundles. */
export let project = (
  graph: Graph,
  p: Projection,
  opts?: ReadOpts,
): Projected | Promise<Projected> => then(graph.rows(p.query, opts), p.fold)

/** A projection's answer as one list of bundles, one per entity: the ones
 * selected, then each one reached that is not among them. What a door with no
 * separate place for the entities reached answers. */
export let flat = ({ found, reached }: Projected): Bundle[] =>
  reached.length ? composed([...found, ...reached]) : found

/** The components a meant query's rows carry, or `null` for every one of
 * them. A `.fields` projection carries the components its paths start from. A
 * component asserted absent (`!archived`) names nothing the answer
 * could carry, and a word the vocabulary does not know asks for nothing. A lone
 * word asked for as present (`.module`) or requested (`?module`) is the
 * component, even where another component has a property of that name. */
export let named = (vocab: Vocab, query: Query): Set<string> | null => {
  let { clauses } = typeof query == 'string' ? parse(query) : query
  let fields = clauses.find((c): c is Fields => c.kind == 'fields')
  if (fields) {
    return new Set(fields.fields.flatMap((f) => {
      try {
        let comp = vocab.aim(f.path.join('.'))[0]?.comp
        return comp && comp != 'entity' ? [comp] : []
      } catch {
        return []
      }
    }))
  }
  if (clauses.some((c) => c.kind == 'every')) return null
  let want = new Set<string>()
  for (let c of clauses) {
    if (c.kind != 'pred' || !c.path.length) continue
    let absent = c.op == '=' &&
      (c.value == null || (c.value.kind == 'scalar' && !c.value.raw))
    if (absent) continue
    try {
      let comp = vocab.aim(c.path.join('.'), c.op == '!' || c.op == '?')[0]
        ?.comp
      if (comp && comp != 'entity') want.add(comp)
    } catch { /* a word this graph never declared asks for nothing */ }
  }
  return want.size ? want : null
}

/** The same for a query as it was typed: a bare property counts for the
 * component it resolves to (@yaks/query's meant.ts). `Graph.read` has meant its query
 * already, so it asks {@link named}. */
export let wanted = (vocab: Vocab, query: Query): Set<string> | null =>
  named(vocab, meaning(vocab)(query))

/** A row cut to what was asked for. The spine names it, its tombstone says it
 * is gone, a text query's `rank` is the answer's own word about it, and `$`
 * keys are the graph's notes on the row rather than components, so those ride
 * whatever the filter said. */
export let only = (want: Set<string> | null) => (b: Bundle): Bundle => {
  if (!want) return b
  let keep = (k: string) => reserved(k) || k == 'rank' || want.has(k)
  let keys = Object.keys(b)
  // A row that carries nothing else is its own answer.
  if (keys.every(keep)) return b
  let out: Bundle = { entity: b.entity }
  for (let k of keys) if (keep(k)) out[k] = b[k]
  return out
}
