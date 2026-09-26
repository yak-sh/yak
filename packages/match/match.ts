// The package's public functions: a query in, the bundles it selects (or the
// rows it answers) out.
//
// Compiling a query produces four things — a test every bundle must pass, the
// sets a match has to lie inside, an ordering, and a window — and this file is
// where they meet. The test is built once, in ./clause.ts, so a query that
// cannot be answered exactly is rejected here, at compile time, rather than
// halfway through an array of bundles.
//
// A query compiles once, the way a regular expression does. @yaks/query hands
// back the same tree for the same text, and the compiled form is kept against
// that tree (and the vocabulary, and the computed rules), so a page asking the
// same question every frame parses and plans it once. A query whose answer
// depends on the moment it is asked (`.due<today`) is the exception: it is
// compiled for its moment, every time.
//
// What a run reads is its source's to say. An array is scanned; a store that
// keeps its entities apart by component or by value (an {@link Index} with
// `wearing` or `keyed`) is read through the smallest set the query says its
// matches lie inside, and every candidate is still tested, so the index decides
// only how much is read.
//
// Results come back in the order the query asks for: `.order=field` sorts by
// that property (a leading `-` descending), the entity number breaks ties, and
// a `.limit`/`.after` window pages within that order — `.after` naming the
// entity to continue past, wherever it sits in the sequence. A window with no
// `.order` is newest-first by entity number, the way a database answers the
// same directives. With neither, the order is the source's: an array's own, or
// whatever order a store's index yields.

import {
  type After,
  type And,
  type Clause,
  type Distinct,
  type Limit,
  type Order,
  parse,
  type Query as Ast,
  type Tally,
} from '@yaks/query'
import { Unsupported, whole } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { BY, compile, type Ctx, type Need, type Test } from './clause.ts'
import {
  type Bundle,
  type Computed,
  type Index,
  index,
  live,
  type Read,
  reader,
} from './read.ts'

/** A query, as text (parsed by @yaks/query) or an already-built AST. */
export type Query = string | Ast

/** Options for one run: the moment a relative time phrase resolves against, and
 * the rules that read the vocabulary's computed properties. */
export type MatchOpts = {
  /** the reference moment for time phrases (default: now) */
  now?: number
  /** `comp.prop` → the value for one bundle, for a property the vocabulary
   * declares but never stores. The in-memory equivalent of @yaks/sql's
   * `derived` hook: an unregistered computed property is refused, as it is
   * there. */
  computed?: Computed
}

/** What a run reads: an array of bundles, or a store's {@link Index} of
 * them. */
export type Source = readonly Bundle[] | Index

/** A compiled query: the bundles of a source that it selects, in order. */
export type Select = (from: Source) => Bundle[]

/**
 * A compiled filter, applied to one bundle at a time. `among` is what answers
 * questions about other entities — a reference followed to its target, the
 * backlinks of an id, the children of a reverse hop — and defaults to the
 * bundle alone. A caller testing many bundles against one set passes it once,
 * as an {@link Index}. Ordering and windowing are not its job: a filter reports
 * whether one bundle matches, and nothing about where it ranks.
 */
export type Filter = (bundle: Bundle, among?: Source) => boolean

let ast = (q: Query): And => typeof q == 'string' ? parse(q) : q
let indexed = (from: Source): Index =>
  Array.isArray(from) ? index(from) : from as Index

// The directives that sit in the clause list without filtering anything, and
// the ones a selection refuses: an aggregate is a row shape, not a selection
// of entities (rows() lifts it out first), and `.near` and `.edges` need an
// index no bundle holds. A
// projection (`fields`, `*`) names which properties the result should carry and
// nothing about which bundles match, so it is carried along and never tested.
let DIRECTIVES = new Set([
  'order',
  'near',
  'count',
  'distinct',
  'tally',
  'fields',
  'every',
  'limit',
  'after',
  'edges',
])
let DECLINED = new Set([
  'near',
  'count',
  'distinct',
  'tally',
  'edges',
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

// The compiled forms already built, per vocabulary, per computed-rule registry,
// per query tree, one for each function that compiles one. A form that read
// the reference moment while compiling keeps that moment beside it and is
// reused only for the same one.
type Kind = 'select' | 'filter' | 'rows'
type Kept = { at?: number; made: unknown }
let NONE: Computed = {}
let kept = new WeakMap<
  Vocab,
  WeakMap<Computed, WeakMap<And, Partial<Record<Kind, Kept>>>>
>()

// Build `make` once for this query, vocabulary and rule set, and hand back the
// same compiled form every later time — unless compiling it asked what time it
// is, in which case it is only the same form at the same moment.
let once = <T>(
  q: And,
  vocab: Vocab,
  opts: MatchOpts,
  kind: Kind,
  make: (ctx: Ctx) => T,
): T => {
  let computed = opts.computed ?? NONE
  let byRules = kept.get(vocab)
  if (!byRules) kept.set(vocab, byRules = new WeakMap())
  let byTree = byRules.get(computed)
  if (!byTree) byRules.set(computed, byTree = new WeakMap())
  let forms = byTree.get(q)
  if (!forms) byTree.set(q, forms = {})
  let hit = forms[kind]
  if (hit && (hit.at === undefined || hit.at === opts.now)) {
    return hit.made as T
  }
  let now = opts.now ?? Date.now()
  let timed = false
  let ctx: Ctx = {
    v: vocab,
    get now() {
      timed = true
      return now
    },
    computed: opts.computed ?? {},
  }
  let made = make(ctx)
  forms[kind] = { at: timed ? opts.now ?? NaN : undefined, made }
  return made
}

// One compile step, shared by matcher() and filter(): the query's clauses, the
// test its filter clauses build, and the sets a match lies inside. Every
// refusal happens here.
let compiled = (
  ctx: Ctx,
  q: And,
): { cs: Clause[]; test: Test; needs: Need[] } => {
  let cs = q.clauses
  for (let c of cs) {
    if (DECLINED.has(c.kind)) throw new Unsupported(`.${c.kind}`, '', BY)
  }
  let filters = cs.filter((c) => !DIRECTIVES.has(c.kind))
  let { test, needs } = compile(ctx, { kind: 'and', clauses: filters })
  return { cs, test, needs }
}

// A directive's path resolved to the one property it names.
let field = (ctx: Ctx, path: string): Read => {
  let hops = ctx.v.aim(path)
  if (hops.length != 1) throw new Unsupported('an ordered path', path, BY)
  if (!hops[0].prop) throw whole(ctx.v, hops[0].comp, BY)
  let read = reader(ctx.v, hops[0].comp, hops[0].prop, ctx.computed)
  if (!read) throw new Unsupported('a computed property here', path, BY)
  return read
}

// The sort a query asks for, or null to keep the order given. An explicit
// `.order` survives a window — a window sets how much of a sequence to return,
// never which sequence — and the entity number breaks its ties, so the order is
// total and a page cut here holds the rows a page cut in SQL holds. A window
// with no `.order` is that tiebreak alone: newest first.
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

// The bundles a run tests: the smallest of the sets the query's matches lie
// inside that the source can hand over, or all of them. An array hands over
// only what it holds, so it is scanned; an id list is looked up one by one.
let candidates = (needs: Need[], among: Index): Iterable<Bundle> => {
  let best: Iterable<Bundle> | undefined
  let size = Infinity
  for (let n of needs) {
    if ('eids' in n) {
      if (n.eids.length >= size) continue
      size = n.eids.length
      best = n.eids.flatMap((eid) => among.of(eid) ?? [])
    } else if ('keys' in n) {
      if (!among.keyed) continue
      let sets = n.keys.map((k) => among.keyed!(n.comp, n.prop, k))
      let total = sets.reduce((sum, s) => sum + s.size, 0)
      if (total >= size) continue
      size = total
      best = sets.length == 1 ? sets[0].values() : sets.flatMap((s) => [
        ...s.values(),
      ])
    } else if (among.wearing) {
      let set = among.wearing(n.comp)
      if (set.size >= size) continue
      size = set.size
      best = set.values()
    }
  }
  return best ?? among.list
}

/**
 * Compile a query into the selection it names: the bundles of a source that
 * match, ordered and windowed as the query asks. The source is all the data
 * the run can see — a reference, a backlink or a reverse hop is looked up in it
 * — and tombstoned entities are left out, the way a database leaves out rows it
 * has marked deleted.
 *
 * Throws {@link Unsupported} at compile time for anything this package cannot
 * answer exactly — see "Refused queries" in the README.
 * `matcher('.status=live&.price<20', vocab)(bundles)` is the matching bundles.
 */
export let matcher = (
  query: Query,
  vocab: Vocab,
  opts: MatchOpts = {},
): Select =>
  once(ast(query), vocab, opts, 'select', (ctx) => selection(ctx, ast(query)))

// The selection a query names, compiled against one context — shared with
// rows(), whose selection is compiled in the same breath and so must read the
// same moment.
let selection = (ctx: Ctx, q: And): Select => {
  let { cs, test, needs } = compiled(ctx, q)
  let limit = find<Limit>(cs, 'limit')
  let after = find<After>(cs, 'after')
  let sort = sorter(ctx, cs, !!(limit || after))
  return (from) => {
    let among = indexed(from)
    let out: Bundle[] = []
    for (let b of candidates(needs, among)) {
      if (live(b) && test(b, among)) out.push(b)
    }
    if (sort) out.sort(sort)
    if (after && sort) out = past(out, among.list, after.n, sort)
    return limit ? out.slice(0, limit.n) : out
  }
}

// The `.after` cursor: the rows strictly past the anchor entity's own place in
// the order. The anchor is found by its entity number — one cursor form for
// every ordering — and it is looked up in the whole array rather than among the
// matches, because an anchor that no longer matches the query still names a
// place in the order. An anchor that is not in the array at all leaves the page
// whole, which is the first page. @yaks/sql compiles the same rule as a keyset
// predicate.
let past = (
  out: Bundle[],
  bundles: readonly Bundle[],
  n: number,
  sort: (a: Bundle, b: Bundle) => number,
): Bundle[] => {
  let at = bundles.find((b) => b.entity.num == n)
  return at ? out.filter((b) => sort(at, b) < 0) : out
}

/** One row of {@link rows}: `{ eid }`, or an aggregate's `{ value, n }`. */
export type Row = Record<string, unknown>

let AGGS = new Set(['count', 'distinct', 'tally'])
// What shapes a sequence. An aggregate is not one: it counts everything the
// filter selects, so a `.limit=20` board's tally still says how many match.
let SEQUENCE = new Set(['order', 'limit', 'after'])

/**
 * Compile a query into the rows @yaks/sql's `rows()` answers for it, over the
 * bundles in hand: one `{ eid }` per match, or an aggregate's rows. `.count` is
 * one `{ value: '', n }`; `.tally=prop` is a `{ value, n }` per value and
 * `.distinct=prop` a `{ value }` per value, empty values dropped and sorted by
 * value. As there, only a text, enum or eid property is tallied, since a
 * number or a time read as text would not compare the same, and an aggregate
 * ignores `.order`, `.limit` and `.after`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab } from '@yaks/vocab'
 *
 * let status = { type: 'string' }
 * let vocab = loadVocab([{
 *   $defs: { book: { component: true, properties: { status } } },
 * }])
 * let sold = (eid: string) => ({ entity: { eid }, book: { status: 'sold' } })
 * assertEquals(rows('.book&.tally=status', vocab)([sold('b1'), sold('b2')]), [
 *   { value: 'sold', n: 2 },
 * ])
 * ```
 */
export let rows = (
  query: Query,
  vocab: Vocab,
  opts: MatchOpts = {},
): (from: Source) => Row[] =>
  once(ast(query), vocab, opts, 'rows', (ctx) => {
    let cs = ast(query).clauses
    let agg = cs.find((c) => AGGS.has(c.kind))
    let select = selection(ctx, {
      kind: 'and',
      clauses: agg ? cs.filter((c) => c != agg && !SEQUENCE.has(c.kind)) : cs,
    })
    if (!agg) {
      return (bs: Source) => select(bs).map((b) => ({ eid: b.entity.eid }))
    }
    if (agg.kind == 'count') {
      return (bs: Source) => [{ value: '', n: select(bs).length }]
    }
    let path = (agg as Distinct | Tally).path.join('.')
    let { read, tag } = field(ctx, path)
    if (!['text', 'enum', 'eid'].includes(tag)) {
      throw new Unsupported('.distinct/.tally', `over a ${tag} property`, BY)
    }
    return (bs: Source) => {
      let n = new Map<string, number>()
      for (let b of select(bs)) {
        let v = read(b)
        if (v != null && String(v) != '') {
          n.set(String(v), (n.get(String(v)) ?? 0) + 1)
        }
      }
      let values = [...n.keys()].sort()
      return agg.kind == 'tally'
        ? values.map((value) => ({ value, n: n.get(value) }))
        : values.map((value) => ({ value }))
    }
  })

/**
 * Compile a query into its filter alone — does this one bundle match? — for a
 * caller that already keeps its own order, or that is re-testing the single
 * bundle that just changed rather than sweeping a whole array.
 *
 * The query's ordering and window are ignored (a window is a property of a
 * sequence, not of one bundle); everything else answers exactly as
 * {@link matcher} does.
 */
export let filter = (
  query: Query,
  vocab: Vocab,
  opts: MatchOpts = {},
): Filter =>
  once(ast(query), vocab, opts, 'filter', (ctx) => {
    let { test } = compiled(ctx, ast(query))
    return (bundle: Bundle, among: Source = [bundle]) =>
      live(bundle) && test(bundle, indexed(among))
  })
