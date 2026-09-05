/**
 * @yaks/fts — full-text search over a yaks graph, on any text property.
 *
 * Search here is not welded to one "document" component. A vocabulary declares
 * components; some of their columns hold prose — a book's title, a review's
 * paragraph, a shop's own description — and this package indexes whichever of
 * them you choose, then answers a search across all of them at once.
 *
 * It is four small pieces, each usable alone:
 *
 * - {@link fields} reads the indexed properties off a
 *   {@link https://jsr.io/@yaks/vocab | @yaks/vocab} schema;
 * - {@link schema} emits the SQLite FTS5 index and the triggers that keep it in
 *   step with the rows;
 * - {@link search} — the {@link https://jsr.io/@yaks/sql | @yaks/sql} extension
 *   — makes a bare word in a query line compile to an FTS `match`, so words and
 *   filters mix on one line: `hobbit .price<20`;
 * - {@link find} ranks the matches and marks each one for display.
 *
 * ```ts
 * import { fields, find, schema, search } from '@yaks/fts'
 * import { compile } from '@yaks/sql'
 * import { parse } from '@yaks/query'
 *
 * let text = fields(shop) // every text property the vocabulary declares
 * for (let stmt of schema(text)) db.exec(stmt)
 *
 * // which books match, with the rest of the line still filtering
 * let { sql, params } = compile(
 *   parse('hobbit .price<20'),
 *   shop,
 *   { extend: [search(text)] },
 * )
 *
 * // and which come first, with a snippet marking each hit
 * let ranked = find(db, text, 'hobbit')
 * ```
 *
 * It assumes the storage layout @yaks/sql's SQLite dialect reads and
 * {@link https://jsr.io/@yaks/sqlite | @yaks/sqlite} builds: an `entity` spine
 * of integer ids, one table per component keyed by an `entity` owner, and a
 * `tombstone` table naming the dead. For meaning-nearest results beside these
 * literal matches, pair it with `@yaks/embedding`.
 *
 * @module
 */

export * from './fields.ts'
export * from './term.ts'
export * from './ddl.ts'
export * from './compile.ts'
export * from './search.ts'
export * from './driver.ts'
