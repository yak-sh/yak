/**
 * @yaks/names — resolve an entity by name.
 *
 * ## Not everything has a name
 * An author is reached as `Ursula Le Guin`. A review is not reached by the
 * sentence it opens with, even though it has a title too: a word deep inside a
 * store's prose matches by coincidence, and in a large store there is always
 * one. So a component says which it is.
 *
 * ## The `by_name` keyword
 * This package owns one keyword. A component that declares `"by_name": true`
 * says its entities answer to a name, read from the vocabulary's name column
 * (`title` by default); a string names a different column.
 *
 * ```json
 * { "$defs": { "author": { "type": "object", "kind": true, "by_name": true } } }
 * ```
 *
 * Register it when you load the vocabulary, and names resolve:
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { nameKeywords, named, nameOf, resolve } from '@yaks/names'
 *
 * let v = loadVocab([catalog], [nameKeywords])
 * let shelf = [
 *   { comps: { author: {}, doc: { title: 'Ursula Le Guin' } } },
 *   { comps: { review: {}, doc: { title: 'Ursula at her best' } } },
 * ]
 *
 * named(v) // { author: { comp: 'doc', prop: 'title' } }
 * nameOf(v)(shelf[0]) // 'Ursula Le Guin'
 * nameOf(v)(shelf[1]) // undefined — a review's title is not a name
 * resolve(v)('le guin', shelf) // the author
 * ```
 *
 * An exact name always wins; failing that the closest name above the match
 * floor does, because nobody types a name the way it is stored — the case
 * drifts, the punctuation goes, a long name gets abbreviated to its first word.
 * Pass `{ close: 1 }` to accept exact names only.
 *
 * The pieces:
 * - `keywords.ts` — the `by_name` keyword vocabulary, ready to register
 * - `names.ts` — what the vocabulary says: which components are named, where,
 *   and the entity a typed name reaches
 * - `match.ts` — the scoring, on its own: how close two names are
 *
 * @module
 */

export * from './keywords.ts'
export * from './match.ts'
export * from './names.ts'
