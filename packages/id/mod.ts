/**
 * @yaks/id — entity ids for a yaks graph: the eid a client mints, and the human
 * id a person types.
 *
 * ## Two ids, one entity
 * An entity's durable identity is its **eid** — a uuid, minted by whoever
 * creates the entity, client included, so a write never waits for the store to
 * name it. Nobody says a uuid out loud, so an entity also wears a **human id**:
 * a letter and a number, `B-7`. The number comes from the store; the letter
 * comes from the vocabulary.
 *
 * ## The `prefix` keyword
 * This package owns one keyword. A component that declares
 * `"prefix": "B"` says its entities are numbered in the `B` series:
 *
 * ```json
 * { "$defs": { "book": { "type": "object", "prefix": "B", "properties": {} } } }
 * ```
 *
 * Register it when you load the vocabulary and the ids follow:
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { idKeywords, idOf, mint, parse } from '@yaks/id'
 *
 * let v = loadVocab([catalog], [idKeywords])
 * let id = idOf(v)
 *
 * id({ eid: mint(), kind: 'book', num: 7 }) // 'B-7'
 * id({ eid: 'a3f19c02-…', kind: 'book' }) // 'a3f19c02' — not numbered yet
 * parse('B-7') // { prefix: 'B', num: 7 }
 * parse('7') // { prefix: '', num: 7 } — the number is the identity
 * ```
 *
 * The letter is display, the number is identity: `B-7` and `7` name the same
 * book, so an id typed from memory still lands. A component that declares no
 * prefix borrows its own initial, so every entity has an id to show.
 *
 * The pieces:
 * - `keywords.ts` — the `prefix` keyword vocabulary, ready to register
 * - `mint.ts` — minting an eid, and the short handle a numberless entity wears
 * - `id.ts` — the prefix table, and `(prefix, num)` → id and back
 *
 * @module
 */

export * from './keywords.ts'
export * from './mint.ts'
export * from './id.ts'
