// The human id: `B-7`. An entity's durable identity is its eid; the letter and
// number beside it are what a person reads and types. The letter names the
// series the number belongs to, a book's `B`, an author's `A`, and each series
// counts on its own, so `B-7` and `A-7` are two entities.
//
// The pair is stored, `entity{prefix, num}`: the letter is fixed when the
// entity is first numbered, from the component that declared it, and never
// follows the entity's components afterwards. Only a declared prefix numbers
// an entity; one whose components declare none shows its short handle. A row
// numbered before series had letters stores no prefix; it prints with the
// letter its components declare, and it answers to its number under any
// letter.

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

/** What an id is built from: the entity's eid, the number the store assigned
 * (absent until the entity is numbered) and the prefix stored with it, and the
 * kind whose declared letter a row stored without a prefix prints with. */
export type Named = {
  eid: string
  kind: string
  num?: number | null
  prefix?: string | null
}

/** A human id, taken apart: the series letter (uppercased, `''` when the id was
 * typed as a bare number) and the number within that series. */
export type Parsed = { prefix: string; num: number }

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
let letters = new WeakMap<Vocab, Readonly<Record<string, string>>>()
let declared = (v: Vocab) => {
  let table = letters.get(v)
  if (!table) letters.set(v, table = prefixes(v))
  return table
}

/**
 * The letter a component's ids use, the one it declared; undefined for a
 * component that declares none, whose entities are not numbered.
 * Config-first — call `let letter = prefixOf(v)` once, then call the result
 * per component.
 */
export let prefixOf = (v: Vocab): (kind: string) => string | undefined => {
  let table = declared(v)
  return (kind) => Object.hasOwn(table, kind) ? table[kind] : undefined
}

/**
 * The letter an entity holding these components is numbered with, from a
 * table of component → letter (by default the vocabulary's declared
 * prefixes): the one of the kind the vocabulary names among the components in
 * the table (`kindOf`), else the first of them; undefined where it holds none.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { loadVocab } from '@yaks/vocab'
 * import { seriesOf } from '@yaks/id'
 * let kind = (before: string[] = []) => ({ component: true, kind: true, before })
 * let v = loadVocab({ $defs: { memory: kind(['comment']), comment: kind(), doc: kind() } })
 * let series = seriesOf(v, { memory: 'M', comment: 'C' })
 * equal(series(['comment', 'memory', 'doc']), 'M')
 * equal(series(['comment', 'doc']), 'C')
 * equal(series(['doc']), undefined)
 * ```
 */
export let seriesOf = (
  v: Vocab,
  table: Readonly<Record<string, string>> = declared(v),
): (held: Iterable<string>) => string | undefined =>
(held) => {
  let has = Object.fromEntries(
    [...held].filter((c) => Object.hasOwn(table, c)).map((c) => [c, true]),
  )
  let kind = v.kindOf(has)
  return Object.hasOwn(has, kind)
    ? table[kind]
    : Object.keys(has).map((c) => table[c])[0]
}

/** A letter and a number, joined into one id: `format('B', 7)` → `'B-7'`. */
export let format = (prefix: string, num: number): string => `${prefix}-${num}`

/**
 * An id, parsed back: `'B-7'` → `{ prefix: 'B', num: 7 }`. A bare number parses
 * too (`'7'` → `{ prefix: '', num: 7 }`), since people drop the letter: it
 * names an entity while only one holds that number. Anything else — an eid, a
 * short handle, an arbitrary string — is not a human id, and returns
 * undefined.
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
 * numbered it, and the short eid handle otherwise. The letter is the stored
 * prefix; a row stored without one prints with its kind's declared letter, and
 * shows its handle where the kind declares none. Config-first over a loaded
 * vocabulary — `let id = idOf(v)`, then `id(book)`.
 */
export let idOf = (v: Vocab): (e: Named) => string => {
  let letter = prefixOf(v)
  return (e) => {
    let prefix = e.num ? e.prefix || letter(e.kind) : undefined
    return prefix ? format(prefix, e.num!) : short(e.eid)
  }
}

/** A bundle, as this file reads one: the `entity` row, and the components
 * beside it — which is all {@link human} needs, and why it requires no
 * dependency. */
export type Wearing = {
  entity: { eid: string; num?: number | null; prefix?: string | null }
  [comp: string]: unknown
}

/**
 * The id of an entity read as a bundle: its `entity` row carries the eid, the
 * number and its prefix, and its components the letter of a row stored
 * without one, the one {@link seriesOf} picks. Use this to display a row just
 * read from the store — `let id = human(vocab)`, then `id(row)` — so that no
 * caller has to assemble a {@link Named} by hand.
 */
export let human = (v: Vocab): (b: Wearing) => string => {
  let series = seriesOf(v)
  return (b) => {
    let { eid, num, prefix } = b.entity
    let letter = num ? prefix || series(Object.keys(b)) : undefined
    return letter ? format(letter, num!) : short(eid)
  }
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

/** What a map of ids is keyed by, from an id as typed or from an entity's row:
 * the pair, `B-7`, in capitals, so every case of one spelling meets. A bare
 * number keys as itself, and so does a row stored without a prefix, which
 * answers to its number under any letter: look such an id up under
 * {@link keys}. Undefined for what is not a human id and for an entity the
 * store has not numbered. */
export let key = (
  id: string | { num?: number | null; prefix?: string | null },
): string | undefined => {
  let p = typeof id == 'string'
    ? parse(id)
    : id.num
    ? { prefix: id.prefix ?? '', num: id.num }
    : undefined
  return p ? p.prefix ? format(p.prefix, p.num) : String(p.num) : undefined
}

/** Every key an id as typed may be filed under ({@link key}): its pair, then
 * its bare number, which a row stored without a prefix is filed under. */
export let keys = (id: string): string[] => {
  let p = parse(id)
  return !p ? [] : p.prefix ? [format(p.prefix, p.num), String(p.num)] : [
    String(p.num),
  ]
}

/** Whether an id as typed names this entity: its number, and its letter where
 * both the id and the entity carry one. */
export let names = (
  id: string,
  e: { num?: number | null; prefix?: string | null },
): boolean => {
  let p = parse(id)
  return !!p && !!e.num && p.num == e.num &&
    (!p.prefix || !e.prefix || p.prefix == e.prefix)
}

/** A copied short handle, normalized before resolving it through the graph. */
export let addressId = (id: string): string =>
  /^[0-9a-f]{10}$/i.test(id) ? `#${id}` : id
