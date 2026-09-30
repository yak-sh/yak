/**
 * What the inspector reads off a bundle or an answer: pure functions, the
 * vocabulary of every view. How a value is shaped, which hue a name wears, the
 * components an entity carries, the tables an archetype names, how many
 * entities carry each component, and what a client may write.
 *
 * @module
 */

import type { Bundle, Io } from './host.ts'

/** One component, as a bundle carries it. */
export type Comp = Record<string, unknown>

let EID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
let HEX = /^[0-9a-f]{32,40}$/
let AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/**
 * The hue a component's name wears (@yaks/ui `Chip-0` … `Chip-5`). Provenance
 * rides nearly every entity, so it keeps the warm end; every other name
 * hashes into the other four, the same on every page.
 *
 * ```ts
 * import { tone } from './read.ts'
 * tone('created') // '4'
 * tone('task') == tone('task') // true
 * ```
 */
export let tone = (name: string): string => {
  if (name == 'created') return '4'
  if (name == 'updated') return '5'
  let hash = 2166136261
  for (let ch of name) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619)
  return String((hash >>> 0) % 4)
}

/**
 * A stored value's shape (@yaks/ui `Value`): nothing, a number, a flag, an
 * id, a moment, structure, or text.
 *
 * ```ts
 * import { shape } from './read.ts'
 * shape(null) // 'nil'
 * shape('') // 'nil'
 * shape(3) // 'num'
 * shape('2026-09-29T19:12:21Z') // 'time'
 * shape({ a: 1 }) // 'json'
 * ```
 */
export let shape = (v: unknown): string =>
  v == null || v === ''
    ? 'nil'
    : typeof v == 'number'
    ? 'num'
    : typeof v == 'boolean'
    ? 'bool'
    : typeof v == 'object'
    ? 'json'
    : EID.test(String(v)) || HEX.test(String(v))
    ? 'id'
    : AT.test(String(v))
    ? 'time'
    : 'text'

/**
 * A stored value, as text: absence says which absence it is.
 *
 * ```ts
 * import { face } from './read.ts'
 * face(null) // 'null'
 * face('') // '""'
 * face({ a: 1 }) // '{"a":1}'
 * ```
 */
export let face = (v: unknown): string =>
  v === ''
    ? '""'
    : v == null
    ? 'null'
    : typeof v == 'object'
    ? JSON.stringify(v)
    : String(v)

/** Whether a client may write this component, or this property of it,
 * here: never where the host's controls take no input (a terminal), nor a
 * component that is not on the wire or is computed, nor a property that is
 * stamped or computed. */
export let writable = (
  io: Pick<Io, 'vocab' | 'edits'>,
  name: string,
  prop?: string,
): boolean => {
  let c = io.vocab.comp(name)
  if (!io.edits || !c?.wire || c.computed) return false
  let p = prop == null ? undefined : io.vocab.prop(name, prop)
  return prop == null || (!!p && !p.stamped && !p.computed)
}

/** Whether a value names an entity by its eid. */
export let named = (v: unknown): v is string =>
  typeof v == 'string' && (EID.test(v) || HEX.test(v))

/**
 * The components a bundle carries, by name, in the order it carries them:
 * everything but its `entity` spine and its `$` requests.
 *
 * ```ts
 * import { comps } from './read.ts'
 * comps({ entity: { eid: 'a' }, doc: { title: 'x' }, $num: true })
 * // [['doc', { title: 'x' }]]
 * ```
 */
export let comps = (b: Bundle): [string, Comp][] =>
  Object.entries(b).filter(([k, v]) =>
    k != 'entity' && !k.startsWith('$') && !!v && typeof v == 'object'
  ) as [string, Comp][]

/** One component of a bundle, or an empty one. */
export let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

/** A string property of a component, or ''. */
export let str = (
  b: Bundle | undefined,
  name: string,
  prop: string,
): string => {
  let v = comp(b, name)[prop]
  return typeof v == 'string' ? v : ''
}

/**
 * The component tables an archetype names (@yaks/archetype), from the JSON
 * text it stores them as.
 *
 * ```ts
 * import { tables } from './read.ts'
 * tables({ entity: { eid: 'a' }, archetype: { tables: '["doc","task"]' } })
 * // ['doc', 'task']
 * ```
 */
export let tables = (b: Bundle): string[] => {
  try {
    let t = JSON.parse(str(b, 'archetype', 'tables') || '[]')
    return Array.isArray(t) ? t.map(String) : []
  } catch {
    return []
  }
}

/**
 * How many entities carry each component: each archetype's count of entities
 * (a `.tally=entity.archetype`), added to every table it names.
 *
 * ```ts
 * import { census } from './read.ts'
 * let sets = [
 *   { entity: { eid: 'x' }, archetype: { tables: '["doc","task"]' } },
 *   { entity: { eid: 'y' }, archetype: { tables: '["doc"]' } },
 * ]
 * census(sets, { x: 3, y: 2 }) // { doc: 5, task: 3 }
 * ```
 */
export let census = (
  sets: Bundle[],
  tally: Record<string, number>,
): Record<string, number> => {
  let out: Record<string, number> = {}
  for (let s of sets) {
    let n = tally[s.entity.eid] ?? 0
    for (let t of tables(s)) out[t] = (out[t] ?? 0) + n
  }
  return out
}

/** The first line of a text, cut to `n` characters. */
export let line = (text: unknown, n = 120): string => {
  let first = String(text ?? '').split('\n').map((l) => l.trim())
    .find(Boolean) ?? ''
  return first.length > n ? first.slice(0, n - 1) + '…' : first
}

/**
 * The text an entity holds for reading: a doc's body, else what a message
 * says (`content.body`, a transcript entry's).
 *
 * ```ts
 * import { bodyOf } from './read.ts'
 * bodyOf({ entity: { eid: 'e' }, content: { body: 'hi' } }) // 'hi'
 * ```
 */
export let bodyOf = (b: Bundle): string =>
  str(b, 'doc', 'body') || str(b, 'content', 'body')

/**
 * Some words, cut where they run past `n` characters.
 *
 * ```ts
 * import { cut } from './read.ts'
 * cut('abcdef', 4) // 'abc…'
 * cut('abc', 4) // 'abc'
 * ```
 */
export let cut = (text: string, n: number): string =>
  text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text

/**
 * What an entity is called, in words: its title; else the `name` its kind
 * gives it (a topic's, a component's); else its id where it is numbered
 * (`S-12`); else the first line of what it says (a transcript entry); else
 * its kind and its handle (`process #1320a8ee61`). `id` is the id a person
 * reads, and `kind` the kind it shows as.
 *
 * ```ts
 * import { called } from './read.ts'
 * let e = (b: object) => ({ entity: { eid: 'e1' }, ...b })
 * called(e({ doc: { title: 'Fix it' } }), 'T-9', 'task') // 'Fix it'
 * called(e({ topic: { name: 'naming' } }), '#e1', 'topic') // 'naming'
 * called(e({ content: { body: '\nuse grams' } }), '#e1', 'entry') // 'use grams'
 * called(e({ process: { pid: 1 } }), '#e1', 'process') // 'process #e1'
 * ```
 */
export let called = (b: Bundle, id: string, kind: string): string =>
  str(b, 'doc', 'title') || str(b, kind, 'name') ||
  (b.entity.num != null ? id : '') || line(bodyOf(b), 80) ||
  (kind && kind != 'entity' ? `${kind} ${id}` : id)

/** Where an entity came from, said once in a quiet line rather than stated
 * as a fact: who made and changed it and when, what built it, where it was
 * imported from, when it was checked. */
export let PROVENANCE = ['created', 'updated', 'built', 'imported', 'verified']

/** What a page says in its head and its body rather than as facts. */
let SAID = new Set(['entity', 'doc', 'content', ...PROVENANCE])

/**
 * The components a page states as facts, in the order they mean: the kinds
 * it is, most specific first (the vocabulary's kind order); then what else it
 * carries, by name; then the marks of what happened to it. What the head and
 * the body say (its title, its text, where it came from) is left out, and so
 * is anything in `skip`.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { facts } from './read.ts'
 * let c = (o = {}) => ({ component: true, properties: {}, ...o })
 * let at = { type: 'string', stamped: true }
 * let vocab = loadVocab([{ $defs: {
 *   doc: c(), task: c({ kind: true }), filed: c(), claim: c(),
 *   completed: c({ properties: { at, by: at } }),
 *   created: c({ properties: { at, by: at } }),
 * } }])
 * facts(vocab, {
 *   entity: { eid: 'e' }, completed: {}, created: {}, filed: {}, doc: {},
 *   task: {}, claim: {},
 * }) // ['task', 'claim', 'filed', 'completed']
 * ```
 */
export let facts = (
  vocab: Pick<Io['vocab'], 'kinds' | 'comp'>,
  b: Bundle,
  skip: string[] = [],
): string[] => {
  let has = comps(b).map(([n]) => n)
    .filter((n) => !SAID.has(n) && !skip.includes(n))
  let kinds = vocab.kinds.filter((k) => has.includes(k))
  let rest = has.filter((n) => !kinds.includes(n)).toSorted()
  let marks = rest.filter((n) => vocab.comp(n)?.mark)
  return [...kinds, ...rest.filter((n) => !marks.includes(n)), ...marks]
}

/**
 * A long hash, as far as a reader needs it: its first ten characters.
 *
 * ```ts
 * import { brief } from './read.ts'
 * brief('f07941748e70ecf0a7272d9a05dba89f0b98cb1cde9709b12a6e1e711ef3621b')
 * // 'f07941748e…'
 * brief('open') // 'open'
 * ```
 */
export let brief = (v: string): string =>
  /^[0-9a-f]{41,}$/.test(v) ? v.slice(0, 10) + '…' : v

/**
 * The relation an edge's entity states: the component beside `edge` that the
 * vocabulary marks `edge` (@yaks/edge). `relations` is those components'
 * names.
 *
 * ```ts
 * import { relation } from './read.ts'
 * relation(
 *   { entity: { eid: 'e' }, edge: { from: 'a', to: 'b' }, requires: {} },
 *   ['requires', 'contains'],
 * ) // 'requires'
 * ```
 */
export let relation = (b: Bundle, relations: string[]): string | undefined =>
  comps(b).map(([name]) => name).find((n) => relations.includes(n))

/** A number, grouped for reading: 12345 reads 12,345. */
export let count = (n: number): string => n.toLocaleString('en-US')

/**
 * A property's type as it reads, off its `_prop` row.
 *
 * ```ts
 * import { typed } from './read.ts'
 * typed({ type: 'string', enum: ['open', 'done'] }) // 'string enum'
 * typed({ type: 'string', ref: 'session' }) // 'string → session'
 * ```
 */
export let typed = (prop: Record<string, unknown>): string =>
  [
    [prop.type].flat().filter(Boolean).join('|'),
    prop.format,
    prop.enum ? 'enum' : null,
    prop.ref ? `→ ${prop.ref}` : null,
  ].filter(Boolean).join(' ')

/**
 * What is special about a property, off its `_prop` row: who owns it,
 * whether it is stored, how it is found.
 *
 * ```ts
 * import { flags } from './read.ts'
 * flags({ stamped: true, search: true, unique: null }) // ['stamped', 'search']
 * ```
 */
export let flags = (prop: Record<string, unknown>): string[] =>
  ['stamped', 'computed', 'required', 'search', 'unique', 'identity']
    .filter((k) => prop[k] === true)

/**
 * Some values' distinct members, in the order first met, blanks left out.
 *
 * ```ts
 * import { unique } from './read.ts'
 * unique(['a', '', 'b', 'a', undefined]) // ['a', 'b']
 * ```
 */
export let unique = (xs: (string | undefined | null)[]): string[] => [
  ...new Set(xs.filter((x): x is string => !!x)),
]
