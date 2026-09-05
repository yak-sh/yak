/**
 * @yaks/match — evaluate a {@link https://jsr.io/@yaks/query | @yaks/query} AST
 * as a predicate over entity bundles held in memory. No database, no SQL: the
 * same query line a server answers from storage, answered from an array.
 *
 * ## Why
 * A query is one grammar with two evaluators. Where the data lives in a
 * database, {@link https://jsr.io/@yaks/sql | @yaks/sql} compiles the query into
 * a statement. Where the data is already in hand — a page's local state, a
 * cache, a test fixture, a worker holding a working set — there is nothing to
 * compile against, so this package evaluates the same AST directly. A saved
 * filter written once therefore selects the same entities on both sides.
 *
 * ## Use
 * ```ts
 * import { matcher } from '@yaks/match'
 *
 * let live = matcher('.status=live&.price<20&.order=-price', vocab)
 * live(bundles) // the matching bundles, dearest first
 * ```
 *
 * {@link matcher} compiles a query into a selection over a bundle SET (which
 * answers references, backlinks and reverse hops, and which the ordering and
 * window apply to). {@link filter} compiles the same query into a per-bundle
 * test, for a caller re-checking one bundle that changed.
 *
 * ## Declines
 * A question this package cannot answer EXACTLY throws
 * {@link https://jsr.io/@yaks/sql/doc/~/Unsupported | Unsupported} — the same
 * error @yaks/sql throws, so a caller with both has one decline contract and
 * one `catch`. What it declines and why is in the README.
 *
 * @module
 */

export {
  type Filter,
  filter,
  matcher,
  type MatchOpts,
  type Query,
  type Select,
} from './match.ts'
export { type Index, index, live, type Read } from './read.ts'
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
export { clause, type Ctx, type Test } from './clause.ts'
export { Unsupported } from '@yaks/sql'
