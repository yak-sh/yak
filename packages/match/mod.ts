/**
 * @yaks/match — run a {@link https://jsr.io/@yaks/query | @yaks/query} AST as a
 * predicate over entity bundles held in memory. No database, no SQL: the same
 * query text a server answers from storage, answered from an array.
 *
 * ## Why
 * One query grammar has two evaluators. Where the data is in a database,
 * {@link https://jsr.io/@yaks/sql | @yaks/sql} compiles the query into a SQL
 * statement. Where the data is already in hand — a page's local state, a cache,
 * a test fixture, a worker holding a working set — there is nothing to compile
 * against, so this package runs the same AST directly. A saved filter written
 * once therefore selects the same entities on both sides.
 *
 * ## Use
 * ```ts
 * import { matcher } from '@yaks/match'
 * import { loadVocab } from '@yaks/vocab'
 *
 * let vocab = loadVocab([{
 *   $defs: {
 *     book: {
 *       component: true,
 *       type: 'object',
 *       properties: { status: { type: 'string' }, price: { type: 'number' } },
 *     },
 *   },
 * }])
 * let bundles = [
 *   { entity: { eid: 'b1' }, book: { status: 'live', price: 12 } },
 *   { entity: { eid: 'b2' }, book: { status: 'live', price: 30 } },
 *   { entity: { eid: 'b3' }, book: { status: 'live', price: 15 } },
 * ]
 * let live = matcher('.status=live&.price<20&.order=-price', vocab)
 * live(bundles) // b3, b1: the matching bundles, most expensive first
 * ```
 *
 * {@link matcher} compiles a query into a selection over an array of bundles,
 * which is also where references, backlinks and reverse hops are looked up, and
 * which the ordering and the `.limit`/`.after` window apply to. {@link filter}
 * compiles the same query into a test on one bundle, for a caller re-checking
 * the single entity that changed.
 *
 * A property a vocabulary declares but never stores (`computed: true`) is read
 * through `opts.computed` — `comp.prop` → the value for one bundle — the way
 * @yaks/sql reads it through its `derived` hook, so an application states the
 * rule once and both evaluators return the same rows.
 *
 * ## Refusals
 * A question this package cannot answer exactly throws
 * {@link https://jsr.io/@yaks/sql/doc/~/Unsupported | Unsupported} — the error
 * @yaks/sql throws too, so a caller using both has one error type to catch.
 * What it refuses, and why, is in the README.
 *
 * @module
 */

export {
  type Filter,
  filter,
  matcher,
  type MatchOpts,
  type Query,
  type Row,
  rows,
  type Select,
} from './match.ts'
export { type Bundle, type Computed, type Eid, live } from './read.ts'
// The value and text rules on their own: the pieces matcher() and filter() are
// built from, exported for a caller testing one value or one search term by
// hand.
export {
  type Check,
  check,
  cmp,
  contains,
  eq,
  EXISTS,
  ne,
  time,
} from './value.ts'
export { search, tokens } from './text.ts'
export { Unsupported } from '@yaks/sql'
