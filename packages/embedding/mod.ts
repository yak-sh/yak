/**
 * @yaks/embedding — semantic search for a yaks graph: the entities nearest in
 * MEANING, beside the literal matches full-text gives.
 *
 * Search finds the word you typed. This finds the book you meant. A vector is
 * stored for every entity that has text, and `.near=<entity>` ranks the graph by
 * how close each one is to that entity's vector — which is how "more like this",
 * "related reading", and "you may already have written this" are all one query.
 *
 * It is generic over the text, exactly as
 * {@link https://jsr.io/@yaks/fts | @yaks/fts} is: a vocabulary declares
 * components, some of their columns hold prose, and {@link fields} chooses which
 * of them feed a vector. An entity gets ONE vector, joined from every field it
 * wears — a vector is a point in meaning-space and an entity is one thing.
 *
 * Five small pieces, each usable alone:
 *
 * - {@link fields} reads the embedded properties off a
 *   {@link https://jsr.io/@yaks/vocab | @yaks/vocab} schema;
 * - {@link schema} emits the one table the vectors live in;
 * - {@link sweep} embeds what changed and drops what left, off the write path;
 * - {@link nearest} ranks the stored vectors against a query vector;
 * - {@link semantic} — the {@link https://jsr.io/@yaks/sql | @yaks/sql}
 *   extension — compiles `.near=<entity>` and `.order=similar` into that
 *   ranking, so a neighbourhood mixes with ordinary filters on one line.
 *
 * ```ts
 * import { fields, hashEmbedder, schema, semantic, sweep } from '@yaks/embedding'
 * import { compile } from '@yaks/sql'
 * import { parse } from '@yaks/query'
 *
 * let text = fields(shop) // every text property the vocabulary declares
 * for (let stmt of schema()) db.exec(stmt)
 *
 * let embedder = hashEmbedder() // swap in a model when you have one
 * await sweep(db, text, embedder) // keeps the vectors true to the prose
 *
 * // the books most like this one, still under the rest of the line's filters
 * let near = semantic(db, embedder)
 * let { sql, params } = compile(
 *   parse('.near=book-1&.order=similar .price<20'),
 *   shop,
 *   { extend: [near] },
 * )
 * let hits = near.rank(bundlesFrom(sql, params)) // each wearing `rank.score`
 * ```
 *
 * The embedder is injected — {@link hashEmbedder} is the deterministic,
 * offline one shipped here, so tests and early development never reach a
 * network. Everything a query touches is synchronous; only the sweep, which may
 * be calling a hosted model, is not.
 *
 * It assumes the storage layout @yaks/sql's SQLite dialect reads and
 * {@link https://jsr.io/@yaks/sqlite | @yaks/sqlite} builds: an `entity` spine
 * of integer ids, one table per component keyed by an `entity` owner, and a
 * `tombstone` table naming the dead.
 *
 * @module
 */

export * from './driver.ts'
export * from './vector.ts'
export * from './embedder.ts'
export * from './fields.ts'
export * from './ddl.ts'
export * from './sweep.ts'
export * from './near.ts'
export * from './compile.ts'
