// Whether a store could match some words, said without asking the store.
//
// A search over many stores asks each one, and the asking is most of what it
// costs: every store wakes, searches and answers, and the slowest answers for
// all of them. A store's lexicon is what it would need to say "nothing here":
// the first few letters of every word its indexes hold. A word whose first
// letters are not in it matches no row there, since a word matches the words
// it begins (./term.ts), so the store can be left asleep.
//
// It is a superset by construction, never exact: a store only ever adds to its
// lexicon, a deleted row leaves its words behind, and four letters stand for
// every word they begin. A lexicon that admits too much costs a store asked
// for nothing; one that admits too little loses a hit, so every rounding here
// errs towards admitting.
//
// Text is folded before it is split, and the same way for what a store holds
// and what is asked: lower case, marks taken off. That is coarser than FTS5's
// own folding, so two words FTS5 reads as one are one here too.

import { split } from './term.ts'

/** How many letters of a word a lexicon keeps. */
export let PREFIX = 4

let TOKEN = /[\p{L}\p{N}\p{Co}]+/gu

let folded = (text: string) =>
  text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()

/**
 * The lexicon entries a text adds: each of its words, folded and cut to
 * {@link PREFIX} letters, once each.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(lexemes('Crème brûlée, crème caramel'), ['crem', 'brul', 'cara'])
 * ```
 */
export let lexemes = (text: string): string[] => [
  ...new Set(folded(text).match(TOKEN)?.map((t) => t.slice(0, PREFIX))),
]

/**
 * Two lexicons as one, sorted, which is the order {@link admits} reads.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(joined(['soup'], ['crem', 'soup']), ['crem', 'soup'])
 * ```
 */
export let joined = (a: readonly string[], b: readonly string[]): string[] =>
  [...new Set([...a, ...b])].sort()

// Whether some entry of a sorted lexicon begins with `start`.
let begins = (lexicon: readonly string[], start: string) => {
  let lo = 0, hi = lexicon.length
  while (lo < hi) {
    let mid = (lo + hi) >> 1
    if (lexicon[mid] < start) lo = mid + 1
    else hi = mid
  }
  return lexicon[lo]?.startsWith(start) ?? false
}

/**
 * Whether a store with this sorted lexicon could match every one of the
 * words, as a search box's words match: each word, or each word of a quoted
 * run, begins some word the store holds. False only when one of them cannot.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let soups = joined(lexemes('Tomato soup'), [])
 * assertEquals(admits(soups, 'tom'), true)
 * assertEquals(admits(soups, 'tomatoes soup'), true)
 * assertEquals(admits(soups, 'soup bread'), false)
 * assertEquals(admits(soups, '"tomato soup"'), true)
 * ```
 */
export let admits = (lexicon: readonly string[], words: string): boolean =>
  split(words).every((word) =>
    (folded(word).match(TOKEN) ?? []).every((t) =>
      begins(lexicon, t.slice(0, PREFIX))
    )
  )
