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
 * Six small pieces, each usable alone:
 *
 * - {@link fields} reads the embedded properties off a
 *   {@link https://jsr.io/@yaks/vocab | @yaks/vocab} schema;
 * - {@link schema} returns the statements for the table the vectors live in,
 *   and for the record of the quantized index built from them, which
 *   {@link build} makes again once enough of them changed;
 * - {@link sweep} embeds what changed and drops what left, off the write path,
 *   reading what moved from a queue the database's own triggers keep
 *   ({@link watch});
 * - {@link nearest} ranks the stored vectors against a query vector;
 * - {@link meaning} embeds a new phrase and returns nearby entities with
 *   excerpts from the text that made their vectors;
 * - {@link semantic} — the {@link https://jsr.io/@yaks/sql | @yaks/sql}
 *   extension — compiles `.near=<entity>` and `.order=similar` into that
 *   ranking, so a neighbourhood combines with ordinary filters in one query.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { storage } from '@yaks/sqlite'
 * import { open } from '@yaks/sqlite/db'
 * import {
 *   fields,
 *   hashEmbedder,
 *   schema,
 *   semantic,
 *   sweep,
 * } from '@yaks/embedding'
 *
 * let title = { type: 'string', search: true }
 * let price = { type: 'number' }
 * let shop = loadVocab([{
 *   $defs: { book: { component: true, properties: { title, price } } },
 * }])
 * let db = open(':memory:')
 * for (let stmt of storage(db, shop).ddl()) db.query(stmt)
 * graph({ storage: storage(db, shop), vocab: shop }).apply([
 *   { entity: { eid: 'book-1' }, book: { title: 'The Hobbit', price: 12 } },
 *   { entity: { eid: 'book-2' }, book: { title: 'Farmer Giles', price: 9 } },
 * ])
 *
 * let text = fields(shop) // every text property the vocabulary declares
 * for (let stmt of schema()) db.query(stmt)
 *
 * let embedder = hashEmbedder() // swap in a model when you have one
 * await sweep(db, text, embedder) // keeps the vectors in step with the text
 *
 * // the books most like this one, still under the rest of the query's filters
 * let near = semantic(db, embedder)
 * let store = storage(db, shop, { extend: [near] })
 * let hits = near.rank(store.read('.near=book-1&.order=similar .price<20'))
 * // each with a `rank.score`
 * ```
 *
 * The embedder is injected — {@link hashEmbedder} is the deterministic,
 * offline one shipped here and {@link remote} is one over HTTP, so tests and
 * early development never reach a network. `.near` reads a stored vector
 * synchronously; searching new words embeds them asynchronously.
 *
 * As a plugin, `./rules` creates the vector table, registers the `.near`
 * compiler and answers phrase searches; `./service` settles the queue. A
 * provider and a model are named beside the plugin in the config, and a
 * provider reached over HTTP is a `provider` row serving the `model` row
 * (@yaks/model). It declares no component — no client ever writes a vector.
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
export * from './workers-ai.ts'
export * from './fields.ts'
export * from './ddl.ts'
export * from './sweep.ts'
export * from './owed.ts'
export * from './near.ts'
export {
  behind,
  type Build,
  build,
  install as installNative,
  type State,
  state,
} from './native.ts'
export * from './search.ts'
export * from './compile.ts'
