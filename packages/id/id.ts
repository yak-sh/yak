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

/** The first 10 hex characters of an eid, dashes removed, after a `#` — what
 * an entity the store has not numbered shows instead of a number. It carries no
 * letter: the handle names one entity by its eid, whatever it is. */
export let short = (eid: string): string =>
  `#${eid.replaceAll('-', '').slice(0, 10).toLowerCase()}`

/** A short handle as typed: 6–64 hex characters after the `#`. */
export let SHORT: RegExp = /^#[0-9a-f]{6,64}$/i

/** A short handle copied without its `#`, as a shell or a sentence leaves it:
 * hex at least as long as a uuid's first segment (`e854bf7d`), which is how an
 * eid is most often quoted, as a bug's letter names it. The `#` is what
 * makes a shorter fragment a handle; without it, a word somebody chose
 * (`facade`) must not be taken for one. A graph asks about it only after
 * every name, number and eid of that spelling (@yaks/graph `address`), so
 * digits alone are a handle only where no entity carries that number. */
export let BARE: RegExp = /^[0-9a-f]{8,64}$/i

/** What an id is built from: the entity's eid, the component that gives it its
 * prefix, and the number the store assigned (absent until the entity is first
 * stored). */
export type Named = { eid: string; kind: string; num?: number | null }

/** A human id, taken apart: the series letter (uppercased, `''` when the id was
 * typed as a bare number) and the number that identifies the entity. */
export type Parsed = { prefix: string; num: number }

// A component that declares no prefix still needs a letter, so it uses the
// first letter of its name: `_effect`, a description component (@yaks/vocab),
// reads `E`, since `parse` reads a prefix of letters and an `_` would make an
// id nothing resolves. Two components sharing an initial share a series —
// harmless, since the number is what identifies an entity.
/** The letter a component that declares no prefix prints its ids with: its
 * name's first letter, uppercased. */
export let initial = (kind: string): string =>
  (kind.match(/[a-z]/i)?.[0] ?? '').toUpperCase()

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

// A loaded vocabulary is immutable; every display can reuse its compiled
// letters without sharing the caller-owned table returned by prefixes().
let letters = new WeakMap<Vocab, (kind: string) => string>()

/**
 * The letter a component's ids use: the one it declared, otherwise its own
 * initial. Config-first — call `let letter = prefixOf(v)` once, then call the
 * result per component.
 */
export let prefixOf = (v: Vocab): (kind: string) => string => {
  let letter = letters.get(v)
  if (!letter) {
    let table = prefixes(v)
    letters.set(v, letter = (kind) => table[kind] ?? initial(kind))
  }
  return letter
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
  return (e) => e.num ? format(letter(e.kind), e.num) : short(e.eid)
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

/** A human id as typed, with its letter: `B-7`, `b-7`. A bare number parses
 * (`parse`) but is not written with its series. */
export let HUMAN: RegExp = /^[A-Za-z]+-\d+$/

/** A short handle with a letter in front of its `#`, as handles were once
 * written (`T#47e9678bdf`). It names nothing. */
export let LETTERED: RegExp = /^[a-z]+#[0-9a-f]{6,64}$/i

/** A human id as prose writes one, as a pattern's source for a grammar that
 * composes it with others: one capital letter, a hyphen and digits. Read as a
 * word of its own ({@link idsIn}), so one whose letters run on before the
 * hyphen (COVID-19, UTF-8) is not an id. */
export let WRITTEN = '[A-Z]-\\d+'

// A human id written as a word of its own: nothing word-like, no `#` and no
// hyphen on either side, so `T-14429` is not found in `T-144294`.
let word = (source: string, flags = 'g') =>
  new RegExp(`(?<![\\w#-])(?:${source})(?![\\w-])`, flags)

/** Every human id written in a text, in order, each a word of its own. */
export let idsIn = (text: string): string[] =>
  [...text.matchAll(word(WRITTEN))].map((m) => m[0])

/** The text with each human id written in it replaced by what `f` says. */
export let replaceIds = (text: string, f: (id: string) => string): string =>
  text.replace(word(WRITTEN), f)

/** Whether a text mentions `id` as a whole id: `T-14429` is not mentioned by
 * `T-144294`. */
export let mentions = (text: string, id: string): boolean =>
  word(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), '').test(text)

/** What a map of ids is keyed by: the same for every spelling that names one
 * entity, from an id as typed or from an entity's row. Today that is the
 * number, since the number is the identity. Undefined for what is not a human
 * id and for an entity the store has not numbered. */
export let key = (
  id: string | { num?: number | null },
): string | undefined => {
  let num = typeof id == 'string' ? parse(id)?.num : id.num
  return num ? String(num) : undefined
}

/** Whether an id as typed names this entity: the same number, whatever letter
 * it is written with. */
export let names = (id: string, e: { num?: number | null }): boolean => {
  let k = key(id)
  return k != null && k == key(e)
}

/** A copied short handle, normalized before resolving it through the graph. */
export let addressId = (id: string): string =>
  /^[0-9a-f]{10}$/i.test(id) ? `#${id}` : id
