/**
 * @yaks/blob — content-addressed storage for a text column, applied without
 * anybody noticing.
 *
 * A blog post's body, a product description, a page of notes: values that are
 * long, often repeated, and awkward in a row. Mark the column and they move:
 *
 * ```ts
 * let blog = {
 *   $defs: {
 *     post: {
 *       type: 'object',
 *       properties: {
 *         title: { type: 'string' },
 *         // the one declaration this package reads
 *         body: { type: 'string', store: 'blob' },
 *       },
 *     },
 *   },
 * }
 * ```
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { blobKeywords, blobRead, blobs, sqliteBlobs } from '@yaks/blob'
 *
 * let vocab = loadVocab([blog], [blobKeywords])
 * // let store = sqliteBlobs(driver)
 * // let db = storage(driver, vocab, { derived: blobRead(vocab) })
 * // let g = graph({ storage: db, vocab, plugins: [blobs(vocab, store)] })
 * //
 * // g.apply([{ entity: { eid: 'p1' }, post: { body: 'a long essay…' } }])
 * // db.read('.post!')[0].post.body // 'a long essay…'
 * ```
 *
 * Nothing between those two lines says `blob`. The write went in as text and
 * came back as text; in between, the row kept the SHA-256 of the essay and the
 * essay itself went to the store — once, however many posts quote it.
 *
 * ## What it is made of
 *
 * - **One keyword.** {@link blobKeywords} registers `store` with @yaks/vocab,
 *   so the meta-model carries the word and this package is what it means. To
 *   the schema a body column is a plain string column, and it stays one for
 *   validation, routing and queries.
 * - **One plugin.** {@link blobs} swaps the text for its address on the way in
 *   and swaps it back before `apply()` returns. It runs INSIDE the batch's
 *   transaction, so the bytes and the row that names them commit together.
 * - **One backend interface.** {@link Blobs} is `has`, `get` and `put` over
 *   `Uint8Array`, keyed by {@link address}. Three ship with the package:
 *   {@link sqliteBlobs} (a table beside your rows — synchronous, and the only
 *   one SQL can read through), {@link fileBlobs} (a directory), and
 *   {@link objectBlobs} (an S3-shaped bucket, R2 included).
 * - **Two read sides.** Over SQL, {@link blobRead} resolves the address in the
 *   statement itself; over anything else, {@link hydrate} resolves gathered
 *   bundles.
 *
 * Dropping the plugin does not strand your data: a body column is a text column
 * holding a hash, and the store is a table of hashes and text.
 *
 * The core — the keyword, the plugin, the interface, and the SQLite backend —
 * imports no platform API, so the same code runs on a server, in a worker, and
 * in a browser tab. {@link fileBlobs} looks its runtime's filesystem up rather
 * than importing one, and throws where there is none.
 *
 * @module
 */

export * from './keywords.ts'
export * from './columns.ts'
export * from './store.ts'
export * from './driver.ts'
export * from './plugin.ts'
export * from './sqlite.ts'
export * from './hydrate.ts'
export * from './file.ts'
export * from './object.ts'
