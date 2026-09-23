/**
 * @yaks/edge — links between entities, as a component.
 *
 * A relationship in a yaks graph is not a foreign-key column; it is an entity
 * of its own, carrying the `edge{from, to, ord}` component plus a second
 * component naming the relation. A blog declares that a post cites a post; a
 * bookstore declares that a book cites a book; the structure is the same, and
 * the relations are yours to declare — this package ships the link mechanism
 * and no relations of its own.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
 *
 * let blog = {
 *   $defs: {
 *     post: { type: 'object', kind: true, properties: { title: { type: 'string' } } },
 *     // one component, declared as a relation
 *     cites: { type: 'object', relation: true },
 *   },
 * }
 * let vocab = loadVocab([edgeDoc, blog], [edgeKeywords])
 * // g.apply([link('p1', 'cites', 'p2')])
 * ```
 *
 * Four things follow from that:
 *
 * - **A link's id is derived from the link itself.** {@link edgeEid} hashes
 *   `from | relation | to`, so two writers who create the same link land on one
 *   entity, and a writer removing a link ({@link unlink}) computes its id
 *   without a lookup.
 * - **A link lives only while both endpoints do.** Both endpoints are
 *   references declared `death: cascade`, so deleting a post deletes its links.
 * - **An incomplete link is rejected** by name: an edge component with no
 *   relation beside it, or with an endpoint missing, never reaches storage
 *   ({@link edges} registers the check).
 * - **Walking is querying.** {@link walk} implements `out`, `in` and a bounded
 *   `reach` over {@link https://jsr.io/@yaks/graph | @yaks/graph}'s `Storage`
 *   interface, and {@link traverse} adds to
 *   {@link https://jsr.io/@yaks/sql | @yaks/sql} the two clauses it cannot
 *   compile on its own — `.cites[<=3]->p1`, a recursive walk over one relation,
 *   and `.edges[cites]!`, which returns a result's links alongside it.
 *
 * It imports no platform API, so the same code runs on a server, in a worker,
 * and in a browser tab.
 *
 * @module
 */

export * from './keywords.ts'
export * from './relations.ts'
export * from './comp.ts'
export * from './eid.ts'
export * from './say.ts'
export * from './guard.ts'
export * from './plugin.ts'
export * from './sql.ts'
export * from './walk.ts'
