/**
 * What the inspector reads off a bundle or an answer: pure functions, the
 * vocabulary of every view. How a value is shaped, which hue a name wears, the
 * components an entity carries, the tables an archetype names, and how many
 * entities carry each component.
 *
 * @module
 */

import type { Bundle } from './host.ts'

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
  let first = String(text ?? '').split('\n')[0].trim()
  return first.length > n ? first.slice(0, n - 1) + '…' : first
}

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
