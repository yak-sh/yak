/**
 * @yaks/names — resolve an entity by name.
 *
 * ## Not everything has a name
 * An author is found by typing `Ursula Le Guin`. A review is not found by the
 * sentence it opens with, even though it has a title too: a word buried in a
 * store's prose matches by coincidence, and in a large store there is always
 * one such word. So each component declares which case it is.
 *
 * ## The `by_name` keyword This package owns one keyword. A component that
 * declares `"by_name": true` makes its entities addressable by name, read from
 * the vocabulary's name property (`title` by default); a string names a
 * different property.
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
 * An exact name always wins; failing that, the closest name above the match
 * threshold does, because nobody types a name exactly as it is stored — the
 * case drifts, the punctuation is dropped, a long name gets abbreviated to its
 * first word. Pass `{ close: 1 }` to accept exact names only.
 *
 * The pieces:
 * - `keywords.ts` — the `by_name` keyword vocabulary, ready to register
 * - `names.ts` — what the vocabulary declares: which components are addressable
 *   by name, which property holds the name, and which entity a typed name
 *   refers to
 * - `match.ts` — the scoring, on its own: how close two names are
 *
 * @module
 */

export * from './keywords.ts'
export * from './match.ts'
export * from './names.ts'
