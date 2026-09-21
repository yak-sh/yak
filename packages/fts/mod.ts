/**
 * @yaks/fts — full-text search over a yaks graph, on any text column.
 *
 * Search is not limited to a single "document" component. A vocabulary declares
 * components, and some of their columns hold prose — a book's title, a review's
 * paragraph, a shop's own description. Each such column is marked
 * `"search": true` in the vocabulary; this package indexes every marked column
 * and searches all of them at once.
 *
 * It is four small pieces, each usable on its own:
 *
 * - {@link fields} reads the searchable columns off a
 *   {@link https://jsr.io/@yaks/vocab | @yaks/vocab} schema — the ones marked
 *   `"search": true`;
 * - {@link schema} returns the SQL that creates the SQLite FTS5 indexes and the
 *   triggers that keep them in step with the component tables;
 * - {@link search} — the {@link https://jsr.io/@yaks/sql | @yaks/sql} extension
 *   — makes a bare word in a query compile to an FTS5 `match`, so words and
 *   filters mix in one query: `hobbit .price<20`;
 * - {@link find} ranks the matches and marks each one for display.
 *
 * ```ts
 * import { fields, find, schema, search } from '@yaks/fts'
 * import { compile } from '@yaks/sql'
 * import { parse } from '@yaks/query'
 *
 * let text = fields(shop) // the columns the vocabulary marks searchable
 * for (let stmt of schema(text)) db.exec(stmt)
 *
 * // which books match, with the rest of the query still filtering
 * let { sql, params } = compile(
 *   parse('hobbit .price<20'),
 *   shop,
 *   { extend: [search(text)] },
 * )
 *
 * // and which come first, with a snippet marking each match
 * let ranked = find(db, text, 'hobbit')
 * ```
 *
 * It assumes the storage layout that @yaks/sql's SQLite dialect reads and
 * {@link https://jsr.io/@yaks/sqlite | @yaks/sqlite} creates: an `entity` table
 * of integer ids, one table per component keyed by an `entity` owner column,
 * and a `tombstone` table listing deleted entities. For nearest-meaning results
 * alongside these literal matches, pair it with `@yaks/embedding`.
 *
 * @module
 */

export * from './fields.ts'
export * from './term.ts'
export * from './ddl.ts'
export * from './compile.ts'
export * from './search.ts'
export * from './driver.ts'
