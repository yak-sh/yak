/**
 * @yaks/edge — links between entities, as a component.
 *
 * A relationship in a yaks graph is not a foreign-key column; it is an entity
 * of its own carrying the `edge{from, to, ord}` component and a RELATION TAG
 * that says what kind of link it is. A blog says `post cites post`; a bookstore
 * says `book cites book`; the shape is the same, and the relations are yours to
 * declare — this package ships the link, the mechanism, and not one relation.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
 *
 * let blog = {
 *   $defs: {
 *     post: { type: 'object', kind: true, properties: { title: {} } },
 *     // one component, and `cites` is a relation
 *     cites: { type: 'object', relation: true },
 *   },
 * }
 * let vocab = loadVocab([edgeDoc, blog], [edgeKeywords])
 * // g.apply([link('p1', 'cites', 'p2')])
 * ```
 *
 * Four things follow from that:
 *
 * - **An edge is named by what it says.** {@link edgeEid} hashes the sentence,
 *   so two writers who state the same link land on one entity and a writer who
 *   takes a link back ({@link unlink}) names it without a lookup.
 * - **A link lives only while both ends do.** Both ends are references with
 *   `death: cascade`, so a deleted post takes its links with it.
 * - **Half a sentence is refused**, by name: an edge with no relation, or with
 *   an end missing, never reaches storage ({@link edges} registers the check).
 * - **Walking is querying.** {@link walk} answers `out`, `in` and a bounded
 *   `reach` through {@link https://jsr.io/@yaks/graph | @yaks/graph}'s Storage
 *   seam, and {@link traverse} teaches
 *   {@link https://jsr.io/@yaks/sql | @yaks/sql} the two clauses it declines on
 *   its own — `.reaches[cites,<=3]=p1` as a recursive walk, `.edges[cites]!` as
 *   the rider that carries a result's links back with it.
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
