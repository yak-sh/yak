// The human id: `B-7`. An entity's durable identity is its eid; the number
// beside it is what a person reads and types, and the letter names the series
// the number belongs to — a book's `B`, an author's `A`.
//
// The number is the identity here: `B-7` and `7` name the same entity, so a
// letter typed from memory (or in the wrong case) still resolves. The letter is
// how a reader tells a book from an author at a glance, which is why it comes
// from the vocabulary — a component declares `prefix`, and every id in that
// series is derived from it, never stored.

import type { Vocab } from '@yaks/vocab'
import { short } from './mint.ts'

/** What an id is built from: the entity's eid, the component that gives it its
 * prefix, and the number the store assigned (absent until the entity is first
 * stored). */
export type Named = { eid: string; kind: string; num?: number | null }

/** A human id, taken apart: the series letter (uppercased, `''` when the id was
 * typed as a bare number) and the number that identifies the entity. */
export type Parsed = { prefix: string; num: number }

// A component that declares no prefix still needs a letter, so it uses its own
// initial. Two components sharing an initial share a series — harmless, since
// the number is what identifies an entity.
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
 * The letter a component's ids use: the one it declared, otherwise its own
 * initial. Config-first — call `let letter = prefixOf(v)` once, then call the
 * result per component.
 */
export let prefixOf = (v: Vocab): (kind: string) => string => {
  let table = prefixes(v)
  return (kind) => table[kind] ?? initial(kind)
}

/** A letter and a number, joined into one id: `format('B', 7)` → `'B-7'`. */
export let format = (prefix: string, num: number): string => `${prefix}-${num}`

/**
 * An id, parsed back: `'B-7'` → `{ prefix: 'B', num: 7 }`. A bare number parses
 * too (`'7'` → `{ prefix: '', num: 7 }`), because the number is the identity
 * and people drop the letter. Anything else — an eid, a short handle, an
 * arbitrary string — is not a human id, and returns undefined.
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
 * An entity's id as everything should display it: `B-7` once the store has
 * numbered it, and the short eid handle until then. Config-first over a loaded
 * vocabulary — `let id = idOf(v)`, then `id(book)`.
 */
export let idOf = (v: Vocab): (e: Named) => string => {
  let letter = prefixOf(v)
  return (e) =>
    e.num ? format(letter(e.kind), e.num) : short(e.eid, letter(e.kind))
}

/** A bundle, as this file reads one: the `entity` row, and the components
 * beside it — which is all {@link human} needs, and why it requires no
 * dependency. */
export type Wearing = {
  entity: { eid: string; num?: number | null }
  [comp: string]: unknown
}

/**
 * The id of an entity read as a bundle: its components determine the prefix,
 * and its `entity` row carries the eid and the number. Use this to display a
 * row just read from the store — `let id = human(vocab)`, then `id(row)` — so
 * that no caller has to assemble a {@link Named} by hand.
 */
export let human = (v: Vocab): (b: Wearing) => string => {
  let id = idOf(v)
  return (b) => id({ eid: b.entity.eid, kind: v.kindOf(b), num: b.entity.num })
}
