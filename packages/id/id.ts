// The human id: `B-7`. An entity's durable identity is its eid; the letter and
// number beside it are what a person reads and types. The letter names the
// series the number belongs to, a book's `B`, an author's `A`, and each series
// counts on its own, so `B-7` and `A-7` are two entities.
//
// The pair is stored, `entity{prefix, num}`: the letter is fixed when the
// entity is first numbered, from the component that declared it, and never
// follows the entity's components afterwards. Only a declared prefix numbers
// an entity; one whose components declare none shows its short handle.

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

/** What an id is built from: the entity's eid, and the number the store
 * assigned (absent until the entity is numbered) with the prefix stored with
 * it. A caller's `kind` rides along unread. */
export type Named = {
  eid: string
  kind?: string
  num?: number | null
  prefix?: string | null
}

/** A human id, taken apart: the series letter (uppercased, `''` when the id was
 * typed as a bare number) and the number within that series. */
export type Parsed = { prefix: string; num: number }

/**
 * Every prefix the vocabulary declares, as kind name → letter: each kind's
 * `prefix` (@yaks/vocab `Vocab.kind`).
 */
export let prefixes = (v: Vocab): Record<string, string> => {
  let out: Record<string, string> = {}
  for (let name of v.kinds) {
    let p = v.kind(name)?.prefix
    if (p) out[name] = p
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
 * table of kind → letter (by default the vocabulary's declared prefixes): the
 * first kind in the table, in kind order, whose components it all holds, else
 * the letter of the first component it holds that the table names; undefined
 * where it holds none.
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
): (held: Iterable<string>) => string | undefined => {
  let lettered = v.kinds.filter((k) => Object.hasOwn(table, k))
    .map((k) => [k, v.kind(k)!.is] as const)
  return (held) => {
    let has = new Set(held)
    let kind = lettered.find(([, is]) => is.every((c) => has.has(c)))
    if (kind) return table[kind[0]]
    for (let c of has) if (Object.hasOwn(table, c)) return table[c]
  }
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
 * prefix. Config-first over a loaded vocabulary — `let id = idOf(v)`, then
 * `id(book)`.
 */
export let idOf = (_v: Vocab): (e: Named) => string => (e) =>
  e.num && e.prefix ? format(e.prefix, e.num) : short(e.eid)

/** A bundle, as this file reads one: the `entity` row, and the components
 * beside it — which is all {@link human} needs, and why it requires no
 * dependency. */
export type Wearing = {
  entity: { eid: string; num?: number | null; prefix?: string | null }
  [comp: string]: unknown
}

/**
 * The id of an entity read as a bundle: its `entity` row carries the eid, the
 * number and its prefix. Use this to display a row just read from the store —
 * `let id = human(vocab)`, then `id(row)` — so that no caller has to assemble
 * a {@link Named} by hand.
 */
export let human = (v: Vocab): (b: Wearing) => string => {
  let id = idOf(v)
  return (b) => id(b.entity)
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

/** Whether an id as typed names this entity: its number, and its letter
 * unless the id was typed as a bare number. */
export let names = (
  id: string,
  e: { num?: number | null; prefix?: string | null },
): boolean => {
  let p = parse(id)
  return !!p && !!e.num && p.num == e.num &&
    (!p.prefix || p.prefix == e.prefix)
}

/**
 * Of the entities holding one number, those an id of that number with this
 * letter names (`''` for a bare number): the ones holding the pair; for a bare
 * number, every holder. `entity` reads an item's `entity{prefix}`. A graph
 * resolves an id this way (`ids`), and so does a client over the rows it holds.
 */
export let answering = <T>(
  held: T[],
  prefix: string,
  entity: (t: T) => { prefix?: string | null },
): T[] => !prefix ? held : held.filter((t) => entity(t).prefix == prefix)

/** A copied short handle, normalized before resolving it through the graph. */
export let addressId = (id: string): string =>
  /^[0-9a-f]{10}$/i.test(id) ? `#${id}` : id
