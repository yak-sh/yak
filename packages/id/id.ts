// The human id: `B-7`. An entity's durable identity is its eid; the number
// beside it is what a person says out loud, and the letter says which series
// the number belongs to — a book's `B`, an author's `A`.
//
// The NUMBER is the identity here: `B-7` and `7` name the same entity, so a
// letter typed from memory (or in the wrong case) still lands. The letter is
// how a reader tells a book from an author at a glance, which is why it comes
// from the vocabulary — a component declares `prefix`, and every id in that
// series is derived, never stored.

import type { Vocab } from '@yaks/vocab'
import { short } from './mint.ts'

/** An entity as an id is made from: its eid, the component naming it, and the
 * number the store minted (absent until the entity is first stored). */
export type Named = { eid: string; kind: string; num?: number | null }

/** A human id, taken apart: the series letter (uppercased, `''` when the id was
 * typed as a bare number) and the number that identifies the entity. */
export type Parsed = { prefix: string; num: number }

// A component that declares no prefix still needs a letter, so it borrows its
// own initial. Two components sharing an initial share a series — harmless,
// since the number is what identifies.
let initial = (kind: string) => kind.slice(0, 1).toUpperCase()

/**
 * Every prefix the vocabulary declares, as component name → letter. Reads the
 * `prefix` keyword, so the vocabulary must have been loaded with `idKeywords`
 * registered — an unregistered keyword is invisible to the loader.
 */
export let prefixes = (v: Vocab): Record<string, string> => {
  let out: Record<string, string> = {}
  for (let name of v.all) {
    let p = v.comp(name)?.keywords.prefix
    if (typeof p == 'string') out[name] = p
  }
  return out
}

/**
 * The letter a component's ids wear: what it declared, else its own initial.
 * Config-first — `let letter = prefixOf(v)` once, then call it per component.
 */
export let prefixOf = (v: Vocab): (kind: string) => string => {
  let table = prefixes(v)
  return (kind) => table[kind] ?? initial(kind)
}

/** A letter and a number, spelled as one id: `format('B', 7)` → `'B-7'`. */
export let format = (prefix: string, num: number): string => `${prefix}-${num}`

/**
 * An id, parsed back: `'B-7'` → `{ prefix: 'B', num: 7 }`. A bare number parses
 * too (`'7'` → `{ prefix: '', num: 7 }`), because the number is the identity
 * and people drop the letter. Anything else — an eid, a short handle, a word —
 * is not a human id, and comes back undefined.
 */
export let parse = (id: string): Parsed | undefined => {
  let m = id.match(/^(?:([A-Za-z]+)-)?(\d+)$/)
  if (!m) return undefined
  let num = Number(m[2])
  return Number.isSafeInteger(num)
    ? { prefix: (m[1] ?? '').toUpperCase(), num }
    : undefined
}

/**
 * An entity's id, the way every door should speak it: `B-7` once the store has
 * numbered it, and the short eid handle until then. Config-first over a loaded
 * vocabulary — `let id = idOf(v)`, then `id(book)`.
 */
export let idOf = (v: Vocab): (e: Named) => string => {
  let letter = prefixOf(v)
  return (e) => e.num ? format(letter(e.kind), e.num) : short(e.eid)
}
