/**
 * @yaks/ram — the in-memory storage adapter: a
 * {@link https://jsr.io/@yaks/graph | @yaks/graph} `Storage` over a plain Map
 * of bundles, fully synchronous, with no database underneath it.
 *
 * ## Why
 * A graph needs somewhere to keep its entities. A server keeps them in SQLite;
 * a page, a worker, or a test has nowhere to put a database and nothing to
 * install — so this package keeps them in a Map, answers queries with
 * {@link https://jsr.io/@yaks/match | @yaks/match}, and speaks the same five
 * members every other adapter does. The same `apply()`, the same query
 * grammar, the same bundles.
 *
 * ## Use
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * // let g = graph({ storage: ram(vocab), vocab })
 * // g.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }])
 * // g.read('.kind=doc') // → the bundles, no await
 * ```
 *
 * {@link ram} binds a {@link Store} to a vocabulary. `ddl()` returns `[]`
 * and `install()` does nothing — a Map has no schema. `tx()` commits when its
 * body returns and rolls back when it throws, so a refused batch leaves the
 * map exactly as it was.
 *
 * ## What it is not
 * It is not a database: there is no persistence, no process boundary, and no
 * index. A query it cannot answer exactly — an aggregate, a nearest-neighbour,
 * a graph walk — throws @yaks/match's `Unsupported`, the same decline
 * @yaks/sql throws.
 *
 * @module
 */

export { type Query, ram, type RamOpts, type Store, type Tx } from './store.ts'
