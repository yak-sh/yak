// The door: a query in, the bundles it selects out.
//
// Compiling a query yields three things — a test every bundle must pass, an
// ordering, and a window — and this file is where they meet. The test is built
// once (./clause.ts), so a query that cannot be answered exactly refuses HERE,
// when it is compiled, not halfway through a set.
//
// The order a selection comes back in is the order the query asks for:
// `.order=field` sorts by that column (a leading `-` descending), the entity
// number breaks its ties, and a `.limit`/`.after` window pages WITHIN that
// order — `.after` naming the entity to continue past, wherever it sits in the
// sequence. A window with no `.order` is newest-first by entity number, the way
// a database answers the same directives. With neither, the bundles keep the
// order they were given.

import {
  type After,
  type And,
  type Clause,
  type Limit,
  type Order,
  parse,
  type Query as Ast,
} from '@yaks/query'
import type { Bundle } from '@yaks/graph'
import { Unsupported } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { BY, clause, type Ctx, type Test } from './clause.ts'
import { column, index, live, type Read } from './read.ts'

/** A query, as text (parsed by @yaks/query) or an already-built AST. */
export type Query = string | Ast

/** What rides a run: the moment a relative time phrase resolves against. */
export type MatchOpts = {
  /** the reference moment for time phrases (default: now) */
  now?: number
}

/** A compiled query: the bundles of a set that it selects, in order. */
export type Select = (bundles: readonly Bundle[]) => Bundle[]

/**
 * A compiled filter, judged one bundle at a time. `among` is the set that
 * answers questions about OTHER entities — a reference followed to its target,
 * the backlinks of an id, the children of a reverse hop — and defaults to the
 * bundle alone. Ordering and windowing are not its business: a filter says
 * whether one bundle belongs, and nothing about where it belongs.
 */
export type Filter = (bundle: Bundle, among?: readonly Bundle[]) => boolean

let ast = (q: Query): And => typeof q == 'string' ? parse(q) : q

// The directives that ride the clause list rather than filter, and the ones
// this package refuses: an aggregate is a row shape, not a selection of
// entities, and a nearest-neighbour or a graph walk needs an index no bundle
// carries.
let DIRECTIVES = new Set([
  'order',
  'near',
  'count',
  'distinct',
  'tally',
  'fields',
  'limit',
  'after',
  'edges',
  'reaches',
])
let DECLINED = new Set([
  'near',
  'count',
  'distinct',
  'tally',
  'edges',
  'reaches',
])

let find = <T extends Clause>(cs: Clause[], kind: string): T | undefined =>
  cs.find((c) => c.kind == kind) as T | undefined

// SQL's ordering, in memory: an absent value first, then numbers, then text.
let rank = (v: unknown): number => v == null ? 0 : typeof v == 'number' ? 1 : 2
let compare = (a: unknown, b: unknown): number => {
  if (rank(a) != rank(b)) return rank(a) - rank(b)
  if (rank(a) == 0) return 0
  if (rank(a) == 1) return (a as number) - (b as number)
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

// One compile, shared by both doors: the context, the query's clauses, and the
// test its filter clauses make. Every decline happens here.
let compiled = (
  query: Query,
  vocab: Vocab,
  opts: MatchOpts,
): { ctx: Ctx; cs: Clause[]; test: Test } => {
  let ctx: Ctx = { v: vocab, now: opts.now ?? Date.now() }
  let cs = ast(query).clauses
  for (let c of cs) {
    if (DECLINED.has(c.kind)) throw new Unsupported(`.${c.kind}`, '', BY)
  }
  let filters = cs.filter((c) => !DIRECTIVES.has(c.kind))
  return { ctx, cs, test: clause(ctx, { kind: 'and', clauses: filters }) }
}

// A directive's path resolved to the one column it names.
let field = (ctx: Ctx, path: string): Read => {
  let hops = ctx.v.aim(path)
  if (hops.length != 1) throw new Unsupported('an ordered path', path, BY)
  let read = column(ctx.v, hops[0].comp, hops[0].prop)
  if (!read) throw new Unsupported('a computed column here', path, BY)
  return read
}

// The sort a query asks for, or null to keep the order given. An explicit
// `.order` SURVIVES a window — a window says how much of a sequence to answer
// with, never which sequence — and the entity number breaks its ties, so the
// order is TOTAL and a page cut here holds the rows a page cut in SQL holds. A
// window with no `.order` is that tiebreak alone: newest first.
let sorter = (
  ctx: Ctx,
  cs: Clause[],
  windowed: boolean,
): ((a: Bundle, b: Bundle) => number) | null => {
  let order = find<Order>(cs, 'order')
  if (!order) return windowed ? newest : null
  let desc = order.value.startsWith('-')
  let read = field(ctx, desc ? order.value.slice(1) : order.value).read
  return (a, b) => (desc ? -1 : 1) * compare(read(a), read(b)) || newest(a, b)
}
let newest = (a: Bundle, b: Bundle) =>
  -compare(a.entity.num ?? null, b.entity.num ?? null)

/**
 * Compile a query into the selection it names: the bundles of a set that match,
 * ordered and windowed as the query asks. The set is the whole world for that
 * run — a reference, a backlink or a reverse hop is answered from it, and
 * tombstoned entities are excluded from the answer the way a database excludes
 * its graves.
 *
 * Throws {@link Unsupported} at compile time for anything this package cannot
 * answer exactly — see the README's Declines.
 *
 * ```ts
 * let live = matcher('.status=live&.price<20', vocab)
 * live(bundles) // the matching bundles
 * ```
 */
export let matcher = (
  query: Query,
  vocab: Vocab,
  opts: MatchOpts = {},
): Select => {
  let { ctx, cs, test } = compiled(query, vocab, opts)
  let limit = find<Limit>(cs, 'limit')
  let after = find<After>(cs, 'after')
  let sort = sorter(ctx, cs, !!(limit || after))
  return (bundles) => {
    let among = index(bundles)
    let hits = bundles.filter((b) => live(b) && test(b, among))
    let out = sort ? [...hits].sort(sort) : [...hits]
    if (after && sort) out = past(out, bundles, after.n, sort)
    return limit ? out.slice(0, limit.n) : out
  }
}

// The `.after` cursor: the rows strictly past the anchor entity's own place in
// the order. The anchor is found by its spine number — one cursor spelling
// however the answer is ordered — and it is looked up in the WHOLE set rather
// than the hits, because an anchor that no longer matches the query still names
// a place in the order. An anchor that is not in the set at all leaves the page
// whole, which is the first page. This is the keyset @yaks/sql compiles.
let past = (
  out: Bundle[],
  bundles: readonly Bundle[],
  n: number,
  sort: (a: Bundle, b: Bundle) => number,
): Bundle[] => {
  let at = bundles.find((b) => b.entity.num == n)
  return at ? out.filter((b) => sort(at, b) < 0) : out
}

/**
 * Compile a query into its FILTER alone — does this one bundle belong? — for a
 * caller that already keeps its own order, or that is re-testing a single
 * bundle that just changed rather than sweeping a whole set.
 *
 * The query's ordering and window are ignored (a window is a property of a set,
 * not of a bundle); everything else answers exactly as {@link matcher} does.
 */
export let filter = (
  query: Query,
  vocab: Vocab,
  opts: MatchOpts = {},
): Filter => {
  let { test } = compiled(query, vocab, opts)
  return (bundle, among = [bundle]) =>
    live(bundle) && test(bundle, index(among))
}
