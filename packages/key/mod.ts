/**
 * @yaks/key — the values an entity answers to, as entities.
 *
 * A name in a yaks graph is not a column on the thing it names; it is an entity
 * of its own carrying the `key{of, value}` component and a KIND TAG that says
 * what sort of value it is. A store names its recipes (`alias`), a directory
 * its people (`email`), a library its books (`isbn`); the shape is the same,
 * and the kinds are yours to declare — this package ships the carrier, the
 * mechanism, and not one kind.
 *
 * It is to a has-many VALUE exactly what
 * {@link https://jsr.io/@yaks/edge | @yaks/edge} is to a LINK: one generic
 * carrier component, tagged by the application's own words, with the entity's
 * id derived from what it says — so an entity has as many values as you write,
 * writing one twice writes one row, and retiring one is dropping that row.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { keyDoc, keyed, keyKeywords } from '@yaks/key'
 *
 * let library = {
 *   $defs: {
 *     book: { type: 'object', kind: true, properties: {} },
 *     // one component, and `isbn` is a kind of value
 *     isbn: { type: 'object', key: true },
 *   },
 * }
 * let vocab = loadVocab([keyDoc, library], [keyKeywords])
 * // g.apply([keyed('isbn', 'b1', '9780441013593')])
 * ```
 *
 * Four things follow from that:
 *
 * - **A key is named by what it says.** {@link keyEid} hashes the kind and the
 *   value, so two writers who state the same value land on one entity, a value
 *   is unique within its kind by construction, and reading one back is a `get`
 *   rather than a query.
 * - **A key lives only while what it names does.** `of` is a reference with
 *   `death: cascade`, so a deleted book takes its isbn with it and the value is
 *   free again.
 * - **Half a sentence is refused**, by name: a key with no kind, no value or no
 *   `of` never reaches storage.
 * - **Stating a held value resolves onto its holder.** A batch minting an
 *   entity under a `$alias` and claiming a value somebody already holds patches
 *   that entity instead of making a second one; a caller who wrote an id down
 *   is refused, with the holder named.
 *
 * It imports no platform API, so the same code runs on a server, in a worker,
 * and in a browser tab.
 *
 * @module
 */

export * from './keywords.ts'
export * from './kinds.ts'
export * from './comp.ts'
export * from './eid.ts'
export * from './say.ts'
export * from './guard.ts'
export * from './resolve.ts'
export * from './plugin.ts'
