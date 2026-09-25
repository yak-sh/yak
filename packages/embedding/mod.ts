/**
 * @yaks/embedding — semantic search for a yaks graph: the entities nearest in
 * meaning, beside the literal matches full-text gives.
 *
 * Full-text search finds the word you typed. This finds the book you meant. A
 * vector is stored for every entity that has text, and `.near=<entity>` ranks
 * the graph by how close each one is to that entity's vector — which is how
 * "more like this", "related reading" and "you may already have written this"
 * are all the same query.
 *
 * It is generic over the text, exactly as {@link https://jsr.io/@yaks/fts |
 * @yaks/fts} is: a vocabulary declares components, some of their properties
 * hold prose, and {@link fields} chooses which of them a vector is made from.
 * An entity gets one vector, made from all of its text fields joined together —
 * a vector is a point in a space of meanings, and an entity is one thing.
 *
 * Five small pieces, each usable alone:
 *
 * - {@link fields} reads the embedded properties off a
 *   {@link https://jsr.io/@yaks/vocab | @yaks/vocab} schema;
 * - {@link schema} returns the statements for the table the vectors live in,
 *   and for the dirty flag an approximate index reads ({@link dirty},
 *   {@link clean}) to know it needs rebuilding;
 * - {@link sweep} embeds what changed and drops what left, off the write path,
 *   reading what moved from a queue the database's own triggers keep
 *   ({@link watch});
 * - {@link nearest} ranks the stored vectors against a query vector;
 * - {@link semantic} — the {@link https://jsr.io/@yaks/sql | @yaks/sql}
 *   extension — compiles `.near=<entity>` and `.order=similar` into that
 *   ranking, so a neighbourhood combines with ordinary filters in one query.
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
 * await sweep(db, text, embedder) // keeps the vectors in step with the text
 *
 * // the books most like this one, still under the rest of the query's filters
 * let near = semantic(db, embedder)
 * let { sql, params } = compile(
 *   parse('.near=book-1&.order=similar .price<20'),
 *   shop,
 *   { extend: [near] },
 * )
 * let hits = near.rank(bundlesFrom(sql, params)) // each with a `rank.score`
 * ```
 *
 * The embedder is injected — {@link hashEmbedder} is the deterministic,
 * offline one shipped here and {@link remote} is one over HTTP, so tests and
 * early development never reach a network. Everything a query touches is
 * synchronous; only the sweep, which may be calling a hosted model, is not.
 *
 * As a plugin it is two exports and nothing else: `./rules` creates the vector
 * table and registers the `.near` compiler, `./service` keeps settling what the
 * queue holds, and the model, endpoint and key are the options named
 * beside the plugin in the config. It declares no component — no client ever
 * writes a vector.
 *
 * It assumes the storage layout @yaks/sql's SQLite dialect reads and
 * {@link https://jsr.io/@yaks/sqlite | @yaks/sqlite} creates: an `entity`
 * table of integer ids, one table per component keyed by an `entity` owner,
 * and a `tombstone` table listing deleted entities.
 *
 * @module
 */

export * from './vector.ts'
export * from './embedder.ts'
export * from './remote.ts'
export * from './fields.ts'
export * from './ddl.ts'
export * from './sweep.ts'
export * from './owed.ts'
export * from './near.ts'
export * from './mark.ts'
export * from './compile.ts'
