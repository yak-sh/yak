import { derivedEid } from '@yaks/graph/identity'
import type { Presence, Vocab, VocabDoc } from '@yaks/vocab'
import { identityIn, nameIn } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The archetype and retired components, loaded beside the application's own
 * vocabulary. */
export const archetypeDoc: VocabDoc = doc

/** One set of components: its derived eid, the names its components are held
 * under (what a bundle and a presence test write), and its descriptor, what
 * `archetype.tables` stores and the eid derives from. */
export type Archetype = {
  readonly eid: string
  readonly tables: readonly string[]
  readonly descriptor: readonly string[]
}

/** How a set's components are written in its descriptor and read back: each
 * one's identity, the UUID its `$id` gives, or its name while it has none
 * (@yaks/vocab `identityIn`); and from an identity, the name a vocabulary
 * holds that component under. A name no word carries reads as itself. */
export type Naming = {
  readonly id: (name: string) => string
  readonly name: (id: string) => string
}

let plain: Naming = { id: (name) => name, name: (id) => id }

// A loaded vocabulary's naming, by its lookups: a layout made over it
// (`{ ...v }`) shares them, and so shares one naming.
let namings = new WeakMap<object, Naming>()

/** The naming a vocabulary gives descriptors; without one, every name is its
 * own identity. */
export let namingOf = (v?: Pick<Vocab, 'comp' | 'word'>): Naming => {
  if (!v) return plain
  let held = namings.get(v.word)
  if (!held) {
    held = { id: (name) => identityIn(v, name), name: (id) => nameIn(v, id) }
    namings.set(v.word, held)
  }
  return held
}

/** UTF-8 bytewise order, independent of locale and JavaScript's UTF-16 sort. */
export function canonical(tables: Iterable<string>): string[] {
  let names = [...new Set(tables)]
  for (let name of names) {
    // The string the id is derived from reserves comma and |; reject an
    // ambiguous name rather than let two different sets share an address.
    // SQLite component names never contain these characters.
    if (
      !name || name.includes('|') || name.includes(',') || name.includes('\0')
    ) {
      throw new Error(`Invalid archetype table name: ${JSON.stringify(name)}`)
    }
  }
  // ASCII's UTF-16 and UTF-8 orders agree. Ordinary component names need no
  // byte arrays, and a set with at most one member needs no comparison.
  if (names.length < 2 || names.every((name) => /^\p{ASCII}+$/u.test(name))) {
    return names.sort()
  }
  let encoder = new TextEncoder()
  let entries = names.map((name) => ({ name, bytes: encoder.encode(name) }))
  entries.sort((a, b) => {
    for (let i = 0; i < Math.min(a.bytes.length, b.bytes.length); i++) {
      if (a.bytes[i] != b.bytes[i]) return a.bytes[i] - b.bytes[i]
    }
    return a.bytes.length - b.bytes.length
  })
  return entries.map((e) => e.name)
}

/** The domain-separated UUID a descriptor derives: its entries bytewise
 * sorted and de-duplicated, then hashed. */
export function eidOf(descriptor: Iterable<string>): string {
  return addressed(canonical(descriptor))
}

let addressed = (names: readonly string[]) =>
  derivedEid('archetype|' + names.join(','))

/** The descriptor the scalar `archetype.tables` stores and transmits: its
 * entries, canonical. A descriptor written before its words had identities
 * holds their labels, and is read as it is. */
export function descriptorOf(value: unknown): string[] {
  return canonical(parsed(value))
}

/** The names a vocabulary holds a stored descriptor's components under, what
 * a bundle and a presence test write: each identity read back to its
 * component's name, and an entry no word carries as it is. Without a
 * vocabulary, the descriptor's own entries.
 *
 * ```ts
 * import { tablesOf } from '@yaks/archetype'
 * import { loadVocab } from '@yaks/vocab'
 * import { equal } from '@yaks/testing'
 *
 * let id = crypto.randomUUID()
 * let v = loadVocab({ $defs: {
 *   note: { component: true, $id: `urn:uuid:${id}` },
 *   tag: { component: true },
 * } })
 * equal(tablesOf(JSON.stringify([id, 'tag']), v), ['note', 'tag'])
 * equal(tablesOf('["note","tag"]', v), ['note', 'tag'])
 * ```
 */
export function tablesOf(
  value: unknown,
  v?: Pick<Vocab, 'comp' | 'word'>,
): string[] {
  let descriptor = descriptorOf(value)
  return v ? canonical(descriptor.map(namingOf(v).name)) : descriptor
}

let parsed = (value: unknown): string[] => {
  let list = typeof value == 'string' ? JSON.parse(value) : value
  if (!Array.isArray(list) || list.some((v) => typeof v != 'string')) {
    throw new Error('archetype.tables must be a JSON array of names')
  }
  return list
}

/** Whether a table set meets a presence predicate; no column values are read. */
export function satisfies(
  predicate: Presence,
  archetype: Pick<Archetype, 'tables'>,
): boolean {
  return (predicate.all ?? []).every((t) => archetype.tables.includes(t)) &&
    !(predicate.none ?? []).some((t) => archetype.tables.includes(t))
}

/**
 * Process-local immutable set/transition/predicate cache. It caches content,
 * never a claim that a row committed: rollback and other writers cannot poison
 * it. Repeated moves use the (from, +/-table) edge without hashing again.
 * A set is interned by the names its components are held under, and its
 * descriptor written by `naming`.
 */
export class Archetypes {
  constructor(private naming: Naming = plain) {}
  private byEid = new Map<string, Archetype>()
  private bySet = new Map<string, Archetype>()
  private byText = new Map<string, Archetype>()
  private edges = new Map<string, Archetype>()
  private predicates = new Map<string, readonly string[]>()

  /** Look up a set already learned from the file or computed by this process. */
  get(eid: string): Archetype | undefined {
    return this.byEid.get(eid)
  }

  /** Decode immutable scalar content: the set a stored descriptor describes,
   * under the eid that descriptor derives. Mutable arrays are read anew, and a
   * cached scalar says nothing about which entity currently carries it. */
  decode(value: unknown): Archetype {
    if (typeof value != 'string') return this.read(descriptorOf(value))
    if (value.length > 8192) return this.read(descriptorOf(value))
    let found = this.byText.get(value)
    if (found) return found
    let set = this.read(descriptorOf(value))
    if (this.byText.size >= 256) {
      this.byText.delete(this.byText.keys().next().value!)
    }
    this.byText.set(value, set)
    return set
  }

  // A descriptor's set. One written in another form than `naming` writes now
  // (labels, before its words had identities) still describes its set under
  // its own eid, and a presence test matches it too; a move from it lands on
  // the set as `naming` writes it.
  private read(descriptor: string[]): Archetype {
    let eid = addressed(descriptor)
    let found = this.byEid.get(eid)
    if (found) return found
    let set = this.intern(descriptor.map(this.naming.name))
    if (set.eid == eid) return set
    let other = Object.freeze({
      eid,
      tables: set.tables,
      descriptor: Object.freeze(descriptor),
    })
    this.byEid.set(eid, other)
    this.predicates.clear()
    return other
  }

  /** Intern a set by the names its components are held under, returning the
   * very same immutable object on repeated use. */
  intern(tables: Iterable<string>): Archetype {
    let names = canonical(tables)
    let key = names.join('|')
    let found = this.bySet.get(key)
    if (found) return found
    let descriptor = canonical(names.map(this.naming.id))
    let value = Object.freeze({
      eid: addressed(descriptor),
      tables: Object.freeze(names),
      descriptor: Object.freeze(descriptor),
    })
    this.bySet.set(key, value)
    this.byEid.set(value.eid, value)
    this.predicates.clear()
    return value
  }

  /** Add or remove one table; an already-satisfied move returns its source. */
  move(from: Archetype, table: string, add: boolean): Archetype {
    if (from.tables.includes(table) == add) return from
    let key = `${from.eid}${add ? '+' : '-'}${table}`
    let found = this.edges.get(key)
    if (found) return found
    let to = this.intern(
      add ? [...from.tables, table] : from.tables.filter((t) => t != table),
    )
    this.edges.set(key, to)
    this.edges.set(`${to.eid}${add ? '-' : '+'}${table}`, from)
    return to
  }

  /** Cached eids satisfying a predicate; learning a new set invalidates it. */
  matching(predicate: Presence): readonly string[] {
    let key = JSON.stringify([
      canonical(predicate.all ?? []),
      canonical(predicate.none ?? []),
    ])
    let found = this.predicates.get(key)
    if (found) return found
    let result = Object.freeze(
      [...this.byEid.values()].filter((a) => satisfies(predicate, a)).map((a) =>
        a.eid
      ),
    )
    this.predicates.set(key, result)
    return result
  }
}
