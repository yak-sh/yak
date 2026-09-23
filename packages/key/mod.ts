/**
 * @yaks/key — the values that identify an entity, stored as entities.
 *
 * A value that identifies something is not a property on the thing it
 * identifies; it is an entity of its own, carrying the `key{of, value}`
 * component and a kind tag component naming what sort of value it is. A store
 * identifies its recipes by a short name (`alias`), a directory its people by
 * address (`email`), a library its books by `isbn`; the structure is the same,
 * and the kinds are yours to declare — this package ships the carrier and the
 * mechanism and not one kind.
 *
 * It is to a has-many value exactly what
 * {@link https://jsr.io/@yaks/edge | @yaks/edge} is to a link: one generic
 * carrier component, tagged by the application's own components, with the
 * entity's id derived from what it holds — so an entity has as many values as
 * you write, writing one twice writes one row, and retiring one means deleting
 * that row.
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
 * - **A key's id is derived from the value.** {@link keyEid} hashes the kind
 *   and the value, so two writers giving the same value land on one entity, a
 *   value is unique within its kind by construction, and reading one back is a
 *   `get` rather than a query.
 * - **A key lives only as long as what it identifies.** `of` is a reference
 *   declared `death: release`, so deleting a book removes its isbn row and
 *   frees the value.
 * - **An incomplete key is refused**, naming what is missing: a key with no
 *   kind, no value or no `of` never reaches storage.
 * - **Claiming a value somebody already holds lands on the holder.** A write
 *   that mints an entity under a `$alias` and gives it a value another entity
 *   already holds patches that entity instead of creating a second one; a
 *   caller who wrote an id down rather than using an alias is refused, with the
 *   holder named.
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
